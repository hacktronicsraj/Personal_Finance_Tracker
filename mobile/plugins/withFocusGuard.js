const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  withStringsXml,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PKG = 'com.personal.financetracker';

/**
 * Focus Guard (personal-assistant enforcement layer):
 *  • An AccessibilityService watches which app is in the foreground. When
 *    Instagram opens and the day's gate isn't satisfied (morning blanket, nightly
 *    check-in, or a spare key), it sends the phone home and opens this app on the
 *    matching gate screen. When a granted Instagram session ends, it spends a key.
 *  • A DeviceAdminReceiver makes the app undeletable from the phone UI (removal
 *    then needs `adb uninstall`); the same service bounces the user out of the
 *    Settings screens that would disable the admin or uninstall the app.
 *  • A native module bridges gate state (SharedPreferences, shared with the
 *    service), permission checks, UsageStats, and "open Instagram now".
 *
 * All native code lives here so `expo prebuild --clean` reproduces it exactly.
 */

const PREFS = 'FocusGuardPrefs';
const IG = 'com.instagram.android';

const SERVICE_KT = `package ${PKG}

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject

/**
 * Enforces the Instagram gate. Stateless beyond SharedPreferences so it survives
 * being restarted by the system. The gate decision mirrors src/gate.ts.
 */
class FocusAccessibilityService : AccessibilityService() {
  private val handler = Handler(Looper.getMainLooper())
  private var inInstagram = false
  private var lastGatePromptAt = 0L

  companion object {
    const val TAG = "FocusGuard"
    const val PREFS = "${PREFS}"
    const val IG = "${IG}"
    const val DAILY_CAP_MIN = 30 // cumulative Instagram minutes/day — hard cap, no override
    // Windows that are NOT a real app switch: navigating within Instagram can
    // briefly surface these (a permission prompt, the photo/file picker, Play
    // services, the shade, the keyboard). Treating them as "left Instagram" was
    // the bug that spent a key and re-gated when opening DMs. They are ignored
    // entirely — only switching to a real other app or the launcher ends a session.
    val SYSTEM_IGNORE = setOf(
      "com.android.systemui", "android",
      "com.google.android.permissioncontroller", "com.android.permissioncontroller",
      "com.google.android.packageinstaller", "com.android.packageinstaller",
      "com.google.android.gms", "com.google.android.gsf",
      "com.google.android.providers.media.module", "com.android.providers.media.module",
      "com.google.android.documentsui", "com.android.documentsui",
      "com.google.android.photopicker", "com.android.intentresolver"
    )
  }

  private fun prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun today(): String {
    val ist = System.currentTimeMillis() + 19800000L // +5:30
    return java.time.Instant.ofEpochMilli(ist).toString().substring(0, 10)
  }

  private fun istMinutes(): Int {
    val ist = System.currentTimeMillis() + 19800000L
    val s = java.time.Instant.ofEpochMilli(ist).toString() // ...THH:MM:...
    return s.substring(11, 13).toInt() * 60 + s.substring(14, 16).toInt()
  }

  /** 23:00–06:00 IST is the night window (math challenge instead of flashcards). */
  private fun isNight(): Boolean {
    val m = istMinutes()
    return m >= 23 * 60 || m < 6 * 60
  }

  /** Cumulative Instagram foreground minutes since IST midnight (UsageStats). */
  private fun usageMinutesToday(): Int {
    return try {
      val usm = getSystemService(Context.USAGE_STATS_SERVICE) as android.app.usage.UsageStatsManager
      val istNow = System.currentTimeMillis() + 19800000L
      val istMidnight = istNow - (istNow % 86400000L)
      val start = istMidnight - 19800000L
      val stats = usm.queryUsageStats(android.app.usage.UsageStatsManager.INTERVAL_DAILY, start, System.currentTimeMillis())
      var ms = 0L
      for (s in stats) if (s.packageName == IG) ms += s.totalTimeInForeground
      (ms / 60000L).toInt()
    } catch (e: Exception) { 0 }
  }

  private fun state(): JSONObject {
    val raw = prefs().getString("state", null) ?: return fresh()
    return try {
      val j = JSONObject(raw)
      if (j.optString("day") != today()) fresh() else j
    } catch (e: Exception) { fresh() }
  }

  private fun fresh(): JSONObject = JSONObject()
    .put("day", today()).put("sessionActive", false)

  private fun save(j: JSONObject) = prefs().edit().putString("state", j.toString()).apply()

  /**
   * null = allowed right now; otherwise the reason to block. Mirrors
   * src/gate.ts decideOpen: the 30-min cap is absolute (checked even mid-session);
   * then an already-granted session; then night → math, day → flashcards.
   */
  private fun blockReason(s: JSONObject): String? {
    if (usageMinutesToday() >= DAILY_CAP_MIN) return "capped"
    if (s.optBoolean("sessionActive")) return null
    if (isNight()) return "math"
    return "flashcards"
  }

  /** True for windows that should not affect Instagram-session tracking. */
  private fun ignorable(pkg: String): Boolean {
    if (pkg == applicationContext.packageName) return true
    if (pkg in SYSTEM_IGNORE) return true
    return isInputMethod(pkg)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    try {
      if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
      val pkg = event.packageName?.toString() ?: return
      Log.d(TAG, "window=" + pkg + " inIg=" + inInstagram)

      // Uninstall / device-admin protection: bounce out of the screens that
      // would remove the app or disable the admin. (Checked before ignore so a
      // Settings/installer screen still triggers the guard.)
      if (isSettingsThreat(pkg, event)) {
        performGlobalAction(GLOBAL_ACTION_BACK)
        return
      }

      // System / transient / picker windows are not an app switch — a photo
      // picker or permission prompt raised from inside Instagram must NOT end the
      // session. Leave tracking untouched.
      if (ignorable(pkg)) return

      if (pkg == IG) {
        inInstagram = true
        handleInstagram()
      } else {
        // A genuine switch to another real app or the home launcher.
        if (inInstagram) onLeftInstagram()
        inInstagram = false
      }
    } catch (e: Exception) {
      // never let the accessibility service crash the phone
    }
  }

  private fun handleInstagram() {
    val s = state()
    val reason = blockReason(s) ?: return // session active → allow
    val nowMs = System.currentTimeMillis()
    if (nowMs - lastGatePromptAt < 1200) return // debounce rapid window events
    lastGatePromptAt = nowMs
    performGlobalAction(GLOBAL_ACTION_HOME)
    handler.postDelayed({ openGate(reason) }, 250)
  }

  private fun onLeftInstagram() {
    val s = state()
    if (s.optBoolean("sessionActive")) {
      // No key is spent — the 30-min/day cap is the limiter. The next open must
      // clear the gate (flashcards, or math at night) again.
      s.put("sessionActive", false)
      save(s)
    }
  }

  private fun openGate(reason: String) {
    val launch = Intent(Intent.ACTION_VIEW, Uri.parse("pft://gate?reason=" + reason))
    launch.setPackage(applicationContext.packageName)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    try { startActivity(launch) } catch (e: Exception) {
      val fallback = packageManager.getLaunchIntentForPackage(applicationContext.packageName)
      fallback?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (fallback != null) startActivity(fallback)
    }
  }

  private fun isInputMethod(pkg: String): Boolean =
    pkg.contains("inputmethod") || pkg.contains("keyboard") || pkg.contains("latin") || pkg.contains("gboard")

  /** Heuristic: the Settings/installer app showing an uninstall or admin-deactivate
   * screen that names this app. */
  private fun isSettingsThreat(pkg: String, event: AccessibilityEvent): Boolean {
    if (!(pkg.contains("settings") || pkg.contains("packageinstaller"))) return false
    val src = event.source ?: return false
    val hay = StringBuilder()
    collectText(src, hay, 0)
    val t = hay.toString().lowercase()
    val mentionsApp = t.contains("finance tracker") || t.contains("raju")
    val threat = t.contains("uninstall") || t.contains("deactivate") || t.contains("device admin") || t.contains("turn off")
    return mentionsApp && threat
  }

  private fun collectText(node: android.view.accessibility.AccessibilityNodeInfo?, sb: StringBuilder, depth: Int) {
    if (node == null || depth > 12) return
    node.text?.let { sb.append(it).append(' ') }
    node.contentDescription?.let { sb.append(it).append(' ') }
    for (i in 0 until node.childCount) collectText(node.getChild(i), sb, depth + 1)
  }

  override fun onInterrupt() {}
}
`;

const MODULE_KT = `package ${PKG}

import android.app.AppOpsManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Process
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class FocusGuardModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FocusGuard"

  private fun prefs() = reactApplicationContext.getSharedPreferences("${PREFS}", Context.MODE_PRIVATE)

  @ReactMethod
  fun getState(promise: Promise) {
    promise.resolve(prefs().getString("state", null))
  }

  @ReactMethod
  fun setState(json: String, promise: Promise) {
    prefs().edit().putString("state", json).apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun isAccessibilityEnabled(promise: Promise) {
    promise.resolve(accessibilityOn())
  }

  private fun accessibilityOn(): Boolean {
    val expected = ComponentName(reactApplicationContext, FocusAccessibilityService::class.java).flattenToString()
    val enabled = Settings.Secure.getString(reactApplicationContext.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabled)
    for (s in splitter) if (s.equals(expected, ignoreCase = true)) return true
    return false
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    val i = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(i)
    promise.resolve(true)
  }

  /* ---- Usage access (for "you've used Instagram X today") ---- */

  @ReactMethod
  fun hasUsageAccess(promise: Promise) {
    val appOps = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), reactApplicationContext.packageName)
    promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
  }

  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    val i = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(i)
    promise.resolve(true)
  }

  /** Foreground minutes for a package since IST midnight today. */
  @ReactMethod
  fun getUsageToday(pkg: String, promise: Promise) {
    try {
      val usm = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as android.app.usage.UsageStatsManager
      val istNow = System.currentTimeMillis() + 19800000L
      val istMidnight = istNow - (istNow % 86400000L)
      val start = istMidnight - 19800000L
      val stats = usm.queryUsageStats(android.app.usage.UsageStatsManager.INTERVAL_DAILY, start, System.currentTimeMillis())
      var ms = 0L
      for (s in stats) if (s.packageName == pkg) ms += s.totalTimeInForeground
      promise.resolve((ms / 60000L).toInt())
    } catch (e: Exception) { promise.resolve(0) }
  }

  /* ---- Device admin (uninstall protection) ---- */

  @ReactMethod
  fun isAdminActive(promise: Promise) {
    val dpm = reactApplicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    promise.resolve(dpm.isAdminActive(ComponentName(reactApplicationContext, FocusAdminReceiver::class.java)))
  }

  @ReactMethod
  fun requestAdmin(promise: Promise) {
    val i = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
    i.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, ComponentName(reactApplicationContext, FocusAdminReceiver::class.java))
    i.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Finance Tracker uses device admin so it can't be uninstalled on a whim. Remove it later with: adb uninstall ${PKG}")
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(i)
    promise.resolve(true)
  }

  @ReactMethod
  fun launchInstagram(promise: Promise) {
    val i = reactApplicationContext.packageManager.getLaunchIntentForPackage("${IG}")
    if (i == null) { promise.resolve(false); return }
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(i)
    promise.resolve(true)
  }

  @ReactMethod
  fun goHome(promise: Promise) {
    val i = Intent(Intent.ACTION_MAIN)
    i.addCategory(Intent.CATEGORY_HOME)
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(i)
    promise.resolve(true)
  }
}
`;

const ADMIN_KT = `package ${PKG}

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

/** Marks the app as a device admin so it can't be uninstalled from the phone UI. */
class FocusAdminReceiver : DeviceAdminReceiver() {
  override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
    "This will let Finance Tracker be uninstalled. If you really mean to, continue."
}
`;

const PACKAGE_KT = `package ${PKG}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class FocusGuardPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(FocusGuardModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

const SERVICE_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagDefault|flagRetrieveInteractiveWindows"
    android:canRetrieveWindowContent="true"
    android:notificationTimeout="100"
    android:description="@string/focus_guard_desc" />
`;

const ADMIN_POLICY_XML = `<?xml version="1.0" encoding="utf-8"?>
<device-admin xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-policies>
        <force-lock />
    </uses-policies>
</device-admin>
`;

function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    app.service = app.service || [];
    app.receiver = app.receiver || [];

    if (!app.service.some((s) => s['$']['android:name'] === '.FocusAccessibilityService')) {
      app.service.push({
        $: {
          'android:name': '.FocusAccessibilityService',
          'android:exported': 'false',
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }] }],
        'meta-data': [{ $: { 'android:name': 'android.accessibilityservice', 'android:resource': '@xml/focus_guard_service' } }],
      });
    }
    if (!app.receiver.some((r) => r['$']['android:name'] === '.FocusAdminReceiver')) {
      app.receiver.push({
        $: {
          'android:name': '.FocusAdminReceiver',
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_DEVICE_ADMIN',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.app.action.DEVICE_ADMIN_ENABLED' } }] }],
        'meta-data': [{ $: { 'android:name': 'android.app.device_admin', 'android:resource': '@xml/focus_admin_policy' } }],
      });
    }
    return cfg;
  });
}

function withStrings(config) {
  return withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [{ _: 'Enforces your Instagram limits: 5 flashcards to open it, a 30-minute daily cap, and a math challenge at night.', $: { name: 'focus_guard_desc' } }],
      cfg.modResults,
    );
    return cfg;
  });
}

function withNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const javaDir = path.join(root, 'app/src/main/java', ...PKG.split('.'));
      const resXml = path.join(root, 'app/src/main/res/xml');
      const write = (p, contents) => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, contents);
      };
      write(path.join(javaDir, 'FocusAccessibilityService.kt'), SERVICE_KT);
      write(path.join(javaDir, 'FocusGuardModule.kt'), MODULE_KT);
      write(path.join(javaDir, 'FocusAdminReceiver.kt'), ADMIN_KT);
      write(path.join(javaDir, 'FocusGuardPackage.kt'), PACKAGE_KT);
      write(path.join(resXml, 'focus_guard_service.xml'), SERVICE_CONFIG_XML);
      write(path.join(resXml, 'focus_admin_policy.xml'), ADMIN_POLICY_XML);
      return cfg;
    },
  ]);
}

function withPackageRegistration(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('FocusGuardPackage()')) {
      src = src.replace(
        /(val packages = PackageList\(this\)\.packages)/,
        '$1\n            packages.add(FocusGuardPackage())',
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = (config) =>
  withPackageRegistration(withNativeFiles(withStrings(withManifest(config))));

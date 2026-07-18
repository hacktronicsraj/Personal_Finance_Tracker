const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PKG = 'com.personal.financetracker';
const PREFS = 'SpendWidgetPrefs';
const PREFS_KEY = 'data';

/**
 * Home-screen widget (M8): this-month spend + next upcoming mandate + last-updated
 * stamp, Ink-dark styling. The JS side writes a `data` JSON blob into the
 * "SpendWidgetPrefs" SharedPreferences and broadcasts a refresh; the provider
 * reads it and populates the RemoteViews. All native code lives in this plugin so
 * `expo prebuild --clean` reproduces it exactly.
 *
 * M4 lands this skeleton (provider + layout + manifest) so the one clean prebuild
 * includes it; M8 adds the native bridge module + JS wiring that fill it with data.
 */

// AppWidgetProvider — renders SharedPreferences data into the RemoteViews, or a
// placeholder before the app has written anything. `renderAll` is the entry point
// the bridge module (M8) calls to push a refresh.
const PROVIDER_KT = `package ${PKG}

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import org.json.JSONObject
import android.widget.RemoteViews

class SpendWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) render(context, manager, id)
  }

  companion object {
    const val PREFS = "${PREFS}"
    const val PREFS_KEY = "${PREFS_KEY}"

    fun renderAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, SpendWidgetProvider::class.java))
      for (id in ids) render(context, manager, id)
    }

    private fun render(context: Context, manager: AppWidgetManager, id: Int) {
      val views = RemoteViews(context.packageName, R.layout.spend_widget)
      try {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREFS_KEY, null)
        if (raw != null) {
          val j = JSONObject(raw)
          views.setTextViewText(R.id.widget_amount, "₹" + j.optString("monthTotal", "0"))
          val name = j.optString("mandateName", "")
          if (name.isNotEmpty()) {
            views.setTextViewText(
              R.id.widget_mandate,
              "Next · " + name + "  ₹" + j.optString("mandateAmount", "") + "  " + j.optString("mandateDate", "")
            )
          } else {
            views.setTextViewText(R.id.widget_mandate, "No upcoming mandates")
          }
          val updated = j.optString("updatedAt", "")
          views.setTextViewText(R.id.widget_updated, if (updated.isNotEmpty()) "updated " + updated else "")
        } else {
          views.setTextViewText(R.id.widget_amount, "₹—")
          views.setTextViewText(R.id.widget_mandate, "Open the app to sync")
          views.setTextViewText(R.id.widget_updated, "")
        }
      } catch (e: Exception) {
        views.setTextViewText(R.id.widget_amount, "₹—")
      }
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (launch != null) {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, launch, flags))
      }
      manager.updateAppWidget(id, views)
    }
  }
}
`;

const LAYOUT_XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@drawable/spend_widget_bg"
    android:padding="16dp">

    <TextView
        android:id="@+id/widget_label"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="SPENT THIS MONTH"
        android:textColor="#6B6B73"
        android:textSize="10sp"
        android:letterSpacing="0.15"
        android:fontFamily="monospace" />

    <TextView
        android:id="@+id/widget_amount"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="4dp"
        android:text="₹—"
        android:textColor="#FAFAFA"
        android:textSize="30sp"
        android:textStyle="bold" />

    <TextView
        android:id="@+id/widget_mandate"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:maxLines="1"
        android:ellipsize="end"
        android:text=""
        android:textColor="#A1A1AA"
        android:textSize="12sp" />

    <TextView
        android:id="@+id/widget_updated"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="6dp"
        android:text=""
        android:textColor="#444448"
        android:textSize="10sp"
        android:fontFamily="monospace" />
</LinearLayout>
`;

const BG_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#0A0A0C" />
    <corners android:radius="22dp" />
    <stroke android:width="1dp" android:color="#222226" />
</shape>
`;

const INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="180dp"
    android:minHeight="110dp"
    android:targetCellWidth="3"
    android:targetCellHeight="2"
    android:updatePeriodMillis="0"
    android:resizeMode="horizontal|vertical"
    android:widgetCategory="home_screen"
    android:initialLayout="@layout/spend_widget" />
`;

// Native module (M8): JS writes the widget's data JSON into SharedPreferences and
// triggers an immediate re-render. Event-driven — no WorkManager/polling.
const MODULE_KT = `package ${PKG}

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SpendWidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "SpendWidget"

  @ReactMethod
  fun setData(json: String, promise: Promise) {
    try {
      val ctx = reactApplicationContext
      ctx.getSharedPreferences(SpendWidgetProvider.PREFS, Context.MODE_PRIVATE)
        .edit().putString(SpendWidgetProvider.PREFS_KEY, json).apply()
      SpendWidgetProvider.renderAll(ctx)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("WIDGET_ERR", e)
    }
  }
}
`;

const PACKAGE_KT = `package ${PKG}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SpendWidgetPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(SpendWidgetModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    app.receiver = app.receiver || [];
    if (!app.receiver.some((r) => r['$']['android:name'] === '.SpendWidgetProvider')) {
      app.receiver.push({
        $: { 'android:name': '.SpendWidgetProvider', 'android:exported': 'false' },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': '@xml/spend_widget_info',
            },
          },
        ],
      });
    }
    return cfg;
  });
}

function withNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const javaDir = path.join(root, 'app/src/main/java', ...PKG.split('.'));
      const resMain = path.join(root, 'app/src/main/res');
      const write = (p, contents) => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, contents);
      };
      write(path.join(javaDir, 'SpendWidgetProvider.kt'), PROVIDER_KT);
      write(path.join(javaDir, 'SpendWidgetModule.kt'), MODULE_KT);
      write(path.join(javaDir, 'SpendWidgetPackage.kt'), PACKAGE_KT);
      write(path.join(resMain, 'layout/spend_widget.xml'), LAYOUT_XML);
      write(path.join(resMain, 'drawable/spend_widget_bg.xml'), BG_XML);
      write(path.join(resMain, 'xml/spend_widget_info.xml'), INFO_XML);
      return cfg;
    },
  ]);
}

// Register SpendWidgetPackage in MainApplication.getPackages(). Same package as
// MainApplication (no import needed). Idempotent.
function withPackageRegistration(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('SpendWidgetPackage()')) {
      src = src.replace(
        /(val packages = PackageList\(this\)\.packages)/,
        '$1\n            packages.add(SpendWidgetPackage())',
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = (config) => withPackageRegistration(withNativeFiles(withManifest(config)));

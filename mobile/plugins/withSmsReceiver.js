const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PKG = 'com.personal.financetracker';

// BroadcastReceiver: fires on incoming SMS even when the app is killed, then
// hands the message to a headless JS task. Wrapped in try/catch so a bad SMS
// can never crash the phone's messaging.
const RECEIVER_KT = `package ${PKG}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.facebook.react.HeadlessJsTaskService

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
      val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
      if (messages.isEmpty()) return
      val sender = messages[0].displayOriginatingAddress ?: ""
      val body = StringBuilder()
      for (m in messages) body.append(m.messageBody ?: "")

      val serviceIntent = Intent(context, SmsHeadlessService::class.java)
      serviceIntent.putExtra("body", body.toString())
      serviceIntent.putExtra("sender", sender)
      context.startService(serviceIntent)
      HeadlessJsTaskService.acquireWakeLockNow(context)
    } catch (e: Exception) {
      // Never crash on SMS receipt.
    }
  }
}
`;

// HeadlessJsTaskService: runs the "SmsHeadlessTask" JS task with the SMS payload
// while the app is in the background or killed.
const SERVICE_KT = `package ${PKG}

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SmsHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent): HeadlessJsTaskConfig? {
    val extras = intent.extras ?: return null
    return HeadlessJsTaskConfig(
      "SmsHeadlessTask",
      Arguments.fromBundle(extras),
      30000,
      true
    )
  }
}
`;

function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    app.receiver = app.receiver || [];
    app.service = app.service || [];

    if (!app.receiver.some((r) => r['$']['android:name'] === '.SmsReceiver')) {
      app.receiver.push({
        $: {
          'android:name': '.SmsReceiver',
          'android:exported': 'true',
          'android:permission': 'android.permission.BROADCAST_SMS',
        },
        'intent-filter': [
          {
            $: { 'android:priority': '999' },
            action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }],
          },
        ],
      });
    }

    if (!app.service.some((s) => s['$']['android:name'] === '.SmsHeadlessService')) {
      app.service.push({ $: { 'android:name': '.SmsHeadlessService', 'android:exported': 'false' } });
    }

    return cfg;
  });
}

function withNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java', ...PKG.split('.'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SmsReceiver.kt'), RECEIVER_KT);
      fs.writeFileSync(path.join(dir, 'SmsHeadlessService.kt'), SERVICE_KT);
      return cfg;
    },
  ]);
}

module.exports = (config) => withNativeFiles(withManifest(config));

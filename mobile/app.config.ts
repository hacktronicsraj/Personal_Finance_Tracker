import type { ExpoConfig } from 'expo/config';

/**
 * Android-only personal build. SMS permissions require a custom dev/APK build
 * (NOT Expo Go). Install via EAS or `expo run:android` on your own device.
 */
const config: ExpoConfig = {
  name: 'Finance Tracker',
  slug: 'pft-mobile',
  scheme: 'pft',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // Old architecture: HeadlessJsTaskService and the SMS-reading native modules
  // are most reliable on the bridge (not bridgeless/new-arch).
  newArchEnabled: false,
  android: {
    package: 'com.personal.financetracker',
    permissions: [
      'android.permission.READ_SMS',
      'android.permission.RECEIVE_SMS',
      'android.permission.POST_NOTIFICATIONS',
      // Keep the SMS receiver + background scan alive on aggressive OEMs.
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-asset',
    'expo-font',
    'expo-sqlite',
    [
      'expo-notifications',
      {
        // default channel/icon config; category actions are registered at runtime.
      },
    ],
    './plugins/withSmsReceiver',
    // Receive payments shared from Google Pay (screenshot image) / PhonePe / Paytm
    // (text) via the Android share sheet.
    [
      'expo-share-intent',
      {
        // Android-only app — skip the iOS share-extension config (it needs an
        // iOS bundle id / app group we don't have).
        disableIOS: true,
        androidIntentFilters: ['text/*', 'image/*'],
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
};

export default config;

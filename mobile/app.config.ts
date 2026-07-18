import type { ExpoConfig } from 'expo/config';

/**
 * Android-only personal build. SMS permissions require a custom dev/APK build
 * (NOT Expo Go). Install via EAS or `expo run:android` on your own device.
 */
const config: ExpoConfig = {
  name: "Raju's Finance Tracker",
  slug: 'pft-mobile',
  scheme: 'pft',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  // Old architecture: HeadlessJsTaskService and the SMS-reading native modules
  // are most reliable on the bridge (not bridgeless/new-arch).
  newArchEnabled: false,
  android: {
    package: 'com.personal.financetracker',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#241318',
    },
    permissions: [
      'android.permission.READ_SMS',
      'android.permission.RECEIVE_SMS',
      'android.permission.POST_NOTIFICATIONS',
      // Keep the SMS receiver + background scan alive on aggressive OEMs.
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      // Receipt capture (M6 attachments) from the camera.
      'android.permission.CAMERA',
      // Biometric app lock (M5).
      'android.permission.USE_BIOMETRIC',
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
        // Monochrome white glyph → clean status-bar icon (a photo would render as
        // an ugly white blob). Accent tints the icon + heads-up.
        icon: './assets/notification-icon.png',
        color: '#34D399',
      },
    ],
    './plugins/withSmsReceiver',
    // Home-screen widget (this-month spend + next mandate). Owns all its native
    // code so clean prebuilds stay safe. (M4 skeleton, M8 completes the bridge.)
    './plugins/withSpendWidget',
    // Receipt capture for attachments (M6). Config plugin sets the Android
    // camera/photo permission rationale strings.
    [
      'expo-image-picker',
      {
        photosPermission: 'Attach a receipt from your photos.',
        cameraPermission: 'Snap a photo of a receipt to attach it.',
      },
    ],
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

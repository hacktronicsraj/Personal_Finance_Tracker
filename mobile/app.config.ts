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
  // OTA updates (EAS Update). JS/asset changes ship over the air; anything that
  // touches native code (a new module, a permission, the config plugins below)
  // still needs a fresh APK. The 'fingerprint' policy computes a hash of the
  // native project, so an update is only offered to a build whose native side
  // actually matches — a JS bundle can never land on an APK that lacks the
  // native code it needs.
  runtimeVersion: { policy: 'fingerprint' },
  updates: {
    // Check on launch; fall back to the bundled JS if the network is slow.
    fallbackToCacheTimeout: 5000,
    checkAutomatically: 'ON_LOAD',
  },
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
      // Focus Guard: read Instagram foreground time for the "used X today" warning.
      'android.permission.PACKAGE_USAGE_STATS',
      // See if Instagram is installed and launch it after a granted key.
      'android.permission.QUERY_ALL_PACKAGES',
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
        // 'application/pdf' lets a bank statement be shared straight to the app
        // for weekly reconciliation.
        androidIntentFilters: ['text/*', 'image/*', 'application/pdf'],
        // Override the library's default launchMode of "singleTask" — that breaks
        // expo-image-picker's camera (the result never comes back, so the blanket /
        // receipt capture hangs on "Working…"). "singleTop" delivers camera results
        // and still routes a shared payment/PDF via onNewIntent.
        androidMainActivityAttributes: { 'android:launchMode': 'singleTop' },
      },
    ],
    // Instagram gate enforcement (accessibility service + device-admin uninstall
    // protection + UsageStats) — see plugins/withFocusGuard.js.
    './plugins/withFocusGuard',
    // On-device PDF text extraction for statement reconciliation.
    './plugins/withPdfText',
  ],
  experiments: {
    typedRoutes: false,
  },
};

export default config;

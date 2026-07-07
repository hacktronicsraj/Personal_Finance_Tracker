import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

/**
 * Deep-links into the Android settings that keep background SMS capture alive.
 * On aggressive OEM skins (MIUI/ColorOS/FuncTouch/etc.) a sideloaded app's
 * broadcast receiver is killed unless it's exempt from battery optimization and
 * allowed to autostart. These are the screens where the user grants that.
 */

const PKG = 'com.personal.financetracker';

export async function openBatteryOptimization(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    // System dialog: "Allow <app> to ignore battery optimizations?"
    await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', {
      data: `package:${PKG}`,
    });
  } catch {
    try {
      await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    } catch {
      /* not available on this device */
    }
  }
}

export async function openAppDetails(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
      data: `package:${PKG}`,
    });
  } catch {
    /* ignore */
  }
}

// OEM autostart / background-start screens, keyed by manufacturer substring.
// Multiple candidates per brand because class names differ across skin versions.
const AUTOSTART: Record<string, { packageName: string; className: string }[]> = {
  xiaomi: [{ packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' }],
  redmi: [{ packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' }],
  poco: [{ packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' }],
  oppo: [
    { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
    { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
    { packageName: 'com.oppo.safe', className: 'com.oppo.safe.permission.startup.StartupAppListActivity' },
  ],
  realme: [
    { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
    { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
  ],
  vivo: [
    { packageName: 'com.iqoo.secure', className: 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity' },
    { packageName: 'com.vivo.permissionmanager', className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
  ],
  oneplus: [{ packageName: 'com.oneplus.security', className: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity' }],
  huawei: [
    { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity' },
    { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.optimize.process.ProtectActivity' },
  ],
};

export function deviceBrand(): string {
  return (Device.manufacturer || Device.brand || '').toLowerCase();
}

/** True when this OEM is known to have a hidden autostart screen worth surfacing. */
export function hasAutostartControls(): boolean {
  const brand = deviceBrand();
  return Object.keys(AUTOSTART).some((k) => brand.includes(k));
}

/** Try to open the OEM autostart screen; fall back to the app-details page. */
export async function openAutostartSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const brand = deviceBrand();
  const key = Object.keys(AUTOSTART).find((k) => brand.includes(k));
  for (const c of key ? AUTOSTART[key] : []) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        packageName: c.packageName,
        className: c.className,
      });
      return true;
    } catch {
      /* try the next candidate */
    }
  }
  await openAppDetails();
  return false;
}

import { NativeModules, Platform } from 'react-native';
import {
  decideOpen,
  endSession,
  freshState,
  grantSession,
  rolled,
  type GateDecision,
  type GateState,
} from './gate';

/**
 * Bridge to the native Focus Guard (plugins/withFocusGuard.js). Gate state lives
 * in Android SharedPreferences so the AccessibilityService — which runs with no
 * JS alive — reads the same source of truth this module writes. Every call is a
 * safe no-op when the native module is absent (Expo Go, older builds).
 */
const M = (NativeModules as any).FocusGuard as
  | {
      getState(): Promise<string | null>;
      setState(json: string): Promise<boolean>;
      isAccessibilityEnabled(): Promise<boolean>;
      openAccessibilitySettings(): Promise<boolean>;
      hasUsageAccess(): Promise<boolean>;
      openUsageAccessSettings(): Promise<boolean>;
      getUsageToday(pkg: string): Promise<number>;
      isAdminActive(): Promise<boolean>;
      requestAdmin(): Promise<boolean>;
      launchInstagram(): Promise<boolean>;
      goHome(): Promise<boolean>;
    }
  | undefined;

export const INSTAGRAM_PKG = 'com.instagram.android';
export function focusGuardAvailable(): boolean {
  return Platform.OS === 'android' && !!M;
}

export async function instagramUsageToday(): Promise<number> {
  try {
    return (await M?.getUsageToday(INSTAGRAM_PKG)) ?? 0;
  } catch {
    return 0;
  }
}

export async function readState(): Promise<GateState> {
  try {
    const raw = await M?.getState();
    if (raw) return rolled(JSON.parse(raw));
  } catch {}
  return freshState();
}

async function writeState(s: GateState): Promise<GateState> {
  try {
    await M?.setState(JSON.stringify(s));
  } catch {}
  return s;
}

/** Decide what the gate should show for an Instagram open right now. */
export async function currentDecision(): Promise<{ state: GateState; decision: GateDecision; usedMinutes: number }> {
  const [state, usedMinutes] = await Promise.all([readState(), instagramUsageToday()]);
  return { state, decision: decideOpen(state, usedMinutes), usedMinutes };
}

// When we granted the last session — the foreground safety-net ignores the brief
// window right after a grant (our app is being pushed back as Instagram launches).
let lastGrantAt = 0;

/** Grant a session and open Instagram (cleared the flashcards / math gate). */
export async function openInstagramSession(): Promise<void> {
  await writeState(grantSession(await readState()));
  lastGrantAt = Date.now();
  try {
    await M?.launchInstagram();
  } catch {}
}

/** Safety net: close a leaked session when our app is foregrounded. */
export async function reconcileSessionOnForeground(): Promise<void> {
  if (Date.now() - lastGrantAt < 15_000) return;
  const s = await readState();
  if (s.sessionActive) await writeState(endSession(s));
}

export async function goHome(): Promise<void> {
  try {
    await M?.goHome();
  } catch {}
}

/* ---- permissions & status (Focus settings screen) ---- */

export interface FocusStatus {
  available: boolean;
  accessibility: boolean;
  usageAccess: boolean;
  adminActive: boolean;
}

export async function focusStatus(): Promise<FocusStatus> {
  if (!focusGuardAvailable()) {
    return { available: false, accessibility: false, usageAccess: false, adminActive: false };
  }
  const [accessibility, usageAccess, adminActive] = await Promise.all([
    M!.isAccessibilityEnabled().catch(() => false),
    M!.hasUsageAccess().catch(() => false),
    M!.isAdminActive().catch(() => false),
  ]);
  return { available: true, accessibility, usageAccess, adminActive };
}

export const openAccessibilitySettings = () => M?.openAccessibilitySettings().catch(() => {});
export const openUsageAccessSettings = () => M?.openUsageAccessSettings().catch(() => {});
export const requestAdmin = () => M?.requestAdmin().catch(() => {});

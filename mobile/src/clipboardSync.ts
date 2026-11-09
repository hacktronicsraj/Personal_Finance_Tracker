import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';
import { getSettings } from './settings';

/**
 * Shared clipboard with the Mac, through the same backend as the finance app.
 *
 * Text copied on the phone is pushed automatically while the app is open;
 * images and files are sent by tapping Send. Everything new from the Mac is
 * put on the phone's clipboard (text) or saved to the app's folder (files).
 */

const POLL_MS = 4000;
const OWNER = 'drwatson';

export interface PhoneClipboardItem {
  id: string;
  kind: 'text' | 'image' | 'file';
  text: string | null;
  deviceId: string;
  deviceName: string | null;
  mime: string | null;
  fileName: string | null;
  byteSize: number | null;
  createdAt: string;
  deleted: boolean;
}

type Listener = (items: PhoneClipboardItem[]) => void;

class PhoneClipboardSync {
  private since = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private listener: Listener | null = null;
  private lastPushed: string | null = null;
  private lastClipboard: string | null = null;
  private appState: AppStateStatus = AppState.currentState;
  private subscribed = false;
  private running = false;
  items: PhoneClipboardItem[] = [];
  lastError: string | null = null;

  /** Starts polling and watching the phone's clipboard. Safe to call twice. */
  async start() {
    if (this.running) return;
    this.running = true;
    this.since = new Date().toISOString();
    this.subscribeToAppState();
    await this.watchLocalClipboard();
    this.timer = setInterval(() => {
      if (this.appState === 'active') {
        void this.poll();
        void this.watchLocalClipboard();
      }
    }, POLL_MS);
    void this.poll();
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(listener: Listener | null) {
    this.listener = listener;
    if (listener) listener(this.items);
  }

  private subscribeToAppState() {
    if (this.subscribed) return;
    this.subscribed = true;
    AppState.addEventListener('change', (state) => {
      this.appState = state;
      if (state === 'active') void this.poll();
    });
  }

  /** Text copied anywhere on the phone goes up on its own. */
  private async watchLocalClipboard() {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || text === this.lastClipboard) return;
      this.lastClipboard = text;
      if (text !== this.lastPushed) await this.pushText(text);
    } catch {
      // Clipboard access can fail while the app is backgrounded; try again next tick.
    }
  }

  async pushText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.lastPushed = trimmed;
    await this.request('/clipboard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: trimmed, deviceId: await deviceId(), deviceName: 'Pixel' }),
    });
  }

  /** Sends an image or file the person picked or shared into the app. */
  async pushFile(uri: string, name: string, mime: string, kind: 'image' | 'file' = 'file') {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) throw new Error('That file is gone');
    const res = await fetch(uri);
    const blob = await res.blob();
    await this.request('/clipboard', {
      method: 'POST',
      headers: {
        'content-type': mime,
        'x-clipboard-kind': kind,
        'x-clipboard-mime': mime,
        'x-clipboard-name': name,
        'x-clipboard-device': await deviceId(),
        'x-clipboard-device-name': 'Pixel',
      },
      body: blob,
    });
  }

  /** Puts an item on the phone's clipboard, or saves it to the app's folder. */
  async receive(item: PhoneClipboardItem) {
    if (item.kind === 'text' && item.text) {
      await Clipboard.setStringAsync(item.text);
      this.lastClipboard = item.text;
      return;
    }
    const dir = `${FileSystem.documentDirectory}shared/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const target = `${dir}${Date.now()}-${item.fileName ?? 'file'}`;
    await FileSystem.downloadAsync(await this.blobUrl(item.id), target);
  }

  private async poll() {
    const data = await this.request(
      `/clipboard?since=${encodeURIComponent(this.since)}&limit=50`,
      { method: 'GET' },
    );
    if (!data || !Array.isArray(data.items)) return;
    const fresh = (data.items as PhoneClipboardItem[])
      .filter((i) => i.deviceId !== 'phone' && !i.deleted);
    if (fresh.length) {
      for (const item of [...fresh].reverse()) {
        if (item.deviceId !== (await deviceId())) await this.receive(item);
      }
      this.items = [...fresh, ...this.items].slice(0, 100);
      this.listener?.(this.items);
    }
    if (typeof data.serverTime === 'string') this.since = data.serverTime;
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    const { backendUrl, apiToken } = await getSettings();
    if (!backendUrl) return null;
    try {
      const res = await fetch(`${backendUrl}${path}`, {
        ...init,
        headers: {
          ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
          'x-clipboard-owner': OWNER,
          ...(init.headers ?? {}),
        },
      });
      this.lastError = res.ok ? null : `${init.method ?? 'GET'} ${path} → ${res.status}`;
      return res.ok ? await res.json() : null;
    } catch (e: any) {
      this.lastError = e?.message ?? 'network error';
      return null;
    }
  }

  private async blobUrl(id: string): Promise<string> {
    const { backendUrl, apiToken } = await getSettings();
    return `${backendUrl}/clipboard/${id}/blob?token=${encodeURIComponent(apiToken ?? '')}`;
  }
}

async function deviceId(): Promise<string> {
  const { deviceId } = await getSettings();
  return deviceId;
}

export const phoneClipboard = new PhoneClipboardSync();

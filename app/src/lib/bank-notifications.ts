import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { api, getSession } from './api';

type Native = {
  isEnabled(): boolean;
  openSettings(): void;
  getPending(): string;
  remove(keys: string[]): void;
};

type Captured = { key: string; app: string; title: string; text: string; posted_at: number };

// Solo existe en el APK de Android (no en Expo Go ni en iOS).
const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('BankNotifications') : null;

export const bankNotificationsSupported = !!native;

export function bankNotificationsEnabled() {
  return native?.isEnabled() ?? false;
}

export function openNotificationAccessSettings() {
  native?.openSettings();
}

let flushing = false;

/** Manda al servidor las notificaciones del banco capturadas; devuelve cuántas quedaron por aprobar. */
export async function flushBankNotifications(): Promise<number> {
  if (!native || flushing || !(await getSession()).token) return 0;
  flushing = true;
  let added = 0;
  try {
    const pending = JSON.parse(native.getPending() || '[]') as Captured[];
    for (let i = 0; i < pending.length; i += 20) {
      const batch = pending.slice(i, i + 20);
      const r = await api<{ added: number }>('/inbox/notifications', { method: 'POST', json: { items: batch }, timeoutMs: 120_000 });
      native.remove(batch.map((n) => n.key));
      added += r.added;
    }
  } catch {
    // Sin conexión: se reintenta la próxima vez que se abra la app.
  } finally {
    flushing = false;
  }
  return added;
}

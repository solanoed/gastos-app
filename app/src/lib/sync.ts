// Sincronización con el servidor: el celular es la fuente de verdad y sube una foto completa
// de sus tablas (son pocos datos). También sube las fotos/íconos que falten y permite restaurar.

import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from '@/db/repo';
import { DB_VERSION } from '@/db/schema';

import { api, getSession } from './api';
import { nowStamp } from './format';

const CUSTOM_ICON_PREFIX = 'img:';

// Mismas columnas que server/src/tables.ts, en orden de inserción (padres primero).
const TABLES: Record<string, string[]> = {
  categories: ['id', 'uid', 'name', 'icon', 'color', 'kind', 'aliases', 'budget', 'sort', 'archived'],
  people: ['id', 'uid', 'name', 'phone'],
  cards: ['id', 'uid', 'name', 'credit_limit', 'ea_rate', 'cut_day', 'pay_day', 'color', 'archived'],
  card_purchases: [
    'id', 'uid', 'card_id', 'description', 'amount', 'installments', 'monthly_rate',
    'installment_override', 'purchase_date', 'first_payment_month', 'category_id',
  ],
  movements: [
    'id', 'uid', 'type', 'amount', 'category_id', 'concept', 'person_id', 'date',
    'settled', 'settled_at', 'card_purchase_id', 'created_at', 'updated_at',
  ],
  attachments: ['id', 'uid', 'movement_id', 'uri'],
  recurring: ['id', 'uid', 'kind', 'name', 'amount', 'day', 'goal', 'saved_initial', 'active', 'sort'],
  recurring_marks: ['recurring_id', 'month', 'paid', 'amount'],
};

/** Columnas NOT NULL locales que no viajan al servidor. */
const LOCAL_DEFAULTS: Record<string, Record<string, () => unknown>> = {
  categories: { created_at: nowStamp },
  people: { created_at: nowStamp },
  cards: { created_at: nowStamp },
  card_purchases: { created_at: nowStamp },
  attachments: { created_at: nowStamp },
  recurring: { created_at: nowStamp },
};

type Row = Record<string, unknown>;
type Snapshot = Record<string, Row[]>;

const basename = (uri: string) => uri.split('/').pop() ?? uri;

async function readSnapshot(db: SQLiteDatabase): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const [table, cols] of Object.entries(TABLES)) {
    out[table] = await db.getAllAsync<Row>(`SELECT ${cols.join(', ')} FROM ${table}`);
  }
  return out;
}

/** Archivos locales referenciados por la base (fotos de movimientos e íconos propios). */
function referencedFiles(snap: Snapshot): { name: string; uri: string }[] {
  const uris = [
    ...snap.attachments.map((a) => String(a.uri)),
    ...snap.categories.map((c) => String(c.icon)).filter((i) => i.startsWith(CUSTOM_ICON_PREFIX)).map((i) => i.slice(CUSTOM_ICON_PREFIX.length)),
  ];
  return uris.map((uri) => ({ name: basename(uri), uri }));
}

async function uploadMissingFiles(snap: Snapshot) {
  const { names } = await api<{ names: string[] }>('/files');
  const have = new Set(names);
  const s = await getSession();
  for (const f of referencedFiles(snap)) {
    if (have.has(f.name) || !new File(f.uri).exists) continue;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const form = new FormData();
    // React Native acepta { uri, name, type } como archivo en FormData.
    form.append('file', { uri: f.uri, name: f.name, type: ext === 'png' ? 'image/png' : 'image/jpeg' } as unknown as Blob);
    await fetch(`${s.server}/files/${f.name}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${s.token}` },
      body: form,
    });
  }
}

let running: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Sube todo al servidor. Si ya hay una sincronización en curso, espera esa. */
export async function syncNow(db: SQLiteDatabase): Promise<void> {
  const s = await getSession();
  if (!s.token) return;
  if (running) return running;
  running = (async () => {
    try {
      const snap = await readSnapshot(db);
      await api('/sync/push', { method: 'POST', json: { schema_version: DB_VERSION, tables: snap }, timeoutMs: 60_000 });
      await setSetting(db, 'last_sync', new Date().toISOString());
      await setSetting(db, 'last_sync_error', null);
      await uploadMissingFiles(snap);
    } catch (e) {
      await setSetting(db, 'last_sync_error', (e as Error).message);
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Programa una sincronización unos segundos después del último cambio. */
export function scheduleSync(db: SQLiteDatabase, delayMs = 4000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow(db).catch(() => {});
  }, delayMs);
}

export async function lastSyncInfo(db: SQLiteDatabase) {
  const [at, error] = await Promise.all([getSetting(db, 'last_sync'), getSetting(db, 'last_sync_error')]);
  return { at, error };
}

export async function serverHasData(): Promise<{ has: boolean; movements: number; pushedAt: string | null }> {
  const r = await api<{ snapshot: Snapshot | null; pushed_at?: string }>('/sync/pull');
  const movements = r.snapshot?.movements?.length ?? 0;
  return { has: !!r.snapshot, movements, pushedAt: r.pushed_at ?? null };
}

export async function localMovementCount(db: SQLiteDatabase) {
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM movements');
  return r?.n ?? 0;
}

/** Reemplaza los datos locales por los del servidor y descarga las fotos. */
export async function restoreFromServer(db: SQLiteDatabase) {
  const r = await api<{ snapshot: Snapshot | null }>('/sync/pull', { timeoutMs: 60_000 });
  const snap = r.snapshot;
  if (!snap) throw new Error('El servidor no tiene datos guardados');

  const adjuntos = new Directory(Paths.document, 'adjuntos');
  const iconos = new Directory(Paths.document, 'iconos');
  adjuntos.create({ idempotent: true, intermediates: true });
  iconos.create({ idempotent: true, intermediates: true });

  // Las rutas absolutas cambian entre instalaciones: se reconstruyen con el nombre del archivo.
  const toDownload: { name: string; dest: File }[] = [];
  for (const a of snap.attachments ?? []) {
    const dest = new File(adjuntos, basename(String(a.uri)));
    a.uri = dest.uri;
    toDownload.push({ name: dest.name, dest });
  }
  for (const c of snap.categories ?? []) {
    const icon = String(c.icon);
    if (icon.startsWith(CUSTOM_ICON_PREFIX)) {
      const dest = new File(iconos, basename(icon.slice(CUSTOM_ICON_PREFIX.length)));
      c.icon = CUSTOM_ICON_PREFIX + dest.uri;
      toDownload.push({ name: dest.name, dest });
    }
  }

  const order = Object.keys(TABLES);
  await db.withTransactionAsync(async () => {
    for (const t of [...order].reverse()) await db.runAsync(`DELETE FROM ${t}`);
    for (const t of order) {
      const defaults = LOCAL_DEFAULTS[t] ?? {};
      const cols = [...TABLES[t], ...Object.keys(defaults)];
      const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      for (const row of snap[t] ?? []) {
        const values = cols.map((c) => (c in defaults && row[c] === undefined ? defaults[c]() : (row[c] ?? null)));
        await db.runAsync(sql, values as (string | number | null)[]);
      }
    }
  });

  const s = await getSession();
  let failed = 0;
  for (const f of toDownload) {
    if (f.dest.exists) continue;
    try {
      await File.downloadFileAsync(`${s.server}/files/${f.name}`, f.dest, { headers: { Authorization: `Bearer ${s.token}` } });
    } catch {
      failed++;
    }
  }
  await setSetting(db, 'last_sync', new Date().toISOString());
  return { movements: snap.movements?.length ?? 0, failedFiles: failed };
}

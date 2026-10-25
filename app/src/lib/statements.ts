import type { SQLiteDatabase } from 'expo-sqlite';

import { createMovement, listCategories } from '@/db/repo';
import type { Card, Category, Movement } from '@/db/types';

import { api, ApiError } from './api';
import { norm, parseDateKey, toDateKey } from './format';

export type StatementItem = {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: 'gasto' | 'ingreso';
  cuotas: number | null;
  categoria: string | null;
};

export type Statement = {
  id: number;
  status: 'processing' | 'pending' | 'error' | 'applied' | 'discarded';
  error: string | null;
  filename: string | null;
  meta: {
    banco: string | null;
    tipo: 'cuenta' | 'tarjeta';
    producto: string | null;
    ultimos4: string | null;
    desde: string | null;
    hasta: string | null;
    saldo_inicial: number | null;
    saldo_final: number | null;
  };
  items: StatementItem[];
  check: { gastos: number; ingresos: number; diferencia: number | null; base: 'saldo' | 'totales' | null };
};

export class PdfPasswordNeeded extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? 'Contraseña incorrecta' : 'El PDF tiene contraseña');
  }
}

/** Sube el PDF; el servidor lo procesa en segundo plano y devuelve el id para consultarlo. */
export async function uploadStatement(file: { uri: string; name: string }, password?: string): Promise<number> {
  const form = new FormData();
  if (password) form.append('password', password);
  form.append('file', { uri: file.uri, name: file.name, type: 'application/pdf' } as unknown as Blob);
  try {
    const r = await api<{ id: number }>('/statements', { method: 'POST', body: form, timeoutMs: 120_000 });
    return r.id;
  } catch (e) {
    if (e instanceof ApiError && e.data.needsPassword) throw new PdfPasswordNeeded(!!e.data.wrongPassword);
    throw e;
  }
}

export async function getStatement(id: number) {
  return (await api<{ statement: Statement }>(`/statements/${id}`)).statement;
}

export async function pendingStatement() {
  return (await api<{ statement: Statement | null }>('/statements/pending', { timeoutMs: 10_000 })).statement;
}

export async function markStatementDone(id: number, status: 'applied' | 'discarded') {
  await api(`/statements/${id}/done`, { method: 'POST', json: { status } });
}

// ---------- Cruce con lo que ya está en la app ----------

export type ReviewRow = {
  index: number;
  item: StatementItem;
  /** Movimiento de la app que ya corresponde a esta fila (mismo monto, fecha cercana). */
  match: Movement | null;
  category_id: number | null;
  selected: boolean;
};

const MATCH_DAYS = 3;

function shiftDate(date: string, days: number) {
  const d = parseDateKey(date);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function dayDiff(a: string, b: string) {
  return Math.abs(parseDateKey(a).getTime() - parseDateKey(b).getTime()) / 86_400_000;
}

/** Gasto del extracto ↔ gasto o préstamo en la app; ingreso ↔ ingreso o deuda. */
function sameDirection(item: StatementItem, m: Movement) {
  return item.tipo === 'gasto' ? m.type === 'expense' || m.type === 'lent' : m.type === 'income' || m.type === 'borrowed';
}

export function statementPeriod(st: Statement) {
  const dates = st.items.map((i) => i.fecha).sort();
  return { from: st.meta.desde ?? dates[0], to: st.meta.hasta ?? dates[dates.length - 1] };
}

/** Tarjeta de la app que probablemente corresponde al extracto (por nombre o últimos 4 dígitos). */
export function guessCard(st: Statement, cards: Card[]): number | null {
  if (st.meta.tipo !== 'tarjeta' || !cards.length) return null;
  const hay = norm(`${st.meta.producto ?? ''} ${st.meta.banco ?? ''} ${st.meta.ultimos4 ?? ''}`);
  const byName = cards.find((c) => {
    const words = norm(c.name).split(/\s+/).filter((w) => w.length > 2);
    return words.length > 0 && words.every((w) => hay.includes(w));
  });
  return (byName ?? cards[0]).id;
}

/**
 * Cruza las filas del extracto con los movimientos de la app pagados con el mismo medio
 * (la tarjeta elegida, o sin tarjeta si es una cuenta). Devuelve las filas y lo que está en la app pero no en el extracto.
 */
export async function reconcile(db: SQLiteDatabase, st: Statement, cardId: number | null) {
  const { from, to } = statementPeriod(st);
  const all = await db.getAllAsync<Movement>(
    `SELECT m.*, c.name AS cat_name, c.icon AS cat_icon, c.color AS cat_color, cp.card_id AS card_id
     FROM movements m
     LEFT JOIN categories c ON c.id = m.category_id
     LEFT JOIN card_purchases cp ON cp.id = m.card_purchase_id
     WHERE m.date BETWEEN ? AND ? ORDER BY m.date`,
    shiftDate(from, -MATCH_DAYS),
    shiftDate(to, MATCH_DAYS),
  );
  const pool = all.filter((m) => (cardId ? m.card_id === cardId : !m.card_id));
  const cats = await listCategories(db);
  const used = new Set<number>();

  const rows: ReviewRow[] = st.items.map((item, index) => {
    let best: Movement | null = null;
    for (const m of pool) {
      if (used.has(m.id) || m.amount !== item.monto || !sameDirection(item, m)) continue;
      const diff = dayDiff(m.date, item.fecha);
      if (diff <= MATCH_DAYS && (!best || diff < dayDiff(best.date, item.fecha))) best = m;
    }
    if (best) used.add(best.id);
    // En un extracto de tarjeta los "ingresos" son pagos a la propia tarjeta: no se agregan por defecto.
    const isCardPayment = st.meta.tipo === 'tarjeta' && item.tipo === 'ingreso';
    return { index, item, match: best, category_id: categoryFor(item, cats), selected: !best && !isCardPayment };
  });

  const missingInStatement = pool.filter((m) => !used.has(m.id) && m.date >= from && m.date <= to);
  return { rows, missingInStatement };
}

function categoryFor(item: StatementItem, cats: Category[]) {
  const kind = item.tipo === 'ingreso' ? 'income' : 'expense';
  const ofKind = cats.filter((c) => c.kind === kind);
  if (item.categoria) {
    const found = ofKind.find((c) => norm(c.name) === norm(item.categoria!));
    if (found) return found.id;
  }
  return ofKind.find((c) => norm(c.name) === 'otros')?.id ?? null;
}

/** Crea en la app los movimientos elegidos. */
export async function applyRows(db: SQLiteDatabase, rows: ReviewRow[], cardId: number | null) {
  let n = 0;
  for (const r of rows) {
    if (!r.selected) continue;
    const type = r.item.tipo === 'ingreso' ? 'income' : 'expense';
    await createMovement(db, {
      type,
      amount: r.item.monto,
      category_id: r.category_id,
      concept: r.item.descripcion,
      date: r.item.fecha,
      card: type === 'expense' && cardId ? { card_id: cardId, installments: r.item.cuotas ?? 1 } : null,
    });
    n++;
  }
  return n;
}

import type { SQLiteDatabase } from 'expo-sqlite';

import { eaToMonthly, firstPaymentMonth, paymentInMonth } from '@/lib/finance';
import { deleteImage, persistImage } from '@/lib/files';
import { nowStamp } from '@/lib/format';
import { uid } from '@/lib/uid';

import type {
  Attachment,
  Card,
  CardPurchase,
  Category,
  CategoryKind,
  ChatMessage,
  Movement,
  MovementInput,
  MovementType,
  Person,
  Recurring,
  RecurringKind,
} from './types';

type DB = SQLiteDatabase;

// ---------- Ajustes ----------

export async function getSetting(db: DB, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
  return r?.value ?? null;
}

export async function setSetting(db: DB, key: string, value: string | null) {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

// ---------- Categorías ----------

export function listCategories(db: DB, opts: { kind?: CategoryKind; includeArchived?: boolean } = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!opts.includeArchived) where.push('archived = 0');
  if (opts.kind) {
    where.push('kind = ?');
    params.push(opts.kind);
  }
  const sql = `SELECT * FROM categories ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort, name`;
  return db.getAllAsync<Category>(sql, params);
}

/** Categorías de gasto ordenadas por uso en los últimos 60 días (para los chips del chat). */
export function frequentCategories(db: DB, limit = 8) {
  return db.getAllAsync<Category>(
    `SELECT c.*, COUNT(m.id) AS uses FROM categories c
     LEFT JOIN movements m ON m.category_id = c.id AND m.date >= date('now', '-60 day')
     WHERE c.archived = 0 AND c.kind = 'expense'
     GROUP BY c.id ORDER BY uses DESC, c.sort LIMIT ?`,
    limit,
  );
}

export async function saveCategory(
  db: DB,
  c: { id?: number; name: string; icon: string; color: string; kind: CategoryKind; aliases: string; budget: number | null },
) {
  if (c.id) {
    await db.runAsync(
      'UPDATE categories SET name = ?, icon = ?, color = ?, kind = ?, aliases = ?, budget = ? WHERE id = ?',
      c.name, c.icon, c.color, c.kind, c.aliases, c.budget, c.id,
    );
    return c.id;
  }
  const max = await db.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM categories');
  const r = await db.runAsync(
    'INSERT INTO categories (uid, name, icon, color, kind, aliases, budget, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    uid(), c.name, c.icon, c.color, c.kind, c.aliases, c.budget, (max?.s ?? 0) + 1, nowStamp(),
  );
  return r.lastInsertRowId;
}

export async function setCategoryArchived(db: DB, id: number, archived: boolean) {
  await db.runAsync('UPDATE categories SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
}

export async function setCategoryBudget(db: DB, id: number, budget: number | null) {
  await db.runAsync('UPDATE categories SET budget = ? WHERE id = ?', budget, id);
}

// ---------- Personas ----------

export function listPeople(db: DB) {
  return db.getAllAsync<Person>('SELECT id, name, phone, photo FROM people ORDER BY name');
}

export function getPerson(db: DB, id: number) {
  return db.getFirstAsync<Person>('SELECT id, name, phone, photo FROM people WHERE id = ?', id);
}

export async function getOrCreatePerson(db: DB, name: string, phone?: string | null, photo?: string | null): Promise<number> {
  const clean = name.trim();
  const found = await db.getFirstAsync<{ id: number }>('SELECT id FROM people WHERE name = ? COLLATE NOCASE', clean);
  if (found) {
    if (phone) await db.runAsync('UPDATE people SET phone = ?, photo = COALESCE(?, photo) WHERE id = ?', phone, photo ?? null, found.id);
    return found.id;
  }
  const r = await db.runAsync(
    'INSERT INTO people (uid, name, phone, photo, created_at) VALUES (?, ?, ?, ?, ?)',
    uid(), clean, phone ?? null, photo ?? null, nowStamp(),
  );
  return r.lastInsertRowId;
}

export async function updatePerson(db: DB, id: number, p: { name: string; phone: string | null; photo: string | null }) {
  await db.runAsync('UPDATE people SET name = ?, phone = ?, photo = ? WHERE id = ?', p.name.trim(), p.phone, p.photo, id);
}

export async function deletePerson(db: DB, id: number) {
  // Los movimientos quedan sin persona (FK ON DELETE SET NULL).
  await db.runAsync('DELETE FROM people WHERE id = ?', id);
}

export type PersonSummary = Person & {
  balance: number; // pendiente: + me debe, - le debo
  pending_count: number;
  total_count: number;
  last_date: string | null;
};

export function peopleSummary(db: DB) {
  return db.getAllAsync<PersonSummary>(
    `SELECT p.id, p.name, p.phone, p.photo,
            COALESCE(SUM(CASE WHEN m.settled = 0 AND m.type = 'lent' THEN m.amount
                              WHEN m.settled = 0 AND m.type = 'borrowed' THEN -m.amount ELSE 0 END), 0) AS balance,
            COALESCE(SUM(CASE WHEN m.settled = 0 AND m.type IN ('lent', 'borrowed') THEN 1 ELSE 0 END), 0) AS pending_count,
            COUNT(m.id) AS total_count,
            MAX(m.date) AS last_date
     FROM people p LEFT JOIN movements m ON m.person_id = p.id
     GROUP BY p.id
     ORDER BY (balance != 0) DESC, ABS(balance) DESC, last_date DESC, p.name`,
  );
}

// ---------- Movimientos ----------

const MOVEMENT_SELECT = `
  SELECT m.*, c.name AS cat_name, c.icon AS cat_icon, c.color AS cat_color,
         p.name AS person_name, cp.card_id AS card_id, k.name AS card_name, k.color AS card_color,
         cp.installments AS installments, cp.installment_override AS installment_override,
         (SELECT COUNT(*) FROM attachments a WHERE a.movement_id = m.id) AS attachment_count
  FROM movements m
  LEFT JOIN categories c ON c.id = m.category_id
  LEFT JOIN people p ON p.id = m.person_id
  LEFT JOIN card_purchases cp ON cp.id = m.card_purchase_id
  LEFT JOIN cards k ON k.id = cp.card_id`;

export type MovementFilter = {
  month?: string;
  categoryId?: number | null;
  type?: MovementType | null;
  personId?: number | null;
  cardId?: number | null;
  search?: string;
  limit?: number;
};

export function listMovements(db: DB, f: MovementFilter = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.month) {
    where.push("substr(m.date, 1, 7) = ?");
    params.push(f.month);
  }
  if (f.categoryId) {
    where.push('m.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.type) {
    where.push('m.type = ?');
    params.push(f.type);
  }
  if (f.personId) {
    where.push('m.person_id = ?');
    params.push(f.personId);
  }
  if (f.cardId) {
    where.push('cp.card_id = ?');
    params.push(f.cardId);
  }
  if (f.search?.trim()) {
    where.push('(m.concept LIKE ? OR c.name LIKE ? OR p.name LIKE ?)');
    const q = `%${f.search.trim()}%`;
    params.push(q, q, q);
  }
  const sql = `${MOVEMENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.date DESC, m.id DESC LIMIT ${f.limit ?? 500}`;
  return db.getAllAsync<Movement>(sql, params);
}

export function getMovement(db: DB, id: number) {
  return db.getFirstAsync<Movement>(`${MOVEMENT_SELECT} WHERE m.id = ?`, id);
}

export function listAttachments(db: DB, movementId: number) {
  return db.getAllAsync<Attachment>('SELECT id, movement_id, uri FROM attachments WHERE movement_id = ? ORDER BY id', movementId);
}

async function insertAttachments(db: DB, movementId: number, uris: string[]) {
  for (const u of uris) {
    await db.runAsync(
      'INSERT INTO attachments (uid, movement_id, uri, created_at) VALUES (?, ?, ?, ?)',
      uid(), movementId, u, nowStamp(),
    );
  }
}

async function upsertPurchase(
  db: DB,
  existingId: number | null,
  input: MovementInput,
): Promise<number | null> {
  if (!input.card) return null;
  const card = await db.getFirstAsync<Card>('SELECT * FROM cards WHERE id = ?', input.card.card_id);
  if (!card) throw new Error('La tarjeta no existe');
  const n = Math.max(1, Math.round(input.card.installments));
  const monthly = n === 1 ? 0 : eaToMonthly(card.ea_rate);
  const first = firstPaymentMonth(input.date, card.cut_day, card.pay_day);
  const override = input.card.installment_override ?? null;
  if (existingId) {
    await db.runAsync(
      `UPDATE card_purchases SET card_id = ?, description = ?, amount = ?, installments = ?, monthly_rate = ?,
       installment_override = ?, purchase_date = ?, first_payment_month = ?, category_id = ? WHERE id = ?`,
      card.id, input.concept, input.amount, n, monthly, override, input.date, first, input.category_id, existingId,
    );
    return existingId;
  }
  const r = await db.runAsync(
    `INSERT INTO card_purchases (uid, card_id, description, amount, installments, monthly_rate, installment_override,
     purchase_date, first_payment_month, category_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid(), card.id, input.concept, input.amount, n, monthly, override, input.date, first, input.category_id, nowStamp(),
  );
  return r.lastInsertRowId;
}

export async function createMovement(db: DB, input: MovementInput): Promise<number> {
  const stored = await Promise.all((input.newImages ?? []).map((u) => persistImage(u)));
  let id = 0;
  await db.withTransactionAsync(async () => {
    const personId = input.person_name?.trim() ? await getOrCreatePerson(db, input.person_name, input.person_phone) : null;
    const purchaseId = input.type === 'expense' ? await upsertPurchase(db, null, input) : null;
    const now = nowStamp();
    const r = await db.runAsync(
      `INSERT INTO movements (uid, type, amount, category_id, concept, person_id, date, card_purchase_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid(), input.type, input.amount, input.category_id, input.concept.trim(), personId, input.date, purchaseId, now, now,
    );
    id = r.lastInsertRowId;
    await insertAttachments(db, id, stored);
  });
  return id;
}

export async function updateMovement(db: DB, id: number, input: MovementInput, removedAttachmentIds: number[] = []) {
  const current = await db.getFirstAsync<{ card_purchase_id: number | null }>(
    'SELECT card_purchase_id FROM movements WHERE id = ?',
    id,
  );
  if (!current) throw new Error('El movimiento no existe');
  const stored = await Promise.all((input.newImages ?? []).map((u) => persistImage(u)));
  const removed: Attachment[] = [];
  await db.withTransactionAsync(async () => {
    const personId = input.person_name?.trim() ? await getOrCreatePerson(db, input.person_name, input.person_phone) : null;
    let purchaseId = current.card_purchase_id;
    if (input.type === 'expense' && input.card) {
      purchaseId = await upsertPurchase(db, purchaseId, input);
    } else if (purchaseId) {
      // Ya no es compra con tarjeta: soltar la referencia antes de borrar (el FK borra en cascada).
      await db.runAsync('UPDATE movements SET card_purchase_id = NULL WHERE id = ?', id);
      await db.runAsync('DELETE FROM card_purchases WHERE id = ?', purchaseId);
      purchaseId = null;
    }
    await db.runAsync(
      `UPDATE movements SET type = ?, amount = ?, category_id = ?, concept = ?, person_id = ?, date = ?,
       card_purchase_id = ?, updated_at = ? WHERE id = ?`,
      input.type, input.amount, input.category_id, input.concept.trim(), personId, input.date, purchaseId, nowStamp(), id,
    );
    for (const aid of removedAttachmentIds) {
      const a = await db.getFirstAsync<Attachment>('SELECT * FROM attachments WHERE id = ? AND movement_id = ?', aid, id);
      if (a) {
        removed.push(a);
        await db.runAsync('DELETE FROM attachments WHERE id = ?', aid);
      }
    }
    await insertAttachments(db, id, stored);
  });
  removed.forEach((a) => deleteImage(a.uri));
}

export async function deleteMovement(db: DB, id: number) {
  const atts = await listAttachments(db, id);
  const m = await db.getFirstAsync<{ card_purchase_id: number | null }>('SELECT card_purchase_id FROM movements WHERE id = ?', id);
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM movements WHERE id = ?', id);
    if (m?.card_purchase_id) await db.runAsync('DELETE FROM card_purchases WHERE id = ?', m.card_purchase_id);
  });
  atts.forEach((a) => deleteImage(a.uri));
}

export async function setSettled(db: DB, id: number, settled: boolean) {
  await db.runAsync(
    'UPDATE movements SET settled = ?, settled_at = ?, updated_at = ? WHERE id = ?',
    settled ? 1 : 0, settled ? nowStamp() : null, nowStamp(), id,
  );
}

export async function settlePerson(db: DB, personId: number) {
  await db.runAsync(
    `UPDATE movements SET settled = 1, settled_at = ?, updated_at = ?
     WHERE person_id = ? AND type IN ('lent', 'borrowed') AND settled = 0`,
    nowStamp(), nowStamp(), personId,
  );
}

// ---------- Resúmenes ----------

export type CategoryTotal = {
  category_id: number | null;
  name: string;
  icon: string;
  color: string;
  budget: number | null;
  total: number;
  count: number;
};

export async function monthTotals(db: DB, month: string) {
  const r = await db.getFirstAsync<{
    income: number | null;
    expense_cash: number | null;
    expense_card: number | null;
    lent: number | null;
    count: number;
  }>(
    `SELECT
       SUM(CASE WHEN type = 'income' THEN amount END) AS income,
       SUM(CASE WHEN type = 'expense' AND card_purchase_id IS NULL THEN amount END) AS expense_cash,
       SUM(CASE WHEN type = 'expense' AND card_purchase_id IS NOT NULL THEN amount END) AS expense_card,
       SUM(CASE WHEN type = 'lent' THEN amount END) AS lent,
       COUNT(*) AS count
     FROM movements WHERE substr(date, 1, 7) = ?`,
    month,
  );
  return {
    income: r?.income ?? 0,
    expenseCash: r?.expense_cash ?? 0,
    expenseCard: r?.expense_card ?? 0,
    lent: r?.lent ?? 0,
    count: r?.count ?? 0,
  };
}

/** Consumo por categoría (incluye compras con tarjeta por su valor total). */
export function spendingByCategory(db: DB, month: string) {
  return db.getAllAsync<CategoryTotal>(
    `SELECT m.category_id, COALESCE(c.name, 'Sin categoría') AS name, COALESCE(c.icon, 'help-circle') AS icon,
            COALESCE(c.color, '#94A3B8') AS color, c.budget AS budget,
            SUM(m.amount) AS total, COUNT(*) AS count
     FROM movements m LEFT JOIN categories c ON c.id = m.category_id
     WHERE m.type = 'expense' AND substr(m.date, 1, 7) = ?
     GROUP BY m.category_id ORDER BY total DESC`,
    month,
  );
}

/** Gasto total por mes para los últimos `n` meses terminando en `month`. */
export function monthlyExpenseSeries(db: DB, fromMonth: string, toMonth: string) {
  return db.getAllAsync<{ month: string; total: number }>(
    `SELECT substr(date, 1, 7) AS month, SUM(amount) AS total FROM movements
     WHERE type = 'expense' AND substr(date, 1, 7) BETWEEN ? AND ?
     GROUP BY month ORDER BY month`,
    fromMonth,
    toMonth,
  );
}

export type PersonBalance = { person_id: number; name: string; balance: number; count: number };

/** Saldo pendiente por persona: positivo = me debe, negativo = le debo. */
export function debtBalances(db: DB) {
  return db.getAllAsync<PersonBalance>(
    `SELECT p.id AS person_id, p.name,
            SUM(CASE WHEN m.type = 'lent' THEN m.amount ELSE -m.amount END) AS balance,
            COUNT(*) AS count
     FROM movements m JOIN people p ON p.id = m.person_id
     WHERE m.type IN ('lent', 'borrowed') AND m.settled = 0
     GROUP BY p.id HAVING balance != 0 ORDER BY ABS(balance) DESC`,
  );
}

// ---------- Plan mensual (recurrentes) ----------

export function listRecurring(db: DB, month: string, kind?: RecurringKind) {
  return db.getAllAsync<Recurring>(
    `SELECT r.*, COALESCE(mk.paid, 0) AS paid, mk.amount AS paid_amount,
            r.saved_initial + COALESCE((SELECT SUM(x.amount) FROM recurring_marks x
              WHERE x.recurring_id = r.id AND x.paid = 1), 0) AS saved_total
     FROM recurring r
     LEFT JOIN recurring_marks mk ON mk.recurring_id = r.id AND mk.month = ?
     WHERE r.active = 1 ${kind ? 'AND r.kind = ?' : ''}
     ORDER BY r.kind, r.sort, r.day, r.name`,
    kind ? [month, kind] : [month],
  );
}

export async function saveRecurring(
  db: DB,
  r: { id?: number; kind: RecurringKind; name: string; amount: number; day: number | null; goal: number | null; saved_initial: number },
) {
  if (r.id) {
    await db.runAsync(
      'UPDATE recurring SET kind = ?, name = ?, amount = ?, day = ?, goal = ?, saved_initial = ? WHERE id = ?',
      r.kind, r.name, r.amount, r.day, r.goal, r.saved_initial, r.id,
    );
    return r.id;
  }
  const res = await db.runAsync(
    'INSERT INTO recurring (uid, kind, name, amount, day, goal, saved_initial, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    uid(), r.kind, r.name, r.amount, r.day, r.goal, r.saved_initial, nowStamp(),
  );
  return res.lastInsertRowId;
}

export async function deleteRecurring(db: DB, id: number) {
  // Se desactiva para no perder el historial de ahorro.
  await db.runAsync('UPDATE recurring SET active = 0 WHERE id = ?', id);
}

export async function setRecurringPaid(db: DB, id: number, month: string, paid: boolean, amount: number) {
  if (paid) {
    await db.runAsync(
      `INSERT INTO recurring_marks (recurring_id, month, paid, amount) VALUES (?, ?, 1, ?)
       ON CONFLICT(recurring_id, month) DO UPDATE SET paid = 1, amount = excluded.amount`,
      id, month, amount,
    );
  } else {
    await db.runAsync('DELETE FROM recurring_marks WHERE recurring_id = ? AND month = ?', id, month);
  }
}

// ---------- Tarjetas ----------

export function listCards(db: DB, includeArchived = false) {
  return db.getAllAsync<Card>(`SELECT * FROM cards ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name`);
}

export function getCard(db: DB, id: number) {
  return db.getFirstAsync<Card>('SELECT * FROM cards WHERE id = ?', id);
}

export async function saveCard(
  db: DB,
  c: { id?: number; name: string; credit_limit: number; ea_rate: number; cut_day: number; pay_day: number; color: string },
) {
  if (c.id) {
    await db.runAsync(
      'UPDATE cards SET name = ?, credit_limit = ?, ea_rate = ?, cut_day = ?, pay_day = ?, color = ? WHERE id = ?',
      c.name, c.credit_limit, c.ea_rate, c.cut_day, c.pay_day, c.color, c.id,
    );
    // Recalcular tasa y primer mes de las compras existentes con los datos nuevos de la tarjeta.
    const purchases = await db.getAllAsync<CardPurchase>('SELECT * FROM card_purchases WHERE card_id = ?', c.id);
    const monthly = eaToMonthly(c.ea_rate);
    for (const p of purchases) {
      await db.runAsync(
        'UPDATE card_purchases SET monthly_rate = ?, first_payment_month = ? WHERE id = ?',
        p.installments === 1 ? 0 : monthly, firstPaymentMonth(p.purchase_date, c.cut_day, c.pay_day), p.id,
      );
    }
    return c.id;
  }
  const r = await db.runAsync(
    'INSERT INTO cards (uid, name, credit_limit, ea_rate, cut_day, pay_day, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    uid(), c.name, c.credit_limit, c.ea_rate, c.cut_day, c.pay_day, c.color, nowStamp(),
  );
  return r.lastInsertRowId;
}

export async function setCardArchived(db: DB, id: number, archived: boolean) {
  await db.runAsync('UPDATE cards SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
}

export function listPurchases(db: DB, cardId?: number) {
  return db.getAllAsync<CardPurchase>(
    `SELECT cp.*, c.name AS cat_name, c.icon AS cat_icon, c.color AS cat_color,
            (SELECT m.id FROM movements m WHERE m.card_purchase_id = cp.id) AS movement_id
     FROM card_purchases cp
     JOIN cards k ON k.id = cp.card_id AND k.archived = 0
     LEFT JOIN categories c ON c.id = cp.category_id
     ${cardId ? 'WHERE cp.card_id = ?' : ''}
     ORDER BY cp.purchase_date DESC, cp.id DESC`,
    cardId ? [cardId] : [],
  );
}

/** Total a pagar de tarjetas en un mes (todas o una). */
export async function cardPaymentsForMonth(db: DB, month: string, cardId?: number) {
  const purchases = await listPurchases(db, cardId);
  return purchases.reduce((s, p) => s + paymentInMonth(p, month), 0);
}

// ---------- Chat ----------

export function listChat(db: DB, limit = 200) {
  return db.getAllAsync<ChatMessage>(
    `SELECT x.*, m.type AS m_type, c.icon AS cat_icon, c.color AS cat_color
     FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?) x
     LEFT JOIN movements m ON m.id = x.movement_id
     LEFT JOIN categories c ON c.id = m.category_id
     ORDER BY x.id`,
    limit,
  );
}

export async function addChat(db: DB, role: 'user' | 'bot', text: string, movementId: number | null = null) {
  const r = await db.runAsync(
    'INSERT INTO chat_messages (role, text, movement_id, created_at) VALUES (?, ?, ?, ?)',
    role, text, movementId, nowStamp(),
  );
  return r.lastInsertRowId;
}

export async function updateChat(db: DB, id: number, text: string) {
  await db.runAsync('UPDATE chat_messages SET text = ? WHERE id = ?', text, id);
}

export async function clearChat(db: DB) {
  await db.runAsync('DELETE FROM chat_messages');
}

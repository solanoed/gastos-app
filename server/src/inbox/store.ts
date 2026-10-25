// Guarda un movimiento detectado (correo o notificación) en la bandeja "Por aprobar".

import { pool } from '../db.js';
import type { Extracted } from '../mail/extract.js';

export async function userLists(userId: number) {
  const [cats, fixed] = await Promise.all([
    pool.query<{ name: string }>("SELECT name FROM categories WHERE user_id = $1 AND archived = 0 AND kind = 'expense'", [userId]),
    pool.query<{ name: string }>("SELECT name FROM recurring WHERE user_id = $1 AND active = 1 AND kind IN ('fixed', 'saving')", [userId]),
  ]);
  return { categories: cats.rows.map((r) => r.name), fixedNames: fixed.rows.map((r) => r.name) };
}

/** Devuelve true si quedó en la bandeja (false si no es movimiento o ya estaba). */
export async function saveDetected(
  userId: number,
  src: { source: 'email' | 'notification'; sourceId: string; receivedAt: Date; sender: string; subject: string; fallbackDate: string },
  x: Extracted | null,
  lists: { categories: string[]; fixedNames: string[] },
): Promise<boolean> {
  if (!x || !x.es_movimiento || !x.monto || x.monto <= 0) return false;
  // Varios avisos por la misma operación (correo + notificación, confirmación + recibo): mismo monto en fechas cercanas.
  const txDate = x.fecha ?? src.fallbackDate;
  const dup = await pool.query(
    `SELECT 1 FROM inbox_items WHERE user_id = $1 AND amount = $2
       AND abs(to_date(date, 'YYYY-MM-DD') - to_date($3, 'YYYY-MM-DD')) <= 2`,
    [userId, Math.round(x.monto), txDate],
  );
  if (dup.rowCount) return false;
  const r = await pool.query(
    `INSERT INTO inbox_items (user_id, source, source_id, received_at, sender, subject, kind, amount, merchant, concept,
       date, due_date, card_last4, suggested_category, matched_recurring)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (user_id, source, source_id) DO NOTHING`,
    [
      userId, src.source, src.sourceId, src.receivedAt, src.sender, src.subject.slice(0, 300), x.tipo, Math.round(x.monto),
      x.comercio, x.concepto, txDate, x.vence, x.tarjeta_ultimos4,
      lists.categories.includes(x.categoria_sugerida ?? '') ? x.categoria_sugerida : null,
      lists.fixedNames.includes(x.gasto_fijo_relacionado ?? '') ? x.gasto_fijo_relacionado : null,
    ],
  );
  return !!r.rowCount;
}

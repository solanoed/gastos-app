// Revisa el correo cada cierto tiempo y deja en la bandeja "Por aprobar" los movimientos detectados.
// No marca correos como leídos ni los modifica (solo lectura con BODY.PEEK).

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { config } from '../config.js';
import { pool } from '../db.js';

import { extractFromEmail } from './extract.js';

const FIRST_SCAN_DAYS = 30;
const MAX_AI_PER_RUN = 40;

// Remitentes financieros conocidos (dominio contiene alguno) y palabras clave de asunto.
const FINANCE_DOMAINS = [
  'bancolombia', 'nu.com.co', 'nubank', 'davivienda', 'daviplata', 'bbva', 'falabella', 'rappipay', 'rappi', 'nequi',
  'colpatria', 'scotiabank', 'bancodebogota', 'avvillas', 'itau', 'lulo', 'movii', 'bancodeoccidente', 'bancopopular',
  'pse', 'icetex', 'movistar', 'tigo', 'claro', 'etb', 'vanti', 'enel', 'epm', 'aire-e', 'gasesdeoccidente', 'mercadopago',
  'paypal', 'addi', 'sistecredito', 'uber', 'didi',
];
const SUBJECT_RE =
  /(compra|pago|pagaste|recaudo|transacci|transferencia|retiro|d[eé]bito|factura|cobro|abono|consignaci|recibiste|avance|cargo)/i;
const PROMO_RE = /(promo|beneficio|descuento|oferta|preventa|aprovecha|black friday|cyber|gana |sorteo|nuevo producto)/i;

let running = false;

async function mailUserId(): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE lower(username) = lower($1)', [config.mail.username]);
  return rows[0]?.id ?? null;
}

function isCandidate(fromAddr: string, subject: string) {
  const domain = fromAddr.split('@').pop()?.toLowerCase() ?? '';
  if (PROMO_RE.test(subject)) return false;
  return FINANCE_DOMAINS.some((d) => domain.includes(d)) || SUBJECT_RE.test(subject);
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Revisa el buzón. Devuelve cuántos movimientos nuevos dejó por aprobar. */
export async function scanMailbox(log: (msg: string) => void = () => {}): Promise<number> {
  if (!config.mail.address || !config.mail.password) return 0;
  if (running) return 0;
  running = true;
  const client = new ImapFlow({
    host: config.mail.host,
    port: 993,
    secure: true,
    auth: { user: config.mail.address, pass: config.mail.password },
    logger: false,
  });
  let added = 0;
  try {
    const userId = await mailUserId();
    if (!userId) return 0;
    const [cats, fixed, state] = await Promise.all([
      pool.query<{ name: string }>("SELECT name FROM categories WHERE user_id = $1 AND archived = 0 AND kind = 'expense'", [userId]),
      pool.query<{ name: string }>("SELECT name FROM recurring WHERE user_id = $1 AND active = 1 AND kind IN ('fixed', 'saving')", [userId]),
      pool.query<{ last_uid: number; uidvalidity: string }>('SELECT last_uid, uidvalidity FROM mail_state WHERE user_id = $1', [userId]),
    ]);
    const categories = cats.rows.map((r) => r.name);
    const fixedNames = fixed.rows.map((r) => r.name);

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox;
      const uidValidity = mailbox ? String(mailbox.uidValidity) : '';
      const prev = state.rows[0];
      const sameBox = prev && prev.uidvalidity === uidValidity;
      const uids = sameBox
        ? ((await client.search({ uid: `${prev.last_uid + 1}:*` }, { uid: true })) || []).filter((u) => u > prev.last_uid)
        : (await client.search({ since: new Date(Date.now() - FIRST_SCAN_DAYS * 86_400_000) }, { uid: true })) || [];

      let maxUid = sameBox ? prev.last_uid : 0;
      let aiCalls = 0;
      for (const uid of uids) {
        maxUid = Math.max(maxUid, uid);
        const head = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
        if (!head || !head.envelope) continue;
        const fromAddr = head.envelope.from?.[0]?.address ?? '';
        const subject = head.envelope.subject ?? '';
        if (!isCandidate(fromAddr, subject)) continue;
        if (aiCalls >= MAX_AI_PER_RUN) {
          // Dejar el resto para la próxima vuelta.
          maxUid = uid - 1;
          break;
        }
        const messageId = head.envelope.messageId ?? `uid-${uidValidity}-${uid}`;
        const exists = await pool.query('SELECT 1 FROM inbox_items WHERE user_id = $1 AND source = $2 AND source_id = $3', [userId, 'email', messageId]);
        if (exists.rowCount) continue;

        const full = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!full || !full.source) continue;
        const parsed = await simpleParser(full.source);
        const text = parsed.text?.trim() || htmlToText(typeof parsed.html === 'string' ? parsed.html : '');
        const date = new Date(parsed.date ?? head.envelope.date ?? Date.now()).toISOString().slice(0, 10);
        aiCalls++;
        const x = await extractFromEmail({ from: fromAddr, subject, date, text }, categories, fixedNames);
        if (!x || !x.es_movimiento || !x.monto || x.monto <= 0) continue;
        // Varios correos por la misma operación (confirmación + recibo): mismo monto en fechas cercanas.
        const txDate = x.fecha ?? date;
        const dup = await pool.query(
          `SELECT 1 FROM inbox_items WHERE user_id = $1 AND amount = $2
             AND abs(to_date(date, 'YYYY-MM-DD') - to_date($3, 'YYYY-MM-DD')) <= 2`,
          [userId, Math.round(x.monto), txDate],
        );
        if (dup.rowCount) continue;
        await pool.query(
          `INSERT INTO inbox_items (user_id, source, source_id, received_at, sender, subject, kind, amount, merchant, concept,
             date, due_date, card_last4, suggested_category, matched_recurring)
           VALUES ($1, 'email', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (user_id, source, source_id) DO NOTHING`,
          [
            userId, messageId, parsed.date ?? new Date(), fromAddr, subject.slice(0, 300), x.tipo, Math.round(x.monto),
            x.comercio, x.concepto, txDate, x.vence, x.tarjeta_ultimos4,
            categories.includes(x.categoria_sugerida ?? '') ? x.categoria_sugerida : null,
            fixedNames.includes(x.gasto_fijo_relacionado ?? '') ? x.gasto_fijo_relacionado : null,
          ],
        );
        added++;
        log(`correo → por aprobar: ${x.comercio ?? subject} ${x.monto}`);
      }
      await pool.query(
        `INSERT INTO mail_state (user_id, last_uid, uidvalidity, checked_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE SET last_uid = excluded.last_uid, uidvalidity = excluded.uidvalidity, checked_at = now()`,
        [userId, maxUid, uidValidity],
      );
    } finally {
      lock.release();
    }
    await client.logout();
  } finally {
    running = false;
    client.close();
  }
  return added;
}

export function startMailPoller(log: { info: (m: string) => void; error: (e: unknown) => void }) {
  if (!config.mail.address || !config.mail.password) {
    log.info('Correo no configurado: lectura de correos desactivada');
    return;
  }
  const tick = () =>
    scanMailbox((m) => log.info(m)).catch((e) => log.error(e));
  setTimeout(tick, 20_000);
  setInterval(tick, config.mail.pollMinutes * 60_000);
}

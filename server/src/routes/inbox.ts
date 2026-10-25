import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { pool } from '../db.js';
import { saveDetected, userLists } from '../inbox/store.js';
import { extractFromEmail } from '../mail/extract.js';
import { scanMailbox } from '../mail/poller.js';

const Decide = z.object({ status: z.enum(['approved', 'rejected']) });

const Notifications = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        app: z.string().max(100),
        title: z.string().max(300),
        text: z.string().max(2000),
        posted_at: z.number(),
      }),
    )
    .max(50),
});

/** Bandeja "Por aprobar": movimientos detectados automáticamente (correo; luego notificaciones). */
export async function inboxRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string } }>('/inbox', { onRequest: [app.authenticate] }, async (req) => {
    const status = req.query.status ?? 'pending';
    const { rows } = await pool.query(
      `SELECT id, source, received_at, sender, subject, kind, amount, merchant, concept, date, due_date, card_last4,
              suggested_category, matched_recurring, status
       FROM inbox_items WHERE user_id = $1 AND status = $2 ORDER BY COALESCE(date, '') DESC, id DESC LIMIT 200`,
      [req.userId, status],
    );
    return { items: rows };
  });

  app.get('/inbox/count', { onRequest: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM inbox_items WHERE user_id = $1 AND status = 'pending'",
      [req.userId],
    );
    return { pending: rows[0].n };
  });

  app.post<{ Params: { id: string } }>('/inbox/:id/decide', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = Decide.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Estado inválido' });
    const r = await pool.query('UPDATE inbox_items SET status = $1, decided_at = now() WHERE id = $2 AND user_id = $3', [
      body.data.status,
      Number(req.params.id),
      req.userId,
    ]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
    return { ok: true };
  });

  /** Notificaciones del banco que el celular capturó (Bancolombia, Nequi, Daviplata, SMS). */
  app.post(
    '/inbox/notifications',
    { onRequest: [app.authenticate], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = Notifications.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Formato inválido' });
      const lists = await userLists(req.userId);
      let added = 0;
      for (const n of body.data.items) {
        const exists = await pool.query('SELECT 1 FROM inbox_items WHERE user_id = $1 AND source = $2 AND source_id = $3', [
          req.userId,
          'notification',
          n.key,
        ]);
        if (exists.rowCount) continue;
        const when = new Date(n.posted_at);
        const date = when.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const x = await extractFromEmail({ from: n.app, subject: n.title, date, text: n.text }, lists.categories, lists.fixedNames);
        const saved = await saveDetected(
          req.userId,
          { source: 'notification', sourceId: n.key, receivedAt: when, sender: n.app, subject: n.title || n.text, fallbackDate: date },
          x,
          lists,
        );
        if (saved) added++;
      }
      return { added };
    },
  );

  /** Revisar el correo ya (además de la revisión automática). */
  app.post('/inbox/scan', { onRequest: [app.authenticate], config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async () => {
    const added = await scanMailbox();
    return { added };
  });
}

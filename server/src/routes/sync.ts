import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { pool } from '../db.js';
import { TABLES } from '../tables.js';

const Push = z.object({
  schema_version: z.number().int(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

/**
 * Sincronización tipo "foto completa": el celular es la fuente de verdad y en cada push
 * manda todas sus tablas. El servidor reemplaza los datos del usuario y guarda la foto para restaurar.
 * Para un solo usuario con un solo celular es simple y no tiene conflictos.
 */
export async function syncRoutes(app: FastifyInstance) {
  app.post('/sync/push', { onRequest: [app.authenticate], bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const body = Push.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Formato inválido' });
    const userId = req.userId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of TABLES) {
        const rows = body.data.tables[t.name] ?? [];
        await client.query(`DELETE FROM ${t.name} WHERE user_id = $1`, [userId]);
        if (!rows.length) continue;
        const names = t.columns.map(([n]) => `"${n}"`).join(', ');
        const defs = t.columns.map(([n, type]) => `"${n}" ${type}`).join(', ');
        await client.query(
          `INSERT INTO ${t.name} (user_id, ${names}) SELECT $1, ${names} FROM jsonb_to_recordset($2::jsonb) AS x(${defs})`,
          [userId, JSON.stringify(rows)],
        );
      }
      await client.query(
        `INSERT INTO sync_state (user_id, snapshot, schema_version, pushed_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE SET snapshot = excluded.snapshot, schema_version = excluded.schema_version, pushed_at = now()`,
        [userId, JSON.stringify(body.data.tables), body.data.schema_version],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { ok: true, synced_at: new Date().toISOString() };
  });

  app.get('/sync/pull', { onRequest: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query<{ snapshot: unknown; schema_version: number; pushed_at: Date }>(
      'SELECT snapshot, schema_version, pushed_at FROM sync_state WHERE user_id = $1',
      [req.userId],
    );
    if (!rows[0]) return { snapshot: null };
    return { snapshot: rows[0].snapshot, schema_version: rows[0].schema_version, pushed_at: rows[0].pushed_at };
  });
}

import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { pool } from '../db.js';
import { extractStatement } from '../statements/extract.js';
import { PdfPasswordError, pdfLines } from '../statements/pdf.js';

const COLUMNS = `id, status, error, filename, meta, items, checks AS "check", created_at`;

/**
 * Extractos bancarios: el celular sube el PDF, la IA saca los movimientos en segundo plano
 * (puede tardar un par de minutos) y la app los muestra para aprobarlos. El PDF no se guarda.
 */
export async function statementRoutes(app: FastifyInstance) {
  app.post(
    '/statements',
    { onRequest: [app.authenticate], config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      let data: Buffer | null = null;
      let filename: string | null = null;
      let password = '';
      for await (const part of req.parts({ limits: { fileSize: 15 * 1024 * 1024 } })) {
        if (part.type === 'file') {
          data = await part.toBuffer();
          filename = part.filename;
        } else if (part.fieldname === 'password') {
          password = String(part.value ?? '');
        }
      }
      if (!data) return reply.code(400).send({ error: 'Falta el archivo' });
      if (data.subarray(0, 5).toString() !== '%PDF-') return reply.code(400).send({ error: 'El archivo no es un PDF' });

      // Leer el texto aquí para responder de una vez si falta la contraseña o el PDF es escaneado.
      let pages: string[][];
      try {
        pages = await pdfLines(new Uint8Array(data), password);
      } catch (e) {
        if (e instanceof PdfPasswordError) return reply.code(422).send({ error: e.message, needsPassword: true, wrongPassword: e.wrong });
        return reply.code(400).send({ error: (e as Error).message });
      }
      if (!pages.some((p) => p.length)) {
        return reply.code(422).send({ error: 'El PDF no tiene texto (parece escaneado). Descarga el extracto original del banco.' });
      }

      const { rows } = await pool.query<{ id: number }>(
        "INSERT INTO statements (user_id, filename, meta, items, checks) VALUES ($1, $2, '{}', '[]', '{}') RETURNING id",
        [req.userId, filename],
      );
      const id = rows[0].id;
      void processStatement(id, req.userId, pages, req.log);
      return { id, status: 'processing' };
    },
  );

  app.get<{ Params: { id: string } }>('/statements/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM statements WHERE id = $1 AND user_id = $2`, [
      Number(req.params.id),
      req.userId,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: 'No existe' });
    return { statement: rows[0] };
  });

  /** Último extracto en proceso o sin revisar (para retomarlo si se cerró la app). */
  app.get('/statements/pending', { onRequest: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM statements
       WHERE user_id = $1 AND status IN ('processing', 'pending') AND created_at > now() - interval '7 days'
       ORDER BY id DESC LIMIT 1`,
      [req.userId],
    );
    return { statement: rows[0] ?? null };
  });

  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    '/statements/:id/done',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const status = req.body?.status === 'discarded' ? 'discarded' : 'applied';
      const r = await pool.query('UPDATE statements SET status = $1, applied_at = now() WHERE id = $2 AND user_id = $3', [
        status,
        Number(req.params.id),
        req.userId,
      ]);
      if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
      return { ok: true };
    },
  );
}

async function processStatement(id: number, userId: number, pages: string[][], log: FastifyBaseLogger) {
  try {
    const cats = await pool.query<{ name: string }>('SELECT name FROM categories WHERE user_id = $1 AND archived = 0', [userId]);
    const r = await extractStatement(pages, cats.rows.map((c) => c.name));
    if (!r.items.length) throw new Error('La IA no encontró movimientos en el extracto. Intenta de nuevo en un momento.');
    const error = r.failedChunks ? `${r.failedChunks} parte(s) del extracto no se pudieron leer; revisa que no falten movimientos.` : null;
    await pool.query("UPDATE statements SET status = 'pending', meta = $2, items = $3, checks = $4, error = $5 WHERE id = $1", [
      id,
      JSON.stringify(r.meta),
      JSON.stringify(r.items),
      JSON.stringify(r.check),
      error,
    ]);
    log.info(`extracto ${id}: ${r.items.length} movimientos, diferencia ${r.check.diferencia}`);
  } catch (e) {
    log.error(e);
    await pool
      .query("UPDATE statements SET status = 'error', error = $2 WHERE id = $1", [id, (e as Error).message])
      .catch(() => {});
  }
}

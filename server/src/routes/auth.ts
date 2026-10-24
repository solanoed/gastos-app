import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { pool } from '../db.js';

const Login = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });
const ChangePassword = z.object({ current: z.string().min(1), next: z.string().min(8) });

// Hash de relleno para comparar aunque el usuario no exista (mismo tiempo de respuesta).
const DUMMY_HASH = bcrypt.hashSync('relleno-no-valido', 12);

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = Login.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Usuario y contraseña son obligatorios' });
      const { rows } = await pool.query<{ id: number; username: string; password_hash: string }>(
        'SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)',
        [body.data.username],
      );
      const user = rows[0];
      const ok = await bcrypt.compare(body.data.password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !ok) return reply.code(401).send({ error: 'Usuario o contraseña incorrectos' });
      const token = app.jwt.sign({ sub: String(user.id), username: user.username }, { expiresIn: '180d' });
      return { token, username: user.username };
    },
  );

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    return { id: req.userId, username: req.user.username };
  });

  app.post('/auth/password', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = ChangePassword.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    if (!rows[0] || !(await bcrypt.compare(body.data.current, rows[0].password_hash))) {
      return reply.code(401).send({ error: 'La contraseña actual no es correcta' });
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(body.data.next, 12), req.userId]);
    return { ok: true };
  });
}

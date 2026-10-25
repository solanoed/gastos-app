import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import { config } from './config.js';
import { migrate, pool } from './db.js';
import { startMailPoller } from './mail/poller.js';
import { aiRoutes } from './routes/ai.js';
import { authRoutes } from './routes/auth.js';
import { fileRoutes } from './routes/files.js';
import { inboxRoutes } from './routes/inbox.js';
import { statementRoutes } from './routes/statements.js';
import { syncRoutes } from './routes/sync.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: number;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; username: string };
    user: { sub: string; username: string };
  }
}

const app = Fastify({ logger: { level: 'info' }, trustProxy: true, bodyLimit: 20 * 1024 * 1024 });

await app.register(cors, { origin: true });
await app.register(rateLimit, { global: false });
await app.register(jwt, { secret: config.jwtSecret });
await app.register(multipart);

app.decorateRequest('userId', 0);
app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    await req.jwtVerify();
    req.userId = Number(req.user.sub);
  } catch {
    return reply.code(401).send({ error: 'Sesión vencida, vuelve a iniciar sesión' });
  }
});

app.get('/', async () => ({ app: 'Mis Cuentas API', ok: true }));

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { ok: true };
});

await app.register(authRoutes);
await app.register(syncRoutes);
await app.register(fileRoutes);
await app.register(aiRoutes);
await app.register(inboxRoutes);
await app.register(statementRoutes);

await migrate();
await app.listen({ host: '0.0.0.0', port: config.port });
startMailPoller({ info: (m) => app.log.info(m), error: (e) => app.log.error(e) });

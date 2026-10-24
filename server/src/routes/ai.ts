import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { answer } from '../ai/chat.js';

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .min(1)
    .max(30),
});

export async function aiRoutes(app: FastifyInstance) {
  app.post(
    '/ai/chat',
    { onRequest: [app.authenticate], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = Body.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Formato inválido' });
      try {
        return await answer(req.userId, body.data.messages);
      } catch (e) {
        req.log.error(e);
        return reply.code(502).send({ error: 'La IA no respondió. Intenta de nuevo en un momento.' });
      }
    },
  );
}

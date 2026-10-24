import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { config } from '../config.js';

// Nombres generados por la app: <uuid>.<ext>
const NAME_RE = /^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|heic|gif)$/i;
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  gif: 'image/gif',
};

function userDir(userId: number) {
  return path.join(config.filesDir, String(userId));
}

export async function fileRoutes(app: FastifyInstance) {
  /** Nombres de archivos ya guardados (para que la app sepa qué falta subir). */
  app.get('/files', { onRequest: [app.authenticate] }, async (req) => {
    try {
      return { names: await readdir(userDir(req.userId)) };
    } catch {
      return { names: [] };
    }
  });

  app.put<{ Params: { name: string } }>('/files/:name', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { name } = req.params;
    if (!NAME_RE.test(name)) return reply.code(400).send({ error: 'Nombre de archivo inválido' });
    const file = await req.file({ limits: { fileSize: 15 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'Falta el archivo' });
    const buf = await file.toBuffer();
    const dir = userDir(req.userId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), buf);
    return { ok: true };
  });

  app.get<{ Params: { name: string } }>('/files/:name', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { name } = req.params;
    if (!NAME_RE.test(name)) return reply.code(400).send({ error: 'Nombre de archivo inválido' });
    const full = path.join(userDir(req.userId), name);
    try {
      await stat(full);
    } catch {
      return reply.code(404).send({ error: 'No existe' });
    }
    const ext = name.split('.').pop()!.toLowerCase();
    return reply.type(MIME[ext] ?? 'application/octet-stream').send(createReadStream(full));
  });
}

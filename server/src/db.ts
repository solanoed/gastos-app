import pg from 'pg';

import { config } from './config.js';
import { TABLES } from './tables.js';

// bigint (int8) llega como string por defecto; los montos en COP caben de sobra en un number.
pg.types.setTypeParser(20, (v) => Number(v));
// SUM() de bigint devuelve numeric (1700): también a number.
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS mail_state (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_uid INTEGER NOT NULL DEFAULT 0,
        uidvalidity TEXT NOT NULL DEFAULT '',
        checked_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS inbox_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sender TEXT,
        subject TEXT,
        kind TEXT,
        amount BIGINT NOT NULL,
        merchant TEXT,
        concept TEXT,
        date TEXT,
        due_date TEXT,
        card_last4 TEXT,
        suggested_category TEXT,
        matched_recurring TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        decided_at TIMESTAMPTZ,
        UNIQUE (user_id, source, source_id)
      );
      CREATE TABLE IF NOT EXISTS statements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT,
        meta JSONB NOT NULL,
        items JSONB NOT NULL,
        checks JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        snapshot JSONB NOT NULL,
        schema_version INTEGER NOT NULL,
        pushed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Un extracto que se estaba procesando cuando se reinició el servidor ya no va a terminar.
    await client.query(
      "UPDATE statements SET status = 'error', error = 'El servidor se reinició mientras se procesaba. Súbelo de nuevo.' WHERE status = 'processing'",
    );
    for (const t of TABLES) {
      const cols = t.columns.map(([n, type]) => `"${n}" ${type}`).join(', ');
      const pk = ['user_id', ...t.primaryKey].join(', ');
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${t.name} (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ${cols}, PRIMARY KEY (${pk}))`,
      );
      // Columnas agregadas en versiones posteriores.
      for (const [n, type] of t.columns) {
        await client.query(`ALTER TABLE ${t.name} ADD COLUMN IF NOT EXISTS "${n}" ${type}`);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

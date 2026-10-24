// Uso (dentro del contenedor): node dist/scripts/create-user.js <usuario> <contraseña>
// Si el usuario existe, cambia la contraseña.
import bcrypt from 'bcryptjs';

import { migrate, pool } from '../db.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.error('Uso: create-user <usuario> <contraseña de al menos 8 caracteres>');
  process.exit(1);
}

await migrate();
const hash = await bcrypt.hash(password, 12);
const { rows } = await pool.query<{ id: number }>(
  `INSERT INTO users (username, password_hash) VALUES ($1, $2)
   ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash RETURNING id`,
  [username, hash],
);
console.log(`Usuario "${username}" listo (id ${rows[0].id}).`);
await pool.end();

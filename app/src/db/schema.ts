import type { SQLiteDatabase } from 'expo-sqlite';

import { nowStamp } from '@/lib/format';
import { uid } from '@/lib/uid';

export const DB_VERSION = 2;

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version >= DB_VERSION) return;

  if (version === 0) {
    // `uid` en cada tabla sincronizable: lo usará el servidor en la fase 2.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'expense',
        aliases TEXT NOT NULL DEFAULT '',
        budget INTEGER,
        sort INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        credit_limit INTEGER NOT NULL DEFAULT 0,
        ea_rate REAL NOT NULL DEFAULT 0,
        cut_day INTEGER NOT NULL DEFAULT 30,
        pay_day INTEGER NOT NULL DEFAULT 15,
        color TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS card_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        description TEXT NOT NULL DEFAULT '',
        amount INTEGER NOT NULL,
        installments INTEGER NOT NULL DEFAULT 1,
        monthly_rate REAL NOT NULL DEFAULT 0,
        installment_override INTEGER,
        purchase_date TEXT NOT NULL,
        first_payment_month TEXT NOT NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'expense',
        amount INTEGER NOT NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        concept TEXT NOT NULL DEFAULT '',
        person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
        date TEXT NOT NULL,
        settled INTEGER NOT NULL DEFAULT 0,
        settled_at TEXT,
        card_purchase_id INTEGER REFERENCES card_purchases(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_movements_date ON movements(date);
      CREATE INDEX IF NOT EXISTS idx_movements_category ON movements(category_id);

      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        movement_id INTEGER NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
        uri TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recurring (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        amount INTEGER NOT NULL,
        day INTEGER,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        goal INTEGER,
        saved_initial INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recurring_marks (
        recurring_id INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        paid INTEGER NOT NULL DEFAULT 1,
        amount INTEGER NOT NULL,
        PRIMARY KEY (recurring_id, month)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        movement_id INTEGER REFERENCES movements(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
    `);
    await seedCategories(db);
    version = 1;
  }

  if (version === 1) {
    // Personas enlazadas a contactos del celular.
    await db.execAsync(`
      ALTER TABLE people ADD COLUMN phone TEXT;
      ALTER TABLE people ADD COLUMN photo TEXT;
    `);
    version = 2;
  }

  await db.execAsync(`PRAGMA user_version = ${DB_VERSION}`);
}

type Seed = [name: string, icon: string, color: string, aliases: string, kind?: 'expense' | 'income'];

const SEED: Seed[] = [
  ['Uber', 'car', '#475569', 'uber,didi,indriver,cabify'],
  ['Rappi', 'moped', '#F97316', 'rappi,ifood,domicilio,domicilios'],
  ['Mercado', 'cart', '#16A34A', 'mercado,super,supermercado,d1,ara,exito,olimpica,carulla,jumbo,mercar'],
  ['Restaurantes', 'silverware-fork-knife', '#E11D48', 'restaurante,almuerzo,comida,cena,desayuno,onces'],
  ['Gas', 'fire', '#D97706', 'gas,gases,vanti'],
  ['Luz', 'lightbulb-on', '#CA8A04', 'luz,energia,enel,epm'],
  ['Agua', 'water', '#0284C7', 'agua,acueducto'],
  ['Aire', 'air-conditioner', '#0891B2', 'aire,aires'],
  ['Transporte', 'bus', '#7C3AED', 'transporte,bus,metro,transmilenio,taxi,gasolina,peaje,parqueadero'],
  ['Salud', 'medical-bag', '#DB2777', 'salud,farmacia,medico,drogueria,medicina'],
  ['Entretenimiento', 'movie-open', '#9333EA', 'cine,netflix,spotify,salida,rumba,entretenimiento'],
  ['Ropa', 'tshirt-crew', '#0D9488', 'ropa,zapatos,tenis'],
  ['Hogar', 'home', '#65A30D', 'hogar,casa,aseo'],
  ['Otros', 'dots-horizontal', '#64748B', 'otros,otro,varios'],
  ['Salario', 'cash', '#15803D', 'salario,sueldo,nomina,quincena', 'income'],
  ['Freelance', 'laptop', '#059669', 'freelance,proyecto,side', 'income'],
  ['Otros ingresos', 'cash-plus', '#0F766E', 'ingreso,ingresos', 'income'],
];

async function seedCategories(db: SQLiteDatabase) {
  const now = nowStamp();
  let sort = 0;
  for (const [name, icon, color, aliases, kind = 'expense'] of SEED) {
    await db.runAsync(
      'INSERT INTO categories (uid, name, icon, color, kind, aliases, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      uid(), name, icon, color, kind, aliases, sort++, now,
    );
  }
}

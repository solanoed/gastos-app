// Tablas que la app sincroniza. Reflejan las tablas SQLite del celular (mismos ids locales),
// con `user_id` delante para separar usuarios. La app es la fuente de verdad: cada push reemplaza los datos.

export type Column = [name: string, pgType: string];

export type TableSpec = {
  name: string;
  columns: Column[];
  primaryKey: string[]; // sin user_id
};

export const TABLES: TableSpec[] = [
  {
    name: 'categories',
    primaryKey: ['id'],
    columns: [
      ['id', 'integer'],
      ['uid', 'text'],
      ['name', 'text'],
      ['icon', 'text'],
      ['color', 'text'],
      ['kind', 'text'],
      ['aliases', 'text'],
      ['budget', 'bigint'],
      ['sort', 'integer'],
      ['archived', 'integer'],
    ],
  },
  {
    name: 'people',
    primaryKey: ['id'],
    columns: [
      ['id', 'integer'],
      ['uid', 'text'],
      ['name', 'text'],
      ['phone', 'text'],
    ],
  },
  {
    name: 'cards',
    primaryKey: ['id'],
    columns: [
      ['id', 'integer'],
      ['uid', 'text'],
      ['name', 'text'],
      ['credit_limit', 'bigint'],
      ['ea_rate', 'double precision'],
      ['cut_day', 'integer'],
      ['pay_day', 'integer'],
      ['color', 'text'],
      ['archived', 'integer'],
    ],
  },
  {
    name: 'card_purchases',
    primaryKey: ['id'],
    columns: [
      ['id', 'integer'],
      ['uid', 'text'],
      ['card_id', 'integer'],
      ['description', 'text'],
      ['amount', 'bigint'],
      ['installments', 'integer'],
      ['monthly_rate', 'double precision'],
      ['installment_override', 'bigint'],
      ['purchase_date', 'text'],
      ['first_payment_month', 'text'],
      ['category_id', 'integer'],
    ],
  },
  {
    name: 'movements',
    primaryKey: ['id'],
    columns: [
      ['id', 'integer'],
      ['uid', 'text'],
      ['type', 'text'],
      ['amount', 'bigint'],
      ['category_id', 'integer'],
      ['concept', 'text'],
      ['person_id', 'integer'],
      ['date', 'text'],
      ['settled', 'integer'],
      ['settled_at', 'text'],
      ['card_purchase_id', 'integer'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  {
    name: 'attachments',
    primaryKey: ['id'],
    columns: [
      ['id', 'integer'],
      ['uid', 'text'],
      ['movement_id', 'integer'],
      ['uri', 'text'],
    ],
  },
  {
    name: 'recurring',
    primaryKey: ['id'],
    columns: [
      ['id', 'integer'],
      ['uid', 'text'],
      ['kind', 'text'],
      ['name', 'text'],
      ['amount', 'bigint'],
      ['day', 'integer'],
      ['goal', 'bigint'],
      ['saved_initial', 'bigint'],
      ['active', 'integer'],
      ['sort', 'integer'],
    ],
  },
  {
    name: 'recurring_marks',
    primaryKey: ['recurring_id', 'month'],
    columns: [
      ['recurring_id', 'integer'],
      ['month', 'text'],
      ['paid', 'integer'],
      ['amount', 'bigint'],
    ],
  },
];

export const TABLE_NAMES = TABLES.map((t) => t.name);

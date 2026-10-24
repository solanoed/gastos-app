export type MovementType = 'expense' | 'income' | 'lent' | 'borrowed';
export type CategoryKind = 'expense' | 'income';
export type RecurringKind = 'income' | 'fixed' | 'saving';

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  lent: 'Me deben',
  borrowed: 'Yo debo',
};

export type Category = {
  id: number;
  uid: string;
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  aliases: string;
  budget: number | null;
  sort: number;
  archived: number;
};

export type Person = { id: number; name: string; phone: string | null; photo: string | null };

export type Movement = {
  id: number;
  type: MovementType;
  amount: number;
  category_id: number | null;
  concept: string;
  person_id: number | null;
  date: string;
  settled: number;
  card_purchase_id: number | null;
  created_at: string;
  // joins
  cat_name: string | null;
  cat_icon: string | null;
  cat_color: string | null;
  person_name: string | null;
  card_id: number | null;
  card_name: string | null;
  installments: number | null;
  installment_override: number | null;
  attachment_count: number;
};

export type Attachment = { id: number; movement_id: number; uri: string };

export type Card = {
  id: number;
  name: string;
  credit_limit: number;
  ea_rate: number;
  cut_day: number;
  pay_day: number;
  color: string;
  archived: number;
};

export type CardPurchase = {
  id: number;
  card_id: number;
  description: string;
  amount: number;
  installments: number;
  monthly_rate: number;
  installment_override: number | null;
  purchase_date: string;
  first_payment_month: string;
  category_id: number | null;
  cat_name: string | null;
  cat_icon: string | null;
  cat_color: string | null;
  movement_id: number | null;
};

export type Recurring = {
  id: number;
  kind: RecurringKind;
  name: string;
  amount: number;
  day: number | null;
  category_id: number | null;
  goal: number | null;
  saved_initial: number;
  active: number;
  sort: number;
  // del mes consultado
  paid: number;
  paid_amount: number | null;
  // solo ahorro: acumulado total
  saved_total: number;
};

export type ChatMessage = {
  id: number;
  role: 'user' | 'bot';
  text: string;
  movement_id: number | null;
  created_at: string;
  // del movimiento enlazado
  m_type: MovementType | null;
  cat_icon: string | null;
  cat_color: string | null;
};

export type MovementInput = {
  type: MovementType;
  amount: number;
  category_id: number | null;
  concept: string;
  person_name?: string | null;
  /** Teléfono del contacto elegido (se guarda en la persona). */
  person_phone?: string | null;
  date: string; // YYYY-MM-DD
  /** URIs nuevos (del picker) a copiar; los ya guardados se pasan en keepAttachments. */
  newImages?: string[];
  /** Compra con tarjeta a cuotas. */
  card?: { card_id: number; installments: number; installment_override?: number | null } | null;
};

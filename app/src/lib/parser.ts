// Intérprete de texto libre del chat: "uber 15k", "rappi 32k pizza", "tc nu 600k mercado 6 cuotas",
// "victor y simon me deben 40k cena", "le debo a simon 10k", "ingreso 200k freelance", "= 32k*3".

import type { Card, Category, MovementType } from '@/db/types';

import { evaluate } from './calc';
import { capitalize, norm, parseAmount } from './format';

export type Draft = {
  type: MovementType;
  amount: number | null;
  category_id: number | null;
  concept: string;
  persons: string[];
  card: { card_id: number; installments: number } | null;
};

export type ParseResult =
  | { kind: 'calc'; expr: string; value: number }
  | { kind: 'calc_error'; expr: string; message: string }
  | { kind: 'question'; text: string }
  /** `missing` vacío = se puede guardar directo; si no, abrir el formulario prellenado. */
  | { kind: 'movement'; draft: Draft; missing: string[]; guessedCategory: boolean };

const QUESTION_START = /^(¿|cuanto|cuantos|cuanta|que|en que|cual|cuales|como|resumen|dame|muestrame|dime|me alcanza|puedo|deberia)\b/;
const STOP = new Set(['en', 'de', 'del', 'con', 'por', 'para', 'a', 'y', 'el', 'la', 'los', 'las', 'un', 'una', 'al', 'mi', 'pague', 'gaste', 'compre']);
const AMOUNT_SUFFIX = new Set(['k', 'mil', 'luca', 'lucas', 'm', 'palo', 'palos', 'millon', 'millones']);
const CARD_WORDS = new Set(['tc', 'tarjeta', 'credito', 'tdc']);

type Tok = { raw: string; n: string; used: boolean };

export function parseInput(text: string, categories: Category[], cards: Card[]): ParseResult {
  const trimmed = text.trim();
  const nt = norm(trimmed);

  // Calculadora: "= 32k*3" o una expresión con operadores.
  const expr = trimmed.startsWith('=') ? trimmed.slice(1) : /^[\d\s$.,km()+\-*/x×÷^%]+$/i.test(trimmed) && /[+\-*/×÷^]/.test(trimmed) ? trimmed : null;
  if (expr !== null) {
    try {
      return { kind: 'calc', expr: expr.trim(), value: evaluate(expr) };
    } catch (e) {
      return { kind: 'calc_error', expr: expr.trim(), message: (e as Error).message };
    }
  }

  if (trimmed.includes('?') || QUESTION_START.test(nt)) return { kind: 'question', text: trimmed };

  const toks: Tok[] = trimmed
    .replace(/[¡!¿;]|,(?!\d)/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, n: norm(raw), used: false }));

  // Cuotas: "6 cuotas", "a 6 cuotas", "x6"
  let installments: number | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if ((t.n === 'cuotas' || t.n === 'cuota') && i > 0 && /^\d{1,2}$/.test(toks[i - 1].n)) {
      installments = parseInt(toks[i - 1].n, 10);
      t.used = toks[i - 1].used = true;
      if (i > 1 && toks[i - 2].n === 'a') toks[i - 2].used = true;
    } else if (/^x\d{1,2}$/.test(t.n)) {
      installments = parseInt(t.n.slice(1), 10);
      t.used = true;
    }
  }

  // Monto: primer token que sea monto (permite "15 mil" o "$ 15.000").
  let amount: number | null = null;
  for (let i = 0; i < toks.length && amount === null; i++) {
    const t = toks[i];
    if (t.used) continue;
    const next = toks[i + 1];
    if (next && /^\d+([.,]\d+)?$/.test(t.n) && AMOUNT_SUFFIX.has(next.n)) {
      amount = parseAmount(t.n + next.n);
      if (amount !== null) t.used = next.used = true;
      continue;
    }
    if (t.n === '$' && next) continue;
    amount = parseAmount(t.n);
    if (amount !== null) t.used = true;
  }

  // Tipo y personas.
  let type: MovementType = 'expense';
  let persons: string[] = [];
  const idx = (w: string, from = 0) => toks.findIndex((t, i) => i >= from && t.n === w);

  const meIdx = toks.findIndex((t, i) => t.n === 'me' && /^deben?$/.test(toks[i + 1]?.n ?? ''));
  const debo = idx('debo');
  const presto = toks.findIndex((t) => /^(preste|prestamo|presto)$/.test(t.n));

  if (meIdx >= 0) {
    // "victor y simon me deben 40k"
    type = 'lent';
    toks[meIdx].used = toks[meIdx + 1].used = true;
    persons = namesFrom(toks.slice(0, meIdx));
  } else if (debo >= 0) {
    // "le debo a simon 10k" / "debo a simon 10k"
    type = 'borrowed';
    toks[debo].used = true;
    if (debo > 0 && toks[debo - 1].n === 'le') toks[debo - 1].used = true;
    persons = namesAfterA(toks, debo + 1);
  } else if (presto >= 0) {
    const before = toks[presto - 1];
    if (before && before.n === 'me') {
      // "simon me presto 50k"
      type = 'borrowed';
      before.used = true;
      toks[presto].used = true;
      persons = namesFrom(toks.slice(0, presto - 1));
    } else {
      // "le preste a victor 50k"
      type = 'lent';
      toks[presto].used = true;
      if (presto > 0 && toks[presto - 1].n === 'le') toks[presto - 1].used = true;
      persons = namesAfterA(toks, presto + 1);
    }
  } else if (/\b(ingreso|me pagaron|recibi|cobre)\b/.test(nt)) {
    type = 'income';
    for (const t of toks) if (['ingreso', 'pagaron', 'recibi', 'cobre'].includes(t.n)) t.used = true;
    const me = toks.findIndex((t, i) => t.n === 'me' && toks[i + 1]?.n === 'pagaron');
    if (me >= 0) toks[me].used = true;
  }

  // Tarjeta.
  let card: Draft['card'] = null;
  let cardAmbiguous = false;
  const hasCardWord = toks.some((t) => CARD_WORDS.has(t.n));
  let matchedCard: Card | undefined;
  for (const c of cards) {
    const cn = norm(c.name).split(/\s+/);
    const at = toks.findIndex((t, i) => cn.every((w, j) => toks[i + j]?.n === w));
    if (at >= 0 && (hasCardWord || cn.join(' ').length > 2)) {
      matchedCard = c;
      for (let j = 0; j < cn.length; j++) toks[at + j].used = true;
      break;
    }
  }
  if (hasCardWord || matchedCard || installments) {
    for (const t of toks) if (CARD_WORDS.has(t.n)) t.used = true;
    const chosen = matchedCard ?? (cards.length === 1 ? cards[0] : undefined);
    if (chosen && type === 'expense') card = { card_id: chosen.id, installments: installments ?? 1 };
    else if (type === 'expense') cardAmbiguous = true;
  }

  // Categoría por nombre o alias (también frases de dos palabras).
  const wanted = type === 'income' ? 'income' : 'expense';
  const pool = [...categories.filter((c) => c.kind === wanted), ...categories.filter((c) => c.kind !== wanted)];
  let category: Category | undefined;
  for (let i = 0; i < toks.length && !category; i++) {
    if (toks[i].used) continue;
    const one = toks[i].n;
    const two = toks[i + 1] ? `${one} ${toks[i + 1].n}` : null;
    for (const c of pool) {
      const keys = [norm(c.name), ...c.aliases.split(',').map(norm).filter(Boolean)];
      if (two && keys.includes(two)) {
        category = c;
        toks[i].used = toks[i + 1].used = true;
        break;
      }
      if (keys.includes(one) || keys.includes(one.replace(/s$/, ''))) {
        category = c;
        toks[i].used = true;
        break;
      }
    }
  }

  let guessedCategory = false;
  if (!category && (type === 'expense' || type === 'income')) {
    const fallback = categories.find((c) => norm(c.name) === (type === 'income' ? 'otros ingresos' : 'otros'));
    category = fallback;
    guessedCategory = true;
  }

  const conceptWords = toks.filter((t) => !t.used).map((t) => t.raw);
  while (conceptWords.length && STOP.has(norm(conceptWords[0]))) conceptWords.shift();
  while (conceptWords.length && STOP.has(norm(conceptWords[conceptWords.length - 1]))) conceptWords.pop();

  const missing: string[] = [];
  if (amount === null) missing.push('monto');
  if ((type === 'lent' || type === 'borrowed') && persons.length === 0) missing.push('persona');
  if (cardAmbiguous) missing.push(cards.length ? 'tarjeta' : 'tarjeta (aún no tienes tarjetas creadas)');

  return {
    kind: 'movement',
    draft: {
      type,
      amount,
      category_id: category?.id ?? null,
      concept: capitalize(conceptWords.join(' ')),
      persons,
      card,
    },
    missing,
    guessedCategory,
  };
}

function namesFrom(toks: Tok[]): string[] {
  const names: string[] = [];
  let cur: string[] = [];
  for (const t of toks) {
    if (t.used) continue;
    if (t.n === 'y' || t.n === 'e') {
      if (cur.length) names.push(cur.join(' '));
      cur = [];
      continue;
    }
    if (STOP.has(t.n)) continue;
    cur.push(capitalize(t.raw));
    t.used = true;
  }
  if (cur.length) names.push(cur.join(' '));
  return names;
}

/** Nombres después de "a" hasta un monto o una palabra de unión ("por", "para", "de"...). */
function namesAfterA(toks: Tok[], from: number): string[] {
  let i = from;
  while (toks[i]?.used) i++;
  if (toks[i]?.n === 'a') toks[i++].used = true;
  const slice: Tok[] = [];
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t.used || ['por', 'para', 'de', 'del', 'en'].includes(t.n)) break;
    slice.push(t);
  }
  return namesFrom(slice);
}

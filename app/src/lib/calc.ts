// Evaluador seguro de expresiones (sin eval): + - * / ^ %, paréntesis y montos como 32k o 1,5m.

import { parseAmount } from './format';

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const s = src.replace(/\s+/g, '').replace(/[x×]/g, '*').replace(/÷/g, '/');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if ('+-*/^()%'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    const m = s.slice(i).match(/^\$?\d[\d.,]*(k|mil|m|palos?|lucas?)?/i);
    if (!m) throw new Error(`No entiendo "${c}"`);
    const raw = m[0];
    // Sin sufijo: "1.5" decimal; "15.000" miles.
    let v = /[a-z]/i.test(raw) ? parseAmount(raw) : null;
    if (v === null) {
      const n = raw.replace('$', '');
      v = /^\d{1,3}([.,]\d{3})+$/.test(n) ? Number(n.replace(/[.,]/g, '')) : Number(n.replace(',', '.'));
    }
    if (!isFinite(v)) throw new Error(`Número inválido "${raw}"`);
    out.push({ t: 'num', v });
    i += raw.length;
  }
  return out;
}

export function evaluate(src: string): number {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;

  function expr(): number {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      v = op === '+' ? v + term() : v - term();
    }
    return v;
  }
  function term(): number {
    let v = power();
    while (isOp('*') || isOp('/')) {
      const op = toks[p++].v;
      const r = power();
      if (op === '/' && r === 0) throw new Error('División por cero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function power(): number {
    const b = unary();
    if (isOp('^')) {
      p++;
      return Math.pow(b, power());
    }
    return b;
  }
  function unary(): number {
    if (isOp('-')) {
      p++;
      return -unary();
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    let v = primary();
    while (isOp('%')) {
      p++;
      v = v / 100;
    }
    return v;
  }
  function primary(): number {
    const t = toks[p++];
    if (!t) throw new Error('Expresión incompleta');
    if (t.t === 'num') return t.v;
    if (t.v === '(') {
      const v = expr();
      if (!isOp(')')) throw new Error('Falta cerrar paréntesis');
      p++;
      return v;
    }
    throw new Error(`No esperaba "${t.v}"`);
  }

  const result = expr();
  if (p < toks.length) throw new Error('Expresión inválida');
  return result;
}

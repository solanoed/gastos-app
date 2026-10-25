// Usa la IA para convertir el texto de un extracto bancario en una lista de movimientos.

import { completeJson, toAmount } from '../ai/json.js';

export type StatementMeta = {
  banco: string | null;
  tipo: 'cuenta' | 'tarjeta';
  producto: string | null;
  ultimos4: string | null;
  desde: string | null;
  hasta: string | null;
  saldo_inicial: number | null;
  saldo_final: number | null;
  total_debitos: number | null;
  total_creditos: number | null;
};

export type StatementItem = {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: 'gasto' | 'ingreso';
  cuotas: number | null;
  categoria: string | null;
};

export type StatementCheck = {
  gastos: number;
  ingresos: number;
  /** Diferencia contra el saldo final o los totales del extracto (0 = cuadra); null si no hay con qué comparar. */
  diferencia: number | null;
  base: 'saldo' | 'totales' | null;
};

const META_PROMPT = `Eres un lector de extractos bancarios de Colombia. Del encabezado y resumen de este extracto responde SOLO un objeto JSON:
- banco: nombre del banco (ej "Bancolombia", "Nequi", "Daviplata"), o null.
- tipo: "tarjeta" si es extracto de tarjeta de crédito; "cuenta" si es de cuenta de ahorros/corriente/billetera.
- producto: nombre del producto (ej "Mastercard Gold", "Cuenta de Ahorros"), o null.
- ultimos4: últimos 4 dígitos de la cuenta o tarjeta, o null.
- desde, hasta: periodo del extracto en formato YYYY-MM-DD, o null.
- saldo_inicial, saldo_final: saldo anterior y saldo final/actual en pesos (número sin puntos), o null. En tarjeta: saldo anterior y nuevo saldo/pago total.
- total_debitos: total de retiros/débitos/cargos/compras del periodo, o null.
- total_creditos: total de depósitos/créditos/abonos/pagos del periodo, o null.`;

const ITEMS_PROMPT = `Eres un lector de extractos bancarios de Colombia. Te paso un fragmento del extracto ({CONTEXTO}).
Extrae TODOS los movimientos de la tabla de transacciones, en el orden en que aparecen, y responde SOLO un objeto JSON:
{"movimientos":[{"fecha":"YYYY-MM-DD","descripcion":"...","monto":12345,"tipo":"gasto","cuotas":null,"categoria":null}]}
Reglas:
- Un elemento por cada fila de movimiento. No inventes filas; ignora encabezados, saldos, totales, intereses ya resumidos y publicidad.
- fecha: si la fila no trae año, usa el año del periodo ({PERIODO}).
- monto: valor positivo en pesos, sin puntos ni signo (los decimales ",00" no cuentan).
- tipo: "gasto" para compras, retiros, débitos, transferencias enviadas, cuotas de manejo, impuestos (4x1000), intereses; "ingreso" para abonos, depósitos, transferencias recibidas, pagos a la tarjeta, devoluciones.
- descripcion: el texto de la fila limpio y corto (comercio o concepto), en mayúscula inicial.
- cuotas: número de cuotas si la fila lo indica (ej "3/12" → 12), si no null.
- categoria: UNA de estas categorías del usuario que mejor encaje, o null: {CATEGORIAS}
Si el fragmento no tiene movimientos responde {"movimientos":[]}.`;

const CHUNK_LINES = 90;

export async function extractStatement(pages: string[][], categories: string[]) {
  const lines = pages.flatMap((p, i) => [`--- Página ${i + 1} ---`, ...p]);
  const head = [...lines.slice(0, 80), '...', ...lines.slice(-40)].join('\n');
  const rawMeta = await completeJson<Record<string, unknown>>(META_PROMPT, head.slice(0, 9000), 800);
  const meta = normalizeMeta(rawMeta ?? {});

  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES) chunks.push(lines.slice(i, i + CHUNK_LINES).join('\n'));

  const periodo = meta.desde || meta.hasta ? `${meta.desde ?? '?'} a ${meta.hasta ?? '?'}` : 'desconocido';
  const system = ITEMS_PROMPT.replace('{CONTEXTO}', `${meta.banco ?? 'banco'}, ${meta.tipo === 'tarjeta' ? 'tarjeta de crédito' : 'cuenta'}`)
    .replace('{PERIODO}', periodo)
    .replace('{CATEGORIAS}', categories.join(', ') || '(ninguna)');

  // Varios fragmentos a la vez, pero sin saturar la API.
  const results: StatementItem[][] = new Array(chunks.length);
  let next = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, chunks.length) }, async () => {
      while (next < chunks.length) {
        const i = next++;
        const r = await completeJson<{ movimientos?: unknown[] }>(system, chunks[i], 6000);
        if (!r) failed++;
        results[i] = (r?.movimientos ?? []).map((m) => normalizeItem(m, categories, meta)).filter((m): m is StatementItem => !!m);
      }
    }),
  );
  const items = results.flat();
  return { meta, items, check: check(meta, items), failedChunks: failed };
}

function str(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function date(v: unknown) {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeMeta(o: Record<string, unknown>): StatementMeta {
  const last4 = str(o.ultimos4)?.replace(/\D/g, '').slice(-4) || null;
  return {
    banco: str(o.banco),
    tipo: o.tipo === 'tarjeta' ? 'tarjeta' : 'cuenta',
    producto: str(o.producto),
    ultimos4: last4,
    desde: date(o.desde),
    hasta: date(o.hasta),
    saldo_inicial: toAmount(o.saldo_inicial),
    saldo_final: toAmount(o.saldo_final),
    total_debitos: toAmount(o.total_debitos),
    total_creditos: toAmount(o.total_creditos),
  };
}

function normalizeItem(v: unknown, categories: string[], meta: StatementMeta): StatementItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const monto = toAmount(o.monto);
  const fecha = date(o.fecha) ?? meta.hasta;
  if (!monto || !fecha) return null;
  const cuotas = typeof o.cuotas === 'number' && o.cuotas > 1 ? Math.round(o.cuotas) : null;
  const cat = str(o.categoria);
  return {
    fecha,
    descripcion: (str(o.descripcion) ?? 'Movimiento').slice(0, 120),
    monto,
    tipo: o.tipo === 'ingreso' ? 'ingreso' : 'gasto',
    cuotas,
    categoria: cat && categories.includes(cat) ? cat : null,
  };
}

/** Compara lo extraído con los saldos o totales del extracto para saber si quedó completo. */
function check(meta: StatementMeta, items: StatementItem[]): StatementCheck {
  const gastos = items.filter((i) => i.tipo === 'gasto').reduce((s, i) => s + i.monto, 0);
  const ingresos = items.filter((i) => i.tipo === 'ingreso').reduce((s, i) => s + i.monto, 0);
  if (meta.total_debitos != null && meta.total_creditos != null) {
    // Valor absoluto de cada lado para que un faltante de gastos no se compense con uno de ingresos.
    const diferencia = Math.abs(meta.total_debitos - gastos) + Math.abs(meta.total_creditos - ingresos);
    return { gastos, ingresos, diferencia, base: 'totales' };
  }
  if (meta.tipo === 'cuenta' && meta.saldo_inicial != null && meta.saldo_final != null) {
    return { gastos, ingresos, diferencia: meta.saldo_final - (meta.saldo_inicial + ingresos - gastos), base: 'saldo' };
  }
  return { gastos, ingresos, diferencia: null, base: null };
}

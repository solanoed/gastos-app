// Herramientas que el modelo puede llamar para consultar los datos del usuario.
// Devuelven JSON compacto con montos en pesos (números); el modelo se encarga de redactar.

import { pool } from '../db.js';

import { eaToMonthly, paymentInMonth, purchaseStatus, simulate, type PurchaseLike } from './finance.js';
import { addMonths, toDateKey, toMonthKey } from './format.js';

type Args = Record<string, unknown>;
type Tool = {
  description: string;
  parameters: Record<string, unknown>;
  run: (userId: number, args: Args) => Promise<unknown>;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : undefined);
const today = () => toDateKey(new Date());
const thisMonth = () => toMonthKey(new Date());

async function q<T>(sql: string, params: unknown[]): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

async function purchases(userId: number, cardId?: number) {
  return q<PurchaseLike & { id: number; card_id: number; description: string; purchase_date: string; categoria: string | null }>(
    `SELECT cp.*, c.name AS categoria FROM card_purchases cp
     JOIN cards k ON k.user_id = cp.user_id AND k.id = cp.card_id AND k.archived = 0
     LEFT JOIN categories c ON c.user_id = cp.user_id AND c.id = cp.category_id
     WHERE cp.user_id = $1 ${cardId ? 'AND cp.card_id = $2' : ''}`,
    cardId ? [userId, cardId] : [userId],
  );
}

export const TOOLS: Record<string, Tool> = {
  resumen_mes: {
    description:
      'Resumen financiero de un mes: ingresos (fijos y extra), gastos fijos (y si están pagados), ahorro, cuotas de tarjeta, gasto del día a día, disponible y lo que queda. Úsala para preguntas generales del mes.',
    parameters: {
      type: 'object',
      properties: { mes: { type: 'string', description: 'Mes en formato YYYY-MM. Por defecto el actual.' } },
    },
    async run(userId, args) {
      const mes = str(args.mes) ?? thisMonth();
      const rec = await q<{ kind: string; name: string; amount: number; day: number | null; paid: number | null }>(
        `SELECT r.kind, r.name, r.amount, r.day, mk.paid FROM recurring r
         LEFT JOIN recurring_marks mk ON mk.user_id = r.user_id AND mk.recurring_id = r.id AND mk.month = $2
         WHERE r.user_id = $1 AND r.active = 1 ORDER BY r.kind, r.day`,
        [userId, mes],
      );
      const [tot] = await q<{ ingresos_extra: number; gasto_efectivo: number; compras_tarjeta: number; prestado: number }>(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS ingresos_extra,
                COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND card_purchase_id IS NULL), 0) AS gasto_efectivo,
                COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND card_purchase_id IS NOT NULL), 0) AS compras_tarjeta,
                COALESCE(SUM(amount) FILTER (WHERE type = 'lent'), 0) AS prestado
         FROM movements WHERE user_id = $1 AND substr(date, 1, 7) = $2`,
        [userId, mes],
      );
      const cuotas = (await purchases(userId)).reduce((s, p) => s + paymentInMonth(p, mes), 0);
      const sum = (k: string) => rec.filter((r) => r.kind === k).reduce((s, r) => s + r.amount, 0);
      const ingresos = sum('income') + tot.ingresos_extra;
      const disponible = ingresos - sum('fixed') - sum('saving') - cuotas;
      return {
        mes,
        ingresos_fijos: sum('income'),
        ingresos_extra: tot.ingresos_extra,
        gastos_fijos: rec.filter((r) => r.kind === 'fixed').map((r) => ({ nombre: r.name, valor: r.amount, dia: r.day, pagado: !!r.paid })),
        ahorro: rec.filter((r) => r.kind === 'saving').map((r) => ({ nombre: r.name, valor: r.amount, hecho: !!r.paid })),
        cuotas_tarjeta: Math.round(cuotas),
        compras_con_tarjeta_del_mes: tot.compras_tarjeta,
        gasto_dia_a_dia: tot.gasto_efectivo,
        prestado_a_otros: tot.prestado,
        disponible_dia_a_dia: Math.round(disponible),
        queda: Math.round(disponible - tot.gasto_efectivo),
      };
    },
  },

  gastos_por_categoria: {
    description: 'Total gastado por categoría entre dos fechas (incluye compras con tarjeta por su valor total), con presupuesto si existe.',
    parameters: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['desde', 'hasta'],
    },
    run(userId, args) {
      return q(
        `SELECT COALESCE(c.name, 'Sin categoría') AS categoria, SUM(m.amount) AS total, COUNT(*) AS cantidad, c.budget AS presupuesto_mensual
         FROM movements m LEFT JOIN categories c ON c.user_id = m.user_id AND c.id = m.category_id
         WHERE m.user_id = $1 AND m.type = 'expense' AND substr(m.date, 1, 10) BETWEEN $2 AND $3
         GROUP BY c.name, c.budget ORDER BY total DESC`,
        [userId, str(args.desde) ?? `${thisMonth()}-01`, str(args.hasta) ?? today()],
      );
    },
  },

  gastos_por_mes: {
    description: 'Total gastado por mes en un rango (opcionalmente de una categoría), para comparar meses o ver tendencias.',
    parameters: {
      type: 'object',
      properties: {
        desde_mes: { type: 'string', description: 'YYYY-MM' },
        hasta_mes: { type: 'string', description: 'YYYY-MM' },
        categoria: { type: 'string', description: 'Nombre de la categoría (opcional)' },
      },
      required: ['desde_mes', 'hasta_mes'],
    },
    run(userId, args) {
      const cat = str(args.categoria);
      return q(
        `SELECT substr(m.date, 1, 7) AS mes, SUM(m.amount) AS total, COUNT(*) AS cantidad
         FROM movements m LEFT JOIN categories c ON c.user_id = m.user_id AND c.id = m.category_id
         WHERE m.user_id = $1 AND m.type = 'expense' AND substr(m.date, 1, 7) BETWEEN $2 AND $3
         ${cat ? 'AND c.name ILIKE $4' : ''}
         GROUP BY mes ORDER BY mes`,
        cat
          ? [userId, str(args.desde_mes) ?? addMonths(thisMonth(), -5), str(args.hasta_mes) ?? thisMonth(), `%${cat}%`]
          : [userId, str(args.desde_mes) ?? addMonths(thisMonth(), -5), str(args.hasta_mes) ?? thisMonth()],
      );
    },
  },

  buscar_movimientos: {
    description: 'Lista movimientos con filtros opcionales: texto en el concepto, categoría, persona, tipo y rango de fechas.',
    parameters: {
      type: 'object',
      properties: {
        texto: { type: 'string' },
        categoria: { type: 'string' },
        persona: { type: 'string' },
        tipo: { type: 'string', enum: ['expense', 'income', 'lent', 'borrowed'], description: 'expense=gasto, income=ingreso, lent=me deben, borrowed=yo debo' },
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
        limite: { type: 'number', description: 'Máximo de resultados (por defecto 30)' },
      },
    },
    run(userId, args) {
      const where = ['m.user_id = $1'];
      const params: unknown[] = [userId];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (str(args.texto)) add('m.concept ILIKE ?', `%${str(args.texto)}%`);
      if (str(args.categoria)) add('c.name ILIKE ?', `%${str(args.categoria)}%`);
      if (str(args.persona)) add('p.name ILIKE ?', `%${str(args.persona)}%`);
      if (str(args.tipo)) add('m.type = ?', str(args.tipo));
      if (str(args.desde)) add('substr(m.date, 1, 10) >= ?', str(args.desde));
      if (str(args.hasta)) add('substr(m.date, 1, 10) <= ?', str(args.hasta));
      const limit = Math.min(100, Math.max(1, num(args.limite) ?? 30));
      return q(
        `SELECT substr(m.date, 1, 10) AS fecha, m.type AS tipo, m.amount AS valor, c.name AS categoria, m.concept AS concepto,
                p.name AS persona, (m.settled = 1) AS saldado, k.name AS tarjeta, cp.installments AS cuotas
         FROM movements m
         LEFT JOIN categories c ON c.user_id = m.user_id AND c.id = m.category_id
         LEFT JOIN people p ON p.user_id = m.user_id AND p.id = m.person_id
         LEFT JOIN card_purchases cp ON cp.user_id = m.user_id AND cp.id = m.card_purchase_id
         LEFT JOIN cards k ON k.user_id = m.user_id AND k.id = cp.card_id
         WHERE ${where.join(' AND ')} ORDER BY m.date DESC, m.id DESC LIMIT ${limit}`,
        params,
      );
    },
  },

  deudas: {
    description: 'Quién le debe al usuario y a quién le debe él (solo pendientes), con el detalle de cada préstamo.',
    parameters: { type: 'object', properties: {} },
    async run(userId) {
      const rows = await q<{ persona: string; tipo: string; valor: number; concepto: string; fecha: string }>(
        `SELECT p.name AS persona, m.type AS tipo, m.amount AS valor, m.concept AS concepto, substr(m.date, 1, 10) AS fecha
         FROM movements m JOIN people p ON p.user_id = m.user_id AND p.id = m.person_id
         WHERE m.user_id = $1 AND m.type IN ('lent', 'borrowed') AND m.settled = 0 ORDER BY p.name, m.date`,
        [userId],
      );
      const byPerson = new Map<string, { persona: string; saldo: number; detalle: unknown[] }>();
      for (const r of rows) {
        const e = byPerson.get(r.persona) ?? { persona: r.persona, saldo: 0, detalle: [] };
        e.saldo += r.tipo === 'lent' ? r.valor : -r.valor;
        e.detalle.push({ fecha: r.fecha, valor: r.valor, concepto: r.concepto, tipo: r.tipo === 'lent' ? 'me debe' : 'le debo' });
        byPerson.set(r.persona, e);
      }
      return { nota: 'saldo positivo = le debe al usuario; negativo = el usuario le debe', personas: [...byPerson.values()] };
    },
  },

  tarjetas: {
    description: 'Estado de las tarjetas de crédito: cupo, deuda pendiente, pago del mes, compras a cuotas activas y proyección de pagos de los próximos 6 meses.',
    parameters: { type: 'object', properties: { mes: { type: 'string', description: 'YYYY-MM, por defecto el actual' } } },
    async run(userId, args) {
      const mes = str(args.mes) ?? thisMonth();
      const cards = await q<{ id: number; name: string; credit_limit: number; ea_rate: number; cut_day: number; pay_day: number }>(
        'SELECT id, name, credit_limit, ea_rate, cut_day, pay_day FROM cards WHERE user_id = $1 AND archived = 0',
        [userId],
      );
      const out = [];
      for (const c of cards) {
        const ps = await purchases(userId, c.id);
        const activas = ps
          .map((p) => ({ p, s: purchaseStatus(p, mes) }))
          .filter(({ s }) => !s.finished)
          .map(({ p, s }) => ({
            compra: p.description || p.categoria || 'Compra',
            valor: p.amount,
            cuotas: p.installments,
            cuota_actual: s.currentIndex + 1,
            valor_cuota: Math.round(s.current?.payment ?? s.rows[0]?.payment ?? 0),
            saldo_pendiente: Math.round(s.remainingBalance),
            termina: s.lastMonth,
          }));
        const deuda = activas.reduce((s, a) => s + a.saldo_pendiente, 0);
        out.push({
          tarjeta: c.name,
          tasa_ea: c.ea_rate,
          dia_corte: c.cut_day,
          dia_pago: c.pay_day,
          cupo: c.credit_limit,
          deuda_pendiente: deuda,
          cupo_disponible: c.credit_limit ? c.credit_limit - deuda : null,
          pago_del_mes: Math.round(ps.reduce((s, p) => s + paymentInMonth(p, mes), 0)),
          proyeccion: Array.from({ length: 6 }, (_, i) => {
            const m = addMonths(mes, i);
            return { mes: m, pago: Math.round(ps.reduce((s, p) => s + paymentInMonth(p, m), 0)) };
          }),
          compras_activas: activas,
        });
      }
      return out;
    },
  },

  simular_compra: {
    description: 'Simula una compra a cuotas: cuota mensual, total e intereses. Puede usar la tasa de una tarjeta del usuario.',
    parameters: {
      type: 'object',
      properties: {
        monto: { type: 'number', description: 'Valor en pesos' },
        cuotas: { type: 'number' },
        tasa_ea: { type: 'number', description: 'Tasa efectiva anual en %, ej 28.5' },
        tarjeta: { type: 'string', description: 'Nombre de la tarjeta para usar su tasa' },
      },
      required: ['monto', 'cuotas'],
    },
    async run(userId, args) {
      let ea = num(args.tasa_ea);
      const cardName = str(args.tarjeta);
      if (ea === undefined && cardName) {
        const [c] = await q<{ ea_rate: number }>('SELECT ea_rate FROM cards WHERE user_id = $1 AND name ILIKE $2 LIMIT 1', [userId, `%${cardName}%`]);
        ea = c?.ea_rate;
      }
      if (ea === undefined) {
        const [c] = await q<{ ea_rate: number }>('SELECT MAX(ea_rate) AS ea_rate FROM cards WHERE user_id = $1 AND archived = 0', [userId]);
        ea = c?.ea_rate ?? 0;
      }
      const monto = num(args.monto) ?? 0;
      const cuotas = Math.max(1, Math.round(num(args.cuotas) ?? 1));
      const s = simulate(monto, cuotas, ea);
      return {
        monto,
        cuotas,
        tasa_ea: ea,
        tasa_mensual_pct: +(eaToMonthly(ea) * 100).toFixed(3),
        cuota_mensual: Math.round(s.payment),
        total: Math.round(s.total),
        intereses: Math.round(s.interest),
      };
    },
  },

  categorias: {
    description: 'Lista las categorías del usuario (gasto o ingreso) con su presupuesto mensual.',
    parameters: { type: 'object', properties: {} },
    run(userId) {
      return q(
        'SELECT name AS nombre, kind AS tipo, budget AS presupuesto_mensual FROM categories WHERE user_id = $1 AND archived = 0 ORDER BY sort',
        [userId],
      );
    },
  },

  por_aprobar: {
    description:
      'Movimientos detectados automáticamente (correo, notificaciones del banco) que esperan aprobación, y el último extracto bancario subido con su resumen.',
    parameters: { type: 'object', properties: {} },
    async run(userId) {
      const pendientes = await q(
        `SELECT source AS origen, kind AS tipo, amount AS monto, merchant AS comercio, concept AS concepto, date AS fecha
         FROM inbox_items WHERE user_id = $1 AND status = 'pending' ORDER BY date DESC LIMIT 30`,
        [userId],
      );
      const [extracto] = await q<{ meta: unknown; checks: unknown; status: string; movimientos: number; subido: string }>(
        `SELECT meta, checks, status, jsonb_array_length(items) AS movimientos, created_at::date::text AS subido
         FROM statements WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
        [userId],
      );
      return { pendientes, ultimo_extracto: extracto ?? null };
    },
  },
};

export const TOOL_DEFS = Object.entries(TOOLS).map(([name, t]) => ({
  type: 'function' as const,
  function: { name, description: t.description, parameters: t.parameters },
}));

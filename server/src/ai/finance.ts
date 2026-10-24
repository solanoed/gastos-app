// Cálculos de tarjeta de crédito al estilo de los bancos colombianos:
// tasa efectiva anual (E.A.) -> mensual vencida, cuota fija (sistema francés).

import { addMonths, monthDiff, parseDateKey, toMonthKey } from './format.js';

/** E.A. en porcentaje (ej. 28.5) -> tasa mensual en fracción (ej. 0.0211). */
export function eaToMonthly(eaPercent: number): number {
  if (!eaPercent || eaPercent <= 0) return 0;
  return Math.pow(1 + eaPercent / 100, 1 / 12) - 1;
}

export function monthlyToEa(monthly: number): number {
  return (Math.pow(1 + monthly, 12) - 1) * 100;
}

/** Cuota fija. A 1 cuota o tasa 0 no se cobra interés. */
export function installmentAmount(principal: number, n: number, monthlyRate: number): number {
  if (n <= 0) return 0;
  if (n === 1 || monthlyRate <= 0) return principal / n;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
}

export type ScheduleRow = {
  k: number; // número de cuota (1..n)
  payment: number;
  interest: number;
  capital: number;
  balance: number; // saldo después de pagar
};

export function amortization(
  principal: number,
  n: number,
  monthlyRate: number,
  fixedPayment?: number | null,
): ScheduleRow[] {
  const rate = n === 1 ? 0 : monthlyRate;
  const pay = fixedPayment && fixedPayment > 0 ? fixedPayment : installmentAmount(principal, n, rate);
  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let k = 1; k <= n; k++) {
    const interest = balance * rate;
    let capital = pay - interest;
    let payment = pay;
    if (k === n || capital > balance) {
      capital = balance;
      payment = capital + interest;
    }
    balance = Math.max(0, balance - capital);
    rows.push({ k, payment, interest, capital, balance });
  }
  return rows;
}

export function simulate(principal: number, n: number, eaPercent: number) {
  const monthly = eaToMonthly(eaPercent);
  const rows = amortization(principal, n, monthly);
  const total = rows.reduce((s, r) => s + r.payment, 0);
  return {
    monthlyRate: n === 1 ? 0 : monthly,
    payment: rows[0]?.payment ?? 0,
    total,
    interest: total - principal,
    rows,
  };
}

/**
 * Mes en que se paga la primera cuota.
 * Si la compra es en o antes del día de corte, entra en ese corte; si no, en el siguiente.
 * El pago cae el mismo mes del corte si el día de pago es posterior al de corte, si no al mes siguiente.
 */
export function firstPaymentMonth(purchaseDate: string, cutDay: number, payDay: number): string {
  const d = parseDateKey(purchaseDate);
  let cutMonth = toMonthKey(d);
  if (d.getDate() > cutDay) cutMonth = addMonths(cutMonth, 1);
  return payDay > cutDay ? cutMonth : addMonths(cutMonth, 1);
}

export type PurchaseLike = {
  amount: number;
  installments: number;
  monthly_rate: number;
  installment_override: number | null;
  first_payment_month: string;
};

/** Estado de una compra a cuotas para un mes dado ('YYYY-MM'). */
export function purchaseStatus(p: PurchaseLike, month: string) {
  const rows = amortization(p.amount, p.installments, p.monthly_rate, p.installment_override);
  const idx = monthDiff(p.first_payment_month, month); // 0 = primera cuota
  const current = idx >= 0 && idx < rows.length ? rows[idx] : null;
  const paidCount = Math.max(0, Math.min(rows.length, idx)); // cuotas de meses anteriores
  const remainingBalance = paidCount === 0 ? p.amount : rows[paidCount - 1].balance;
  const totalCost = rows.reduce((s, r) => s + r.payment, 0);
  return {
    rows,
    current, // cuota que se paga en `month` (o null)
    currentIndex: idx,
    paidCount,
    remaining: rows.length - paidCount,
    remainingBalance, // capital pendiente al inicio del mes
    totalCost,
    totalInterest: totalCost - p.amount,
    lastMonth: addMonths(p.first_payment_month, rows.length - 1),
    finished: idx >= rows.length,
  };
}

/** Pago de la compra en un mes (0 si no le toca). */
export function paymentInMonth(p: PurchaseLike, month: string): number {
  const idx = monthDiff(p.first_payment_month, month);
  if (idx < 0 || idx >= p.installments) return 0;
  const rows = amortization(p.amount, p.installments, p.monthly_rate, p.installment_override);
  return rows[idx].payment;
}

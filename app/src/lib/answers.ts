// Respuestas locales a preguntas frecuentes mientras no hay IA conectada (fase 3).

import type { SQLiteDatabase } from 'expo-sqlite';

import { cardPaymentsForMonth, debtBalances, listRecurring, monthTotals, spendingByCategory } from '@/db/repo';

import { addMonths, currentMonth, money, monthLabel, norm } from './format';

export async function answerLocally(db: SQLiteDatabase, question: string): Promise<string> {
  const q = norm(question);
  const month = /mes pasado|anterior/.test(q) ? addMonths(currentMonth(), -1) : currentMonth();
  const label = monthLabel(month);

  if (/\b(me deben|debo|deuda|deudas|prestamo|presto)\b/.test(q)) {
    const rows = await debtBalances(db);
    if (!rows.length) return 'No tienes deudas pendientes. 🎉';
    const owed = rows.filter((r) => r.balance > 0);
    const owe = rows.filter((r) => r.balance < 0);
    const lines: string[] = [];
    if (owed.length) lines.push('Te deben:\n' + owed.map((r) => `• ${r.name}: ${money(r.balance)}`).join('\n'));
    if (owe.length) lines.push('Tú debes:\n' + owe.map((r) => `• ${r.name}: ${money(-r.balance)}`).join('\n'));
    return lines.join('\n\n');
  }

  if (/\b(tarjeta|tarjetas|cuota|cuotas|tc)\b/.test(q)) {
    const total = await cardPaymentsForMonth(db, month);
    const next = await cardPaymentsForMonth(db, addMonths(month, 1));
    return `Cuotas de tarjeta en ${label}: ${money(total)}.\nEl próximo mes: ${money(next)}.`;
  }

  if (/\b(mas|mayor|top|consumi|gaste en|en que)\b/.test(q)) {
    const cats = await spendingByCategory(db, month);
    if (!cats.length) return `Aún no hay gastos registrados en ${label}.`;
    const total = cats.reduce((s, c) => s + c.total, 0);
    const top = cats
      .slice(0, 5)
      .map((c, i) => `${i + 1}. ${c.name}: ${money(c.total)} (${Math.round((c.total / total) * 100)}%, ${c.count} mov.)`)
      .join('\n');
    return `En ${label} lo que más consumiste fue ${cats[0].name}.\n\n${top}`;
  }

  if (/\b(cuanto|total|llevo|resumen|gaste|gastado)\b/.test(q)) {
    const [tot, rec, cards] = await Promise.all([monthTotals(db, month), listRecurring(db, month), cardPaymentsForMonth(db, month)]);
    const fixed = rec.filter((r) => r.kind === 'fixed').reduce((s, r) => s + r.amount, 0);
    const income = rec.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0) + tot.income;
    return [
      `Resumen de ${label}:`,
      `• Gastos del día a día: ${money(tot.expenseCash)}`,
      `• Compras con tarjeta: ${money(tot.expenseCard)} (cuotas este mes: ${money(cards)})`,
      `• Gastos fijos: ${money(fixed)}`,
      `• Ingresos: ${money(income)}`,
    ].join('\n');
  }

  return 'Sin conexión a la IA no sé responder eso. Inicia sesión en Ajustes para usarla.\n\nPor ahora puedo decirte: "¿en qué gasté más?", "¿cuánto llevo este mes?", "¿cuánto me deben?" o "¿cuánto pago de tarjetas?".';
}

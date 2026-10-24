// Formato de dinero (COP, sin decimales) y fechas locales.

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function groupThousands(n: number): string {
  const s = Math.round(Math.abs(n)).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function money(n: number, opts: { sign?: boolean } = {}): string {
  const neg = n < 0;
  const body = '$' + groupThousands(n);
  if (neg) return '-' + body;
  return opts.sign && n > 0 ? '+' + body : body;
}

/** $1,2M / $350k para gráficos y chips compactos. */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}$${trimDecimal(a / 1_000_000)}M`;
  if (a >= 1_000) return `${sign}$${trimDecimal(a / 1_000)}k`;
  return money(n);
}

function trimDecimal(x: number): string {
  const r = Math.round(x * 10) / 10;
  return (Number.isInteger(r) ? r.toString() : r.toFixed(1)).replace('.', ',');
}

/** Convierte "15.000", "32k", "1,5m", "2 palos" en pesos. Devuelve null si no es un monto. */
export function parseAmount(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/^\$/, '').replace(/\s+/g, '');
  const m = t.match(/^(\d+(?:[.,]\d+)*)(k|mil|lucas?|m|mm|millon(?:es)?|palos?)?$/);
  if (!m) return null;
  const [, num, suffix] = m;
  let value: number;
  if (suffix) {
    // Con sufijo, la coma o el punto es decimal: 1,5m = 1.500.000
    value = parseFloat(num.replace(',', '.'));
    if (suffix === 'k' || suffix === 'mil' || suffix.startsWith('luca')) value *= 1_000;
    else value *= 1_000_000;
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(num)) {
    value = parseInt(num.replace(/[.,]/g, ''), 10);
  } else {
    value = parseFloat(num.replace(',', '.'));
  }
  if (!isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

// ---------- Fechas ----------
// Fechas guardadas como texto local 'YYYY-MM-DD' y meses como 'YYYY-MM'.

const pad = (n: number) => n.toString().padStart(2, '0');

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function nowStamp(): string {
  const d = new Date();
  return `${toDateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function yesterdayKey(): string {
  return toDateKey(new Date(Date.now() - 86_400_000));
}

export function currentMonth(): string {
  return toMonthKey(new Date());
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return toMonthKey(d);
}

export function monthDiff(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function monthLabel(monthKey: string, withYear = true): string {
  const [y, m] = monthKey.split('-').map(Number);
  const name = MONTHS[m - 1];
  const cap = name[0].toUpperCase() + name.slice(1);
  return withYear ? `${cap} ${y}` : cap;
}

export function monthShort(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const thisYear = new Date().getFullYear();
  return y === thisYear ? MONTHS_SHORT[m - 1] : `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

export function dayLabel(dateKey: string): string {
  const today = todayKey();
  const yest = yesterdayKey();
  if (dateKey === today) return 'Hoy';
  if (dateKey === yest) return 'Ayer';
  const d = parseDateKey(dateKey);
  const wd = WEEKDAYS[d.getDay()];
  return `${wd[0].toUpperCase() + wd.slice(1)} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Normaliza para comparar: minúsculas y sin tildes. */
export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

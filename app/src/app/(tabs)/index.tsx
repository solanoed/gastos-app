import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Empty, Icon, IconButton, IconCircle, ProgressBar, Row, Screen, SectionTitle, StatTile, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  cardPaymentsForMonth,
  debtBalances,
  listCards,
  listRecurring,
  monthlyExpenseSeries,
  monthTotals,
  spendingByCategory,
} from '@/db/repo';
import { useData } from '@/hooks/use-data';
import { useInboxCount } from '@/hooks/use-inbox-count';
import { useTheme } from '@/hooks/use-theme';
import { addMonths, currentMonth, daysInMonth, money, moneyShort, monthLabel, monthShort } from '@/lib/format';

export default function Dashboard() {
  const t = useTheme();
  const navigation = useNavigation();
  const [month, setMonth] = useState(currentMonth());
  const inbox = useInboxCount();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Mis Cuentas',
      headerRight: () => (
        <Row gap={0} style={{ marginRight: 8 }}>
          <View>
            <IconButton icon="inbox-arrow-down-outline" onPress={() => router.push('/bandeja')} />
            {inbox > 0 ? (
              <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, backgroundColor: t.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Txt variant="caption" bold color="#fff">
                  {inbox}
                </Txt>
              </View>
            ) : null}
          </View>
          <IconButton icon="calculator-variant-outline" onPress={() => router.push('/calculadora')} />
          <IconButton icon="shape-outline" onPress={() => router.push('/categorias')} />
          <IconButton icon="cog-outline" onPress={() => router.push('/ajustes')} />
        </Row>
      ),
    });
  }, [navigation, inbox, t.danger]);

  const { data } = useData(
    async (db) => {
      const from = addMonths(month, -5);
      const [totals, byCat, recurring, cardPay, debts, series, cards] = await Promise.all([
        monthTotals(db, month),
        spendingByCategory(db, month),
        listRecurring(db, month),
        cardPaymentsForMonth(db, month),
        debtBalances(db),
        monthlyExpenseSeries(db, from, month),
        listCards(db),
      ]);
      const cardsDue = await Promise.all(cards.map(async (c) => ({ card: c, amount: await cardPaymentsForMonth(db, month, c.id) })));
      return { totals, byCat, recurring, cardPay, debts, series, from, cardsDue };
    },
    [month],
  );

  if (!data) return <Screen>{null}</Screen>;

  const { totals, byCat, recurring, cardPay, debts, series, from, cardsDue } = data;
  const incomePlan = recurring.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0);
  const fixed = recurring.filter((r) => r.kind === 'fixed');
  const savings = recurring.filter((r) => r.kind === 'saving');
  const fixedTotal = fixed.reduce((s, r) => s + r.amount, 0);
  const savingTotal = savings.reduce((s, r) => s + r.amount, 0);
  const income = incomePlan + totals.income;
  const available = income - fixedTotal - savingTotal - cardPay;
  const spent = totals.expenseCash;
  const remaining = available - spent;

  const isCurrent = month === currentMonth();
  const today = new Date().getDate();
  const daysLeft = isCurrent ? daysInMonth(month) - today + 1 : 0;

  const pendingFixed = fixed.filter((r) => !r.paid);
  const owedToMe = debts.filter((d) => d.balance > 0).reduce((s, d) => s + d.balance, 0);
  const iOwe = debts.filter((d) => d.balance < 0).reduce((s, d) => s - d.balance, 0);
  const catTotal = byCat.reduce((s, c) => s + c.total, 0);

  // Serie de 6 meses completa (meses sin gasto en 0).
  const months = Array.from({ length: 6 }, (_, i) => addMonths(from, i));
  const seriesMap = new Map(series.map((s) => [s.month, s.total]));
  const maxSeries = Math.max(1, ...months.map((m) => seriesMap.get(m) ?? 0));

  return (
    <Screen>
      <Row between>
        <IconButton icon="chevron-left" onPress={() => setMonth(addMonths(month, -1))} />
        <Pressable onPress={() => setMonth(currentMonth())}>
          <Txt variant="h2">{monthLabel(month)}</Txt>
        </Pressable>
        <IconButton icon="chevron-right" onPress={() => setMonth(addMonths(month, 1))} />
      </Row>

      <Card style={{ backgroundColor: t.primarySoft, borderColor: t.primarySoft }}>
        <Txt variant="small" color={t.primary} bold>
          {remaining >= 0 ? 'Te queda este mes' : 'Te pasaste por'}
        </Txt>
        <Txt variant="amount" color={remaining >= 0 ? t.text : t.danger}>
          {money(Math.abs(remaining))}
        </Txt>
        <ProgressBar value={available > 0 ? spent / available : spent > 0 ? 2 : 0} height={10} />
        <Row between>
          <Txt variant="small" muted>
            Gastado {money(spent)}
          </Txt>
          <Txt variant="small" muted>
            Disponible {money(available)}
          </Txt>
        </Row>
        {isCurrent && remaining > 0 && daysLeft > 0 ? (
          <Txt variant="small" color={t.primary}>
            ≈ {money(remaining / daysLeft)} por día durante los {daysLeft} días que faltan
          </Txt>
        ) : null}
        {income === 0 ? (
          <Pressable onPress={() => router.push('/plan')}>
            <Txt variant="small" bold color={t.info}>
              Configura tus ingresos y gastos fijos en “Mi plan” →
            </Txt>
          </Pressable>
        ) : null}
      </Card>

      <Row>
        <StatTile label="Ingresos" value={moneyShort(income)} color={t.primary} />
        <StatTile label="Fijos" value={moneyShort(fixedTotal)} sub={`${fixed.length - pendingFixed.length}/${fixed.length} pagados`} />
      </Row>
      <Row>
        <StatTile label="Ahorro" value={moneyShort(savingTotal)} color={t.info} />
        <StatTile label="Cuotas tarjeta" value={moneyShort(cardPay)} sub={totals.expenseCard ? `Compras: ${moneyShort(totals.expenseCard)}` : undefined} />
      </Row>

      {(pendingFixed.length > 0 || cardsDue.some((c) => c.amount > 0)) && (
        <>
          <SectionTitle title="Pendiente por pagar" action="Ver plan" onAction={() => router.push('/plan')} />
          <Card>
            {pendingFixed.map((r) => (
              <Row key={r.id} between>
                <Row>
                  <Icon name="calendar-clock" size={18} color={t.warning} />
                  <Txt>
                    {r.name}
                    {r.day ? <Txt muted> · día {r.day}</Txt> : null}
                  </Txt>
                </Row>
                <Txt bold>{money(r.amount)}</Txt>
              </Row>
            ))}
            {cardsDue
              .filter((c) => c.amount > 0)
              .map(({ card, amount }) => (
                <Row key={`c${card.id}`} between>
                  <Row>
                    <Icon name="credit-card-clock-outline" size={18} color={card.color} />
                    <Txt>
                      {card.name}
                      <Txt muted> · día {card.pay_day}</Txt>
                    </Txt>
                  </Row>
                  <Txt bold>{money(amount)}</Txt>
                </Row>
              ))}
          </Card>
        </>
      )}

      <SectionTitle title="¿En qué se fue la plata?" action="Historial" onAction={() => router.push('/historial')} />
      {byCat.length === 0 ? (
        <Card>
          <Empty icon="chart-donut" title="Sin gastos aún" text="Registra tu primer gasto en el chat.">
            <Pressable onPress={() => router.push('/chat')}>
              <Txt bold color={t.primary}>
                Ir al chat →
              </Txt>
            </Pressable>
          </Empty>
        </Card>
      ) : (
        <Card>
          {byCat.map((c) => {
            const pct = catTotal ? c.total / catTotal : 0;
            return (
              <View key={c.category_id ?? 'none'} style={{ gap: 4, paddingVertical: 4 }}>
                <Row between>
                  <Row style={{ flex: 1 }}>
                    <IconCircle icon={c.icon} color={c.color} size={28} />
                    <Txt numberOfLines={1} style={{ flex: 1 }}>
                      {c.name}
                    </Txt>
                  </Row>
                  <Txt bold>{money(c.total)}</Txt>
                  <Txt variant="caption" muted style={{ width: 36, textAlign: 'right' }}>
                    {Math.round(pct * 100)}%
                  </Txt>
                </Row>
                <ProgressBar value={c.budget ? c.total / c.budget : pct} color={c.color} height={6} />
                {c.budget ? (
                  <Txt variant="caption" color={c.total > c.budget ? t.danger : t.textSecondary}>
                    {c.total > c.budget ? `Te pasaste ${money(c.total - c.budget)} del presupuesto` : `Presupuesto ${money(c.budget)} · quedan ${money(c.budget - c.total)}`}
                  </Txt>
                ) : null}
              </View>
            );
          })}
        </Card>
      )}

      <SectionTitle title="Últimos 6 meses" />
      <Card>
        <Row style={{ alignItems: 'flex-end', height: 140, gap: 10 }}>
          {months.map((m) => {
            const v = seriesMap.get(m) ?? 0;
            const sel = m === month;
            return (
              <Pressable key={m} onPress={() => setMonth(m)} style={{ flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <Txt variant="caption" muted numberOfLines={1}>
                  {v ? moneyShort(v) : ''}
                </Txt>
                <View style={{ width: '100%', maxWidth: 34, height: `${Math.max(2, (v / maxSeries) * 70)}%`, borderRadius: 6, backgroundColor: sel ? t.primary : t.backgroundSelected }} />
                <Txt variant="caption" bold={sel} muted={!sel}>
                  {monthShort(m)}
                </Txt>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      {savings.some((s) => s.goal) ? (
        <>
          <SectionTitle title="Metas de ahorro" />
          <Card>
            {savings
              .filter((s) => s.goal)
              .map((s) => (
                <View key={s.id} style={{ gap: 4 }}>
                  <Row between>
                    <Txt bold>{s.name}</Txt>
                    <Txt variant="small" muted>
                      {money(s.saved_total)} / {money(s.goal!)}
                    </Txt>
                  </Row>
                  <ProgressBar value={s.saved_total / s.goal!} color={t.info} />
                </View>
              ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Me deben / Debo" action="Ver personas" onAction={() => router.push('/personas')} />
      <Row>
        <Card style={{ flex: 1 }} onPress={() => router.push('/personas')}>
          <Txt variant="caption" muted>
            Te deben
          </Txt>
          <Txt variant="h2" color={t.info}>
            {money(owedToMe)}
          </Txt>
          <Txt variant="caption" muted numberOfLines={1}>
            {debts.filter((d) => d.balance > 0).map((d) => d.name).join(', ') || 'Nadie'}
          </Txt>
        </Card>
        <Card style={{ flex: 1 }} onPress={() => router.push('/personas')}>
          <Txt variant="caption" muted>
            Debes
          </Txt>
          <Txt variant="h2" color={t.warning}>
            {money(iOwe)}
          </Txt>
          <Txt variant="caption" muted numberOfLines={1}>
            {debts.filter((d) => d.balance < 0).map((d) => d.name).join(', ') || 'A nadie'}
          </Txt>
        </Card>
      </Row>
      <View style={{ height: Spacing.two }} />
    </Screen>
  );
}

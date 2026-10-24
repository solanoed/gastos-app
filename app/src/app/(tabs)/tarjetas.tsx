import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CardForm } from '@/components/card-form';
import { Button, Card, Empty, Icon, ProgressBar, Row, Screen, SectionTitle, Txt } from '@/components/ui';
import { listCards, listPurchases } from '@/db/repo';
import { useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { paymentInMonth, purchaseStatus } from '@/lib/finance';
import { addMonths, currentMonth, money, moneyShort, monthShort } from '@/lib/format';

export default function Tarjetas() {
  const t = useTheme();
  const [formOpen, setFormOpen] = useState(false);
  const month = currentMonth();

  const { data } = useData(async (db) => {
    const [cards, purchases] = await Promise.all([listCards(db), listPurchases(db)]);
    return { cards, purchases };
  }, []);

  if (!data) return <Screen>{null}</Screen>;
  const { cards, purchases } = data;

  const next6 = Array.from({ length: 6 }, (_, i) => addMonths(month, i));
  const projection = next6.map((m) => purchases.reduce((s, p) => s + paymentInMonth(p, m), 0));
  const maxProj = Math.max(1, ...projection);

  return (
    <Screen>
      {cards.length === 0 ? (
        <Card>
          <Empty icon="credit-card-plus-outline" title="Agrega tu primera tarjeta" text="Con el cupo, la tasa y las fechas de corte y pago, la app calcula tus cuotas.">
            <Button title="Agregar tarjeta" icon="plus" onPress={() => setFormOpen(true)} />
          </Empty>
        </Card>
      ) : (
        <>
          {cards.map((c) => {
            const ps = purchases.filter((p) => p.card_id === c.id);
            const used = ps.reduce((s, p) => s + purchaseStatus(p, month).remainingBalance, 0);
            const thisMonth = ps.reduce((s, p) => s + paymentInMonth(p, month), 0);
            const active = ps.filter((p) => !purchaseStatus(p, month).finished).length;
            return (
              <Card key={c.id} onPress={() => router.push({ pathname: '/tarjeta/[id]', params: { id: String(c.id) } })} style={{ borderLeftWidth: 5, borderLeftColor: c.color }}>
                <Row between>
                  <Row>
                    <Icon name="credit-card" color={c.color} />
                    <Txt variant="h2">{c.name}</Txt>
                  </Row>
                  <Icon name="chevron-right" color={t.textSecondary} />
                </Row>
                <Row between>
                  <View>
                    <Txt variant="caption" muted>
                      Pago este mes (día {c.pay_day})
                    </Txt>
                    <Txt variant="h2">{money(thisMonth)}</Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt variant="caption" muted>
                      {active} compras activas
                    </Txt>
                    <Txt variant="small" muted>
                      Corte día {c.cut_day}
                    </Txt>
                  </View>
                </Row>
                {c.credit_limit ? (
                  <>
                    <ProgressBar value={used / c.credit_limit} color={c.color} />
                    <Txt variant="caption" muted>
                      Usado {money(used)} · Disponible {money(Math.max(0, c.credit_limit - used))} de {money(c.credit_limit)}
                    </Txt>
                  </>
                ) : null}
              </Card>
            );
          })}
          <Button title="Agregar tarjeta" icon="plus" variant="secondary" onPress={() => setFormOpen(true)} />

          <SectionTitle title="Próximos 6 meses" />
          <Card>
            <Txt variant="small" muted>
              Lo que pagarás de cuotas si no haces compras nuevas.
            </Txt>
            {next6.map((m, i) => (
              <Row key={m} style={{ gap: 10 }}>
                <Txt variant="small" style={{ width: 52 }} bold={i === 0}>
                  {monthShort(m)}
                </Txt>
                <View style={{ flex: 1 }}>
                  <View style={{ height: 14, width: `${Math.max(1, (projection[i] / maxProj) * 100)}%`, backgroundColor: i === 0 ? t.primary : t.backgroundSelected, borderRadius: 4 }} />
                </View>
                <Txt variant="small" style={{ width: 70, textAlign: 'right' }}>
                  {moneyShort(projection[i])}
                </Txt>
              </Row>
            ))}
          </Card>

          <Button title="Simular una compra a cuotas" icon="calculator-variant" variant="ghost" onPress={() => router.push('/calculadora')} />
        </>
      )}
      <CardForm visible={formOpen} onClose={() => setFormOpen(false)} />
    </Screen>
  );
}

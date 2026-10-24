import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useLayoutEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { CardForm } from '@/components/card-form';
import { MovementForm } from '@/components/movement-form';
import { Button, Card, Divider, Empty, IconButton, IconCircle, ProgressBar, Row, Screen, SectionTitle, Segmented, StatTile, Txt } from '@/components/ui';
import { getCard, listPurchases, setCardArchived } from '@/db/repo';
import type { CardPurchase } from '@/db/types';
import { useBump, useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { monthlyToEa, paymentInMonth, purchaseStatus } from '@/lib/finance';
import { addMonths, currentMonth, dayLabel, money, moneyShort, monthLabel, monthShort } from '@/lib/format';

export default function TarjetaDetalle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cardId = Number(id);
  const db = useSQLiteContext();
  const bump = useBump();
  const navigation = useNavigation();
  const month = currentMonth();
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<'active' | 'done'>('active');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editMovement, setEditMovement] = useState<number | null>(null);

  const { data } = useData(async (d) => {
    const [card, purchases] = await Promise.all([getCard(d, cardId), listPurchases(d, cardId)]);
    return { card, purchases };
  }, [cardId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: data?.card?.name ?? 'Tarjeta',
      headerRight: () => (
        <Row gap={0}>
          <IconButton icon="pencil-outline" onPress={() => setEditOpen(true)} />
          <IconButton
            icon="archive-outline"
            onPress={() =>
              Alert.alert('Archivar tarjeta', 'Deja de aparecer en el plan y en el dashboard. Los gastos se conservan en el historial.', [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Archivar',
                  style: 'destructive',
                  onPress: async () => {
                    await setCardArchived(db, cardId, true);
                    bump();
                    router.back();
                  },
                },
              ])
            }
          />
        </Row>
      ),
    });
  }, [navigation, data?.card?.name, db, cardId, bump]);

  if (!data?.card) return <Screen>{null}</Screen>;
  const { card, purchases } = data;
  const statuses = purchases.map((p) => ({ p, s: purchaseStatus(p, month) }));
  const active = statuses.filter(({ s }) => !s.finished);
  const done = statuses.filter(({ s }) => s.finished);
  const used = active.reduce((sum, { s }) => sum + s.remainingBalance, 0);
  const thisMonth = purchases.reduce((s, p) => s + paymentInMonth(p, month), 0);
  const interestPending = active.reduce((sum, { s }) => sum + s.rows.slice(s.paidCount).reduce((a, r) => a + r.interest, 0), 0);
  const shown = filter === 'active' ? active : done;

  return (
    <Screen>
      <Row>
        <StatTile label={`Pago de ${monthShort(month)}`} value={moneyShort(thisMonth)} color={card.color} sub={`Día ${card.pay_day}`} />
        <StatTile label="Deuda pendiente" value={moneyShort(used)} sub={`Intereses por pagar ${moneyShort(interestPending)}`} />
      </Row>
      {card.credit_limit ? (
        <Card>
          <Row between>
            <Txt variant="small" muted>
              Cupo usado
            </Txt>
            <Txt variant="small" bold>
              {Math.round((used / card.credit_limit) * 100)}%
            </Txt>
          </Row>
          <ProgressBar value={used / card.credit_limit} color={card.color} />
          <Txt variant="caption" muted>
            Disponible {money(Math.max(0, card.credit_limit - used))} de {money(card.credit_limit)} · Tasa {String(card.ea_rate).replace('.', ',')}% E.A. · Corte día {card.cut_day}
          </Txt>
        </Card>
      ) : null}

      <Button title="Registrar compra" icon="plus" onPress={() => setAddOpen(true)} />

      <SectionTitle title="Compras" />
      <Segmented
        options={[
          { value: 'active', label: `Activas (${active.length})` },
          { value: 'done', label: `Pagadas (${done.length})` },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {shown.length === 0 ? (
        <Empty icon="receipt" title={filter === 'active' ? 'Sin compras activas' : 'Nada pagado aún'} />
      ) : (
        shown.map(({ p, s }) => (
          <PurchaseCard
            key={p.id}
            p={p}
            s={s}
            color={card.color}
            open={expanded === p.id}
            onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
            onEdit={() => p.movement_id && setEditMovement(p.movement_id)}
          />
        ))
      )}

      <CardForm visible={editOpen} card={card} onClose={() => setEditOpen(false)} />
      <MovementForm visible={addOpen} onClose={() => setAddOpen(false)} initial={{ card: { card_id: card.id, installments: 1 } }} />
      <MovementForm visible={editMovement !== null} movementId={editMovement} onClose={() => setEditMovement(null)} />
    </Screen>
  );
}

function PurchaseCard({
  p,
  s,
  color,
  open,
  onToggle,
  onEdit,
}: {
  p: CardPurchase;
  s: ReturnType<typeof purchaseStatus>;
  color: string;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const t = useTheme();
  const title = p.description || p.cat_name || 'Compra';
  return (
    <Card onPress={onToggle}>
      <Row>
        <IconCircle icon={p.cat_icon ?? 'shopping'} color={p.cat_color ?? color} size={36} />
        <View style={{ flex: 1 }}>
          <Txt bold numberOfLines={1}>
            {title}
          </Txt>
          <Txt variant="caption" muted>
            {dayLabel(p.purchase_date)} · {money(p.amount)} a {p.installments} {p.installments === 1 ? 'cuota' : 'cuotas'}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt bold>{s.current ? money(s.current.payment) : '—'}</Txt>
          <Txt variant="caption" muted>
            {s.finished ? 'Pagada' : s.currentIndex < 0 ? `Inicia ${monthShort(p.first_payment_month)}` : `Cuota ${s.currentIndex + 1}/${p.installments}`}
          </Txt>
        </View>
      </Row>
      <ProgressBar value={s.paidCount / p.installments} color={color} height={6} />
      <Txt variant="caption" muted>
        {s.paidCount} pagadas · faltan {s.remaining} · termina {monthLabel(s.lastMonth)}
        {s.totalInterest > 1 ? ` · intereses ${money(s.totalInterest)}` : ' · sin intereses'}
      </Txt>
      {open ? (
        <View style={{ gap: 6, marginTop: 6 }}>
          <Divider />
          <Row>
            <Txt variant="caption" bold muted style={{ width: 30 }}>
              #
            </Txt>
            <Txt variant="caption" bold muted style={{ flex: 1 }}>
              Mes
            </Txt>
            <Txt variant="caption" bold muted style={{ flex: 1, textAlign: 'right' }}>
              Cuota
            </Txt>
            <Txt variant="caption" bold muted style={{ flex: 1, textAlign: 'right' }}>
              Interés
            </Txt>
            <Txt variant="caption" bold muted style={{ flex: 1, textAlign: 'right' }}>
              Saldo
            </Txt>
          </Row>
          {s.rows.map((r, i) => {
            const isCurrent = i === s.currentIndex;
            const paid = i < s.paidCount;
            return (
              <Row key={r.k} style={isCurrent ? { backgroundColor: t.primarySoft, borderRadius: 6 } : undefined}>
                <Txt variant="caption" muted={paid} style={{ width: 30 }}>
                  {r.k}
                </Txt>
                <Txt variant="caption" muted={paid} style={{ flex: 1 }}>
                  {monthShort(addMonths(p.first_payment_month, i))}
                </Txt>
                <Txt variant="caption" muted={paid} style={{ flex: 1, textAlign: 'right' }}>
                  {moneyShort(r.payment)}
                </Txt>
                <Txt variant="caption" muted={paid} style={{ flex: 1, textAlign: 'right' }}>
                  {moneyShort(r.interest)}
                </Txt>
                <Txt variant="caption" muted={paid} style={{ flex: 1, textAlign: 'right' }}>
                  {moneyShort(r.balance)}
                </Txt>
              </Row>
            );
          })}
          <Txt variant="caption" muted>
            Tasa {(p.monthly_rate * 100).toFixed(2).replace('.', ',')}% mensual ({monthlyToEa(p.monthly_rate).toFixed(1).replace('.', ',')}% E.A.)
            {p.installment_override ? ' · cuota tomada del extracto' : ''}
          </Txt>
          <Pressable onPress={onEdit}>
            <Txt bold color={t.primary}>
              Editar compra
            </Txt>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}


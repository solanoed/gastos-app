import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';

import { MovementForm, type FormInitial } from '@/components/movement-form';
import { Button, Card, Empty, Icon, Row, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { listCategories, listRecurring, setRecurringPaid } from '@/db/repo';
import { useBump } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { api, getSession } from '@/lib/api';
import { dayLabel, money, norm } from '@/lib/format';

export type InboxItem = {
  id: number;
  source: string;
  sender: string | null;
  subject: string | null;
  kind: 'gasto' | 'ingreso' | 'pago_fijo' | 'factura_por_pagar' | 'otro';
  amount: number;
  merchant: string | null;
  concept: string | null;
  date: string | null;
  due_date: string | null;
  card_last4: string | null;
  suggested_category: string | null;
  matched_recurring: string | null;
};

const KIND_LABEL: Record<InboxItem['kind'], string> = {
  gasto: 'Gasto',
  ingreso: 'Ingreso',
  pago_fijo: 'Pago de gasto fijo',
  factura_por_pagar: 'Factura por pagar',
  otro: 'Movimiento',
};

export default function Bandeja() {
  const db = useSQLiteContext();
  const bump = useBump();
  const t = useTheme();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState<{ item: InboxItem; initial: FormInitial } | null>(null);

  const load = useCallback(async () => {
    if (!(await getSession()).token) {
      setError('Inicia sesión en Ajustes para recibir movimientos de tu correo.');
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const r = await api<{ items: InboxItem[] }>('/inbox');
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function decide(item: InboxItem, status: 'approved' | 'rejected') {
    await api(`/inbox/${item.id}/decide`, { method: 'POST', json: { status } });
    setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
  }

  async function approve(item: InboxItem) {
    // Pago de un gasto fijo (ej. ICETEX): marcarlo como pagado en Mi plan.
    if (item.matched_recurring && (item.kind === 'pago_fijo' || item.kind === 'gasto')) {
      const month = (item.date ?? '').slice(0, 7);
      const rec = (await listRecurring(db, month)).find((r) => norm(r.name) === norm(item.matched_recurring!));
      if (rec) {
        await setRecurringPaid(db, rec.id, month, true, item.amount);
        await decide(item, 'approved');
        bump();
        return Alert.alert('Listo', `${rec.name} quedó marcado como pagado.`);
      }
    }
    const cats = await listCategories(db);
    const cat = item.suggested_category ? cats.find((c) => norm(c.name) === norm(item.suggested_category!)) : undefined;
    setForm({
      item,
      initial: {
        type: item.kind === 'ingreso' ? 'income' : 'expense',
        amount: item.amount,
        category_id: cat?.id ?? null,
        concept: [item.merchant, item.concept].filter(Boolean).join(' · '),
        date: item.date ?? undefined,
      },
    });
  }

  async function scan() {
    setScanning(true);
    try {
      const r = await api<{ added: number }>('/inbox/scan', { method: 'POST', timeoutMs: 180_000 });
      await load();
      if (!r.added) Alert.alert('Revisado', 'No encontré movimientos nuevos en tu correo.');
    } catch (e) {
      Alert.alert('No se pudo revisar', (e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Txt variant="small" muted>
        Movimientos detectados en tu correo y en las notificaciones del banco. Apruébalos para guardarlos o descártalos.
      </Txt>
      <Button title="Revisar correo ahora" icon="email-sync-outline" variant="secondary" onPress={scan} loading={scanning} />

      {error ? (
        <Card>
          <Txt color={t.danger}>{error}</Txt>
        </Card>
      ) : null}

      {items && items.length === 0 && !error ? (
        <Card>
          <Empty icon="inbox-outline" title="Nada por aprobar" text="Cuando llegue un pago o compra a tu correo o al celular, aparecerá aquí." />
        </Card>
      ) : null}

      {items?.map((item) => (
        <Card key={item.id}>
          <Row between style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="caption" muted>
                {KIND_LABEL[item.kind] ?? 'Movimiento'} · {item.date ? dayLabel(item.date) : ''}
              </Txt>
              <Txt bold numberOfLines={1}>
                {item.merchant ?? item.concept ?? 'Movimiento'}
              </Txt>
              {item.concept && item.merchant ? (
                <Txt variant="small" muted numberOfLines={1}>
                  {item.concept}
                </Txt>
              ) : null}
            </View>
            <Txt variant="h2" color={item.kind === 'ingreso' ? t.primary : t.text}>
              {money(item.amount)}
            </Txt>
          </Row>
          <Row style={{ flexWrap: 'wrap' }} gap={6}>
            {item.suggested_category ? <Tag icon="shape-outline" text={item.suggested_category} /> : null}
            {item.matched_recurring ? <Tag icon="calendar-check" text={`Fijo: ${item.matched_recurring}`} /> : null}
            {item.card_last4 ? <Tag icon="credit-card-outline" text={`•••• ${item.card_last4}`} /> : null}
            {item.due_date ? <Tag icon="calendar-alert" text={`Vence ${item.due_date}`} /> : null}
          </Row>
          {item.subject ? (
            <Txt variant="caption" muted numberOfLines={2}>
              ✉️ {item.subject}
            </Txt>
          ) : null}
          <Row>
            <Button title="Descartar" icon="close" variant="secondary" small onPress={() => decide(item, 'rejected')} style={{ flex: 1 }} />
            <Button title={item.matched_recurring ? 'Marcar pagado' : 'Aprobar'} icon="check" small onPress={() => approve(item)} style={{ flex: 1 }} />
          </Row>
        </Card>
      ))}

      <MovementForm
        visible={form !== null}
        initial={form?.initial}
        onClose={() => setForm(null)}
        onSaved={() => {
          if (form) decide(form.item, 'approved');
        }}
      />
    </ScrollView>
  );
}

function Tag({ icon, text }: { icon: string; text: string }) {
  const t = useTheme();
  return (
    <Row gap={4} style={{ backgroundColor: t.backgroundElement, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Icon name={icon} size={14} color={t.textSecondary} />
      <Txt variant="caption">{text}</Txt>
    </Row>
  );
}

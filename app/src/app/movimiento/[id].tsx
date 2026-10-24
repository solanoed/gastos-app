import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { MovementForm } from '@/components/movement-form';
import { Button, Card, Divider, IconCircle, Row, Screen, Txt } from '@/components/ui';
import { getMovement, listAttachments, setSettled } from '@/db/repo';
import { MOVEMENT_TYPE_LABEL } from '@/db/types';
import { useBump, useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, money } from '@/lib/format';

export default function MovimientoDetalle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const movementId = Number(id);
  const db = useSQLiteContext();
  const bump = useBump();
  const t = useTheme();
  const [editOpen, setEditOpen] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);

  const { data } = useData(async (d) => {
    const [m, atts] = await Promise.all([getMovement(d, movementId), listAttachments(d, movementId)]);
    return { m, atts };
  }, [movementId]);

  if (!data) return <Screen>{null}</Screen>;
  if (!data.m) {
    // Se borró (por ejemplo desde el formulario).
    return (
      <Screen>
        <Txt muted>Este movimiento ya no existe.</Txt>
        <Button title="Volver" onPress={() => router.back()} />
      </Screen>
    );
  }
  const { m, atts } = data;
  const isDebt = m.type === 'lent' || m.type === 'borrowed';

  return (
    <Screen>
      <Card style={{ alignItems: 'center', gap: 6 }}>
        <IconCircle icon={m.cat_icon ?? 'help-circle'} color={m.cat_color ?? '#94A3B8'} size={56} />
        <Txt variant="small" muted>
          {MOVEMENT_TYPE_LABEL[m.type]}
        </Txt>
        <Txt variant="amount" color={m.type === 'income' ? t.primary : t.text}>
          {money(m.amount)}
        </Txt>
        <Txt bold>{m.cat_name ?? 'Sin categoría'}</Txt>
      </Card>

      <Card>
        <Detail label="Fecha" value={dayLabel(m.date.slice(0, 10)) + ` (${m.date.slice(0, 10)})`} />
        {m.concept ? <Detail label="Concepto" value={m.concept} /> : null}
        {m.person_name ? <Detail label={m.type === 'lent' ? 'Te debe' : m.type === 'borrowed' ? 'Le debes a' : 'Persona'} value={m.person_name} /> : null}
        {m.card_name ? <Detail label="Tarjeta" value={`${m.card_name} · ${m.installments} ${m.installments === 1 ? 'cuota' : 'cuotas'}`} /> : null}
        {isDebt ? <Detail label="Estado" value={m.settled ? 'Saldado ✅' : 'Pendiente'} /> : null}
      </Card>

      {atts.length ? (
        <Card>
          <Txt variant="small" bold muted>
            Fotos
          </Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {atts.map((a) => (
              <Pressable key={a.id} onPress={() => setViewer(a.uri)}>
                <Image source={{ uri: a.uri }} style={{ width: 100, height: 100, borderRadius: 10 }} contentFit="cover" />
              </Pressable>
            ))}
          </Row>
        </Card>
      ) : null}

      <Row>
        {isDebt ? (
          <Button
            title={m.settled ? 'Marcar pendiente' : 'Marcar saldado'}
            variant="secondary"
            icon={m.settled ? 'undo' : 'check'}
            onPress={async () => {
              await setSettled(db, m.id, !m.settled);
              bump();
            }}
            style={{ flex: 1 }}
          />
        ) : null}
        <Button title="Editar" icon="pencil" onPress={() => setEditOpen(true)} style={{ flex: 1 }} />
      </Row>

      <MovementForm visible={editOpen} movementId={m.id} onClose={() => setEditOpen(false)} />

      <Modal visible={!!viewer} transparent onRequestClose={() => setViewer(null)} animationType="fade">
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={{ width: '100%', height: '80%' }} contentFit="contain" /> : null}
        </Pressable>
      </Modal>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Txt variant="caption" muted>
        {label}
      </Txt>
      <Txt>{value}</Txt>
      <Divider />
    </View>
  );
}

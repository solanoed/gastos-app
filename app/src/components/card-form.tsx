import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { PALETTE } from '@/constants/theme';
import { saveCard } from '@/db/repo';
import type { Card } from '@/db/types';
import { useBump } from '@/hooks/use-data';
import { eaToMonthly } from '@/lib/finance';
import { money, parseAmount } from '@/lib/format';

import { Button, Field, Input, Row, Sheet, Txt } from './ui';

export function CardForm({ visible, card, onClose }: { visible: boolean; card?: Card | null; onClose: () => void }) {
  // Remontar al abrir para reiniciar los campos.
  return visible ? <Inner card={card} onClose={onClose} /> : null;
}

function Inner({ card, onClose }: { card?: Card | null; onClose: () => void }) {
  const db = useSQLiteContext();
  const bump = useBump();
  const [name, setName] = useState(card?.name ?? '');
  const [limit, setLimit] = useState(card ? String(card.credit_limit) : '');
  const [rate, setRate] = useState(card ? String(card.ea_rate).replace('.', ',') : '');
  const [cut, setCut] = useState(card ? String(card.cut_day) : '');
  const [pay, setPay] = useState(card ? String(card.pay_day) : '');
  const [color, setColor] = useState(card?.color ?? PALETTE[13]);

  const ea = parseFloat(rate.replace(',', '.')) || 0;

  async function save() {
    const cutDay = parseInt(cut, 10);
    const payDay = parseInt(pay, 10);
    if (!name.trim()) return Alert.alert('Falta el nombre', 'Ej: Nu, Bancolombia Visa');
    if (!(cutDay >= 1 && cutDay <= 31) || !(payDay >= 1 && payDay <= 31)) {
      return Alert.alert('Revisa las fechas', 'El día de corte y el de pago deben estar entre 1 y 31.');
    }
    await saveCard(db, {
      id: card?.id,
      name: name.trim(),
      credit_limit: parseAmount(limit) ?? 0,
      ea_rate: ea,
      cut_day: cutDay,
      pay_day: payDay,
      color,
    });
    bump();
    onClose();
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={card ? 'Editar tarjeta' : 'Nueva tarjeta'}
      footer={<Button title="Guardar" icon="check" onPress={save} />}>
      <Field label="Nombre">
        <Input value={name} onChangeText={setName} placeholder="Nu, Bancolombia Visa…" />
      </Field>
      <Field label="Cupo total" hint={parseAmount(limit) ? money(parseAmount(limit)!) : undefined}>
        <Input value={limit} onChangeText={setLimit} placeholder="Ej: 5m" />
      </Field>
      <Field
        label="Tasa de interés E.A. (%)"
        hint={ea ? `Equivale a ${(eaToMonthly(ea) * 100).toFixed(2).replace('.', ',')}% mensual. Está en tu extracto.` : 'La que aparece en el extracto, ej: 28,5'}>
        <Input value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="28,5" />
      </Field>
      <Row>
        <View style={{ flex: 1 }}>
          <Field label="Día de corte">
            <Input value={cut} onChangeText={setCut} keyboardType="number-pad" placeholder="30" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Día de pago">
            <Input value={pay} onChangeText={setPay} keyboardType="number-pad" placeholder="15" />
          </Field>
        </View>
      </Row>
      <Field label="Color">
        <Row style={{ flexWrap: 'wrap' }}>
          {PALETTE.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: '#fff' }}
            />
          ))}
        </Row>
      </Field>
      {card ? (
        <Txt variant="caption" muted>
          Si cambias la tasa o las fechas, se recalculan las cuotas de las compras de esta tarjeta.
        </Txt>
      ) : null}
    </Sheet>
  );
}

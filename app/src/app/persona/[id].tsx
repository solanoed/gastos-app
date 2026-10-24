import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useLayoutEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { MovementForm } from '@/components/movement-form';
import { MovementRow } from '@/components/movement-row';
import { Avatar, Button, Card, Field, IconButton, Input, Row, Screen, SectionTitle, Segmented, Sheet, Txt } from '@/components/ui';
import { deletePerson, getPerson, listMovements, settlePerson, updatePerson } from '@/db/repo';
import type { MovementType, Person } from '@/db/types';
import { useBump, useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { openWhatsApp, pickContact } from '@/lib/contacts';
import { money } from '@/lib/format';

export default function PersonaDetalle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const personId = Number(id);
  const db = useSQLiteContext();
  const bump = useBump();
  const t = useTheme();
  const navigation = useNavigation();
  const [form, setForm] = useState<MovementType | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [show, setShow] = useState<'pending' | 'all'>('pending');

  const { data } = useData(async (d) => {
    const [person, movements] = await Promise.all([getPerson(d, personId), listMovements(d, { personId, limit: 500 })]);
    return { person, movements };
  }, [personId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: data?.person?.name ?? 'Persona',
      headerRight: () => <IconButton icon="pencil-outline" onPress={() => setEditOpen(true)} />,
    });
  }, [navigation, data?.person?.name]);

  if (!data) return <Screen>{null}</Screen>;
  if (!data.person) {
    return (
      <Screen>
        <Txt muted>Esta persona ya no existe.</Txt>
        <Button title="Volver" onPress={() => router.back()} />
      </Screen>
    );
  }
  const { person, movements } = data;
  const debts = movements.filter((m) => m.type === 'lent' || m.type === 'borrowed');
  const pending = debts.filter((m) => !m.settled);
  const balance = pending.reduce((s, m) => s + (m.type === 'lent' ? m.amount : -m.amount), 0);
  const shown = show === 'pending' ? pending : movements;
  const color = balance > 0 ? t.info : balance < 0 ? t.warning : t.textSecondary;

  function settleAll() {
    Alert.alert(
      'Marcar todo como saldado',
      balance > 0 ? `¿${person.name} ya te pagó ${money(balance)}?` : `¿Ya le pagaste ${money(-balance)} a ${person.name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, saldado',
          onPress: async () => {
            await settlePerson(db, person.id);
            bump();
          },
        },
      ],
    );
  }

  function remind() {
    if (!person.phone) return;
    const detail = pending
      .filter((m) => m.type === 'lent')
      .slice(0, 8)
      .map((m) => `• ${m.concept || m.cat_name || 'Préstamo'}: ${money(m.amount)}`)
      .join('\n');
    const first = person.name.split(' ')[0];
    openWhatsApp(person.phone, `Hola ${first}, te recuerdo que tienes pendiente ${money(balance)}:\n${detail}`);
  }

  return (
    <Screen>
      <Card style={{ alignItems: 'center', gap: 6 }}>
        <Avatar name={person.name} color={color} size={64} />
        <Txt variant="h2">{person.name}</Txt>
        {person.phone ? (
          <Txt variant="small" muted>
            {person.phone}
          </Txt>
        ) : null}
        <Txt variant="amount" color={color}>
          {money(Math.abs(balance))}
        </Txt>
        <Txt muted>{balance > 0 ? 'te debe' : balance < 0 ? 'le debes' : 'están al día'}</Txt>
      </Card>

      <Row>
        <Button title="Me debe" icon="account-arrow-left" variant="secondary" onPress={() => setForm('lent')} style={{ flex: 1 }} />
        <Button title="Le debo" icon="account-arrow-right" variant="secondary" onPress={() => setForm('borrowed')} style={{ flex: 1 }} />
      </Row>
      {balance !== 0 ? (
        <Row>
          <Button title="Saldar todo" icon="check-all" onPress={settleAll} style={{ flex: 1 }} />
          {balance > 0 && person.phone ? <Button title="Cobrar" icon="whatsapp" variant="secondary" onPress={remind} style={{ flex: 1 }} /> : null}
        </Row>
      ) : null}

      <SectionTitle title="Movimientos" />
      <Segmented
        options={[
          { value: 'pending', label: `Pendientes (${pending.length})` },
          { value: 'all', label: `Todos (${movements.length})` },
        ]}
        value={show}
        onChange={setShow}
      />
      <Card>
        {shown.length === 0 ? (
          <Txt muted>No hay movimientos.</Txt>
        ) : (
          shown.map((m) => <MovementRow key={m.id} m={m} onPress={() => router.push({ pathname: '/movimiento/[id]', params: { id: String(m.id) } })} />)
        )}
      </Card>

      <MovementForm visible={form !== null} onClose={() => setForm(null)} initial={{ type: form ?? 'lent', person: person.name }} />
      {editOpen ? <EditPerson person={person} onClose={() => setEditOpen(false)} /> : null}
    </Screen>
  );
}

function EditPerson({ person, onClose }: { person: Person; onClose: () => void }) {
  const db = useSQLiteContext();
  const bump = useBump();
  const [name, setName] = useState(person.name);
  const [phone, setPhone] = useState(person.phone ?? '');

  async function linkContact() {
    const c = await pickContact();
    if (!c) return;
    if (c.phone) setPhone(c.phone);
    if (!name.trim()) setName(c.name);
  }

  async function save() {
    if (!name.trim()) return Alert.alert('Falta el nombre');
    try {
      await updatePerson(db, person.id, { name, phone: phone.trim() || null, photo: person.photo });
      bump();
      onClose();
    } catch {
      Alert.alert('Ya existe', 'Hay otra persona con ese nombre.');
    }
  }

  function remove() {
    Alert.alert('Eliminar persona', 'Sus movimientos se conservan, pero quedan sin persona.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deletePerson(db, person.id);
          bump();
          onClose();
          router.back();
        },
      },
    ]);
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Editar persona"
      footer={
        <Row>
          <Button title="Eliminar" variant="danger" icon="trash-can-outline" onPress={remove} />
          <Button title="Guardar" icon="check" onPress={save} style={{ flex: 1 }} />
        </Row>
      }>
      <Field label="Nombre">
        <Input value={name} onChangeText={setName} autoCapitalize="words" />
      </Field>
      <Field label="Celular" hint="Para cobrarle por WhatsApp">
        <View style={{ gap: 8 }}>
          <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="300 123 4567" />
          <Button title="Tomar de mis contactos" icon="account-box-outline" variant="secondary" small onPress={linkContact} />
        </View>
      </Field>
    </Sheet>
  );
}

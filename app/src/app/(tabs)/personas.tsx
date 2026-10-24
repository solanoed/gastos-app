import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Avatar, Button, Card, Divider, Empty, Field, Icon, Input, Row, Screen, Segmented, Sheet, StatTile, Txt } from '@/components/ui';
import { getOrCreatePerson, peopleSummary } from '@/db/repo';
import { useBump, useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { pickContact } from '@/lib/contacts';
import { dayLabel, money, moneyShort } from '@/lib/format';

type Filter = 'pending' | 'all';

export default function Personas() {
  const t = useTheme();
  const db = useSQLiteContext();
  const bump = useBump();
  const [filter, setFilter] = useState<Filter>('pending');
  const [newOpen, setNewOpen] = useState(false);
  const { data } = useData((d) => peopleSummary(d), []);

  if (!data) return <Screen>{null}</Screen>;
  const owedToMe = data.filter((p) => p.balance > 0).reduce((s, p) => s + p.balance, 0);
  const iOwe = data.filter((p) => p.balance < 0).reduce((s, p) => s - p.balance, 0);
  const shown = filter === 'pending' ? data.filter((p) => p.balance !== 0) : data;

  async function addFromContacts() {
    const c = await pickContact();
    if (!c || !c.name) return;
    const id = await getOrCreatePerson(db, c.name, c.phone);
    bump();
    router.push({ pathname: '/persona/[id]', params: { id: String(id) } });
  }

  return (
    <Screen>
      <Row>
        <StatTile label="Te deben" value={moneyShort(owedToMe)} color={t.info} sub={`${data.filter((p) => p.balance > 0).length} personas`} />
        <StatTile label="Debes" value={moneyShort(iOwe)} color={t.warning} sub={`${data.filter((p) => p.balance < 0).length} personas`} />
      </Row>
      <Row>
        <Button title="Desde contactos" icon="account-box-outline" variant="secondary" onPress={addFromContacts} style={{ flex: 1 }} />
        <Button title="Nueva" icon="account-plus" variant="secondary" onPress={() => setNewOpen(true)} style={{ flex: 1 }} />
      </Row>
      <Segmented
        options={[
          { value: 'pending', label: 'Con saldo pendiente' },
          { value: 'all', label: `Todas (${data.length})` },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {shown.length === 0 ? (
        <Card>
          <Empty
            icon="handshake-outline"
            title={filter === 'pending' ? 'Todo al día' : 'Aún no hay personas'}
            text='Escribe en el chat "victor me debe 20k" o agrega a alguien desde tus contactos.'
          />
        </Card>
      ) : (
        <Card>
          {shown.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <Pressable onPress={() => router.push({ pathname: '/persona/[id]', params: { id: String(p.id) } })}>
              <Row style={{ paddingVertical: 10 }} gap={12}>
                <Avatar name={p.name} color={p.balance > 0 ? t.info : p.balance < 0 ? t.warning : t.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Txt bold>{p.name}</Txt>
                  <Txt variant="caption" muted>
                    {p.pending_count ? `${p.pending_count} pendientes · ` : ''}
                    {p.last_date ? `último: ${dayLabel(p.last_date.slice(0, 10))}` : 'sin movimientos'}
                    {p.phone ? ' · 📱' : ''}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt bold color={p.balance > 0 ? t.info : p.balance < 0 ? t.warning : t.textSecondary}>
                    {p.balance === 0 ? 'Al día' : money(Math.abs(p.balance))}
                  </Txt>
                  {p.balance !== 0 ? (
                    <Txt variant="caption" muted>
                      {p.balance > 0 ? 'te debe' : 'le debes'}
                    </Txt>
                  ) : null}
                </View>
                <Icon name="chevron-right" color={t.textSecondary} />
              </Row>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <NewPersonSheet visible={newOpen} onClose={() => setNewOpen(false)} />
    </Screen>
  );
}

function NewPersonSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return visible ? <NewPersonInner onClose={onClose} /> : null;
}

function NewPersonInner({ onClose }: { onClose: () => void }) {
  const db = useSQLiteContext();
  const bump = useBump();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  async function save() {
    if (!name.trim()) return Alert.alert('Falta el nombre');
    const id = await getOrCreatePerson(db, name, phone.trim() || null);
    bump();
    onClose();
    router.push({ pathname: '/persona/[id]', params: { id: String(id) } });
  }

  return (
    <Sheet visible onClose={onClose} title="Nueva persona" footer={<Button title="Guardar" icon="check" onPress={save} />}>
      <Field label="Nombre">
        <Input value={name} onChangeText={setName} placeholder="Víctor" autoCapitalize="words" autoFocus />
      </Field>
      <Field label="Celular (opcional)" hint="Para cobrarle por WhatsApp">
        <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="300 123 4567" />
      </Field>
    </Sheet>
  );
}

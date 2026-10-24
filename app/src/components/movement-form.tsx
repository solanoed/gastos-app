import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import {
  createMovement,
  deleteMovement,
  getMovement,
  listAttachments,
  listCards,
  listCategories,
  listPeople,
  updateMovement,
} from '@/db/repo';
import type { Attachment, Card, Category, MovementType, Person } from '@/db/types';
import { useBump } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { eaToMonthly, firstPaymentMonth, installmentAmount } from '@/lib/finance';
import { pickContact } from '@/lib/contacts';
import { money, monthLabel, parseAmount, todayKey, yesterdayKey } from '@/lib/format';
import { Spacing } from '@/constants/theme';

import { Button, Chip, Field, Icon, Input, Row, Segmented, Sheet, Txt } from './ui';

export type FormInitial = {
  type?: MovementType;
  amount?: number | null;
  category_id?: number | null;
  concept?: string;
  person?: string;
  date?: string;
  card?: { card_id: number; installments: number } | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Si viene, se edita ese movimiento. */
  movementId?: number | null;
  initial?: FormInitial;
  onSaved?: (id: number, summary: string) => void;
};

const TYPES: { value: MovementType; label: string }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
  { value: 'lent', label: 'Me deben' },
  { value: 'borrowed', label: 'Yo debo' },
];

const QUICK_INSTALLMENTS = [1, 3, 6, 12, 24, 36];

export function MovementForm({ visible, onClose, movementId, initial, onSaved }: Props) {
  const db = useSQLiteContext();
  const bump = useBump();
  const t = useTheme();

  const [categories, setCategories] = useState<Category[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const [type, setType] = useState<MovementType>('expense');
  const [amountText, setAmountText] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [concept, setConcept] = useState('');
  const [person, setPerson] = useState('');
  const [personPhone, setPersonPhone] = useState<string | null>(null);
  const [date, setDate] = useState(todayKey());
  const [payWithCard, setPayWithCard] = useState(false);
  const [cardId, setCardId] = useState<number | null>(null);
  const [installmentsText, setInstallmentsText] = useState('1');
  const [overrideText, setOverrideText] = useState('');
  const [existing, setExisting] = useState<Attachment[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [newImages, setNewImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Cargar catálogos y datos iniciales cada vez que se abre.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      const [cats, cs, ps] = await Promise.all([listCategories(db), listCards(db), listPeople(db)]);
      if (!alive) return;
      setCategories(cats);
      setCards(cs);
      setPeople(ps);
      setRemoved([]);
      setNewImages([]);
      setPersonPhone(null);
      if (movementId) {
        const m = await getMovement(db, movementId);
        const atts = await listAttachments(db, movementId);
        if (!alive || !m) return;
        setType(m.type);
        setAmountText(String(m.amount));
        setCategoryId(m.category_id);
        setConcept(m.concept);
        setPerson(m.person_name ?? '');
        setDate(m.date.slice(0, 10));
        setPayWithCard(!!m.card_id);
        setCardId(m.card_id ?? cs[0]?.id ?? null);
        setInstallmentsText(String(m.installments ?? 1));
        setOverrideText(m.installment_override ? String(m.installment_override) : '');
        setExisting(atts);
      } else {
        const i = initial ?? {};
        setType(i.type ?? 'expense');
        setAmountText(i.amount ? String(i.amount) : '');
        setCategoryId(i.category_id ?? null);
        setConcept(i.concept ?? '');
        setPerson(i.person ?? '');
        setDate(i.date ?? todayKey());
        setPayWithCard(!!i.card);
        setCardId(i.card?.card_id || cs[0]?.id || null);
        setInstallmentsText(String(i.card?.installments ?? 1));
        setOverrideText('');
        setExisting([]);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, movementId]);

  const amount = parseAmount(amountText);
  const isDebt = type === 'lent' || type === 'borrowed';
  const kind = type === 'income' ? 'income' : 'expense';
  const visibleCats = categories.filter((c) => c.kind === kind);
  const card = cards.find((c) => c.id === cardId) ?? null;
  const installments = Math.max(1, parseInt(installmentsText, 10) || 1);
  const override = parseAmount(overrideText);

  const cardPreview = useMemo(() => {
    if (!payWithCard || !card || !amount) return null;
    const rate = installments === 1 ? 0 : eaToMonthly(card.ea_rate);
    const cuota = override ?? installmentAmount(amount, installments, rate);
    const first = firstPaymentMonth(date, card.cut_day, card.pay_day);
    return { cuota, total: cuota * installments, first };
  }, [payWithCard, card, amount, installments, override, date]);

  async function pickImages(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso necesario', fromCamera ? 'Activa el permiso de cámara.' : 'Activa el permiso de fotos.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.7 };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 10 });
    if (!res.canceled) setNewImages((prev) => [...prev, ...res.assets.map((a) => a.uri)]);
  }

  async function save() {
    if (!amount) return Alert.alert('Falta el monto', 'Escribe un valor, por ejemplo 15000 o 32k.');
    if (isDebt && !person.trim()) return Alert.alert('Falta la persona', '¿Quién te debe o a quién le debes?');
    if (type === 'expense' && payWithCard && !card) return Alert.alert('Falta la tarjeta', 'Crea una tarjeta en la pestaña Tarjetas.');
    setSaving(true);
    try {
      const input = {
        type,
        amount,
        category_id: categoryId,
        concept,
        person_name: isDebt ? person : null,
        person_phone: isDebt ? personPhone : null,
        date,
        newImages,
        card: type === 'expense' && payWithCard && card ? { card_id: card.id, installments, installment_override: override } : null,
      };
      let id: number;
      if (movementId) {
        await updateMovement(db, movementId, input, removed);
        id = movementId;
      } else {
        id = await createMovement(db, input);
      }
      bump();
      const cat = categories.find((c) => c.id === categoryId);
      onSaved?.(id, `${cat?.name ?? (isDebt ? person : 'Movimiento')} · ${money(amount)}`);
      onClose();
    } catch (e) {
      Alert.alert('No se pudo guardar', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!movementId) return;
    Alert.alert('Borrar movimiento', '¿Seguro? También se borran sus fotos y, si fue con tarjeta, la compra a cuotas.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await deleteMovement(db, movementId);
          bump();
          onClose();
        },
      },
    ]);
  }

  const yesterday = yesterdayKey();
  const shownImages = [
    ...existing.filter((a) => !removed.includes(a.id)).map((a) => ({ key: `e${a.id}`, uri: a.uri, remove: () => setRemoved((r) => [...r, a.id]) })),
    ...newImages.map((uri, i) => ({ key: `n${i}`, uri, remove: () => setNewImages((n) => n.filter((_, j) => j !== i)) })),
  ];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={movementId ? 'Editar movimiento' : 'Nuevo movimiento'}
      footer={
        <Row>
          {movementId ? <Button title="Borrar" variant="danger" icon="trash-can-outline" onPress={confirmDelete} /> : null}
          <Button title="Guardar" icon="check" onPress={save} loading={saving} style={{ flex: 1 }} />
        </Row>
      }>
      <Segmented options={TYPES} value={type} onChange={setType} />

      <Field label="Valor" hint={amount ? money(amount) : 'Ej: 15000, 32k, 1,5m'}>
        <Input big value={amountText} onChangeText={setAmountText} placeholder="$0" keyboardType="default" autoFocus={!movementId} />
      </Field>

      <Field label={isDebt ? 'Categoría (opcional)' : 'Categoría'}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {visibleCats.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              icon={c.icon}
              color={c.color}
              selected={categoryId === c.id}
              onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
            />
          ))}
        </View>
      </Field>

      {isDebt ? (
        <Field label={type === 'lent' ? '¿Quién te debe?' : '¿A quién le debes?'}>
          <Row>
            <Input value={person} onChangeText={setPerson} placeholder="Nombre" autoCapitalize="words" style={{ flex: 1 }} />
            <Button
              title="Contactos"
              icon="account-box-outline"
              variant="secondary"
              small
              onPress={async () => {
                const c = await pickContact();
                if (c?.name) {
                  setPerson(c.name);
                  setPersonPhone(c.phone);
                }
              }}
            />
          </Row>
          {people.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {people.map((p) => (
                <Chip key={p.id} label={p.name} icon="account" selected={person.toLowerCase() === p.name.toLowerCase()} onPress={() => setPerson(p.name)} />
              ))}
            </View>
          ) : null}
        </Field>
      ) : null}

      <Field label="Concepto (opcional)">
        <Input value={concept} onChangeText={setConcept} placeholder="Ej: almuerzo con Víctor" />
      </Field>

      <Field label="Fecha">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="Hoy" selected={date === todayKey()} onPress={() => setDate(todayKey())} />
          <Chip label="Ayer" selected={date === yesterday} onPress={() => setDate(yesterday)} />
          <Input value={date} onChangeText={setDate} placeholder="AAAA-MM-DD" style={{ flex: 1, minWidth: 130, paddingVertical: 8 }} />
        </Row>
      </Field>

      {type === 'expense' ? (
        <Field label="¿Cómo pagaste?">
          <Segmented
            options={[
              { value: 'cash', label: 'Efectivo / débito' },
              { value: 'card', label: 'Tarjeta de crédito' },
            ]}
            value={payWithCard ? 'card' : 'cash'}
            onChange={(v) => setPayWithCard(v === 'card')}
          />
          {payWithCard ? (
            cards.length === 0 ? (
              <Txt muted>Aún no tienes tarjetas. Créalas en la pestaña Tarjetas.</Txt>
            ) : (
              <View style={{ gap: Spacing.two, marginTop: Spacing.one }}>
                <Row style={{ flexWrap: 'wrap' }}>
                  {cards.map((c) => (
                    <Chip key={c.id} label={c.name} icon="credit-card" color={c.color} selected={cardId === c.id} onPress={() => setCardId(c.id)} />
                  ))}
                </Row>
                <Txt variant="small" muted bold>
                  Cuotas
                </Txt>
                <Row style={{ flexWrap: 'wrap' }}>
                  {QUICK_INSTALLMENTS.map((n) => (
                    <Chip key={n} label={String(n)} selected={installments === n} onPress={() => setInstallmentsText(String(n))} />
                  ))}
                  <Input value={installmentsText} onChangeText={setInstallmentsText} keyboardType="number-pad" style={{ width: 70, paddingVertical: 8 }} />
                </Row>
                <Input
                  value={overrideText}
                  onChangeText={setOverrideText}
                  placeholder="Cuota exacta del extracto (opcional)"
                />
                {cardPreview ? (
                  <View style={{ backgroundColor: t.infoSoft, borderRadius: 10, padding: 12, gap: 2 }}>
                    <Txt bold color={t.info}>
                      {installments} × {money(cardPreview.cuota)}
                    </Txt>
                    <Txt variant="small" color={t.info}>
                      Total {money(cardPreview.total)} · intereses {money(cardPreview.total - (amount ?? 0))}
                    </Txt>
                    <Txt variant="small" color={t.info}>
                      Primera cuota: {monthLabel(cardPreview.first)}
                    </Txt>
                  </View>
                ) : null}
              </View>
            )
          ) : null}
        </Field>
      ) : null}

      <Field label="Fotos (facturas, recuerdos)">
        <Row>
          <Button title="Cámara" icon="camera" variant="secondary" small onPress={() => pickImages(true)} />
          <Button title="Galería" icon="image-multiple" variant="secondary" small onPress={() => pickImages(false)} />
        </Row>
        {shownImages.length ? (
          <Row style={{ flexWrap: 'wrap' }}>
            {shownImages.map((img) => (
              <View key={img.key}>
                <Image source={{ uri: img.uri }} style={{ width: 76, height: 76, borderRadius: 10 }} contentFit="cover" />
                <Pressable onPress={img.remove} style={{ position: 'absolute', top: -6, right: -6, backgroundColor: t.danger, borderRadius: 12, padding: 2 }}>
                  <Icon name="close" size={16} color="#fff" />
                </Pressable>
              </View>
            ))}
          </Row>
        ) : null}
      </Field>
    </Sheet>
  );
}

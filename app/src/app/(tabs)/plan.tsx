import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, Card, Divider, Field, Icon, IconButton, IconCircle, Input, ProgressBar, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import {
  cardPaymentsForMonth,
  deleteRecurring,
  listCategories,
  listRecurring,
  monthTotals,
  saveRecurring,
  setCategoryBudget,
  setRecurringPaid,
  spendingByCategory,
} from '@/db/repo';
import type { Category, Recurring, RecurringKind } from '@/db/types';
import { useBump, useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { addMonths, currentMonth, money, monthLabel, parseAmount } from '@/lib/format';

const SECTIONS: { kind: RecurringKind; title: string; empty: string; check: string; icon: string }[] = [
  { kind: 'income', title: 'Ingresos', empty: 'Agrega tu salario u otros ingresos fijos', check: 'Recibido', icon: 'cash-multiple' },
  { kind: 'fixed', title: 'Gastos fijos', empty: 'ICETEX, arriendo, internet, celular…', check: 'Pagado', icon: 'calendar-check' },
  { kind: 'saving', title: 'Ahorro y metas', empty: 'Ahorro mensual, fondo de emergencia, viaje…', check: 'Ahorrado', icon: 'piggy-bank' },
];

type EditState = { open: boolean; kind: RecurringKind; item?: Recurring };

export default function Plan() {
  const db = useSQLiteContext();
  const bump = useBump();
  const t = useTheme();
  const [month, setMonth] = useState(currentMonth());
  const [edit, setEdit] = useState<EditState>({ open: false, kind: 'fixed' });
  const [budgetCat, setBudgetCat] = useState<Category | null>(null);

  const { data } = useData(
    async (d) => {
      const [rec, cardPay, totals, cats, spent] = await Promise.all([
        listRecurring(d, month),
        cardPaymentsForMonth(d, month),
        monthTotals(d, month),
        listCategories(d, { kind: 'expense' }),
        spendingByCategory(d, month),
      ]);
      return { rec, cardPay, totals, cats, spent };
    },
    [month],
  );

  if (!data) return <Screen>{null}</Screen>;
  const { rec, cardPay, totals, cats, spent } = data;
  const sum = (k: RecurringKind) => rec.filter((r) => r.kind === k).reduce((s, r) => s + r.amount, 0);
  const income = sum('income') + totals.income;
  const fixed = sum('fixed');
  const saving = sum('saving');
  const available = income - fixed - saving - cardPay;
  const spentMap = new Map(spent.map((s) => [s.category_id, s.total]));

  async function toggle(r: Recurring) {
    await setRecurringPaid(db, r.id, month, !r.paid, r.amount);
    bump();
  }

  return (
    <Screen>
      <Row between>
        <IconButton icon="chevron-left" onPress={() => setMonth(addMonths(month, -1))} />
        <Pressable onPress={() => setMonth(currentMonth())}>
          <Txt variant="h2">{monthLabel(month)}</Txt>
        </Pressable>
        <IconButton icon="chevron-right" onPress={() => setMonth(addMonths(month, 1))} />
      </Row>

      <Card>
        <Line label="Ingresos fijos" value={sum('income')} color={t.primary} sign="+" />
        {totals.income ? <Line label="Ingresos extra (del chat)" value={totals.income} color={t.primary} sign="+" /> : null}
        <Line label="Gastos fijos" value={fixed} sign="−" />
        <Line label="Ahorro" value={saving} sign="−" />
        <Line label="Cuotas de tarjeta" value={cardPay} sign="−" />
        <Divider />
        <Row between>
          <Txt bold>Disponible para el día a día</Txt>
          <Txt variant="h2" color={available >= 0 ? t.primary : t.danger}>
            {money(available)}
          </Txt>
        </Row>
        <Row between>
          <Txt variant="small" muted>
            Ya gastaste (efectivo/débito)
          </Txt>
          <Txt variant="small" muted>
            {money(totals.expenseCash)}
          </Txt>
        </Row>
      </Card>

      {SECTIONS.map((s) => {
        const items = rec.filter((r) => r.kind === s.kind);
        return (
          <View key={s.kind} style={{ gap: Spacing2 }}>
            <SectionTitle title={s.title} action="+ Agregar" onAction={() => setEdit({ open: true, kind: s.kind })} />
            <Card>
              {items.length === 0 ? (
                <Pressable onPress={() => setEdit({ open: true, kind: s.kind })}>
                  <Row>
                    <Icon name={s.icon} color={t.textSecondary} />
                    <Txt muted style={{ flex: 1 }}>
                      {s.empty}
                    </Txt>
                  </Row>
                </Pressable>
              ) : (
                items.map((r, i) => (
                  <View key={r.id}>
                    {i > 0 ? <Divider /> : null}
                    <Row style={{ paddingVertical: 8 }}>
                      <Pressable onPress={() => toggle(r)} hitSlop={8}>
                        <Icon
                          name={r.paid ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                          size={26}
                          color={r.paid ? t.primary : t.textSecondary}
                        />
                      </Pressable>
                      <Pressable style={{ flex: 1 }} onPress={() => setEdit({ open: true, kind: s.kind, item: r })}>
                        <Txt bold style={r.paid ? { opacity: 0.6 } : undefined}>
                          {r.name}
                        </Txt>
                        <Txt variant="caption" muted>
                          {[r.day ? `Día ${r.day}` : null, r.paid ? s.check : null].filter(Boolean).join(' · ') || 'Toca el círculo al pagar'}
                        </Txt>
                        {s.kind === 'saving' && r.goal ? (
                          <View style={{ gap: 2, marginTop: 4 }}>
                            <ProgressBar value={r.saved_total / r.goal} color={t.info} height={6} />
                            <Txt variant="caption" muted>
                              {money(r.saved_total)} de {money(r.goal)}
                            </Txt>
                          </View>
                        ) : null}
                      </Pressable>
                      <Txt bold>{money(r.amount)}</Txt>
                    </Row>
                  </View>
                ))
              )}
            </Card>
          </View>
        );
      })}

      <SectionTitle title="Presupuesto por categoría" />
      <Card>
        <Txt variant="small" muted>
          Pon un tope mensual y la app te avisa cuando te acerques.
        </Txt>
        {cats.map((c, i) => {
          const used = spentMap.get(c.id) ?? 0;
          return (
            <View key={c.id}>
              {i > 0 ? <Divider /> : null}
              <Pressable onPress={() => setBudgetCat(c)} style={{ paddingVertical: 8, gap: 4 }}>
                <Row>
                  <IconCircle icon={c.icon} color={c.color} size={30} />
                  <Txt style={{ flex: 1 }}>{c.name}</Txt>
                  <Txt variant="small" muted>
                    {c.budget ? `${money(used)} / ${money(c.budget)}` : used ? money(used) : 'Sin tope'}
                  </Txt>
                </Row>
                {c.budget ? <ProgressBar value={used / c.budget} color={c.color} height={5} /> : null}
              </Pressable>
            </View>
          );
        })}
      </Card>

      <RecurringSheet state={edit} onClose={() => setEdit({ ...edit, open: false })} />
      <BudgetSheet category={budgetCat} onClose={() => setBudgetCat(null)} />
    </Screen>
  );
}

const Spacing2 = 8;

function Line({ label, value, sign, color }: { label: string; value: number; sign: string; color?: string }) {
  return (
    <Row between>
      <Txt muted>{label}</Txt>
      <Txt bold color={color}>
        {sign} {money(value)}
      </Txt>
    </Row>
  );
}

function RecurringSheet({ state, onClose }: { state: EditState; onClose: () => void }) {
  const db = useSQLiteContext();
  const bump = useBump();
  const item = state.item;
  const key = `${state.open}-${item?.id ?? 'new'}-${state.kind}`;
  return <RecurringSheetInner key={key} state={state} onClose={onClose} db={db} bump={bump} item={item} />;
}

function RecurringSheetInner({
  state,
  onClose,
  db,
  bump,
  item,
}: {
  state: EditState;
  onClose: () => void;
  db: ReturnType<typeof useSQLiteContext>;
  bump: () => void;
  item?: Recurring;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(item ? String(item.amount) : '');
  const [day, setDay] = useState(item?.day ? String(item.day) : '');
  const [goal, setGoal] = useState(item?.goal ? String(item.goal) : '');
  const [savedInitial, setSavedInitial] = useState(item?.saved_initial ? String(item.saved_initial) : '');
  const kind = item?.kind ?? state.kind;
  const titles = { income: 'ingreso', fixed: 'gasto fijo', saving: 'ahorro' } as const;
  const placeholders = { income: 'Salario', fixed: 'ICETEX', saving: 'Fondo de emergencia' } as const;

  async function save() {
    const a = parseAmount(amount);
    if (!name.trim() || !a) return Alert.alert('Faltan datos', 'Escribe el nombre y el valor mensual.');
    const d = parseInt(day, 10);
    await saveRecurring(db, {
      id: item?.id,
      kind,
      name: name.trim(),
      amount: a,
      day: d >= 1 && d <= 31 ? d : null,
      goal: kind === 'saving' ? parseAmount(goal) : null,
      saved_initial: kind === 'saving' ? parseAmount(savedInitial) ?? 0 : 0,
    });
    bump();
    onClose();
  }

  function remove() {
    if (!item) return;
    Alert.alert('Eliminar', `¿Quitar "${item.name}" del plan?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deleteRecurring(db, item.id);
          bump();
          onClose();
        },
      },
    ]);
  }

  return (
    <Sheet
      visible={state.open}
      onClose={onClose}
      title={`${item ? 'Editar' : 'Nuevo'} ${titles[kind]}`}
      footer={
        <Row>
          {item ? <Button title="Eliminar" variant="danger" icon="trash-can-outline" onPress={remove} /> : null}
          <Button title="Guardar" icon="check" onPress={save} style={{ flex: 1 }} />
        </Row>
      }>
      <Field label="Nombre">
        <Input value={name} onChangeText={setName} placeholder={placeholders[kind]} />
      </Field>
      <Field label="Valor mensual" hint={parseAmount(amount) ? money(parseAmount(amount)!) : undefined}>
        <Input big value={amount} onChangeText={setAmount} placeholder="$0" />
      </Field>
      <Field label={kind === 'income' ? 'Día en que llega (opcional)' : 'Día de pago (opcional)'}>
        <Input value={day} onChangeText={setDay} keyboardType="number-pad" placeholder="15" />
      </Field>
      {kind === 'saving' ? (
        <>
          <Field label="Meta total (opcional)" hint={parseAmount(goal) ? money(parseAmount(goal)!) : 'Ej: 5m para el fondo de emergencia'}>
            <Input value={goal} onChangeText={setGoal} placeholder="$0" />
          </Field>
          <Field label="Ya llevas ahorrado (opcional)">
            <Input value={savedInitial} onChangeText={setSavedInitial} placeholder="$0" />
          </Field>
        </>
      ) : null}
    </Sheet>
  );
}

function BudgetSheet({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const db = useSQLiteContext();
  const bump = useBump();
  const [value, setValue] = useState('');
  const [lastId, setLastId] = useState<number | null>(null);
  if (category && category.id !== lastId) {
    setLastId(category.id);
    setValue(category.budget ? String(category.budget) : '');
  }

  async function save(clear = false) {
    if (!category) return;
    await setCategoryBudget(db, category.id, clear ? null : parseAmount(value));
    bump();
    setLastId(null);
    onClose();
  }

  return (
    <Sheet
      visible={!!category}
      onClose={() => (setLastId(null), onClose())}
      title={`Presupuesto: ${category?.name ?? ''}`}
      footer={
        <Row>
          {category?.budget ? <Button title="Quitar" variant="secondary" onPress={() => save(true)} /> : null}
          <Button title="Guardar" icon="check" onPress={() => save()} style={{ flex: 1 }} />
        </Row>
      }>
      <Field label="Tope mensual" hint={parseAmount(value) ? money(parseAmount(value)!) : 'Ej: 200k'}>
        <Input big value={value} onChangeText={setValue} placeholder="$0" autoFocus />
      </Field>
    </Sheet>
  );
}

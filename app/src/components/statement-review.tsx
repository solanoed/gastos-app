import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { listCards, listCategories } from '@/db/repo';
import type { Card as CardT, Category, Movement } from '@/db/types';
import { useBump } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, money } from '@/lib/format';
import {
  applyRows,
  guessCard,
  markStatementDone,
  reconcile,
  statementPeriod,
  type ReviewRow,
  type Statement,
} from '@/lib/statements';
import { scheduleSync } from '@/lib/sync';

import { Button, Card, Chip, Divider, Icon, Row, Sheet, Txt } from './ui';

/** Diálogo con todos los movimientos del extracto para elegir cuáles agregar. */
export function StatementReview({
  statement: st,
  onClose,
  onDone,
}: {
  statement: Statement;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const db = useSQLiteContext();
  const t = useTheme();
  const bump = useBump();
  const [cards, setCards] = useState<CardT[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [cardId, setCardId] = useState<number | null | undefined>(undefined);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [missing, setMissing] = useState<Movement[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [cs, ks] = await Promise.all([listCards(db), listCategories(db)]);
      setCards(cs);
      setCats(ks);
      setCardId(guessCard(st, cs));
    })();
  }, [db, st]);

  // Volver a cruzar cada vez que cambia el medio de pago.
  useEffect(() => {
    if (cardId === undefined) return;
    reconcile(db, st, cardId).then((r) => {
      setRows(r.rows);
      setMissing(r.missingInStatement);
    });
  }, [db, st, cardId]);

  const selected = rows?.filter((r) => r.selected) ?? [];
  const matched = rows?.filter((r) => r.match).length ?? 0;
  const { from, to } = statementPeriod(st);
  const diff = st.check.diferencia;

  function update(index: number, patch: Partial<ReviewRow>) {
    setRows((prev) => prev?.map((r) => (r.index === index ? { ...r, ...patch } : r)) ?? null);
  }

  function selectAll(v: boolean) {
    setRows((prev) => prev?.map((r) => ({ ...r, selected: v && !r.match })) ?? null);
  }

  async function apply() {
    if (!rows) return;
    setSaving(true);
    try {
      const n = await applyRows(db, rows, cardId ?? null);
      await markStatementDone(st.id, 'applied').catch(() => {});
      bump();
      scheduleSync(db);
      onDone(
        `📄 Extracto ${st.meta.banco ?? ''} aplicado: agregué ${n} movimiento${n === 1 ? '' : 's'}` +
          (matched ? ` (${matched} ya estaban registrados).` : '.'),
      );
    } catch (e) {
      Alert.alert('No se pudo guardar', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    Alert.alert('Descartar extracto', 'No se agrega ningún movimiento.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          await markStatementDone(st.id, 'discarded').catch(() => {});
          onDone('📄 Descarté el extracto, no agregué nada.');
        },
      },
    ]);
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Revisar extracto"
      footer={
        <Row>
          <Button title="Descartar" variant="ghost" onPress={discard} style={{ flex: 1 }} />
          <Button
            title={selected.length ? `Agregar ${selected.length}` : 'Nada por agregar'}
            icon="check-all"
            onPress={apply}
            loading={saving}
            disabled={!selected.length}
            style={{ flex: 2 }}
          />
        </Row>
      }>
      <Card>
        <Txt bold>
          {[st.meta.banco, st.meta.producto].filter(Boolean).join(' · ') || 'Extracto'}
          {st.meta.ultimos4 ? ` ****${st.meta.ultimos4}` : ''}
        </Txt>
        <Txt variant="small" muted>
          {from && to ? `Del ${dayLabel(from)} al ${dayLabel(to)}` : ''} · {st.items.length} movimientos
        </Txt>
        <Row>
          <Txt variant="small" style={{ flex: 1 }}>
            Gastos <Txt bold>{money(st.check.gastos)}</Txt>
          </Txt>
          <Txt variant="small" style={{ flex: 1 }}>
            Ingresos <Txt bold color={t.primary}>{money(st.check.ingresos)}</Txt>
          </Txt>
        </Row>
        {diff === 0 ? (
          <Row gap={6}>
            <Icon name="check-decagram" size={18} color={t.primary} />
            <Txt variant="small" color={t.primary}>
              Cuadra exacto con {st.check.base === 'saldo' ? 'el saldo' : 'los totales'} del extracto
            </Txt>
          </Row>
        ) : diff != null ? (
          <Row gap={6} style={{ alignItems: 'flex-start' }}>
            <Icon name="alert" size={18} color={t.warning} />
            <Txt variant="small" color={t.warning} style={{ flex: 1 }}>
              No cuadra por {money(Math.abs(diff))}: puede faltar o sobrar algún movimiento. Revisa contra el PDF.
            </Txt>
          </Row>
        ) : (
          <Txt variant="caption" muted>
            No encontré saldos ni totales para comprobar que esté completo.
          </Txt>
        )}
        {st.error ? (
          <Txt variant="caption" color={t.warning}>
            {st.error}
          </Txt>
        ) : null}
      </Card>

      <View style={{ gap: 6 }}>
        <Txt variant="small" bold muted>
          Pagado con
        </Txt>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="Cuenta / efectivo" icon="bank" selected={cardId === null} onPress={() => setCardId(null)} />
          {cards.map((c) => (
            <Chip key={c.id} label={c.name} icon="credit-card" color={c.color} selected={cardId === c.id} onPress={() => setCardId(c.id)} />
          ))}
        </Row>
      </View>

      {rows ? (
        <Card>
          <Row between>
            <Txt variant="small" muted style={{ flex: 1 }}>
              {selected.length} por agregar · {matched} ya registrados
            </Txt>
            <Pressable onPress={() => selectAll(selected.length === 0)} hitSlop={8}>
              <Txt variant="small" bold color={t.primary}>
                {selected.length ? 'Ninguno' : 'Todos'}
              </Txt>
            </Pressable>
          </Row>
          {rows.map((r, i) => (
            <View key={r.index}>
              {i > 0 ? <Divider /> : null}
              <ItemRow
                row={r}
                cats={cats}
                editing={editing === r.index}
                onToggle={() => update(r.index, { selected: !r.selected })}
                onEditCategory={() => setEditing(editing === r.index ? null : r.index)}
                onCategory={(id) => (update(r.index, { category_id: id }), setEditing(null))}
                cardStatement={st.meta.tipo === 'tarjeta'}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {missing.length ? (
        <Card>
          <Txt bold>En la app pero no en el extracto</Txt>
          <Txt variant="caption" muted>
            Pueden ser pagos en efectivo, de otra cuenta, o movimientos repetidos. Revísalos en el Historial.
          </Txt>
          {missing.map((m) => (
            <Row key={m.id} between>
              <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>
                {dayLabel(m.date)} · {m.concept || m.cat_name || 'Movimiento'}
              </Txt>
              <Txt variant="small" bold>
                {money(m.amount)}
              </Txt>
            </Row>
          ))}
        </Card>
      ) : null}
    </Sheet>
  );
}

function ItemRow({
  row,
  cats,
  editing,
  onToggle,
  onEditCategory,
  onCategory,
  cardStatement,
}: {
  row: ReviewRow;
  cats: Category[];
  editing: boolean;
  onToggle: () => void;
  onEditCategory: () => void;
  onCategory: (id: number) => void;
  cardStatement: boolean;
}) {
  const t = useTheme();
  const { item } = row;
  const income = item.tipo === 'ingreso';
  const cat = cats.find((c) => c.id === row.category_id);
  const options = cats.filter((c) => c.kind === (income ? 'income' : 'expense'));
  return (
    <View style={{ gap: 6, paddingVertical: 6, opacity: row.selected ? 1 : 0.6 }}>
      <Row gap={10}>
        <Pressable onPress={onToggle} hitSlop={8}>
          <Icon name={row.selected ? 'checkbox-marked' : 'checkbox-blank-outline'} color={row.selected ? t.primary : t.textSecondary} />
        </Pressable>
        <Pressable onPress={onToggle} style={{ flex: 1, minWidth: 0 }}>
          <Txt bold numberOfLines={1}>
            {item.descripcion}
          </Txt>
          <Txt variant="caption" muted numberOfLines={1}>
            {dayLabel(item.fecha)}
            {item.cuotas ? ` · ${item.cuotas} cuotas` : ''}
            {row.match ? ` · Ya registrado: ${row.match.concept || row.match.cat_name || 'movimiento'}` : ''}
            {!row.match && cardStatement && income ? ' · Pago a la tarjeta' : ''}
          </Txt>
        </Pressable>
        <Txt bold color={income ? t.primary : t.text} style={{ fontVariant: ['tabular-nums'] }}>
          {income ? '+' : ''}
          {money(item.monto)}
        </Txt>
      </Row>
      {row.selected ? (
        <Row style={{ marginLeft: 34, flexWrap: 'wrap' }} gap={6}>
          {editing ? (
            options.map((c) => <Chip key={c.id} label={c.name} icon={c.icon} color={c.color} selected={c.id === row.category_id} onPress={() => onCategory(c.id)} />)
          ) : (
            <Chip label={cat?.name ?? 'Sin categoría'} icon={cat?.icon ?? 'tag-outline'} color={cat?.color} onPress={onEditCategory} />
          )}
        </Row>
      ) : null}
    </View>
  );
}

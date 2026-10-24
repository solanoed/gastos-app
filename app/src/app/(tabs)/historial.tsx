import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, SectionList, View } from 'react-native';

import { MovementForm } from '@/components/movement-form';
import { MovementRow } from '@/components/movement-row';
import { Chip, Empty, Icon, IconButton, Input, Row, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { listCategories, listMovements } from '@/db/repo';
import type { MovementType } from '@/db/types';
import { useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { addMonths, currentMonth, dayLabel, money, monthLabel } from '@/lib/format';

const TYPE_FILTERS: { value: MovementType; label: string; icon: string }[] = [
  { value: 'expense', label: 'Gastos', icon: 'arrow-up' },
  { value: 'income', label: 'Ingresos', icon: 'arrow-down' },
  { value: 'lent', label: 'Me deben', icon: 'account-arrow-left' },
  { value: 'borrowed', label: 'Debo', icon: 'account-arrow-right' },
];

export default function Historial() {
  const t = useTheme();
  const [month, setMonth] = useState<string | null>(currentMonth());
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [type, setType] = useState<MovementType | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const { data: cats } = useData((db) => listCategories(db), []);
  const { data: rows } = useData(
    (db) => listMovements(db, { month: month ?? undefined, search, categoryId, type }),
    [month, search, categoryId, type],
  );

  // Agrupar por día.
  const sections: { title: string; total: number; data: NonNullable<typeof rows> }[] = [];
  for (const m of rows ?? []) {
    const day = m.date.slice(0, 10);
    let s = sections[sections.length - 1];
    if (!s || s.title !== day) {
      s = { title: day, total: 0, data: [] };
      sections.push(s);
    }
    s.data.push(m);
    if (m.type === 'expense') s.total += m.amount;
  }
  const totalExpense = (rows ?? []).filter((m) => m.type === 'expense').reduce((s, m) => s + m.amount, 0);
  const totalIncome = (rows ?? []).filter((m) => m.type === 'income').reduce((s, m) => s + m.amount, 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ padding: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two }}>
        <Row between>
          <IconButton icon="chevron-left" onPress={() => setMonth(addMonths(month ?? currentMonth(), -1))} />
          <Pressable onPress={() => setMonth(month ? null : currentMonth())}>
            <Txt variant="h2">{month ? monthLabel(month) : 'Todos los meses'}</Txt>
          </Pressable>
          <IconButton icon="chevron-right" onPress={() => setMonth(addMonths(month ?? currentMonth(), 1))} />
        </Row>
        <Input value={search} onChangeText={setSearch} placeholder="Buscar concepto, categoría o persona" style={{ paddingVertical: 10 }} />
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two }}>
          {TYPE_FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} icon={f.icon} selected={type === f.value} onPress={() => setType(type === f.value ? null : f.value)} />
          ))}
          {(cats ?? []).map((c) => (
            <Chip key={c.id} label={c.name} icon={c.icon} color={c.color} selected={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? null : c.id)} />
          ))}
        </ScrollView>
      </View>
      <Row between style={{ paddingHorizontal: Spacing.three, paddingBottom: Spacing.two }}>
        <Txt variant="small" muted>
          {rows?.length ?? 0} movimientos
        </Txt>
        <Txt variant="small" muted>
          Gastos {money(totalExpense)}
          {totalIncome ? ` · Ingresos ${money(totalIncome)}` : ''}
        </Txt>
      </Row>

      <SectionList
        sections={sections}
        keyExtractor={(m) => String(m.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingBottom: 100 }}
        renderSectionHeader={({ section }) => (
          <Row between style={{ marginTop: Spacing.three, marginBottom: 2 }}>
            <Txt variant="small" bold muted>
              {dayLabel(section.title)}
            </Txt>
            {section.total ? (
              <Txt variant="small" muted>
                {money(section.total)}
              </Txt>
            ) : null}
          </Row>
        )}
        renderItem={({ item }) => <MovementRow m={item} onPress={() => router.push({ pathname: '/movimiento/[id]', params: { id: String(item.id) } })} />}
        ListEmptyComponent={<Empty icon="text-box-search-outline" title="Nada por aquí" text="No hay movimientos con estos filtros." />}
      />

      <Pressable
        onPress={() => setFormOpen(true)}
        style={({ pressed }) => ({
          position: 'absolute',
          right: 20,
          bottom: 20,
          backgroundColor: t.primary,
          borderRadius: 30,
          padding: 16,
          elevation: 4,
          opacity: pressed ? 0.8 : 1,
        })}>
        <Icon name="plus" size={28} color={t.primaryText} />
      </Pressable>
      <MovementForm visible={formOpen} onClose={() => setFormOpen(false)} />
    </View>
  );
}

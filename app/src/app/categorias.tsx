import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, Card, Divider, Field, Icon, IconCircle, Input, Row, Screen, SectionTitle, Segmented, Sheet, Txt } from '@/components/ui';
import { IconPicker } from '@/components/icon-picker';
import { PALETTE } from '@/constants/theme';
import { listCategories, saveCategory, setCategoryArchived } from '@/db/repo';
import type { Category, CategoryKind } from '@/db/types';
import { useBump, useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { money, parseAmount } from '@/lib/format';

export default function Categorias() {
  const t = useTheme();
  const db = useSQLiteContext();
  const bump = useBump();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [editing, setEditing] = useState<{ open: boolean; cat?: Category }>({ open: false });
  const { data } = useData((d) => listCategories(d, { includeArchived: true }), []);

  const list = (data ?? []).filter((c) => c.kind === kind);
  const active = list.filter((c) => !c.archived);
  const archived = list.filter((c) => c.archived);

  return (
    <Screen>
      <Segmented
        options={[
          { value: 'expense', label: 'Gastos' },
          { value: 'income', label: 'Ingresos' },
        ]}
        value={kind}
        onChange={setKind}
      />
      <Button title="Nueva categoría" icon="plus" onPress={() => setEditing({ open: true })} />
      <Card>
        {active.map((c, i) => (
          <View key={c.id}>
            {i > 0 ? <Divider /> : null}
            <Pressable onPress={() => setEditing({ open: true, cat: c })}>
              <Row style={{ paddingVertical: 8 }}>
                <IconCircle icon={c.icon} color={c.color} size={36} />
                <View style={{ flex: 1 }}>
                  <Txt bold>{c.name}</Txt>
                  {c.aliases ? (
                    <Txt variant="caption" muted numberOfLines={1}>
                      Palabras: {c.aliases.split(',').join(', ')}
                    </Txt>
                  ) : null}
                </View>
                {c.budget ? (
                  <Txt variant="caption" muted>
                    Tope {money(c.budget)}
                  </Txt>
                ) : null}
                <Icon name="chevron-right" color={t.textSecondary} />
              </Row>
            </Pressable>
          </View>
        ))}
      </Card>
      {archived.length ? (
        <>
          <SectionTitle title="Ocultas" />
          <Card>
            {archived.map((c) => (
              <Row key={c.id} between>
                <Row>
                  <IconCircle icon={c.icon} color={c.color} size={30} />
                  <Txt muted>{c.name}</Txt>
                </Row>
                <Pressable
                  onPress={async () => {
                    await setCategoryArchived(db, c.id, false);
                    bump();
                  }}>
                  <Txt bold color={t.primary}>
                    Restaurar
                  </Txt>
                </Pressable>
              </Row>
            ))}
          </Card>
        </>
      ) : null}
      <Txt variant="caption" muted>
        Las “palabras” sirven para el chat: si escribes “didi 12k” y Didi está en las palabras de Uber, se guarda como Uber.
      </Txt>
      {editing.open ? <CategorySheet cat={editing.cat} kind={kind} onClose={() => setEditing({ open: false })} /> : null}
    </Screen>
  );
}

function CategorySheet({ cat, kind, onClose }: { cat?: Category; kind: CategoryKind; onClose: () => void }) {
  const db = useSQLiteContext();
  const bump = useBump();
  const [name, setName] = useState(cat?.name ?? '');
  const [icon, setIcon] = useState(cat?.icon ?? 'tag');
  const [color, setColor] = useState(cat?.color ?? PALETTE[0]);
  const [aliases, setAliases] = useState(cat?.aliases.split(',').join(', ') ?? '');
  const [budget, setBudget] = useState(cat?.budget ? String(cat.budget) : '');

  async function save() {
    if (!name.trim()) return Alert.alert('Falta el nombre');
    await saveCategory(db, {
      id: cat?.id,
      name: name.trim(),
      icon,
      color,
      kind: cat?.kind ?? kind,
      aliases: aliases
        .split(',')
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
        .join(','),
      budget: parseAmount(budget),
    });
    bump();
    onClose();
  }

  async function archive() {
    if (!cat) return;
    await setCategoryArchived(db, cat.id, true);
    bump();
    onClose();
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={cat ? 'Editar categoría' : 'Nueva categoría'}
      footer={
        <Row>
          {cat ? <Button title="Ocultar" variant="secondary" icon="eye-off-outline" onPress={archive} /> : null}
          <Button title="Guardar" icon="check" onPress={save} style={{ flex: 1 }} />
        </Row>
      }>
      <Row>
        <IconCircle icon={icon} color={color} size={52} />
        <View style={{ flex: 1 }}>
          <Input value={name} onChangeText={setName} placeholder="Ej: Gimnasio" autoFocus={!cat} />
        </View>
      </Row>
      <Field label="Color">
        <Row style={{ flexWrap: 'wrap' }}>
          {PALETTE.map((c) => (
            <Pressable key={c} onPress={() => setColor(c)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: '#fff' }} />
          ))}
        </Row>
      </Field>
      <Field label="Ícono">
        <IconPicker value={icon} color={color} onChange={setIcon} />
      </Field>
      <Field label="Palabras para el chat (separadas por coma)" hint="Ej: gym, gimnasio, smartfit">
        <Input value={aliases} onChangeText={setAliases} autoCapitalize="none" />
      </Field>
      {(cat?.kind ?? kind) === 'expense' ? (
        <Field label="Presupuesto mensual (opcional)" hint={parseAmount(budget) ? money(parseAmount(budget)!) : undefined}>
          <Input value={budget} onChangeText={setBudget} placeholder="Ej: 200k" />
        </Field>
      ) : null}
    </Sheet>
  );
}

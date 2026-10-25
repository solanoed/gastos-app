import * as DocumentPicker from 'expo-document-picker';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentRef } from 'react';
import { Alert, FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';

import { MovementForm, type FormInitial } from '@/components/movement-form';
import { StatementReview } from '@/components/statement-review';
import { Button, Chip, Icon, IconButton, IconCircle, Input, Row, Sheet, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  addChat,
  clearChat,
  createMovement,
  deleteMovement,
  frequentCategories,
  listCards,
  listCategories,
  listChat,
  updateChat,
} from '@/db/repo';
import { MOVEMENT_TYPE_LABEL, type ChatMessage } from '@/db/types';
import { useBump, useData } from '@/hooks/use-data';
import { useInboxCount } from '@/hooks/use-inbox-count';
import { useKeyboardOverlap } from '@/hooks/use-keyboard';
import { useTheme } from '@/hooks/use-theme';
import { answerLocally } from '@/lib/answers';
import { api, getSession } from '@/lib/api';
import { dayLabel, money, todayKey } from '@/lib/format';
import { parseInput } from '@/lib/parser';
import { getStatement, PdfPasswordNeeded, pendingStatement, uploadStatement, type Statement } from '@/lib/statements';
import { syncNow } from '@/lib/sync';

const HINTS = ['uber 15k', 'rappi 32k pizza', 'tc 600k mercado 6 cuotas', 'victor me debe 20k', '¿en qué gasté más?', '¿me alcanza para algo de 2m a 12 cuotas?', '= 32k*3'];

export default function ChatScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const bump = useBump();
  const navigation = useNavigation();
  const [text, setText] = useState('');
  const [form, setForm] = useState<{ open: boolean; initial?: FormInitial; movementId?: number | null }>({ open: false });
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const { attach: keyboardRef, overlap: keyboardOverlap } = useKeyboardOverlap();

  const { data: messages, reload } = useData((d) => listChat(d), []);
  const { data: chips } = useData((d) => frequentCategories(d, 10), []);
  const inbox = useInboxCount();

  // Extracto bancario: subiendo → procesando en el servidor → listo para revisar.
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<{ id: number; msgId: number | null } | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pw, setPw] = useState<{ file: { uri: string; name: string }; wrong: boolean; value: string } | null>(null);

  // Retomar un extracto que quedó procesando o sin revisar (por ejemplo si se cerró la app).
  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!(await getSession()).token) return;
        const st = await pendingStatement().catch(() => null);
        if (st?.status === 'processing') setProcessing((p) => p ?? { id: st.id, msgId: null });
        else if (st?.status === 'pending') setStatement((cur) => cur ?? st);
      })();
    }, []),
  );

  useEffect(() => {
    if (!processing) return;
    let alive = true;
    const tick = async () => {
      const st = await getStatement(processing.id).catch(() => null);
      if (!alive || !st || st.status === 'processing') return;
      alive = false;
      setProcessing(null);
      let text: string;
      if (st.status === 'pending') {
        const d = st.check.diferencia;
        text =
          `📄 Leí ${st.items.length} movimientos del extracto${st.meta.banco ? ` de ${st.meta.banco}` : ''}` +
          (d === 0 ? ' y cuadra exacto ✓.' : d != null ? `, pero no cuadra por ${money(Math.abs(d))}.` : '.') +
          ' Revísalos y elige cuáles agregar.';
        setStatement(st);
        setReviewOpen(true);
      } else {
        text = `No pude leer el extracto: ${st.error ?? 'error desconocido'}`;
      }
      if (processing.msgId) await updateChat(db, processing.msgId, text);
      else await addChat(db, 'bot', text);
      reload();
    };
    tick();
    const h = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [processing, db, reload]);

  function attach() {
    Alert.alert('Adjuntar', '¿Qué quieres agregar?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Movimiento', onPress: () => setForm({ open: true }) },
      { text: 'Extracto (PDF)', onPress: pickStatement },
    ]);
  }

  async function pickStatement() {
    if (!(await getSession()).token) {
      return Alert.alert('Inicia sesión', 'Para leer extractos con la IA necesitas iniciar sesión en Ajustes.');
    }
    if (processing) return Alert.alert('Un momento', 'Todavía estoy leyendo el extracto anterior.');
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    await sendStatement({ uri: r.assets[0].uri, name: r.assets[0].name });
  }

  async function sendStatement(file: { uri: string; name: string }, password?: string) {
    setUploading(true);
    try {
      const id = await uploadStatement(file, password);
      setPw(null);
      await addChat(db, 'user', `📄 ${file.name}`);
      const msgId = await addChat(db, 'bot', 'Leyendo el extracto… puede tardar un par de minutos. Te aviso aquí cuando esté listo.');
      setStatement(null);
      setProcessing({ id, msgId });
      reload();
    } catch (e) {
      if (e instanceof PdfPasswordNeeded) setPw({ file, wrong: e.wrong, value: '' });
      else Alert.alert('No se pudo subir el extracto', (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Row gap={0} style={{ marginRight: 8 }}>
          <IconButton icon="calculator-variant-outline" onPress={() => router.push('/calculadora')} />
          <IconButton
            icon="broom"
            onPress={() =>
              Alert.alert('Limpiar chat', 'Se borra la conversación, no tus movimientos.', [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Limpiar',
                  onPress: async () => {
                    await clearChat(db);
                    reload();
                  },
                },
              ])
            }
          />
        </Row>
      ),
    });
  }, [navigation, db, reload]);

  // Primer uso: mensaje de bienvenida.
  useEffect(() => {
    if (messages && messages.length === 0) {
      addChat(
        db,
        'bot',
        '¡Hola! Escríbeme lo que gastas y lo guardo. Ejemplos:\n• uber 15k\n• rappi 32k pizza\n• tc 600k mercado 6 cuotas\n• victor y simon me deben 40k cena\n• ingreso 200k freelance\n• = 32k*3 + 15000\n\nO toca una categoría de arriba.',
      ).then(reload);
    }
  }, [messages, db, reload]);

  async function bot(textOut: string, movementId: number | null = null) {
    await addChat(db, 'bot', textOut, movementId);
  }

  async function send() {
    const msg = text.trim();
    if (!msg) return;
    setText('');
    await addChat(db, 'user', msg);
    const [cats, cards] = await Promise.all([listCategories(db), listCards(db)]);
    const r = parseInput(msg, cats, cards);

    if (r.kind === 'calc') {
      await bot(`${r.expr} = ${formatCalc(r.value)}`);
    } else if (r.kind === 'calc_error') {
      await bot(`No pude calcular eso: ${r.message}`);
    } else if (r.kind === 'question') {
      await askAI(msg);
    } else if (r.missing.length) {
      await bot(`Me falta: ${r.missing.join(', ')}. Te abrí el formulario para completarlo.`);
      const d = r.draft;
      setForm({
        open: true,
        initial: { type: d.type, amount: d.amount, category_id: d.category_id, concept: d.concept, person: d.persons.join(' y '), card: d.card },
      });
    } else {
      const d = r.draft;
      const cat = cats.find((c) => c.id === d.category_id);
      const card = d.card ? cards.find((c) => c.id === d.card!.card_id) : null;
      const amount = d.amount!;
      if (d.persons.length > 1) {
        // Varias personas: se divide en partes iguales.
        const share = Math.round(amount / d.persons.length);
        for (const p of d.persons) {
          const id = await createMovement(db, { type: d.type, amount: share, category_id: d.category_id, concept: d.concept, person_name: p, date: todayKey() });
          await bot(`${MOVEMENT_TYPE_LABEL[d.type]}: ${p} · ${money(share)}`, id);
        }
        await bot(`Dividí ${money(amount)} entre ${d.persons.length} personas.`);
      } else {
        const id = await createMovement(db, {
          type: d.type,
          amount,
          category_id: d.category_id,
          concept: d.concept,
          person_name: d.persons[0] ?? null,
          date: todayKey(),
          card: d.card,
        });
        const parts = [
          d.persons[0] ? `${MOVEMENT_TYPE_LABEL[d.type]}: ${d.persons[0]}` : d.type === 'income' ? `Ingreso: ${cat?.name ?? ''}` : cat?.name ?? 'Gasto',
          money(amount),
          d.concept || null,
          card ? `💳 ${card.name}${d.card!.installments > 1 ? ` a ${d.card!.installments} cuotas` : ''}` : null,
        ].filter(Boolean);
        let reply = parts.join(' · ');
        if (r.guessedCategory) reply += `\nNo reconocí la categoría, la dejé en "${cat?.name ?? 'Otros'}". Toca para cambiarla.`;
        await bot(reply, id);
      }
      bump();
    }
    reload();
  }

  /** Pregunta a la IA del servidor; sin sesión o sin conexión responde localmente. */
  async function askAI(question: string) {
    const s = await getSession();
    if (!s.token) {
      await bot(await answerLocally(db, question));
      return;
    }
    const pendingId = await addChat(db, 'bot', 'Pensando…');
    reload();
    try {
      // Subir los últimos cambios para que la IA vea datos al día.
      await syncNow(db).catch(() => {});
      const recent = (await listChat(db, 10))
        .filter((m) => m.id !== pendingId && !m.movement_id)
        .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.text }));
      while (recent.length && recent[0].role !== 'user') recent.shift();
      const res = await api<{ text: string }>('/ai/chat', { method: 'POST', json: { messages: recent }, timeoutMs: 90_000 });
      await updateChat(db, pendingId, res.text);
    } catch (e) {
      const local = await answerLocally(db, question);
      await updateChat(db, pendingId, `${local}\n\n(La IA no respondió: ${(e as Error).message})`);
    }
  }

  async function undo(m: ChatMessage) {
    if (!m.movement_id) return;
    await deleteMovement(db, m.movement_id);
    await addChat(db, 'bot', '↩️ Listo, lo borré.');
    bump();
    reload();
  }

  const data = [...(messages ?? [])].reverse();

  return (
    <View ref={keyboardRef} style={{ flex: 1, backgroundColor: t.background, paddingBottom: keyboardOverlap }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, padding: Spacing.two, paddingHorizontal: Spacing.three }}>
        {statement ? (
          <Chip label="Revisar extracto" icon="file-document-check-outline" color={t.info} selected onPress={() => setReviewOpen(true)} />
        ) : processing || uploading ? (
          <Chip label="Leyendo extracto…" icon="progress-clock" color={t.info} />
        ) : null}
        {inbox > 0 ? <Chip label={`Por aprobar (${inbox})`} icon="inbox-arrow-down" color={t.danger} selected onPress={() => router.push('/bandeja')} /> : null}
        <Chip label="Tarjeta" icon="credit-card-plus" color={t.info} onPress={() => setForm({ open: true, initial: { card: { card_id: 0, installments: 1 } } })} />
        {(chips ?? []).map((c) => (
          <Chip key={c.id} label={c.name} icon={c.icon} color={c.color} onPress={() => setForm({ open: true, initial: { category_id: c.id } })} />
        ))}
        <Chip label="Me deben" icon="account-arrow-left" color={t.info} onPress={() => setForm({ open: true, initial: { type: 'lent' } })} />
        <Chip label="Debo" icon="account-arrow-right" color={t.warning} onPress={() => setForm({ open: true, initial: { type: 'borrowed' } })} />
        <Chip label="Ingreso" icon="cash-plus" color={t.primary} onPress={() => setForm({ open: true, initial: { type: 'income' } })} />
        <Chip label="Editar" icon="pencil" onPress={() => router.push('/categorias')} />
      </ScrollView>

      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
        renderItem={({ item, index }) => (
          <Bubble
            m={item}
            canUndo={index < 6}
            onEdit={() => item.movement_id && setForm({ open: true, movementId: item.movement_id })}
            onUndo={() => undo(item)}
          />
        )}
      />

      {text.length === 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: Spacing.three, paddingBottom: 6 }}>
          {HINTS.map((h) => (
            <Pressable key={h} onPress={() => (setText(h), inputRef.current?.focus())}>
              <Txt variant="caption" muted style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: t.backgroundElement }}>
                {h}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <Row style={{ padding: Spacing.two, paddingHorizontal: Spacing.three, backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.border }}>
        <IconButton icon="paperclip" color={t.textSecondary} onPress={attach} />
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder="uber 15k, ¿en qué gasté más?…"
          placeholderTextColor={t.textSecondary}
          onSubmitEditing={send}
          submitBehavior="submit"
          returnKeyType="send"
          style={{ flex: 1, color: t.text, fontSize: 16, backgroundColor: t.backgroundElement, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 }}
        />
        <Pressable onPress={send} style={{ backgroundColor: t.primary, borderRadius: 22, padding: 10 }}>
          <Icon name="send" size={20} color={t.primaryText} />
        </Pressable>
      </Row>

      {statement && reviewOpen ? (
        <StatementReview
          statement={statement}
          onClose={() => setReviewOpen(false)}
          onDone={async (summary) => {
            setReviewOpen(false);
            setStatement(null);
            await addChat(db, 'bot', summary);
            reload();
          }}
        />
      ) : null}

      {pw ? (
        <Sheet
          visible
          onClose={() => setPw(null)}
          title="PDF con contraseña"
          footer={<Button title="Abrir extracto" icon="lock-open-variant" loading={uploading} disabled={!pw.value} onPress={() => sendStatement(pw.file, pw.value)} />}>
          <Txt muted>Los bancos suelen proteger el extracto con tu número de cédula. La contraseña solo se usa para abrirlo y no se guarda.</Txt>
          {pw.wrong ? <Txt color={t.danger}>La contraseña no es correcta, intenta de nuevo.</Txt> : null}
          <Input
            value={pw.value}
            onChangeText={(v) => setPw((p) => (p ? { ...p, value: v } : p))}
            placeholder="Contraseña del PDF"
            secureTextEntry
            autoFocus
            onSubmitEditing={() => pw.value && sendStatement(pw.file, pw.value)}
          />
        </Sheet>
      ) : null}

      <MovementForm
        visible={form.open}
        initial={form.initial}
        movementId={form.movementId}
        onClose={() => setForm({ open: false })}
        onSaved={async (id, summary) => {
          if (!form.movementId) await addChat(db, 'bot', summary, id);
          else await addChat(db, 'bot', `✏️ Actualizado: ${summary}`, id);
          reload();
        }}
      />
    </View>
  );
}

function formatCalc(v: number) {
  if (Number.isInteger(v) && Math.abs(v) >= 1000) return money(v);
  return (Math.round(v * 100) / 100).toString().replace('.', ',');
}

function Bubble({ m, canUndo, onEdit, onUndo }: { m: ChatMessage; canUndo: boolean; onEdit: () => void; onUndo: () => void }) {
  const t = useTheme();
  const mine = m.role === 'user';
  // Mensajes viejos traían "✅ " al inicio; ahora el ícono de la categoría lo reemplaza.
  const text = m.movement_id ? m.text.replace(/^(✅|✏️)\s*/u, '') : m.text;
  const isDebt = m.m_type === 'lent' || m.m_type === 'borrowed';
  const icon = m.cat_icon ?? (isDebt ? (m.m_type === 'lent' ? 'account-arrow-left' : 'account-arrow-right') : 'help-circle');
  const color = m.cat_color ?? (m.m_type === 'lent' ? t.info : m.m_type === 'borrowed' ? t.warning : '#94A3B8');
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Pressable
        onPress={m.movement_id ? onEdit : undefined}
        style={{
          maxWidth: '85%',
          backgroundColor: mine ? t.bubbleUser : t.bubbleBot,
          borderRadius: 16,
          borderBottomRightRadius: mine ? 4 : 16,
          borderBottomLeftRadius: mine ? 16 : 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderWidth: mine ? 0 : 1,
          borderColor: t.border,
        }}>
        {m.movement_id ? (
          <Row gap={10} style={{ alignItems: 'flex-start' }}>
            <IconCircle icon={icon} color={color} size={30} />
            <Txt style={{ flexShrink: 1 }}>{text}</Txt>
          </Row>
        ) : (
          <Txt color={mine ? t.bubbleUserText : t.text}>{text}</Txt>
        )}
        {m.movement_id ? (
          <Row gap={14} style={{ marginTop: 6, marginLeft: 40 }}>
            <Pressable onPress={onEdit} hitSlop={6}>
              <Txt variant="small" bold color={t.primary}>
                Editar
              </Txt>
            </Pressable>
            {canUndo ? (
              <Pressable onPress={onUndo} hitSlop={6}>
                <Txt variant="small" bold color={t.danger}>
                  Deshacer
                </Txt>
              </Pressable>
            ) : null}
          </Row>
        ) : null}
      </Pressable>
      <Txt variant="caption" muted style={{ marginTop: 2, marginHorizontal: 4 }}>
        {dayLabel(m.created_at.slice(0, 10))} {m.created_at.slice(11, 16)}
      </Txt>
    </View>
  );
}

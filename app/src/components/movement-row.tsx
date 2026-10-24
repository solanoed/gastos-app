import { Pressable, View } from 'react-native';

import type { Movement } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { money } from '@/lib/format';

import { Icon, IconCircle, Row, Txt } from './ui';

export function MovementRow({ m, onPress }: { m: Movement; onPress?: () => void }) {
  const t = useTheme();
  const isIncome = m.type === 'income';
  const isDebt = m.type === 'lent' || m.type === 'borrowed';

  const title = isDebt
    ? `${m.type === 'lent' ? 'Me debe' : 'Le debo a'} ${m.person_name ?? '¿?'}`
    : m.cat_name ?? 'Sin categoría';
  // Primero el medio de pago (chip con el color de la tarjeta) y después el comentario.
  const subtitle = [isDebt ? m.cat_name : null, m.concept || null].filter(Boolean).join(' · ');
  const cardColor = m.card_color ?? t.textSecondary;
  const cardLabel = m.card_name
    ? `${m.card_name}${m.installments && m.installments > 1 ? ` · ${m.installments} cuotas` : ''}`
    : null;

  const amountColor = isIncome ? t.primary : m.type === 'lent' ? t.info : m.type === 'borrowed' ? t.warning : t.text;
  const icon = isDebt ? (m.type === 'lent' ? 'account-arrow-left' : 'account-arrow-right') : m.cat_icon ?? 'help-circle';
  const color = isDebt ? (m.type === 'lent' ? t.info : t.warning) : m.cat_color ?? '#94A3B8';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Row gap={12} style={{ paddingVertical: 10 }}>
        <IconCircle icon={icon} color={color} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt bold numberOfLines={1} style={isDebt && m.settled ? { textDecorationLine: 'line-through' } : undefined}>
            {title}
          </Txt>
          {cardLabel || subtitle ? (
            <Row gap={6} style={{ marginTop: 3 }}>
              {cardLabel ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0,
                    maxWidth: '70%',
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: cardColor + '66',
                    backgroundColor: cardColor + '22',
                  }}>
                  <Icon name="credit-card" size={12} color={cardColor} />
                  <Txt variant="caption" bold numberOfLines={1} style={{ flexShrink: 1 }}>
                    {cardLabel}
                  </Txt>
                </View>
              ) : null}
              {subtitle ? (
                <Txt variant="small" muted numberOfLines={1} style={{ flex: 1 }}>
                  {subtitle}
                </Txt>
              ) : null}
            </Row>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt bold color={amountColor} style={{ fontVariant: ['tabular-nums'] }}>
            {isIncome ? '+' : ''}
            {money(m.amount)}
          </Txt>
          <Row gap={4}>
            {m.attachment_count > 0 ? <Icon name="paperclip" size={14} color={t.textSecondary} /> : null}
            {isDebt && m.settled ? (
              <Txt variant="caption" color={t.primary}>
                saldado
              </Txt>
            ) : null}
          </Row>
        </View>
      </Row>
    </Pressable>
  );
}

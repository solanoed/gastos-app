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
  const subtitle = [
    isDebt ? m.cat_name : null,
    m.concept || null,
    m.card_name ? `${m.card_name}${m.installments && m.installments > 1 ? ` · ${m.installments} cuotas` : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
          {subtitle ? (
            <Txt variant="small" muted numberOfLines={1}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt bold color={amountColor} style={{ fontVariant: ['tabular-nums'] }}>
            {isIncome ? '+' : ''}
            {money(m.amount)}
          </Txt>
          <Row gap={4}>
            {m.card_id ? <Icon name="credit-card-outline" size={14} color={t.textSecondary} /> : null}
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

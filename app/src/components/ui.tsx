import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { useKeyboardOverlap } from '@/hooks/use-keyboard';
import { useTheme } from '@/hooks/use-theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Prefijo de los íconos propios (PNG subidos por el usuario) guardados en `categories.icon`. */
export const CUSTOM_ICON_PREFIX = 'img:';

export function Icon({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const t = useTheme();
  if (name.startsWith(CUSTOM_ICON_PREFIX)) {
    return <Image source={{ uri: name.slice(CUSTOM_ICON_PREFIX.length) }} style={{ width: size, height: size }} contentFit="contain" />;
  }
  return <MaterialCommunityIcons name={name as IconName} size={size} color={color ?? t.text} />;
}

export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + '26', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontWeight: '800', fontSize: size * 0.38 }}>{letters || '?'}</Text>
    </View>
  );
}

type TxtProps = {
  children: ReactNode;
  variant?: 'title' | 'h2' | 'body' | 'small' | 'caption' | 'amount';
  color?: string;
  muted?: boolean;
  bold?: boolean;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

export function Txt({ children, variant = 'body', color, muted, bold, center, style, numberOfLines }: TxtProps) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        styles[variant],
        { color: color ?? (muted ? t.textSecondary : t.text) },
        bold && { fontWeight: '700' },
        center && { textAlign: 'center' },
        style,
      ]}>
      {children}
    </Text>
  );
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const inner = [padded && { padding: Spacing.three, gap: Spacing.three }, style];
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: t.background }, inner]}>{children}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={[inner, { paddingBottom: Spacing.six }]}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const t = useTheme();
  const base = [styles.card, { backgroundColor: t.card, borderColor: t.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.75 }]}>
      {children}
    </Pressable>
  );
}

export function Row({
  children,
  gap = Spacing.two,
  style,
  between,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  between?: boolean;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, between && { justifyContent: 'space-between' }, style]}>
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  small,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = { primary: t.primary, secondary: t.backgroundElement, danger: t.dangerSoft, ghost: 'transparent' }[variant];
  const fg = { primary: t.primaryText, secondary: t.text, danger: t.danger, ghost: t.primary }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Row gap={6} style={{ justifyContent: 'center' }}>
          {icon && <Icon name={icon} size={small ? 16 : 20} color={fg} />}
          <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
        </Row>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, color, size = 24, style }: { icon: string; onPress: () => void; color?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.5 : 1 }, style]}>
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="small" muted bold>
        {label}
      </Txt>
      {children}
      {hint ? (
        <Txt variant="caption" muted>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function Input(props: TextInputProps & { big?: boolean }) {
  const t = useTheme();
  const { big, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={t.textSecondary}
      {...rest}
      style={[
        styles.input,
        big && styles.inputBig,
        { backgroundColor: t.backgroundElement, color: t.text, borderColor: t.border },
        style,
      ]}
    />
  );
}

export function Chip({
  label,
  icon,
  color,
  selected,
  onPress,
  onLongPress,
}: {
  label: string;
  icon?: string;
  color?: string;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const accent = color ?? t.primary;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? accent : t.card,
          borderColor: selected ? accent : t.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      {icon && <Icon name={icon} size={16} color={selected ? '#fff' : accent} />}
      <Text style={{ color: selected ? '#fff' : t.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.backgroundElement }]}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segment, sel && { backgroundColor: t.card, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth }]}>
            <Text style={{ color: sel ? t.text : t.textSecondary, fontWeight: sel ? '700' : '500', fontSize: 13 }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function IconCircle({ icon, color, size = 40 }: { icon: string; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={size * 0.52} color={color} />
    </View>
  );
}

export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const t = useTheme();
  const v = Math.max(0, Math.min(1, value));
  const over = value > 1;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: t.backgroundElement, overflow: 'hidden' }}>
      <View style={{ width: `${v * 100}%`, height: '100%', borderRadius: height, backgroundColor: over ? t.danger : color ?? t.primary }} />
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <Row between style={{ marginTop: Spacing.two }}>
      <Txt variant="h2">{title}</Txt>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={{ color: t.primary, fontWeight: '600' }}>{action}</Text>
        </Pressable>
      ) : null}
    </Row>
  );
}

export function Empty({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: Spacing.four, gap: Spacing.two }}>
      <Icon name={icon} size={44} color={t.textSecondary} />
      <Txt variant="h2" center>
        {title}
      </Txt>
      {text ? (
        <Txt muted center>
          {text}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

/** Hoja inferior modal con teclado. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { attach: keyboardRef, overlap: keyboardOverlap } = useKeyboardOverlap();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View ref={keyboardRef} style={{ flex: 1, paddingBottom: keyboardOverlap }}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.background, paddingBottom: (keyboardOverlap ? 0 : insets.bottom) + Spacing.three }]}>
          <View style={[styles.grabber, { backgroundColor: t.backgroundSelected }]} />
          <Row between style={{ paddingHorizontal: Spacing.three, paddingBottom: Spacing.two }}>
            <Txt variant="h2">{title}</Txt>
            <IconButton icon="close" onPress={onClose} />
          </Row>
          <ScrollView contentContainerStyle={{ padding: Spacing.three, paddingTop: 0, gap: Spacing.three }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: Spacing.three, paddingTop: Spacing.two }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function StatTile({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: t.card, borderColor: t.border }]}>
      <Txt variant="caption" muted>
        {label}
      </Txt>
      <Txt variant="h2" color={color} numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Txt>
      {sub ? (
        <Txt variant="caption" muted numberOfLines={1}>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  h2: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13 },
  caption: { fontSize: 12 },
  amount: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  card: { borderRadius: Radius.md, padding: Spacing.three, borderWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  button: { borderRadius: Radius.md, paddingVertical: 14, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.sm },
  buttonText: { fontSize: 16, fontWeight: '700' },
  input: { borderRadius: Radius.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, borderWidth: StyleSheet.hairlineWidth },
  inputBig: { fontSize: 30, fontWeight: '800', paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1 },
  segmented: { flexDirection: 'row', borderRadius: Radius.sm, padding: 3, gap: 3 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, maxHeight: '92%' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginVertical: 8 },
  tile: { flex: 1, borderRadius: Radius.md, padding: 12, borderWidth: StyleSheet.hairlineWidth, gap: 2, minWidth: 0 },
});

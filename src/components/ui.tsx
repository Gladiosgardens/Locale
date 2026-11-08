import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space, type } from '@/theme';

export { colors };

export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <Text style={[type.wordmark, { fontSize: size }]} accessibilityRole="header">
      Locale
    </Text>
  );
}

// Full-page layout for forms and onboarding: large Bodoni title, quiet subtitle.
export function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={type.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={[type.bodyMuted, styles.subtitle]}>{subtitle}</Text> : null}
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'quiet' && styles.buttonQuiet,
        inactive && styles.buttonDisabled,
        pressed && !inactive && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onInk : colors.ink} />
      ) : (
        <Text style={[styles.buttonText, variant !== 'primary' && styles.buttonTextDark]}>{label}</Text>
      )}
    </Pressable>
  );
}

// Underlined field: quieter than a boxed input, closer to a printed form.
export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[styles.input, props.multiline && styles.inputMultiline, style]}
        {...props}
      />
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {children}
    </Text>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Avatar({ name, size = 36, uri }: { name: string; size?: number; uri?: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{initials || '·'}</Text>
      )}
    </View>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: space.xl, paddingTop: space.xl },
  subtitle: { marginTop: space.sm, maxWidth: 360 },
  body: { flex: 1, marginTop: space.xxl, gap: space.lg },
  button: {
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 15,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  buttonSecondary: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.ink },
  buttonQuiet: { backgroundColor: colors.wash, borderColor: colors.wash },
  buttonDisabled: { opacity: 0.35 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: colors.onInk, fontFamily: fonts.semibold, fontSize: 15 },
  buttonTextDark: { color: colors.ink },
  field: { gap: space.xs },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.ink,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 14 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.paper,
  },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { color: colors.ink, fontFamily: fonts.medium, fontSize: 14 },
  chipTextSelected: { color: colors.onInk },
  avatar: { backgroundColor: colors.wash, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontFamily: fonts.display, color: colors.ink },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, backgroundColor: colors.paper, padding: space.xl },
});

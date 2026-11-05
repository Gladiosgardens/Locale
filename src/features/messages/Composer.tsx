import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '@/components/ui';
import { MAX_MESSAGE } from './api';
import { fonts } from '@/theme';

export function Composer({
  onSend,
  disabled,
  sending,
  placeholder = 'Message…',
}: {
  onSend: (body: string) => Promise<boolean>;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const canSend = !disabled && !sending && text.trim().length > 0;

  async function send() {
    if (!canSend) return;
    if (await onSend(text)) setText('');
  }

  return (
    <View style={styles.bar}>
      <TextInput
        accessibilityLabel="Message"
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline
        maxLength={MAX_MESSAGE}
        editable={!disabled}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend, busy: !!sending }}
        disabled={!canSend}
        onPress={send}
        style={[styles.send, !canSend && styles.sendDisabled]}
      >
        <Text style={styles.sendText}>Send</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.bg },
  input: { flex: 1, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontFamily: fonts.body, fontSize: 16, color: colors.text, backgroundColor: '#FFFFFF' },
  send: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.accentText, fontFamily: fonts.semibold, fontSize: 15  },
});

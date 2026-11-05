import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, colors, ErrorText, Field } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { REPORT_REASONS, type ReportReason, type ReportTarget } from './api';
import { useReport } from './hooks';
import { fonts } from '@/theme';

export type ReportSubject = { type: ReportTarget; id: string; label: string };

export function ReportSheet({ subject, onClose }: { subject: ReportSubject | null; onClose: () => void }) {
  const report = useReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function close() {
    setReason(null);
    setDetails('');
    setError(null);
    setSent(false);
    onClose();
  }

  async function submit() {
    if (!subject || !reason) return;
    setError(null);
    try {
      await report.mutateAsync({ targetType: subject.type, targetId: subject.id, reason, details });
      setSent(true);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <Modal visible={!!subject} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close report" />
      <View style={styles.sheet} accessibilityViewIsModal>
        {sent ? (
          <>
            <Text style={styles.title} accessibilityRole="header">Thanks for reporting</Text>
            <Text style={styles.body}>
              {reason === 'child_safety' && subject?.type === 'post'
                ? 'The post is hidden for everyone while we review it. If a child is in immediate danger, contact local emergency services.'
                : 'We’ll review it. The person you reported won’t know it was you.'}
            </Text>
            <Button label="Done" onPress={close} />
          </>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title} accessibilityRole="header">Report {subject?.label}</Text>
            <Text style={styles.body}>Why are you reporting this? Your report is private.</Text>
            {REPORT_REASONS.map((r) => (
              <Pressable
                key={r.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: reason === r.value }}
                accessibilityLabel={r.label}
                onPress={() => setReason(r.value)}
                style={[styles.option, reason === r.value && styles.optionSelected]}
              >
                <Text style={styles.optionText}>{r.label}</Text>
                {r.hint ? <Text style={styles.hint}>{r.hint}</Text> : null}
              </Pressable>
            ))}
            <Field label="Details (optional)" value={details} onChangeText={setDetails} maxLength={1000} multiline />
            <ErrorText>{error}</ErrorText>
            <Button label="Send report" onPress={submit} disabled={!reason} loading={report.isPending} />
            <Button label="Cancel" variant="secondary" onPress={close} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '85%', backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 36, gap: 12 },
  content: { gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, lineHeight: 21 },
  option: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' },
  optionSelected: { borderColor: colors.accent, borderWidth: 2 },
  optionText: { fontFamily: fonts.body, fontSize: 15, color: colors.text },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
});

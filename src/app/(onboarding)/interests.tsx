import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Chip, colors, ErrorText, Screen } from '@/components/ui';
import { useInterests, useMyProfile, useSetInterests } from '@/features/onboarding/hooks';
import { friendlyError } from '@/lib/errors';

const MIN_INTERESTS = 3;
const MAX_INTERESTS = 15;

export default function InterestsStep() {
  const interests = useInterests();
  const profile = useMyProfile();
  const save = useSetInterests();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Pre-select anything the user already chose (e.g. coming back to this step).
  const savedIds = profile.data?.interestIds;
  useEffect(() => {
    if (savedIds?.length) setSelected(new Set(savedIds));
  }, [savedIds]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_INTERESTS) next.add(id);
      return next;
    });
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync([...selected]);
      router.push('/profile');
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const remaining = Math.max(0, MIN_INTERESTS - selected.size);

  return (
    <Screen title="What are you into?" subtitle="Pick at least 3. We use these to suggest groups near you.">
      {interests.isPending ? (
        <ActivityIndicator color={colors.accent} />
      ) : interests.isError ? (
        <>
          <ErrorText>Couldn't load interests.</ErrorText>
          <Button label="Try again" variant="secondary" onPress={() => interests.refetch()} />
        </>
      ) : interests.data.length === 0 ? (
        <Text style={styles.muted}>No interests are available right now. Please try again later.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.chips}>
          {interests.data.map((i) => (
            <Chip key={i.id} label={i.label} selected={selected.has(i.id)} onPress={() => toggle(i.id)} />
          ))}
        </ScrollView>
      )}
      <View style={styles.footer}>
        <Text style={styles.muted}>
          {remaining > 0 ? `Pick ${remaining} more` : `${selected.size} selected`}
        </Text>
        <ErrorText>{error}</ErrorText>
        <Button label="Continue" onPress={submit} disabled={remaining > 0} loading={save.isPending} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 12 },
  footer: { gap: 10, paddingBottom: 12 },
  muted: { color: colors.muted, fontSize: 15 },
});

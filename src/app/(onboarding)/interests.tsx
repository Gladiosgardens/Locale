import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Chip, colors, ErrorText, Screen } from '@/components/ui';
import { useInterests, useMyProfile, useSetInterests } from '@/features/onboarding/hooks';
import { friendlyError } from '@/lib/errors';
import { fonts } from '@/theme';

const MIN_INTERESTS = 3;
const MAX_INTERESTS = 15;

export default function InterestsStep() {
  const interests = useInterests();
  const profile = useMyProfile();
  const save = useSetInterests();
  // null until the user touches a chip; until then show what they saved before.
  const [edited, setEdited] = useState<Set<number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = edited ?? new Set(profile.data?.interestIds ?? []);

  function toggle(id: number) {
    setEdited(() => {
      const next = new Set(selected);
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
    <Screen title="What are you into?" subtitle="Pick at least 3. We use these to shape your feed.">
      {interests.isPending ? (
        <ActivityIndicator color={colors.ink} />
      ) : interests.isError ? (
        <>
          <ErrorText>Couldn’t load interests.</ErrorText>
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
  muted: { color: colors.muted, fontFamily: fonts.body, fontSize: 15  },
});

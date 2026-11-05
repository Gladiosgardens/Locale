import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { Button, colors, ErrorText, Field, Screen } from '@/components/ui';
import { useAreaSearch, useChooseArea, useMyProfile, useSetAreaFromCell } from '@/features/onboarding/hooks';
import { LocationDeniedError, locateArea } from '@/features/onboarding/locateArea';
import { friendlyError } from '@/lib/errors';
import { fonts } from '@/theme';

export default function AreaStep() {
  const profile = useMyProfile();
  const setFromCell = useSetAreaFromCell();
  const choose = useChooseArea();
  const [locating, setLocating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const areas = useAreaSearch(query, picking);
  const current = profile.data?.area;

  const next = () => router.push('/interests');

  async function useLocation() {
    setError(null);
    setLocating(true);
    try {
      const cell = await locateArea();
      await setFromCell.mutateAsync(cell);
      next();
    } catch (e) {
      if (e instanceof LocationDeniedError) {
        setError('Location is off. You can pick your area from the list instead.');
        setPicking(true);
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setLocating(false);
    }
  }

  async function pick(areaId: string) {
    setError(null);
    try {
      await choose.mutateAsync(areaId);
      next();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <Screen
      title="Where's your neighborhood?"
      subtitle="We save an area about 5 km across, never your exact location."
    >
      {current && !picking ? (
        <>
          <Text style={styles.current}>You’re in {current.name}.</Text>
          <Button label="Continue" onPress={next} />
          <Button label="Change area" variant="secondary" onPress={useLocation} loading={locating} />
        </>
      ) : (
        <>
          <Button label="Use my approximate location" onPress={useLocation} loading={locating} />
          {!picking ? (
            <Button label="Pick from a list" variant="secondary" onPress={() => setPicking(true)} />
          ) : null}
        </>
      )}
      <ErrorText>{error}</ErrorText>
      {picking ? (
        <>
          <Field label="Search areas" value={query} onChangeText={setQuery} placeholder="Neighborhood or city" />
          {areas.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : areas.isError ? (
            <ErrorText>Couldn’t load areas.</ErrorText>
          ) : (
            <FlatList
              data={areas.data}
              keyExtractor={(a) => a.id}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  No areas match yet. Use your approximate location to create yours.
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable accessibilityRole="button" style={styles.row} onPress={() => pick(item.id)}>
                  <Text style={styles.rowText}>{item.name}</Text>
                </Pressable>
              )}
            />
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  current: { fontFamily: fonts.body, fontSize: 18, color: colors.text },
  empty: { color: colors.muted, fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowText: { fontFamily: fonts.body, fontSize: 16, color: colors.text },
});

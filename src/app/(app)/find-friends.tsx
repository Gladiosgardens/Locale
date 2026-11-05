import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useMyProfile } from '@/features/onboarding/hooks';
import { MIN_PEOPLE_QUERY, type Person } from '@/features/people/api';
import { useFindContacts, usePeopleSearch, useSuggestions } from '@/features/people/hooks';
import { shareInvite } from '@/features/people/invite';
import { PersonRow } from '@/features/people/PersonRow';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function Action({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      {busy ? <ActivityIndicator color={colors.ink} /> : <Feather name={icon} size={22} color={colors.ink} />}
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export default function FindFriends() {
  const params = useLocalSearchParams<{ q?: string }>();
  const me = useMyProfile();
  const [text, setText] = useState(params.q ?? '');
  const query = useDebounced(text, 300);
  const searching = query.trim().replace(/^@/, '').length >= MIN_PEOPLE_QUERY;
  const results = usePeopleSearch(query);
  const suggestions = useSuggestions();
  const contacts = useFindContacts();
  const handle = me.data?.handle;

  function findContacts() {
    Alert.alert(
      'Find friends from your contacts?',
      'Locale checks the email addresses in your contacts against people on Locale. They’re scrambled on your phone first, and we don’t keep them.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () =>
            contacts.mutate(undefined, {
              onSuccess: (r) => {
                if (r.status === 'denied') {
                  Alert.alert('Contacts access is off', 'You can turn it on for Locale in your phone’s Settings.');
                } else if (r.status === 'unsupported') {
                  Alert.alert('Contacts are only available in the phone app.');
                }
              },
              onError: (e) => Alert.alert(friendlyError(e)),
            }),
        },
      ],
    );
  }

  const found = contacts.data?.status === 'ok' ? contacts.data : null;

  const listHeader = (
    <View>
      <View style={styles.actions}>
        <Action icon="share" label="Invite friends" onPress={() => handle && void shareInvite(handle)} />
        <Action icon="maximize" label="Your QR code" onPress={() => router.push('/qr')} />
        <Action icon="book" label="Contacts" onPress={findContacts} busy={contacts.isPending} />
      </View>
      {found ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>From your contacts</Text>
          {found.people.length ? (
            found.people.map((p) => <PersonRow key={`c-${p.id}`} person={p} />)
          ) : (
            <Text style={[type.bodyMuted, styles.note]}>
              {found.checked
                ? 'None of your contacts are on Locale yet. Invite them with a link.'
                : 'Your contacts don’t have email addresses we can check.'}
            </Text>
          )}
        </View>
      ) : null}
      <Text style={[styles.sectionTitle, styles.suggestedTitle]}>Suggested for you</Text>
    </View>
  );

  const searchEmpty = results.isPending ? (
    <ActivityIndicator style={styles.loading} color={colors.ink} />
  ) : results.isError ? (
    <View style={styles.message}>
      <Text style={type.bodyMuted}>Search didn’t work.</Text>
      <Button label="Try again" variant="secondary" onPress={() => results.refetch()} />
    </View>
  ) : (
    <View style={styles.message}>
      <Text style={type.bodyMuted}>Nobody called “{query.trim()}” yet.</Text>
      {handle ? <Button label="Invite friends" variant="secondary" onPress={() => void shareInvite(handle)} /> : null}
    </View>
  );

  const suggestedEmpty = suggestions.isPending ? (
    <ActivityIndicator style={styles.loading} color={colors.ink} />
  ) : (
    <Text style={[type.bodyMuted, styles.note]}>
      {suggestions.isError ? 'We couldn’t load suggestions.' : 'No suggestions yet. Invite friends to get started.'}
    </Text>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Find friends
        </Text>
      </View>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Feather name="search" size={18} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search people by name or username"
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Name or @username"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {text ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setText('')} hitSlop={10}>
              <Feather name="x" size={18} color={colors.ink} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {searching ? (
        <FlatList<Person>
          key="search"
          data={results.data ?? []}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PersonRow person={item} />}
          ListEmptyComponent={searchEmpty}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList<Person>
          key="suggested"
          data={suggestions.data ?? []}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PersonRow person={item} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={suggestedEmpty}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm },
  searchRow: { paddingHorizontal: space.lg, paddingVertical: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.wash,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 11, fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  actions: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    borderRadius: radius.tag,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pressed: { backgroundColor: colors.wash },
  actionText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  section: { paddingTop: space.lg },
  sectionTitle: { fontFamily: fonts.displayItalic, fontSize: 20, color: colors.ink, paddingHorizontal: space.lg, paddingBottom: space.xs },
  suggestedTitle: { paddingTop: space.xl },
  note: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  message: { padding: space.xl, gap: space.md },
  loading: { marginVertical: space.xl },
});

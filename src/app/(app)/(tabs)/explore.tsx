import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { usePeopleSearch } from '@/features/people/hooks';
import { PersonRow } from '@/features/people/PersonRow';
import { MIN_QUERY_LENGTH } from '@/features/posts/api';
import { useFeed, useSearch } from '@/features/posts/hooks';
import { PostGrid } from '@/features/posts/PostGrid';
import { colors, fonts, radius, space, type } from '@/theme';

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Quick searches people can tap instead of typing.
const SUGGESTIONS = ['Sneakers', 'Headphones', 'Linen', 'Watch', 'Keyboard', 'Lamp', 'Grill', 'Vintage'];

export default function Explore() {
  const [text, setText] = useState('');
  const query = useDebounced(text, 350);
  const searching = query.trim().length >= MIN_QUERY_LENGTH;
  const results = useSearch(query);
  const people = usePeopleSearch(searching ? query : '');
  const peopleFound = searching ? (people.data ?? []) : [];
  const discover = useFeed('everywhere', null);
  const active = searching ? results : discover;
  // A one-word search can also be a hashtag.
  const hashtag = searching && /^#?[^\s#@]+$/.test(query.trim()) ? query.trim().replace(/^#/, '').toLowerCase() : null;

  const empty = active.isPending ? (
    <ActivityIndicator style={styles.loading} color={colors.ink} />
  ) : active.isError ? (
    <View style={styles.message}>
      <Text style={type.bodyMuted}>{searching ? 'Search didn’t work.' : 'We couldn’t load Explore.'}</Text>
      <Button label="Try again" variant="secondary" onPress={() => active.refetch()} />
    </View>
  ) : (
    <View style={styles.message}>
      <Text style={type.bodyMuted}>
        {searching ? `Nothing tagged “${query.trim()}” yet.` : 'Nothing to explore yet. Posts from everyone appear here.'}
      </Text>
    </View>
  );

  const header = (
    <View style={styles.header}>
      <Text style={type.title} accessibilityRole="header">
        {searching ? `“${query.trim()}”` : 'Explore'}
      </Text>
      {hashtag && !/^[0-9_]+$/.test(hashtag) ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`See posts tagged #${hashtag}`}
          onPress={() => router.push(`/tag/${encodeURIComponent(hashtag)}`)}
          style={styles.hashtag}
          hitSlop={4}
        >
          <Feather name="hash" size={18} color={colors.ink} />
          <Text style={styles.hashtagText}>See posts tagged #{hashtag}</Text>
        </Pressable>
      ) : null}
      {peopleFound.length ? (
        <View style={styles.people}>
          <Text style={styles.peopleTitle}>People</Text>
          {peopleFound.slice(0, 3).map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
          {peopleFound.length > 3 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/find-friends', params: { q: query.trim() } })}
              hitSlop={6}
            >
              <Text style={styles.seeAll}>See all people</Text>
            </Pressable>
          ) : null}
          <Text style={styles.peopleTitle}>Posts</Text>
        </View>
      ) : null}
      {!searching ? (
        <View style={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} accessibilityRole="button" onPress={() => setText(s)} style={styles.suggestion} hitSlop={4}>
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Feather name="search" size={18} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search people, items, brands, stores and hashtags"
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Search people, items, #hashtags"
            placeholderTextColor={colors.muted}
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
      <PostGrid query={active} layout="masonry" header={header} empty={empty} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hashtag: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  hashtagText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  screen: { flex: 1, backgroundColor: colors.paper },
  searchRow: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.wash,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 11, fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, gap: space.md },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  suggestion: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  suggestionText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
  message: { padding: space.xl, gap: space.md },
  people: { marginHorizontal: -space.lg, gap: 0 },
  peopleTitle: { fontFamily: fonts.displayItalic, fontSize: 20, color: colors.ink, paddingHorizontal: space.lg, paddingTop: space.sm },
  seeAll: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ultramarine, paddingHorizontal: space.lg, paddingVertical: space.sm },
  loading: { marginVertical: space.xxl },
});

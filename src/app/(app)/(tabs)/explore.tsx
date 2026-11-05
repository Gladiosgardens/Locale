import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
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
const SUGGESTIONS = ['Linen', 'Denim', 'Loafers', 'Gold hoops', 'Trench coat', 'Lamp', 'Rug', 'Vintage'];

export default function Explore() {
  const [text, setText] = useState('');
  const query = useDebounced(text, 350);
  const searching = query.trim().length >= MIN_QUERY_LENGTH;
  const results = useSearch(query);
  const discover = useFeed('everywhere', null);
  const active = searching ? results : discover;

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
            accessibilityLabel="Search items, brands and stores"
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Search items, brands, stores"
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
  loading: { marginVertical: space.xxl },
});

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors } from '@/components/ui';
import { MIN_QUERY_LENGTH } from '@/features/posts/api';
import { useSearch } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function Search() {
  const [text, setText] = useState('');
  const query = useDebounced(text, 350);
  const results = useSearch(query);
  const tooShort = query.trim().length < MIN_QUERY_LENGTH;

  const empty = tooShort ? (
    <Text style={styles.hint}>Search items, brands or stores in public posts from everywhere.</Text>
  ) : results.isPending ? (
    <ActivityIndicator style={styles.loading} color={colors.accent} />
  ) : results.isError ? (
    <View style={styles.message}>
      <Text style={styles.hint}>Search didn’t work. Please try again.</Text>
      <Button label="Try again" variant="secondary" onPress={() => results.refetch()} />
    </View>
  ) : (
    <Text style={styles.hint}>No tagged items match “{query.trim()}” yet.</Text>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TextInput
          accessibilityLabel="Search items"
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Linen sofa, Reformation, IKEA…"
          placeholderTextColor={colors.muted}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>
      <PostList query={results} empty={empty} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#FFFFFF',
  },
  cancel: { color: colors.muted, fontSize: 16 },
  hint: { padding: 24, fontSize: 16, color: colors.muted, lineHeight: 22 },
  message: { gap: 12 },
  loading: { marginVertical: 24 },
});

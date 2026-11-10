import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFilteredFeed } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';
import { colors, space, type } from '@/theme';

const ASKING = { asking: true } as const;

// Posts still asking "Where's this from?", newest first.
export default function Asking() {
  const feed = useFilteredFeed(ASKING);
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Help find
        </Text>
      </View>
      <Text style={[type.small, styles.lead]}>
        People asking where something is from. Answer one, and earn if they add your find.
      </Text>
      <PostList
        query={feed}
        empty={
          feed.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.ink} />
          ) : (
            <Text style={[type.bodyMuted, styles.lead]}>Nobody is asking right now.</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  lead: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  loading: { marginVertical: space.xl },
});

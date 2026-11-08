import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import type { Activity } from '@/features/activity/api';
import { useActivity, useMarkActivitySeen } from '@/features/activity/hooks';
import { PersonRow } from '@/features/people/PersonRow';
import { UserAvatar } from '@/features/profiles/UserAvatar';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space, type } from '@/theme';

const VERB: Record<Activity['kind'], string> = {
  like: 'liked your post.',
  comment: 'commented:',
  reply: 'replied to your comment:',
  follow: 'started following you.',
};

function Row({ a }: { a: Activity }) {
  if (a.kind === 'follow') {
    return (
      <PersonRow
        person={{ id: a.actor.id, handle: a.actor.handle, displayName: a.actor.displayName, iFollow: a.iFollowActor, note: `Followed you ${timeAgo(a.createdAt)}` }}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${a.actor.displayName} ${VERB[a.kind]} ${a.body ?? ''}`}
      onPress={() => (a.postId ? router.push(a.kind === 'like' ? `/post/${a.postId}` : `/comments/${a.postId}`) : undefined)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Pressable onPress={() => router.push(`/profile/${a.actor.id}`)} accessibilityRole="link" hitSlop={4}>
        <UserAvatar userId={a.actor.id} name={a.actor.displayName} size={44} />
      </Pressable>
      <Text style={styles.text} numberOfLines={3}>
        <Text style={styles.name}>{a.actor.handle} </Text>
        {VERB[a.kind]}
        {a.body ? ` ${a.body}` : ''} <Text style={styles.time}>{timeAgo(a.createdAt)}</Text>
      </Text>
      {a.postThumb ? <Image source={{ uri: a.postThumb }} style={styles.thumb} contentFit="cover" /> : null}
    </Pressable>
  );
}

export default function ActivityScreen() {
  const activity = useActivity();
  const markSeen = useMarkActivitySeen();
  const list = useMemo(() => activity.data?.pages.flat() ?? [], [activity.data]);

  // Opening the screen counts as having seen everything.
  const { mutate } = markSeen;
  useEffect(() => {
    mutate();
  }, [mutate]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Activity
        </Text>
      </View>
      <FlatList
        data={list}
        keyExtractor={(a) => `${a.kind}-${a.actor.id}-${a.postId}-${a.createdAt}`}
        renderItem={({ item }) => <Row a={item} />}
        onEndReached={() => {
          if (activity.hasNextPage && !activity.isFetchingNextPage) void activity.fetchNextPage();
        }}
        onRefresh={() => void activity.refetch()}
        refreshing={activity.isRefetching}
        ListEmptyComponent={
          activity.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.ink} />
          ) : activity.isError ? (
            <View style={styles.empty}>
              <Text style={type.bodyMuted}>We couldn’t load your activity.</Text>
              <Button label="Try again" variant="secondary" onPress={() => activity.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={type.bodyMuted}>When people like or comment on your posts, or follow you, you’ll see it here.</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  pressed: { backgroundColor: colors.wash },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  name: { fontFamily: fonts.semibold },
  time: { color: colors.muted },
  thumb: { width: 44, height: 44, borderRadius: radius.tag, backgroundColor: colors.wash },
  loading: { marginVertical: space.xl },
  empty: { padding: space.xl, gap: space.md },
});

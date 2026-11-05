import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, colors } from '@/components/ui';
import { GroupCard } from '@/features/groups/GroupCard';
import { useGroups } from '@/features/groups/hooks';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import { fonts } from '@/theme';

export default function Groups() {
  const profile = useMyProfile();
  const interests = useInterests();
  const [interestId, setInterestId] = useState<number | null>(null);
  const groups = useGroups({ interestId });

  const labels = useMemo(() => new Map((interests.data ?? []).map((i) => [i.id, i.label])), [interests.data]);
  const myInterests = (interests.data ?? []).filter((i) => profile.data?.interestIds.includes(i.id));
  const filterLabel = interestId ? labels.get(interestId) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Groups</Text>
        <Pressable accessibilityRole="button" style={styles.create} onPress={() => router.push('/groups/new')}>
          <Text style={styles.createText}>New group</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>
        Groups near {profile.data?.area?.name ?? 'you'} and the ones you’re in
      </Text>

      {myInterests.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filters}>
          <Chip label="All" selected={interestId === null} onPress={() => setInterestId(null)} />
          {myInterests.map((i) => (
            <Chip key={i.id} label={i.label} selected={interestId === i.id} onPress={() => setInterestId(i.id)} />
          ))}
        </ScrollView>
      ) : null}

      <FlatList
        data={groups.data ?? []}
        keyExtractor={(g) => g.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <GroupCard group={item} interestLabel={labels.get(item.interestId)} onPress={() => router.push(`/groups/${item.id}`)} />
        )}
        ListEmptyComponent={
          groups.isPending ? (
            <ActivityIndicator style={styles.loading} color={colors.accent} />
          ) : groups.isError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>We couldn’t load groups.</Text>
              <Button label="Try again" variant="secondary" onPress={() => groups.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {filterLabel ? `No ${filterLabel} groups near you yet.` : 'No groups near you yet.'} Start the first one.
              </Text>
              <Button label="Create a group" onPress={() => router.push('/groups/new')} />
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 8 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 24, color: colors.text },
  link: { color: colors.muted, fontFamily: fonts.body, fontSize: 15  },
  create: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  createText: { color: colors.accentText, fontFamily: fonts.semibold, fontSize: 14  },
  subtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  filterBar: { flexGrow: 0 },
  filters: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  list: { gap: 10, paddingHorizontal: 16, paddingBottom: 32 },
  loading: { marginVertical: 24 },
  empty: { paddingVertical: 24, gap: 16 },
  emptyText: { fontFamily: fonts.body, fontSize: 16, color: colors.muted, lineHeight: 22 },
});

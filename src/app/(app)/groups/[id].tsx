import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Centered, colors } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import type { Group, RosterEntry } from '@/features/groups/api';
import {
  useGroup,
  useJoinGroup,
  useLeaveGroup,
  useRemoveMember,
  useRespondToRequest,
  useRoster,
  useSetRole,
} from '@/features/groups/hooks';
import { useInterests } from '@/features/onboarding/hooks';
import { useGroupFeed } from '@/features/posts/hooks';
import { PostList } from '@/features/posts/PostList';
import { ReportSheet, type ReportSubject } from '@/features/safety/ReportSheet';
import { friendlyError } from '@/lib/errors';
import { fonts } from '@/theme';

const ROLE_LABEL = { owner: 'Owner', moderator: 'Moderator', member: '' } as const;

function MembershipAction({ group }: { group: Group }) {
  const join = useJoinGroup(group.id);
  const leave = useLeaveGroup(group.id);
  const fail = (e: unknown) => Alert.alert(friendlyError(e));

  if (group.myStatus === 'banned') return <Text style={styles.muted}>You can’t join this group.</Text>;
  if (group.myRole === 'owner') return null;
  if (group.myStatus === 'pending') {
    return (
      <View style={styles.actionRow}>
        <Text style={styles.muted}>Request sent. A moderator will review it.</Text>
        <Button label="Withdraw" variant="secondary" loading={leave.isPending} onPress={() => leave.mutate(undefined, { onError: fail })} />
      </View>
    );
  }
  if (group.myStatus === 'active') {
    return (
      <Button
        label="Leave group"
        variant="secondary"
        loading={leave.isPending}
        onPress={() =>
          Alert.alert(`Leave ${group.name}?`, group.privacy === 'private' ? 'You’ll need approval to rejoin.' : undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: () => leave.mutate(undefined, { onError: fail }) },
          ])
        }
      />
    );
  }
  return (
    <Button
      label={group.privacy === 'public' ? 'Join group' : 'Request to join'}
      loading={join.isPending}
      onPress={() => join.mutate(undefined, { onError: fail })}
    />
  );
}

function Requests({ group, entries }: { group: Group; entries: RosterEntry[] }) {
  const respond = useRespondToRequest(group.id);
  const pending = entries.filter((e) => e.status === 'pending');
  if (!pending.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Requests to join</Text>
      {pending.map((p) => (
        <View key={p.profileId} style={styles.personRow}>
          <Text style={styles.person}>{p.displayName} <Text style={styles.muted}>@{p.handle}</Text></Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Approve ${p.handle}`}
            onPress={() => respond.mutate({ profileId: p.profileId, approve: true }, { onError: (e) => Alert.alert(friendlyError(e)) })}
            hitSlop={8}
          >
            <Text style={styles.approve}>Approve</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Decline ${p.handle}`}
            onPress={() => respond.mutate({ profileId: p.profileId, approve: false }, { onError: (e) => Alert.alert(friendlyError(e)) })}
            hitSlop={8}
          >
            <Text style={styles.decline}>Decline</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function Members({ group, entries, myId }: { group: Group; entries: RosterEntry[]; myId?: string }) {
  const [open, setOpen] = useState(false);
  const remove = useRemoveMember(group.id);
  const setRole = useSetRole(group.id);
  const active = entries.filter((e) => e.status === 'active');
  const isOwner = group.myRole === 'owner';
  const isMod = isOwner || group.myRole === 'moderator';
  const fail = (e: unknown) => Alert.alert(friendlyError(e));

  return (
    <View style={styles.section}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)}>
        <Text style={styles.sectionTitle}>{open ? 'Hide members' : `Members (${active.length})`}</Text>
      </Pressable>
      {open
        ? active.map((m) => {
            const canRemove = m.profileId !== myId && m.role !== 'owner' && (isOwner || (isMod && m.role === 'member'));
            return (
              <View key={m.profileId} style={styles.personRow}>
                <Text style={styles.person}>
                  {m.displayName} <Text style={styles.muted}>@{m.handle}</Text>
                  {ROLE_LABEL[m.role] ? <Text style={styles.role}>  {ROLE_LABEL[m.role]}</Text> : null}
                </Text>
                {isOwner && m.role !== 'owner' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={m.role === 'moderator' ? `Make ${m.handle} a member` : `Make ${m.handle} a moderator`}
                    onPress={() => setRole.mutate({ profileId: m.profileId, role: m.role === 'moderator' ? 'member' : 'moderator' }, { onError: fail })}
                    hitSlop={8}
                  >
                    <Text style={styles.approve}>{m.role === 'moderator' ? 'Demote' : 'Make mod'}</Text>
                  </Pressable>
                ) : null}
                {canRemove ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${m.handle}`}
                    onPress={() =>
                      Alert.alert(`Remove @${m.handle}?`, 'They won’t be able to rejoin.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(m.profileId, { onError: fail }) },
                      ])
                    }
                    hitSlop={8}
                  >
                    <Text style={styles.decline}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })
        : null}
    </View>
  );
}

export default function GroupPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const group = useGroup(id);
  const interests = useInterests();
  const g = group.data;
  const isMember = g?.myStatus === 'active';
  const canReadPosts = !!g && (isMember || (g.privacy === 'public' && g.myStatus !== 'banned'));
  const feed = useGroupFeed(id, canReadPosts);
  const roster = useRoster(id, isMember);
  const [reporting, setReporting] = useState<ReportSubject | null>(null);

  if (group.isPending) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }
  if (!g) {
    return (
      <Centered>
        <Text style={styles.muted}>{group.isError ? 'We couldn’t load this group.' : 'This group isn’t available in your area.'}</Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </Centered>
    );
  }

  const interest = interests.data?.find((i) => i.id === g.interestId)?.label;

  const header = (
    <View style={styles.info}>
      <Text style={styles.title} accessibilityRole="header">{g.name}</Text>
      <Text style={styles.muted}>
        {[interest, g.privacy === 'private' ? 'Private' : 'Public', `${g.memberCount} ${g.memberCount === 1 ? 'member' : 'members'}`, g.areaName]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {g.description ? <Text style={styles.description}>{g.description}</Text> : null}
      <MembershipAction group={g} />
      {isMember ? (
        <Button
          label="Post in group"
          onPress={() => router.push({ pathname: '/new-post', params: { groupId: g.id, groupName: g.name } })}
        />
      ) : null}
      {isMember && roster.data ? (
        <>
          <Requests group={g} entries={roster.data} />
          <Members group={g} entries={roster.data} myId={session?.user.id} />
        </>
      ) : null}
      {g.myRole !== 'owner' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setReporting({ type: 'group', id: g.id, label: 'group' })}
          hitSlop={8}
        >
          <Text style={styles.reportLink}>Report group</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </View>
      {canReadPosts ? (
        <PostList
          query={feed}
          header={header}
          empty={
            feed.isPending ? (
              <ActivityIndicator style={styles.loading} color={colors.accent} />
            ) : (
              <Text style={styles.emptyText}>No posts in this group yet.</Text>
            )
          }
        />
      ) : (
        <View>
          {header}
          {g.myStatus !== 'banned' ? (
            <Text style={styles.emptyText}>This group is private. Members’ posts appear here once you’re approved.</Text>
          ) : null}
        </View>
      )}
      <ReportSheet subject={reporting} onClose={() => setReporting(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topbar: { paddingHorizontal: 16, paddingVertical: 8 },
  link: { color: colors.muted, fontFamily: fonts.body, fontSize: 15  },
  info: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 24, color: colors.text },
  description: { fontFamily: fonts.body, fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { color: colors.muted, fontFamily: fonts.body, fontSize: 14  },
  actionRow: { gap: 8 },
  section: { gap: 6, paddingTop: 6 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6 },
  person: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text },
  role: { fontFamily: fonts.body, fontSize: 12, color: colors.accent },
  approve: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 14, },
  decline: { color: colors.danger, fontFamily: fonts.body, fontSize: 14  },
  reportLink: { color: colors.muted, fontFamily: fonts.body, fontSize: 13, textDecorationLine: 'underline' },
  loading: { marginVertical: 24 },
  emptyText: { padding: 16, fontFamily: fonts.body, fontSize: 15, color: colors.muted, lineHeight: 21 },
});

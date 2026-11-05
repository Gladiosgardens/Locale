import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Chip, colors, ErrorText, Field } from '@/components/ui';
import type { GroupPrivacy } from '@/features/groups/api';
import { useCreateGroup } from '@/features/groups/hooks';
import { useInterests, useMyProfile } from '@/features/onboarding/hooks';
import { friendlyError } from '@/lib/errors';
import { fonts } from '@/theme';

export default function NewGroup() {
  const profile = useMyProfile();
  const interests = useInterests();
  const create = useCreateGroup();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [interestId, setInterestId] = useState<number | null>(null);
  const [privacy, setPrivacy] = useState<GroupPrivacy>('public');
  const [error, setError] = useState<string | null>(null);

  const family = !!interests.data?.find((i) => i.id === interestId)?.is_family;
  const effectivePrivacy: GroupPrivacy = family ? 'private' : privacy;
  const ready = name.trim().length >= 3 && interestId != null;

  async function submit() {
    setError(null);
    try {
      const id = await create.mutateAsync({ name, description, interestId: interestId!, privacy: effectivePrivacy });
      router.replace(`/groups/${id}`);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">New group</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Field label="Name" value={name} onChangeText={setName} maxLength={60} placeholder="Downtown dog walkers" />
        <Field
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          maxLength={500}
          multiline
          placeholder="Morning loops around the park, all dogs welcome."
        />

        <Text style={styles.label}>Interest</Text>
        <View style={styles.chips}>
          {(interests.data ?? []).map((i) => (
            <Chip key={i.id} label={i.label} selected={interestId === i.id} onPress={() => setInterestId(i.id)} />
          ))}
        </View>

        <Text style={styles.label}>Who can see posts</Text>
        <View style={styles.chips}>
          <Chip label="Public" selected={effectivePrivacy === 'public'} onPress={() => !family && setPrivacy('public')} />
          <Chip label="Private" selected={effectivePrivacy === 'private'} onPress={() => setPrivacy('private')} />
        </View>
        <Text style={styles.notice}>
          {family
            ? 'Groups about kids are always private: only approved members see posts and who’s in the group.'
            : effectivePrivacy === 'public'
              ? 'Anyone within about 15 km can see posts and join right away.'
              : 'People nearby can see the group exists. Only approved members see posts and members.'}
        </Text>
        <Text style={styles.notice}>The group is based in {profile.data?.area?.name ?? 'your area'}. Its posts never appear in Everywhere or search.</Text>

        <ErrorText>{error}</ErrorText>
        <Button label="Create group" onPress={submit} disabled={!ready} loading={create.isPending} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  link: { color: colors.muted, fontFamily: fonts.body, fontSize: 16, width: 60 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17, color: colors.text },
  spacer: { width: 60 },
  body: { padding: 16, gap: 14 },
  label: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, lineHeight: 18 },
});

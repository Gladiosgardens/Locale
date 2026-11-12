import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorText, Field } from '@/components/ui';
import { useDeleteAccount, useDeletionSummary } from '@/features/account/api';
import { formatPrice } from '@/features/items/link';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';

// Permanently deletes the account. Typing your username is the confirmation.
export default function DeleteAccount() {
  const summary = useDeletionSummary();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState('');
  const s = summary.data;
  const matches = !!s && typed.trim().replace(/^@/, '').toLowerCase() === s.handle;
  const blocked = !!s?.payoutInProgress;

  function confirm() {
    Alert.alert('Delete your account?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(typed, {
            // Signing out sends the app back to sign-in.
            onSuccess: () => Alert.alert('Your account has been deleted'),
          }),
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Delete account
        </Text>
      </View>

      {summary.isPending ? (
        <ActivityIndicator style={styles.loading} color={colors.ink} />
      ) : !s ? (
        <Text style={[type.bodyMuted, styles.body]}>{friendlyError(summary.error)}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={type.body}>
            Deleting @{s.handle} removes your profile and everything you’ve made on Locale, for good:{' '}
            {s.postCount === 1 ? 'your post' : s.postCount ? `your ${s.postCount} posts` : 'your posts'}, stories, comments,
            likes, saves, wishlist, messages you sent, follows and your Instagram connection.
          </Text>

          {blocked ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                A payout is on its way to you. You can delete your account once it arrives.
              </Text>
            </View>
          ) : s.unpaidCents > 0 ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                You have {formatPrice(s.unpaidCents, 'USD')} in earnings that haven’t been paid yet. Deleting your account gives
                them up.
              </Text>
            </View>
          ) : null}

          <Text style={type.small}>
            Records of payouts already sent are kept for tax purposes, without your profile. Your Stripe account stays with
            Stripe.
          </Text>

          <Field
            label={`Type ${s.handle} to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!blocked}
          />
          <ErrorText>{remove.error ? friendlyError(remove.error) : null}</ErrorText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !matches || blocked || remove.isPending }}
            disabled={!matches || blocked || remove.isPending}
            onPress={confirm}
            style={[styles.danger, (!matches || blocked) && styles.dangerOff]}
          >
            {remove.isPending ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.dangerText}>Delete my account</Text>
            )}
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  loading: { marginVertical: space.xl },
  body: { padding: space.lg, gap: space.lg },
  notice: { backgroundColor: colors.wash, borderRadius: radius.tag, padding: space.md },
  noticeText: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink, lineHeight: 21 },
  danger: { minHeight: 50, borderRadius: 999, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  dangerOff: { opacity: 0.4 },
  dangerText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.onInk },
});

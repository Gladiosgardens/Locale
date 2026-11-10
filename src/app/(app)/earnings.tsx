import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { formatUsd, payoutDashboard, startPayoutSetup, type Sale } from '@/features/earnings/api';
import { PAYOUT_COUNTRIES } from '@/features/earnings/countries';
import { useEarnings, usePayouts, useRefreshPayoutAccount, useSales } from '@/features/earnings/hooks';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space, type } from '@/theme';

const STATUS_LABEL: Record<Sale['status'], string> = {
  pending: 'Waiting for return window',
  available: 'Ready for next payout',
  processing: 'Paying out',
  paid: 'Paid',
  reversed: 'Returned',
};

function monthDay(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

// Money earned when people buy through items you tagged, and payout setup.
export default function Earnings() {
  const summary = useEarnings();
  const sales = useSales();
  const payouts = usePayouts();
  const refresh = useRefreshPayoutAccount();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = summary.data;

  // Stripe sends people back to locale://earnings; re-check their account then.
  const { mutate: recheck } = refresh;
  useEffect(() => {
    if (s?.hasAccount) recheck();
  }, [s?.hasAccount, recheck]);

  async function setup(country: string | null) {
    setPicking(false);
    setBusy(true);
    try {
      const url = await startPayoutSetup(country ?? s?.country ?? 'US');
      await WebBrowser.openAuthSessionAsync(url, 'locale://earnings');
      refresh.mutate();
    } catch (e) {
      const detail = (e as { detail?: string }).detail;
      Alert.alert('Payout setup didn’t finish', detail ?? friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function dashboard() {
    setBusy(true);
    try {
      await WebBrowser.openBrowserAsync(await payoutDashboard());
    } catch (e) {
      Alert.alert(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Earnings
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {summary.isPending ? <ActivityIndicator style={styles.loading} color={colors.ink} /> : null}
        {summary.isError ? (
          <View style={styles.block}>
            <Text style={type.bodyMuted}>We couldn’t load your earnings.</Text>
            <Button label="Try again" variant="secondary" onPress={() => summary.refetch()} />
          </View>
        ) : null}

        {s ? (
          <>
            <View
              style={styles.hero}
              accessible
              accessibilityLabel={`${formatUsd(s.availableCents)} ready for your next payout`}
            >
              <Text style={styles.heroValue}>{formatUsd(s.availableCents)}</Text>
              <Text style={styles.heroLabel}>Ready for your next payout</Text>
            </View>
            <View style={styles.pair}>
              <View style={styles.half} accessible accessibilityLabel={`${formatUsd(s.pendingCents)} pending`}>
                <Text style={styles.value}>{formatUsd(s.pendingCents)}</Text>
                <Text style={styles.label}>Pending, until stores’ return windows close</Text>
              </View>
              <View style={styles.half} accessible accessibilityLabel={`${formatUsd(s.paidCents)} paid out`}>
                <Text style={styles.value}>{formatUsd(s.paidCents)}</Text>
                <Text style={styles.label}>Paid out so far</Text>
              </View>
            </View>

            <View style={styles.card}>
              {!s.hasAccount ? (
                <>
                  <Text style={styles.cardTitle}>Get paid</Text>
                  <Text style={type.small}>
                    Set up payouts with Stripe to receive your earnings in your bank account. Stripe checks your
                    identity and handles tax details; Locale never sees your bank information.
                  </Text>
                  <Button label="Set up payouts" onPress={() => setPicking(true)} loading={busy} />
                </>
              ) : !s.payoutsEnabled ? (
                <>
                  <Text style={styles.cardTitle}>Finish payout setup</Text>
                  <Text style={type.small}>
                    {s.detailsSubmitted
                      ? 'Stripe is reviewing your details. This usually takes a few minutes; we’ll pay you once it’s done.'
                      : 'Stripe needs a few more details before it can pay you.'}
                  </Text>
                  <Button
                    label={s.detailsSubmitted ? 'Check again' : 'Continue with Stripe'}
                    onPress={() => (s.detailsSubmitted ? refresh.mutate() : void setup(null))}
                    loading={busy || refresh.isPending}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.cardTitle}>Payouts are on</Text>
                  <Text style={type.small}>
                    {s.availableCents >= s.minimumPayoutCents
                      ? `Your next payout is on ${monthDay(s.nextPayoutOn)}.`
                      : `We pay on the 1st of each month once you have at least ${formatUsd(s.minimumPayoutCents)} ready.`}
                  </Text>
                  <Button
                    label="Bank account and tax details"
                    variant="secondary"
                    onPress={() => void dashboard()}
                    loading={busy}
                  />
                </>
              )}
            </View>

            <Text style={styles.section}>Sales from your posts</Text>
            {sales.data?.length ? (
              sales.data.map((sale) => (
                <Pressable
                  key={sale.id}
                  accessibilityRole={sale.postId ? 'button' : undefined}
                  disabled={!sale.postId}
                  onPress={() => sale.postId && router.push(`/post/${sale.postId}`)}
                  style={styles.row}
                  accessibilityLabel={`${sale.itemTitle ?? 'Item'}: you earned ${formatUsd(sale.earnedCents)}, ${STATUS_LABEL[sale.status]}`}
                >
                  <Image
                    source={sale.thumb ? { uri: sale.thumb } : undefined}
                    style={styles.thumb}
                    contentFit="cover"
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {sale.itemTitle ?? 'Tagged item'}
                    </Text>
                    <Text style={styles.meta}>
                      {STATUS_LABEL[sale.status]}, {timeAgo(sale.occurredAt)}
                    </Text>
                  </View>
                  <Text style={[styles.amount, sale.status === 'reversed' && styles.reversed]}>
                    {formatUsd(sale.earnedCents)}
                  </Text>
                </Pressable>
              ))
            ) : sales.isPending ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <Text style={type.bodyMuted}>
                When someone buys through an item you tagged, the sale shows here. Stores report sales within a day or
                two.
              </Text>
            )}

            {payouts.data?.length ? (
              <>
                <Text style={styles.section}>Payouts</Text>
                {payouts.data.map((p) => (
                  <View key={p.id} style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{formatUsd(p.amountCents)}</Text>
                      <Text style={styles.meta}>
                        {p.status === 'paid'
                          ? 'Sent to your Stripe account'
                          : p.status === 'failed'
                            ? 'Didn’t go through; we’ll retry next month'
                            : 'Sending'}
                        , {timeAgo(p.createdAt)}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            <Text style={styles.section}>How earning works</Text>
            <Text style={styles.rule}>
              • Tag items with shop links. When someone buys through your post, you get {s.sharePercent}% of the store’s
              commission.
            </Text>
            <Text style={styles.rule}>
              • Sales stay pending until the store’s return window closes, usually 30 to 90 days. Returned orders don’t
              count.
            </Text>
            <Text style={styles.rule}>
              • We pay on the 1st of every month once you have at least {formatUsd(s.minimumPayoutCents)} ready.
            </Text>
            <Text style={styles.rule}>
              • Buying through your own posts doesn’t earn. Links you marked as your own affiliate links keep earning
              through your own program.
            </Text>
            <Text style={styles.rule}>• Not every store pays commission, and stores set their own rates.</Text>
          </>
        ) : null}
      </ScrollView>
      <CountryPicker visible={picking} onPick={(c) => void setup(c)} onClose={() => setPicking(false)} />
    </SafeAreaView>
  );
}

function CountryPicker({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(
    () => PAYOUT_COUNTRIES.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())),
    [q],
  );
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.topbar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} hitSlop={10}>
            <Feather name="x" size={24} color={colors.ink} />
          </Pressable>
          <Text style={type.title} accessibilityRole="header">
            Where’s your bank?
          </Text>
        </View>
        <View style={styles.body}>
          <TextInput
            accessibilityLabel="Search countries"
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="Search countries"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
          />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.countries}>
          {list.map((c) => (
            <Pressable key={c.code} accessibilityRole="button" onPress={() => onPick(c.code)} style={styles.country}>
              <Text style={styles.countryName}>{c.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
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
  body: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  loading: { marginVertical: space.xl },
  block: { gap: space.md, paddingVertical: space.lg },
  hero: { paddingVertical: space.lg, gap: 4 },
  heroValue: { fontFamily: fonts.display, fontSize: 52, lineHeight: 58, color: colors.ultramarine },
  heroLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  pair: { flexDirection: 'row', gap: space.lg, paddingBottom: space.lg },
  half: { flex: 1, gap: 2 },
  value: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  label: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  card: { backgroundColor: colors.wash, borderRadius: radius.tag, padding: space.lg, gap: space.md },
  cardTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  section: {
    fontFamily: fonts.displayItalic,
    fontSize: 19,
    color: colors.ink,
    marginTop: space.xl,
    marginBottom: space.xs,
    paddingBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  thumb: { width: 44, height: 44, borderRadius: radius.tag, backgroundColor: colors.wash },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  amount: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ultramarine },
  reversed: { color: colors.muted, textDecorationLine: 'line-through' },
  rule: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.graphite, marginTop: space.xs },
  search: {
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  countries: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  country: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  countryName: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
});

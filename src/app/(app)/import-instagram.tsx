import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { connectUrl, MAX_IMPORT } from '@/features/instagram/api';
import { useDisconnectInstagram, useImportPosts, useInstagramMedia, useInstagramStatus } from '@/features/instagram/hooks';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';

const COLS = 3;

// Bring your Instagram photos to Locale so your profile isn't empty on day one.
export default function ImportInstagram() {
  const { width } = useWindowDimensions();
  const status = useInstagramStatus();
  const connected = !!status.data?.connected;
  const media = useInstagramMedia(connected);
  const run = useImportPosts();
  const disconnect = useDisconnectInstagram();
  const [picked, setPicked] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const posts = useMemo(() => media.data?.pages.flatMap((p) => p.posts) ?? [], [media.data]);
  const size = Math.floor((width - 2 * space.lg - (COLS - 1) * 4) / COLS);

  async function connect() {
    setConnecting(true);
    try {
      await WebBrowser.openAuthSessionAsync(await connectUrl(), 'locale://import-instagram');
      await status.refetch();
    } catch (e) {
      Alert.alert('Instagram didn’t connect', friendlyError(e));
    } finally {
      setConnecting(false);
    }
  }

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_IMPORT ? [...p, id] : p));
  }

  function startImport() {
    run.mutate(picked, {
      onSuccess: (r) => {
        setPicked([]);
        const limit = r.skipped.some((s) => s.reason === 'rate_limited');
        Alert.alert(
          r.imported.length ? `Imported ${r.imported.length} ${r.imported.length === 1 ? 'post' : 'posts'}` : 'Nothing was imported',
          limit
            ? 'You’ve reached today’s limit of 20 new posts. Import the rest tomorrow.'
            : r.skipped.length
              ? `${r.skipped.length} couldn’t be imported (videos, or already imported).`
              : 'They’re on your profile with their original dates. Tag what’s in them so people can shop them.',
        );
      },
      onError: (e) => Alert.alert(friendlyError(e)),
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Import from Instagram
        </Text>
      </View>

      {status.isPending ? (
        <ActivityIndicator style={styles.loading} color={colors.ink} />
      ) : !connected ? (
        <View style={styles.intro}>
          <Text style={type.body}>
            Bring your Instagram photos to Locale. You pick which posts; they keep their captions and original dates, and
            appear on your profile, not as new posts in your followers’ feeds.
          </Text>
          <Text style={type.small}>
            Works with Instagram professional accounts (Creator or Business). Switching is free in Instagram: Settings, then
            Account type and tools. Locale only reads your posts; it never posts to Instagram.
          </Text>
          <Button label="Connect Instagram" onPress={() => void connect()} loading={connecting} />
        </View>
      ) : (
        <>
          <View style={styles.bar}>
            <Text style={styles.who}>@{status.data?.username ?? 'instagram'}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert('Disconnect Instagram?', 'Posts you imported stay on Locale.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Disconnect', style: 'destructive', onPress: () => disconnect.mutate() },
                ])
              }
              hitSlop={8}
            >
              <Text style={styles.disconnect}>Disconnect</Text>
            </Pressable>
          </View>
          <Text style={[type.small, styles.hint]}>Choose up to {MAX_IMPORT} posts at a time. Photos and carousels only; videos stay on Instagram.</Text>
          <FlatList
            data={posts}
            keyExtractor={(p) => p.id}
            numColumns={COLS}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.grid}
            onEndReached={() => {
              if (media.hasNextPage && !media.isFetchingNextPage) void media.fetchNextPage();
            }}
            ListEmptyComponent={
              media.isPending ? (
                <ActivityIndicator color={colors.ink} />
              ) : media.isError ? (
                <Text style={type.bodyMuted}>{friendlyError(media.error)}</Text>
              ) : (
                <Text style={type.bodyMuted}>No photos found on this account.</Text>
              )
            }
            renderItem={({ item }) => {
              const on = picked.includes(item.id);
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: item.imported }}
                  accessibilityLabel={`${item.caption?.slice(0, 60) ?? 'Instagram post'}${item.imported ? ', already imported' : ''}`}
                  disabled={item.imported}
                  onPress={() => toggle(item.id)}
                >
                  <Image source={{ uri: item.thumbnail }} style={[{ width: size, height: size }, styles.tile, item.imported && styles.dim]} contentFit="cover" />
                  {item.images.length > 1 ? (
                    <Feather name="copy" size={14} color={colors.onInk} style={styles.multi} />
                  ) : null}
                  {on ? (
                    <View style={styles.check}>
                      <Feather name="check" size={14} color={colors.onInk} />
                    </View>
                  ) : null}
                  {item.imported ? <Text style={styles.importedTag}>Imported</Text> : null}
                </Pressable>
              );
            }}
          />
          <View style={styles.footer}>
            <Button
              label={picked.length ? `Import ${picked.length} ${picked.length === 1 ? 'post' : 'posts'}` : 'Select posts to import'}
              onPress={startImport}
              disabled={!picked.length}
              loading={run.isPending}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  loading: { marginVertical: space.xl },
  intro: { padding: space.lg, gap: space.lg },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg },
  who: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  disconnect: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  hint: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  grid: { paddingHorizontal: space.lg, paddingBottom: 120, gap: 4 },
  gridRow: { gap: 4 },
  tile: { borderRadius: 2, backgroundColor: colors.wash },
  dim: { opacity: 0.35 },
  multi: { position: 'absolute', top: 6, right: 6 },
  check: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ultramarine,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.paper,
  },
  importedTag: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.ink,
    backgroundColor: colors.paper,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.tag,
  },
  footer: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.xl },
});

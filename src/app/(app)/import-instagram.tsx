import Feather from '@expo/vector-icons/Feather';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import type { ExportPost } from '@/features/instagram/export';
import {
  importedKeys,
  importPost,
  INSTAGRAM_DOWNLOAD_URL,
  MAX_IMPORT,
  openDownload,
  pickDownload,
  type OpenDownload,
} from '@/features/instagram/download';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';

const COLS = 3;

const STEPS = [
  {
    title: 'Ask Instagram for your posts',
    body: 'In Instagram: Accounts Center, then Your information and permissions, then Download your information. Choose Some of your information and pick your posts. Choose Download to device, set Format to JSON, Media quality to High and Date range to All time.',
  },
  {
    title: 'Wait for Instagram’s email',
    body: 'It usually takes from a few minutes to a day. Download the file from the email onto this phone.',
  },
  { title: 'Choose the file here', body: 'Then pick the posts you want on Locale.' },
];

// Bring your Instagram photos to Locale from the copy Instagram lets you
// download. The file is read on the phone; only the posts you pick are uploaded.
export default function ImportInstagram() {
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [download, setDownload] = useState<OpenDownload | null>(null);
  const [opening, setOpening] = useState(false);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const size = Math.floor((width - 2 * space.lg - (COLS - 1) * 4) / COLS);

  // Close the file and clear extracted photos when leaving or switching files.
  useEffect(() => () => download?.close(), [download]);

  async function choose() {
    const file = await pickDownload().catch(() => null);
    if (!file) return;
    setOpening(true);
    try {
      const d = await openDownload(file);
      setImported(await importedKeys(d.posts.map((p) => p.key)));
      setPicked([]);
      setDownload(d);
    } catch (e) {
      Alert.alert('Couldn’t open that file', friendlyError(e));
    } finally {
      setOpening(false);
    }
  }

  function toggle(key: string) {
    setPicked((p) => (p.includes(key) ? p.filter((x) => x !== key) : p.length < MAX_IMPORT ? [...p, key] : p));
  }

  async function startImport() {
    if (!download || !session) return;
    const chosen = download.posts.filter((p) => picked.includes(p.key));
    let added = 0;
    let failed = 0;
    let limited = false;
    setProgress({ done: 0, total: chosen.length });
    for (const post of chosen) {
      try {
        await importPost(session.user.id, download, post);
        added++;
        setImported((s) => new Set(s).add(post.key));
      } catch (e) {
        const code = e instanceof Error ? e.message : '';
        if (code === 'already_imported') setImported((s) => new Set(s).add(post.key));
        else if (code === 'post_rate_limited') {
          limited = true;
          break;
        } else failed++;
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setProgress(null);
    setPicked([]);
    void qc.invalidateQueries({ queryKey: ['feed'] });
    void qc.invalidateQueries({ queryKey: ['profile'] });
    Alert.alert(
      added ? `Imported ${added} ${added === 1 ? 'post' : 'posts'}` : 'Nothing was imported',
      limited
        ? 'You’ve reached today’s limit of 20 new posts. Import the rest tomorrow.'
        : failed
          ? `${failed} couldn’t be imported. Try those again.`
          : 'They’re on your profile with their original dates. Tag what’s in them so people can shop them.',
    );
  }

  const busy = !!progress;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10} disabled={busy}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Import from Instagram
        </Text>
      </View>

      {!download ? (
        <ScrollView contentContainerStyle={styles.intro}>
          <Text style={type.body}>
            Bring your Instagram photos to Locale. Download a copy of your posts from Instagram, then pick which ones to add.
            They keep their captions and original dates, so they don’t show up as new posts in your followers’ feeds.
          </Text>
          {STEPS.map((s, i) => (
            <View key={s.title} style={styles.step}>
              <Text style={styles.stepNumber} accessibilityElementsHidden importantForAccessibility="no">
                {i + 1}
              </Text>
              <View style={styles.stepText}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={type.small}>{s.body}</Text>
              </View>
            </View>
          ))}
          <Button label="Open Instagram’s download page" variant="secondary" onPress={() => void Linking.openURL(INSTAGRAM_DOWNLOAD_URL)} />
          <Button label="Choose download file" onPress={() => void choose()} loading={opening} />
          <Text style={type.small}>
            Locale reads the file on your phone and uploads only the posts you pick. Works with any Instagram account.
          </Text>
        </ScrollView>
      ) : (
        <>
          <View style={styles.bar}>
            <Text style={styles.count}>
              {download.posts.length} photo {download.posts.length === 1 ? 'post' : 'posts'}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void choose()} hitSlop={8} disabled={busy}>
              <Text style={styles.link}>Choose another file</Text>
            </Pressable>
          </View>
          <Text style={[type.small, styles.hint]}>
            Choose up to {MAX_IMPORT} at a time.
            {download.videosSkipped ? ` ${download.videosSkipped} video ${download.videosSkipped === 1 ? 'post stays' : 'posts stay'} on Instagram.` : ''}
          </Text>
          <FlatList
            data={download.posts}
            keyExtractor={(p) => p.key}
            numColumns={COLS}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.grid}
            initialNumToRender={18}
            ListEmptyComponent={<Text style={type.bodyMuted}>There are no photo posts in this file.</Text>}
            renderItem={({ item }) => (
              <Tile
                post={item}
                download={download}
                size={size}
                on={picked.includes(item.key)}
                done={imported.has(item.key)}
                disabled={busy}
                onPress={() => toggle(item.key)}
              />
            )}
          />
          <View style={styles.footer}>
            <Button
              label={
                progress
                  ? `Importing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : picked.length
                    ? `Import ${picked.length} ${picked.length === 1 ? 'post' : 'posts'}`
                    : 'Select posts to import'
              }
              onPress={() => void startImport()}
              disabled={!picked.length || busy}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

// Photos come out of the zip one at a time, so a long grid doesn't read
// dozens of files at once.
let extracting: Promise<unknown> = Promise.resolve();

function Tile({
  post,
  download,
  size,
  on,
  done,
  disabled,
  onPress,
}: {
  post: ExportPost;
  download: OpenDownload;
  size: number;
  on: boolean;
  done: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const job = extracting.then(() => (alive.current ? download.photoUri(post.photos[0]) : null));
    extracting = job.catch(() => undefined);
    job.then((u) => alive.current && u && setUri(u)).catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [download, post]);
  const date = new Date(post.takenAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: done || disabled }}
      accessibilityLabel={`${post.caption?.slice(0, 60) ?? 'Instagram post'}, ${date}${done ? ', already imported' : ''}`}
      disabled={done || disabled}
      onPress={onPress}
    >
      <View style={[{ width: size, height: size }, styles.tile, done && styles.dim]}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      {post.photos.length > 1 ? <Feather name="copy" size={14} color={colors.onInk} style={styles.multi} /> : null}
      {on ? (
        <View style={styles.check}>
          <Feather name="check" size={14} color={colors.onInk} />
        </View>
      ) : null}
      {done ? <Text style={styles.importedTag}>Imported</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  intro: { padding: space.lg, gap: space.lg },
  step: { flexDirection: 'row', gap: space.md },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.ink,
    color: colors.onInk,
    textAlign: 'center',
    lineHeight: 26,
    fontFamily: fonts.semibold,
    fontSize: 13,
    overflow: 'hidden',
  },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg },
  count: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  link: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  hint: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  grid: { paddingHorizontal: space.lg, paddingBottom: 120, gap: 4 },
  gridRow: { gap: 4 },
  tile: { borderRadius: 2, backgroundColor: colors.wash, overflow: 'hidden' },
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

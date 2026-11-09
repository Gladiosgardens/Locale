import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, ErrorText, Field } from '@/components/ui';
import type { Detection, DetectedItem, DraftTag, PickedPhoto, ShopMatch } from '@/features/posts/api';
import { friendlyError } from '@/lib/errors';
import { checkItemLink, formatPrice, parsePriceCents } from './link';
import { fonts, radius, space } from '@/theme';

export const MAX_TAGS_PER_PHOTO = 5;
const DOT = 26;
const EMPTY_FORM = { title: '', brand: '', store: '', url: '', price: '', affiliate: false };

type Props = {
  photo: PickedPhoto | null;
  mediaIndex: number;
  tags: DraftTag[];
  /** How many more tags the whole post can take. */
  remainingForPost: number;
  onChange: (tags: DraftTag[]) => void;
  onClose: () => void;
  /** Finds items in the photo automatically. Omitted for videos and when shopping is off. */
  onDetect?: () => Promise<Detection>;
};

/**
 * Detection gives positions on the whole photo; tags are placed on the frame the
 * photo is shown in, which crops very tall photos (contentFit "cover"). Convert.
 */
export function toFramePoint(p: { x: number; y: number }, photo: { width: number; height: number }, frameW: number, frameH: number) {
  const scale = Math.max(frameW / photo.width, frameH / photo.height);
  const offX = (photo.width * scale - frameW) / 2;
  const offY = (photo.height * scale - frameH) / 2;
  const clamp = (v: number) => Math.min(Math.max(v, 0.02), 0.98);
  return { x: clamp((p.x * photo.width * scale - offX) / frameW), y: clamp((p.y * photo.height * scale - offY) / frameH) };
}

export function TagEditor({ photo, mediaIndex, tags, remainingForPost, onChange, onClose, onDetect }: Props) {
  const { width: screen } = useWindowDimensions();
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [suggestions, setSuggestions] = useState<DetectedItem[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picking, setPicking] = useState<DetectedItem | null>(null);

  const width = screen;
  const height = photo ? Math.min(Math.round((screen * photo.height) / photo.width), Math.round(screen * 1.25)) : 0;
  const canAdd = tags.length < MAX_TAGS_PER_PHOTO && remainingForPost > 0;
  const link = form.url.trim() ? checkItemLink(form.url) : null;

  function startAt(x: number, y: number) {
    if (!canAdd) return;
    setPending({ x: Math.min(Math.max(x / width, 0), 1), y: Math.min(Math.max(y / height, 0), 1) });
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function detect() {
    if (!onDetect) return;
    setDetecting(true);
    setError(null);
    try {
      const found = await onDetect();
      setSuggestions(found.items);
      setNote(found.note ?? null);
    } catch (e) {
      // Development builds also show the technical reason, to help set things up.
      const detail = __DEV__ ? (e as { detail?: string }).detail : undefined;
      setError(detail ? `${friendlyError(e)}\n\n${detail}` : friendlyError(e));
    } finally {
      setDetecting(false);
    }
  }

  // Turn a suggestion into a tag: with a chosen match, or as a name only.
  function accept(s: DetectedItem, match: ShopMatch | null) {
    if (!photo || !canAdd) return;
    const at = toFramePoint(s, photo, width, height);
    const tag: DraftTag = {
      media: mediaIndex,
      ...at,
      item: {
        title: s.name.slice(0, 80),
        ...(match?.store ? { store_name: match.store.slice(0, 60) } : {}),
        ...(match ? { url: match.url } : {}),
        ...(match?.priceCents != null && match.currency ? { price_cents: match.priceCents, currency: match.currency } : {}),
      },
    };
    onChange([...tags, tag]);
    setSuggestions((prev) => (prev ?? []).filter((x) => x !== s));
    setPicking(null);
  }

  function save() {
    if (!pending) return;
    const title = form.title.trim();
    if (!title) return setError('Give the item a name.');
    if (link && !link.ok) return setError(friendlyError(new Error(link.error)));
    const cents = parsePriceCents(form.price);
    if (Number.isNaN(cents)) return setError('Enter a price like 24.99.');

    const tag: DraftTag = {
      media: mediaIndex,
      x: pending.x,
      y: pending.y,
      item: {
        title,
        ...(form.brand.trim() ? { brand: form.brand.trim() } : {}),
        ...(form.store.trim() ? { store_name: form.store.trim() } : {}),
        ...(link?.ok ? { url: form.url.trim(), is_affiliate: form.affiliate } : {}),
        ...(cents != null ? { price_cents: cents, currency: 'USD' } : {}),
      },
    };
    onChange([...tags, tag]);
    setPending(null);
  }

  return (
    <Modal visible={!!photo} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Tag items</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {photo ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tap the photo where the item is"
                onPress={(e) => startAt(e.nativeEvent.locationX, e.nativeEvent.locationY)}
              >
                <Image source={photo.thumbnail ?? { uri: photo.uri }} style={{ width, height }} contentFit="cover" />
                {[...tags.map((t) => ({ x: t.x, y: t.y, key: `${t.x}-${t.y}`, pending: false })),
                  ...(pending ? [{ ...pending, key: 'pending', pending: true }] : [])].map((d, i) => (
                  <View
                    key={d.key}
                    pointerEvents="none"
                    style={[styles.dot, d.pending && styles.dotPending, { left: d.x * width - DOT / 2, top: d.y * height - DOT / 2 }]}
                  >
                    <Text style={styles.dotText}>{d.pending ? '+' : i + 1}</Text>
                  </View>
                ))}
                {photo
                  ? (suggestions ?? []).map((sg) => {
                      const at = toFramePoint(sg, photo, width, height);
                      return (
                        <View
                          key={`s-${sg.name}-${sg.x}`}
                          pointerEvents="none"
                          style={[styles.suggestDot, { left: at.x * width - DOT / 2, top: at.y * height - DOT / 2 }]}
                        />
                      );
                    })
                  : null}
              </Pressable>
            ) : null}

            <View style={styles.panel}>
              {picking ? (
                <>
                  <Text style={styles.pickTitle}>{picking.name}</Text>
                  <Text style={styles.hint}>
                    {picking.matches.length
                      ? 'Pick the closest match. You can change the name later by removing and re-adding the tag.'
                      : 'We didn’t find a shop for this one. You can still tag it by name.'}
                  </Text>
                  {picking.matches.map((m) => (
                    <Pressable
                      key={m.url}
                      accessibilityRole="button"
                      accessibilityLabel={[m.title, m.store, m.priceCents != null && m.currency ? formatPrice(m.priceCents, m.currency) : null]
                        .filter(Boolean)
                        .join(', ')}
                      onPress={() => accept(picking, m)}
                      style={({ pressed }) => [styles.match, pressed && styles.pressed]}
                    >
                      <Image source={m.thumbnail ? { uri: m.thumbnail } : undefined} style={styles.matchImage} contentFit="cover" />
                      <View style={styles.matchText}>
                        <Text style={styles.matchTitle} numberOfLines={2}>
                          {m.title}
                        </Text>
                        <Text style={styles.matchMeta} numberOfLines={1}>
                          {m.store ?? m.host}
                        </Text>
                        {m.priceCents != null && m.currency ? (
                          <Text style={styles.matchPrice}>{formatPrice(m.priceCents, m.currency)}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                  <Button label="Tag it without a link" variant="secondary" onPress={() => accept(picking, null)} />
                  <Button label="Back" variant="quiet" onPress={() => setPicking(null)} />
                </>
              ) : pending ? (
                <>
                  <Field label="Item name" value={form.title} onChangeText={(title) => setForm({ ...form, title })} maxLength={80} placeholder="Linen sofa" autoFocus />
                  <Field label="Brand (optional)" value={form.brand} onChangeText={(brand) => setForm({ ...form, brand })} maxLength={60} />
                  <Field label="Store (optional)" value={form.store} onChangeText={(store) => setForm({ ...form, store })} maxLength={60} />
                  <Field
                    label="Link to buy (optional)"
                    value={form.url}
                    onChangeText={(url) => setForm({ ...form, url })}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    placeholder="https://"
                  />
                  {link?.ok ? <Text style={styles.host}>Opens {link.host}</Text> : null}
                  {link?.ok ? (
                    <View style={styles.row}>
                      <Switch
                        accessibilityLabel="I may earn from this link"
                        value={form.affiliate}
                        onValueChange={(affiliate) => setForm({ ...form, affiliate })}
                      />
                      <Text style={styles.rowText}>I may earn from this link (affiliate)</Text>
                    </View>
                  ) : null}
                  <Field label="Price in USD (optional)" value={form.price} onChangeText={(price) => setForm({ ...form, price })} keyboardType="decimal-pad" placeholder="24.99" />
                  <ErrorText>{error}</ErrorText>
                  <Button label="Add tag" onPress={save} />
                  <Button label="Cancel" variant="secondary" onPress={() => setPending(null)} />
                </>
              ) : (
                <>
                  {onDetect && suggestions === null ? (
                    <Button
                      label={detecting ? 'Looking for items…' : 'Find items automatically'}
                      onPress={detect}
                      loading={detecting}
                      disabled={!canAdd}
                    />
                  ) : null}
                  {detecting ? <ActivityIndicator color={colors.ink} /> : null}
                  {suggestions && suggestions.length ? (
                    <View style={styles.suggestions}>
                      <Text style={styles.suggestTitle}>
                        {suggestions.length === 1 ? 'We found 1 item' : `We found ${suggestions.length} items`}
                      </Text>
                      {suggestions.map((sg) => (
                        <Pressable
                          key={`row-${sg.name}-${sg.x}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${sg.name}, ${sg.matches.length} matches`}
                          onPress={() => setPicking(sg)}
                          disabled={!canAdd}
                          style={({ pressed }) => [styles.suggestRow, pressed && styles.pressed]}
                        >
                          <View style={styles.suggestRing} />
                          <Text style={styles.tagText}>{sg.name}</Text>
                          <Text style={styles.matchMeta}>
                            {sg.matches.length ? `${sg.matches.length} matches` : 'No shop found'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : suggestions ? (
                    <Text style={styles.hint}>We didn’t spot anything to tag. Tap the photo to tag items by hand.</Text>
                  ) : null}
                  {__DEV__ && note ? <Text style={styles.hint}>Shop lookup: {note}</Text> : null}
                  {error && !pending ? <ErrorText>{error}</ErrorText> : null}
                  <Text style={styles.hint}>
                    {canAdd
                      ? 'Tap the photo where an item is to tag it.'
                      : tags.length >= MAX_TAGS_PER_PHOTO
                        ? `That’s the maximum of ${MAX_TAGS_PER_PHOTO} tags for this photo.`
                        : 'That’s the maximum of 20 tags for this post.'}
                  </Text>
                  {tags.map((t, i) => {
                    const tagLink = t.item.url ? checkItemLink(t.item.url) : null;
                    return (
                    <View key={`${t.x}-${t.y}`} style={styles.tagRow}>
                      <Text style={styles.tagText}>
                        {i + 1}. {t.item.title}
                        {tagLink?.ok ? `  ·  ${tagLink.host}` : ''}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${t.item.title}`}
                        onPress={() => onChange(tags.filter((x) => x !== t))}
                        hitSlop={8}
                      >
                        <Text style={styles.remove}>Remove</Text>
                      </Pressable>
                    </View>
                    );
                  })}
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17, color: colors.text },
  done: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 16, },
  body: { paddingBottom: 40 },
  panel: { padding: 16, gap: 12 },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPending: { backgroundColor: 'rgba(0,0,0,0.55)' },
  dotText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 12, },
  host: { color: colors.muted, fontFamily: fonts.body, fontSize: 13, marginTop: -6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text },
  hint: { color: colors.muted, fontFamily: fonts.body, fontSize: 15  },
  tagRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tagText: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text },
  remove: { color: colors.danger, fontFamily: fonts.body, fontSize: 14  },
  pressed: { opacity: 0.7 },
  suggestDot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: colors.paper,
    backgroundColor: 'rgba(35,56,200,0.55)',
  },
  suggestions: { gap: 2 },
  suggestTitle: { fontFamily: fonts.displayItalic, fontSize: 19, color: colors.ink, marginBottom: space.xs },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  suggestRing: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.ultramarine },
  pickTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  match: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.sm },
  matchImage: { width: 56, height: 56, borderRadius: radius.tag, backgroundColor: colors.wash },
  matchText: { flex: 1, gap: 2 },
  matchTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  matchMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  matchPrice: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ultramarine },
});

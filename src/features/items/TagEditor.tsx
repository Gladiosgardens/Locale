import { Image } from 'expo-image';
import { useState } from 'react';
import {
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
import type { DraftTag, PickedPhoto } from '@/features/posts/api';
import { friendlyError } from '@/lib/errors';
import { checkItemLink, parsePriceCents } from './link';

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
};

export function TagEditor({ photo, mediaIndex, tags, remainingForPost, onChange, onClose }: Props) {
  const { width: screen } = useWindowDimensions();
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

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
                <Image source={{ uri: photo.uri }} style={{ width, height }} contentFit="cover" />
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
              </Pressable>
            ) : null}

            <View style={styles.panel}>
              {pending ? (
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
  title: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.text },
  done: { color: colors.accent, fontSize: 16, fontWeight: '600' },
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
  dotText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  host: { color: colors.muted, fontSize: 13, marginTop: -6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, fontSize: 15, color: colors.text },
  hint: { color: colors.muted, fontSize: 15 },
  tagRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tagText: { flex: 1, fontSize: 15, color: colors.text },
  remove: { color: colors.danger, fontSize: 14 },
});

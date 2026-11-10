import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { ItemSheet } from '@/features/items/ItemSheet';
import { formatPrice } from '@/features/items/link';
import type { Item } from '@/features/posts/api';
import { useFeed, useFilteredFeed } from '@/features/posts/hooks';
import { PostGrid } from '@/features/posts/PostGrid';
import type { SavedItem } from '@/features/social/api';
import { CollectionNameSheet } from '@/features/social/CollectionSheet';
import {
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useRenameCollection,
  useSaveItem,
  useSavedItems,
} from '@/features/social/hooks';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';

function SavedItemRow({ s, onOpen }: { s: SavedItem; onOpen: () => void }) {
  const save = useSaveItem();
  const tagged = s.item.priceCents != null && s.item.currency ? { priceCents: s.item.priceCents, currency: s.item.currency } : null;
  // The latest checked price beats the one tagged when posted.
  const shown = s.current ?? tagged;
  const price = shown ? formatPrice(shown.priceCents, shown.currency) : null;
  const was =
    s.current && tagged && tagged.currency === s.current.currency && s.current.priceCents < tagged.priceCents
      ? formatPrice(tagged.priceCents, tagged.currency)
      : null;
  const where = s.item.brand ?? s.item.storeName ?? s.item.urlHost;
  return (
    <View style={styles.itemRow}>
      <Pressable
        style={styles.itemMain}
        accessibilityRole="button"
        accessibilityLabel={[s.item.title, where, price, was ? `was ${was}` : null, s.inStock === false ? 'sold out' : null]
          .filter(Boolean)
          .join(', ')}
        onPress={onOpen}
      >
        <Image
          source={s.photoUrl ? { uri: s.photoUrl, cacheKey: s.photoPath ?? undefined } : undefined}
          style={styles.thumb}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
        <View style={styles.itemText}>
          {where ? <Text style={styles.brand}>{where}</Text> : null}
          <Text style={styles.title} numberOfLines={2}>
            {s.item.title}
          </Text>
          {price ? (
            <Text style={styles.price}>
              {price}
              {was ? <Text style={styles.was}> {was}</Text> : null}
            </Text>
          ) : null}
          {s.inStock === false ? <Text style={styles.soldOut}>Sold out. We’ll tell you when it’s back.</Text> : null}
        </View>
      </Pressable>
      <View style={styles.itemActions}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`See the post ${s.item.title} is from`}
          onPress={() => router.push(`/post/${s.postId}`)}
          hitSlop={8}
        >
          <Feather name="image" size={20} color={colors.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${s.item.title} from your wishlist`}
          onPress={() =>
            save.mutate(
              { itemId: s.item.id, postId: s.postId, saved: false },
              { onError: (e) => Alert.alert(friendlyError(e)) },
            )
          }
          hitSlop={8}
        >
          <Feather name="x" size={20} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

export default function Saved() {
  const [tab, setTab] = useState<'items' | 'posts'>('items');
  const items = useSavedItems();
  const allPosts = useFeed('saved', null);
  const collections = useCollections();
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const filter = useMemo(() => (collectionId ? { collectionId } : null), [collectionId]);
  const collectionPosts = useFilteredFeed(filter);
  const posts = collectionId ? collectionPosts : allPosts;
  const create = useCreateCollection();
  const rename = useRenameCollection();
  const remove = useDeleteCollection();
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const current = collections.data?.find((c) => c.id === collectionId);

  function manage(c: { id: string; name: string }) {
    Alert.alert(c.name, undefined, [
      { text: 'Rename', onPress: () => setNaming({ id: c.id, name: c.name }) },
      {
        text: 'Delete collection',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Delete ${c.name}?`, 'The posts stay in Saved.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () =>
                remove.mutate(c.id, {
                  onSuccess: () => setCollectionId(null),
                  onError: (e) => Alert.alert(friendlyError(e)),
                }),
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function saveName(name: string) {
    const done = { onSuccess: () => setNaming(null), onError: (e: unknown) => Alert.alert(friendlyError(e)) };
    if (naming?.id) rename.mutate({ id: naming.id, name }, done);
    else create.mutate(name, { ...done, onSuccess: (id) => (setNaming(null), setCollectionId(id)) });
  }
  const [open, setOpen] = useState<{ item: Item; postId: string } | null>(null);
  const list = useMemo(() => items.data?.pages.flat() ?? [], [items.data]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Saved
        </Text>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['items', 'posts'] as const).map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'items' ? 'Wishlist' : 'Posts'}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'items' ? (
        <FlatList
          data={list}
          keyExtractor={(s) => s.item.id}
          renderItem={({ item: s }) => <SavedItemRow s={s} onOpen={() => setOpen({ item: s.item, postId: s.postId })} />}
          onEndReached={() => {
            if (items.hasNextPage && !items.isFetchingNextPage) void items.fetchNextPage();
          }}
          ListEmptyComponent={
            items.isPending ? (
              <ActivityIndicator style={styles.loading} color={colors.ink} />
            ) : items.isError ? (
              <View style={styles.empty}>
                <Text style={type.bodyMuted}>We couldn’t load your wishlist.</Text>
                <Button label="Try again" variant="secondary" onPress={() => items.refetch()} />
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={type.bodyMuted}>
                  Tap a tagged item in any post and choose Save to wishlist. It shows up here with where to buy it.
                </Text>
              </View>
            )
          }
        />
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipBar}
            contentContainerStyle={styles.chips}
            accessibilityLabel="Collections"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: collectionId === null }}
              onPress={() => setCollectionId(null)}
              style={[styles.chip, collectionId === null && styles.chipActive]}
            >
              <Text style={[styles.chipText, collectionId === null && styles.chipTextActive]}>All posts</Text>
            </Pressable>
            {(collections.data ?? []).map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityState={{ selected: collectionId === c.id }}
                accessibilityLabel={`${c.name}, ${c.postCount} ${c.postCount === 1 ? 'post' : 'posts'}`}
                accessibilityHint="Long press to rename or delete"
                onPress={() => setCollectionId(c.id)}
                onLongPress={() => manage(c)}
                style={[styles.chip, collectionId === c.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, collectionId === c.id && styles.chipTextActive]}>{c.name}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New collection"
              onPress={() => setNaming({ id: null, name: '' })}
              style={styles.chip}
            >
              <Feather name="plus" size={16} color={colors.ink} />
            </Pressable>
          </ScrollView>
          {current ? (
            <Pressable accessibilityRole="button" onPress={() => manage(current)} style={styles.manage} hitSlop={6}>
              <Text style={styles.manageText}>Rename or delete {current.name}</Text>
            </Pressable>
          ) : null}
          <PostGrid
            query={posts}
            layout="square"
            empty={
              posts.isPending ? (
                <ActivityIndicator style={styles.loading} color={colors.ink} />
              ) : (
                <View style={styles.empty}>
                  <Text style={type.bodyMuted}>
                    {collectionId
                      ? 'Nothing here yet. Open a post’s ••• menu and choose Save to collection.'
                      : 'Tap the bookmark under any post to save it here.'}
                  </Text>
                </View>
              )
            }
          />
        </>
      )}
      <CollectionNameSheet
        visible={!!naming}
        title={naming?.id ? 'Rename collection' : 'New collection'}
        initial={naming?.name}
        saving={create.isPending || rename.isPending}
        onSave={saveName}
        onClose={() => setNaming(null)}
      />
      <ItemSheet item={open?.item ?? null} postId={open?.postId} onClose={() => setOpen(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  was: { fontFamily: fonts.body, color: colors.muted, textDecorationLine: 'line-through' },
  soldOut: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  screen: { flex: 1, backgroundColor: colors.paper },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  tabs: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.wash },
  tabActive: { backgroundColor: colors.ink },
  tabText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  tabTextActive: { color: colors.onInk },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 72, height: 90, borderRadius: radius.tag, backgroundColor: colors.wash },
  itemText: { flex: 1, gap: 2 },
  brand: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  price: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ultramarine },
  itemActions: { gap: space.lg, alignItems: 'center' },
  chipBar: { flexGrow: 0 },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  chipTextActive: { color: colors.onInk },
  manage: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  manageText: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  loading: { marginVertical: space.xl },
  empty: { padding: space.xl, gap: space.md },
});

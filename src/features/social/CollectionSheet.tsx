import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, radius, space, type } from '@/theme';
import {
  MAX_COLLECTION_NAME,
  useCollections,
  useCreateCollection,
  usePostCollections,
  useSetInCollection,
} from './hooks';

// A name field for creating or renaming a collection.
export function CollectionNameSheet({
  visible,
  title,
  initial = '',
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial?: string;
  saving: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {visible ? <NameForm title={title} initial={initial} saving={saving} onSave={onSave} onClose={onClose} /> : null}
    </Modal>
  );
}

function NameForm({
  title,
  initial,
  saving,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  saving: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.sheet} accessibilityViewIsModal>
        <Text style={type.title} accessibilityRole="header">
          {title}
        </Text>
        <TextInput
          accessibilityLabel="Collection name"
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={MAX_COLLECTION_NAME}
          placeholder="Desk ideas, Summer looks…"
          placeholderTextColor={colors.muted}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => name.trim() && onSave(name)}
        />
        <Button label="Save collection" onPress={() => onSave(name)} disabled={!name.trim()} loading={saving} />
        <Button label="Cancel" variant="quiet" onPress={onClose} />
      </View>
    </KeyboardAvoidingView>
  );
}

// "Save to collection" for one post: tick the collections it belongs in, or make a new one.
export function CollectionSheet({ postId, onClose }: { postId: string | null; onClose: () => void }) {
  return (
    <Modal visible={!!postId} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {postId ? <Picker key={postId} postId={postId} onClose={onClose} /> : null}
    </Modal>
  );
}

function Picker({ postId, onClose }: { postId: string; onClose: () => void }) {
  const collections = useCollections();
  const inIds = usePostCollections(postId);
  const setIn = useSetInCollection();
  const create = useCreateCollection();
  const [naming, setNaming] = useState(false);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const fail = (e: unknown) => Alert.alert(friendlyError(e));

  const isIn = (id: string) => local[id] ?? inIds.data?.includes(id) ?? false;

  function toggle(id: string) {
    const next = !isIn(id);
    setLocal((m) => ({ ...m, [id]: next }));
    setIn.mutate(
      { collectionId: id, postId, inIt: next },
      { onError: (e) => (setLocal((m) => ({ ...m, [id]: !next })), fail(e)) },
    );
  }

  const close = onClose;

  // Naming a new collection swaps the list for a name field in the same sheet.
  if (naming) {
    return (
      <NameForm
        title="New collection"
        initial=""
        saving={create.isPending}
        onClose={() => setNaming(false)}
        onSave={(name) =>
          create.mutate(name, {
            onSuccess: (id) => {
              setNaming(false);
              toggle(id);
            },
            onError: fail,
          })
        }
      />
    );
  }

  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <Text style={type.title} accessibilityRole="header">
        Save to collection
      </Text>
      {collections.isPending ? <ActivityIndicator color={colors.ink} /> : null}
      <ScrollView style={styles.list}>
        {(collections.data ?? []).map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isIn(c.id) }}
            accessibilityLabel={c.name}
            onPress={() => toggle(c.id)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Image source={c.coverUrl ? { uri: c.coverUrl } : undefined} style={styles.cover} contentFit="cover" />
            <Text style={styles.name} numberOfLines={1}>
              {c.name}
            </Text>
            <Feather name={isIn(c.id) ? 'check-circle' : 'circle'} size={22} color={colors.ink} />
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New collection"
        onPress={() => setNaming(true)}
        style={styles.row}
      >
        <View style={[styles.cover, styles.newCover]}>
          <Feather name="plus" size={20} color={colors.ink} />
        </View>
        <Text style={styles.name}>New collection</Text>
      </Pressable>
      <Button label="Done" variant="quiet" onPress={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: space.xl,
    paddingBottom: 40,
    gap: space.md,
  },
  list: { maxHeight: 320 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  pressed: { opacity: 0.7 },
  cover: { width: 48, height: 48, borderRadius: radius.tag, backgroundColor: colors.wash },
  newCover: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },
  name: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: colors.ink },
  input: {
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
});

import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText } from '@/components/ui';
import type { Answer } from '@/features/answers/api';
import { useAcceptAnswer, useAnswers, useDeleteAnswer, useSetAsking, useSubmitAnswer } from '@/features/answers/hooks';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatPrice } from '@/features/items/link';
import { usePost } from '@/features/posts/hooks';
import { UserAvatar } from '@/features/profiles/UserAvatar';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space, type } from '@/theme';

// "Where's this from?": answers on one post, and a form to suggest one.
export default function Answers() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { session } = useAuth();
  const post = usePost(postId);
  const answers = useAnswers(postId);
  const accept = useAcceptAnswer(postId);
  const remove = useDeleteAnswer(postId);
  const setAsking = useSetAsking(postId);
  const p = post.data;
  const isAuthor = !!p && p.author.id === session?.user.id;
  const fail = (e: unknown) => Alert.alert(friendlyError(e));

  function confirmAccept(a: Answer) {
    Alert.alert(
      `Add “${a.title}” to your post?`,
      `It’s tagged on your photo, and @${a.answerer.handle} earns from sales through it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add to post', onPress: () => accept.mutate(a.id, { onError: fail }) },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Where’s this from?
        </Text>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {p ? (
            <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${p.id}`)} style={styles.head}>
              <Image
                source={p.media[0]?.url ? { uri: p.media[0].url } : undefined}
                style={styles.photo}
                contentFit="cover"
              />
              <View style={styles.flex}>
                <Text style={styles.who}>@{p.author.handle}</Text>
                {p.caption ? (
                  <Text style={type.small} numberOfLines={3}>
                    {p.caption}
                  </Text>
                ) : null}
                <Text style={styles.state}>{p.asking ? 'Still looking' : 'Found it'}</Text>
              </View>
            </Pressable>
          ) : post.isPending ? (
            <ActivityIndicator color={colors.ink} />
          ) : null}

          {isAuthor && p ? (
            <Button
              label={p.asking ? 'Found it: stop asking' : 'Ask again'}
              variant="secondary"
              onPress={() => setAsking.mutate(!p.asking, { onError: fail })}
              loading={setAsking.isPending}
            />
          ) : null}

          <Text style={styles.section}>Answers</Text>
          {answers.isPending ? <ActivityIndicator color={colors.ink} /> : null}
          {answers.data?.length === 0 ? (
            <Text style={type.bodyMuted}>
              {isAuthor
                ? 'No answers yet. People who know will suggest where it’s from.'
                : 'No answers yet. Know where it’s from?'}
            </Text>
          ) : null}
          {(answers.data ?? []).map((a) => (
            <View key={a.id} style={[styles.answer, a.accepted && styles.accepted]}>
              <View style={styles.answerHead}>
                <UserAvatar userId={a.answerer.id} name={a.answerer.displayName} size={28} />
                <Text style={styles.who}>@{a.answerer.handle}</Text>
                <Text style={styles.time}>{timeAgo(a.createdAt)}</Text>
              </View>
              <Text style={styles.title}>{a.title}</Text>
              <Text style={styles.meta}>
                {[
                  a.storeName,
                  a.urlHost,
                  a.priceCents != null && a.currency ? formatPrice(a.priceCents, a.currency) : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
              {a.note ? <Text style={type.small}>{a.note}</Text> : null}
              {a.accepted ? <Text style={styles.badge}>Added to the post</Text> : null}
              <View style={styles.answerActions}>
                {a.url ? (
                  <Button
                    label={`Open ${a.urlHost}`}
                    variant="quiet"
                    style={styles.small}
                    onPress={() => void WebBrowser.openBrowserAsync(a.url!, { dismissButtonStyle: 'close' })}
                  />
                ) : null}
                {a.canAccept ? (
                  <Button label="Add to post" style={styles.small} onPress={() => confirmAccept(a)} />
                ) : null}
                {!a.accepted && (a.isMine || isAuthor) ? (
                  <Button
                    label={a.isMine ? 'Withdraw' : 'Dismiss'}
                    variant="quiet"
                    style={styles.small}
                    onPress={() => remove.mutate(a.id, { onError: fail })}
                  />
                ) : null}
              </View>
            </View>
          ))}

          {p && p.asking && !isAuthor ? <AnswerForm postId={p.id} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AnswerForm({ postId }: { postId: string }) {
  const submit = useSubmitAnswer(postId);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [store, setStore] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function send() {
    setError(null);
    const cleaned = price.replace(/[^0-9.]/g, '');
    const priceCents = cleaned ? Math.round(parseFloat(cleaned) * 100) : null;
    if (!title.trim()) return setError('Say what it is, e.g. “Brass mushroom lamp”.');
    if (!url.trim() && !store.trim()) return setError('Add a link or the store’s name.');
    submit.mutate(
      { title, url, storeName: store, priceCents: Number.isFinite(priceCents) ? priceCents : null, note },
      {
        onSuccess: () => {
          setTitle('');
          setUrl('');
          setStore('');
          setPrice('');
          setNote('');
        },
        onError: (e) => setError(friendlyError(e)),
      },
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.section}>Know where it’s from?</Text>
      <Text style={type.small}>If the poster adds your answer, you earn from sales through it.</Text>
      <TextInput
        accessibilityLabel="What it is"
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="What it is"
        placeholderTextColor={colors.muted}
        maxLength={80}
      />
      <TextInput
        accessibilityLabel="Link to the item"
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="Link (https://…)"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Store"
          style={[styles.input, styles.flex]}
          value={store}
          onChangeText={setStore}
          placeholder="Store"
          placeholderTextColor={colors.muted}
          maxLength={60}
        />
        <TextInput
          accessibilityLabel="Price in US dollars"
          style={[styles.input, styles.price]}
          value={price}
          onChangeText={setPrice}
          placeholder="Price $"
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
        />
      </View>
      <TextInput
        accessibilityLabel="Note"
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional)"
        placeholderTextColor={colors.muted}
        maxLength={300}
      />
      <ErrorText>{error}</ErrorText>
      <Button label="Send answer" onPress={send} loading={submit.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  head: { flexDirection: 'row', gap: space.md },
  photo: { width: 96, height: 120, borderRadius: radius.tag, backgroundColor: colors.wash },
  who: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  state: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ultramarine, marginTop: 4 },
  section: { fontFamily: fonts.displayItalic, fontSize: 19, color: colors.ink, marginTop: space.sm },
  answer: { gap: 4, padding: space.md, borderRadius: radius.tag, borderWidth: 1, borderColor: colors.hairline },
  accepted: { borderColor: colors.ultramarine },
  answerHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  title: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  badge: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ultramarine },
  answerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 4 },
  small: { paddingVertical: 8, paddingHorizontal: space.md },
  form: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  input: {
    backgroundColor: colors.wash,
    borderRadius: radius.tag,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  price: { width: 110 },
});

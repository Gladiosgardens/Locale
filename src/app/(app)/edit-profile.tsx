import Feather from '@expo/vector-icons/Feather';
import { useQueryClient } from '@tanstack/react-query';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, ErrorText, Field } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { uploadPhoto } from '@/features/posts/api';
import { setAvatar, updateProfile } from '@/features/profiles/api';
import { useAvatarUrl } from '@/features/profiles/avatars';
import { useProfile } from '@/features/profiles/hooks';
import { friendlyError } from '@/lib/errors';
import { colors, fonts, space, type } from '@/theme';

const MAX_BIO = 300;
const AVATAR_PX = 640;

export default function EditProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const profile = useProfile(userId);
  const photo = useAvatarUrl(userId);
  const [form, setForm] = useState<{ displayName: string; handle: string; bio: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = profile.data;
  const values = form ?? { displayName: p?.displayName ?? '', handle: p?.handle ?? '', bio: p?.bio ?? '' };

  function refresh() {
    qc.invalidateQueries({ queryKey: ['avatar', userId] });
    qc.invalidateQueries({ queryKey: ['profile', userId] });
    qc.invalidateQueries({ queryKey: ['my-profile'] });
    qc.invalidateQueries({ queryKey: ['feed'] });
  }

  async function changePhoto() {
    if (!userId) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1, exif: false });
    if (picked.canceled) return;
    setPhotoBusy(true);
    try {
      const a = picked.assets[0];
      const side = Math.min(a.width, a.height);
      const ctx = ImageManipulator.manipulate(a.uri);
      ctx.crop({ originX: (a.width - side) / 2, originY: (a.height - side) / 2, width: side, height: side });
      ctx.resize({ width: AVATAR_PX, height: AVATAR_PX });
      const image = await ctx.renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      const path = await uploadPhoto(userId, saved.uri);
      await setAvatar(path);
      refresh();
    } catch (e) {
      Alert.alert(friendlyError(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  function removePhoto() {
    Alert.alert('Remove your profile photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setPhotoBusy(true);
          try {
            await setAvatar(null);
            refresh();
          } catch (e) {
            Alert.alert(friendlyError(e));
          } finally {
            setPhotoBusy(false);
          }
        },
      },
    ]);
  }

  async function save() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile(userId, values);
      refresh();
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  if (!p) {
    return (
      <SafeAreaView style={styles.screen}>
        <ActivityIndicator style={styles.loading} color={colors.ink} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={type.title} accessibilityRole="header">
          Edit profile
        </Text>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.photoRow}>
            <Avatar name={values.displayName || p.displayName} size={96} uri={photo} />
            <View style={styles.photoActions}>
              {photoBusy ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <>
                  <Pressable accessibilityRole="button" onPress={changePhoto} hitSlop={6}>
                    <Text style={styles.link}>{photo ? 'Change photo' : 'Add a photo'}</Text>
                  </Pressable>
                  {photo ? (
                    <Pressable accessibilityRole="button" onPress={removePhoto} hitSlop={6}>
                      <Text style={styles.remove}>Remove photo</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          </View>
          <Field label="Name" value={values.displayName} maxLength={50} onChangeText={(displayName) => setForm({ ...values, displayName })} />
          <Field
            label="Username"
            value={values.handle}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(handle) => setForm({ ...values, handle })}
          />
          <Text style={type.small}>3–20 letters, numbers or underscores.</Text>
          <Field
            label="Bio"
            value={values.bio}
            maxLength={MAX_BIO}
            multiline
            onChangeText={(bio) => setForm({ ...values, bio })}
            placeholder="What you’re into, where you shop, what you make"
          />
          <Text style={styles.count}>{`${values.bio.length}/${MAX_BIO}`}</Text>
          <ErrorText>{error}</ErrorText>
          <Button label="Save" onPress={save} loading={saving} disabled={!values.displayName.trim() || !values.handle.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  loading: { marginTop: 48 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { padding: space.xl, gap: space.lg },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  photoActions: { gap: space.md },
  link: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ultramarine },
  remove: { fontFamily: fonts.medium, fontSize: 14, color: colors.danger },
  count: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: 'right', marginTop: -space.md },
});

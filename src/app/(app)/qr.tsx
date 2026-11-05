import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Wordmark } from '@/components/ui';
import { useMyProfile } from '@/features/onboarding/hooks';
import { profileLink, shareInvite } from '@/features/people/invite';
import { QrCode } from '@/features/people/QrCode';
import { colors, fonts, radius, space, type } from '@/theme';

// Your profile as a QR code, for adding each other in person: the other person
// points their phone camera at it and Locale opens on your profile.
export default function MyQrCode() {
  const me = useMyProfile();
  const { width } = useWindowDimensions();
  const handle = me.data?.handle;
  const size = Math.min(width - 96, 300);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} hitSlop={10}>
          <Feather name="x" size={26} color={colors.ink} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <View style={styles.card}>
          <Wordmark size={26} />
          {handle ? <QrCode value={profileLink(handle)} size={size} /> : <View style={{ width: size, height: size }} />}
          <View style={styles.names}>
            <Text style={styles.name}>{me.data?.display_name}</Text>
            <Text style={type.small}>@{handle}</Text>
          </View>
        </View>
        <Text style={[type.bodyMuted, styles.help]}>
          Friends can scan this with their phone’s camera to open your profile.
        </Text>
        {handle ? <Button label="Share profile link" onPress={() => void shareInvite(handle)} /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.wash },
  topbar: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: space.xl },
  card: {
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.paper,
    borderRadius: radius.sheet,
    paddingVertical: space.xl,
    paddingHorizontal: space.xl,
  },
  names: { alignItems: 'center', gap: 2 },
  name: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  help: { textAlign: 'center', maxWidth: 300 },
});

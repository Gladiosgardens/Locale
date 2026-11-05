import { useQuery } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native';
import { Button, Centered } from '@/components/ui';
import { profileIdByHandle } from '@/features/people/api';
import { colors, type } from '@/theme';

// Where invite links and QR codes land: locale://u/<handle>.
export default function ProfileByHandle() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const lookup = useQuery({ queryKey: ['handle', handle], queryFn: () => profileIdByHandle(handle ?? ''), enabled: !!handle });

  if (lookup.data) return <Redirect href={`/profile/${lookup.data}`} />;
  if (lookup.isPending) {
    return (
      <Centered>
        <ActivityIndicator color={colors.ink} />
      </Centered>
    );
  }
  return (
    <Centered>
      <Text style={type.bodyMuted}>
        {lookup.isError ? 'We couldn’t open this profile.' : `There’s nobody called @${handle} on Locale.`}
      </Text>
      <Button label="Go home" variant="secondary" onPress={() => router.replace('/home')} />
    </Centered>
  );
}

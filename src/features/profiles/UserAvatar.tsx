import { Avatar } from '@/components/ui';
import { useAvatarUrl } from './avatars';

/** A person's profile photo, or their initials until they add one. */
export function UserAvatar({ userId, name, size }: { userId: string | null | undefined; name: string; size?: number }) {
  return <Avatar name={name} size={size} uri={useAvatarUrl(userId)} />;
}

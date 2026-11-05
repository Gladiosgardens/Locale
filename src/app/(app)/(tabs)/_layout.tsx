import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConversations } from '@/features/messages/hooks';
import { colors, fonts } from '@/theme';

type IconName = keyof typeof Feather.glyphMap;

const TABS: Record<string, { label: string; icon: IconName }> = {
  home: { label: 'Home', icon: 'home' },
  explore: { label: 'Explore', icon: 'search' },
  create: { label: 'New post', icon: 'plus' },
  messages: { label: 'Messages', icon: 'message-circle' },
  me: { label: 'Profile', icon: 'user' },
};

const tap = () => {
  if (Platform.OS !== 'web') void Haptics.selectionAsync();
};

function useUnreadCount() {
  const inbox = useConversations(false);
  const requests = useConversations(true);
  return (inbox.data ?? []).reduce((n, c) => n + c.unread, 0) + (requests.data?.length ?? 0);
}

// Icon-only bar in the Instagram mould: thin line icons, a small ultramarine
// mark under the current tab, and a solid black button in the middle for posting.
function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const unread = useUnreadCount();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        const isCreate = route.name === 'create';
        const badge = route.name === 'messages' && unread > 0;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={badge ? `${tab.label}, ${unread} unread` : tab.label}
            accessibilityState={{ selected: focused }}
            style={styles.item}
            hitSlop={4}
            onPress={() => {
              tap();
              if (isCreate) {
                router.push('/new-post');
                return;
              }
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            }}
          >
            {isCreate ? (
              <View style={styles.create}>
                <Feather name="plus" size={22} color={colors.onInk} />
              </View>
            ) : (
              <View style={styles.iconWrap}>
                <Feather name={tab.icon} size={24} color={focused ? colors.ink : colors.muted} />
                {badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                  </View>
                ) : null}
                <View style={[styles.mark, focused && styles.markActive]} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="create" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: 10,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  iconWrap: { alignItems: 'center', gap: 5 },
  mark: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  markActive: { backgroundColor: colors.ultramarine },
  create: {
    width: 46,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.ultramarine,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.paper,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, color: colors.onInk },
});

import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { parseRich } from '@/lib/rich';
import { fonts } from '@/theme';

// Caption or comment text with tappable @mentions (open the profile) and
// #hashtags (open posts with that tag). Nests inside a parent <Text>.
export function RichText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const parts = useMemo(() => parseRich(text), [text]);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          p.text
        ) : (
          <Text
            key={i}
            style={styles.link}
            accessibilityRole="link"
            accessibilityHint={p.kind === 'mention' ? `Opens @${p.value}’s profile` : `Shows posts tagged #${p.value}`}
            onPress={() =>
              router.push(p.kind === 'mention' ? `/u/${p.value}` : `/tag/${encodeURIComponent(p.value)}`)
            }
            suppressHighlighting
          >
            {p.text}
          </Text>
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({ link: { fontFamily: fonts.semibold } });

import type { Interest } from './api';

// Topics are grouped so everyone can find their world at a glance. Nobody is
// asked their gender; what they pick here shapes their For you feed.
export const SECTIONS = [
  { key: 'style', label: 'Style' },
  { key: 'home', label: 'Home' },
  { key: 'tech', label: 'Tech & cars' },
  { key: 'food', label: 'Food & drink' },
  { key: 'active', label: 'Active & outdoors' },
  { key: 'everyday', label: 'Everyday' },
] as const;

export function groupBySection(interests: Interest[]): { key: string; label: string; items: Interest[] }[] {
  return SECTIONS.map((s) => ({ ...s, items: interests.filter((i) => (i.section ?? 'everyday') === s.key) })).filter(
    (g) => g.items.length > 0,
  );
}

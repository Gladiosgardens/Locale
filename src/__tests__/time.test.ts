import { timeAgo } from '@/lib/time';

const now = new Date('2026-11-03T20:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

it('formats relative times compactly', () => {
  expect(timeAgo(ago(10_000), now)).toBe('now');
  expect(timeAgo(ago(5 * 60_000), now)).toBe('5m');
  expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3h');
  expect(timeAgo(ago(2 * 86_400_000), now)).toBe('2d');
  expect(timeAgo(ago(10 * 86_400_000), now)).not.toMatch(/d$/);
  expect(timeAgo(new Date(now.getTime() + 60_000).toISOString(), now)).toBe('now');
});

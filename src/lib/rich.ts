// Splits captions and comments into plain text, @mentions and #hashtags,
// following the same rules as the server (extract_mentions / extract_hashtags).

export type RichPart = { kind: 'text' | 'mention' | 'hashtag'; text: string; value: string };

// A "word" character: ASCII letters, digits and _, or a letter from another
// script. Punctuation blocks, spaces and emoji (surrogates) are not.
function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  if (/[0-9A-Za-z_]/.test(ch)) return true;
  const c = ch.charCodeAt(0);
  if (c < 0xc0) return false;
  if (c === 0xd7 || c === 0xf7) return false; // × ÷
  if (c >= 0x2000 && c <= 0x2bff) return false; // general punctuation, symbols, arrows
  if (c >= 0x3000 && c <= 0x303f) return false; // CJK punctuation
  if (c >= 0xd800 && c <= 0xdfff) return false; // emoji and other astral characters
  if (c >= 0xfe00 && c <= 0xfe0f) return false; // variation selectors
  if (c >= 0xff00 && c <= 0xff0f) return false; // fullwidth punctuation
  return true;
}

const HANDLE = /^[a-z0-9_]{3,20}$/;

export function parseRich(text: string): RichPart[] {
  const parts: RichPart[] = [];
  let plain = '';
  let i = 0;
  const flush = () => {
    if (plain) parts.push({ kind: 'text', text: plain, value: plain });
    plain = '';
  };
  while (i < text.length) {
    const ch = text[i];
    const prev = text[i - 1];
    if (ch === '@' && !isWordChar(prev) && prev !== '@' && prev !== '.') {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      const handle = text.slice(i + 1, j).toLowerCase();
      if (HANDLE.test(handle) && !isWordChar(text[j])) {
        flush();
        parts.push({ kind: 'mention', text: text.slice(i, j), value: handle });
        i = j;
        continue;
      }
    }
    if (ch === '#' && !isWordChar(prev) && prev !== '&' && prev !== '#') {
      let j = i + 1;
      while (j < text.length && isWordChar(text[j]) && j - i <= 50) j++;
      const tag = text.slice(i + 1, j).toLowerCase();
      if (tag && j - i - 1 <= 50 && !isWordChar(text[j]) && !/^[0-9_]+$/.test(tag)) {
        flush();
        parts.push({ kind: 'hashtag', text: text.slice(i, j), value: tag });
        i = j;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return parts;
}

/** The @word being typed at the cursor, if any (for mention suggestions). */
export function mentionAt(text: string, cursor: number): { start: number; query: string } | null {
  let i = cursor - 1;
  while (i >= 0 && /[A-Za-z0-9_]/.test(text[i])) i--;
  if (i < 0 || text[i] !== '@') return null;
  if (i > 0 && (isWordChar(text[i - 1]) || text[i - 1] === '@' || text[i - 1] === '.')) return null;
  const query = text.slice(i + 1, cursor);
  return query.length <= 20 ? { start: i, query } : null;
}

/** Replaces the @word at the cursor with @handle and a space. */
export function insertMention(text: string, cursor: number, handle: string): { text: string; cursor: number } {
  const at = mentionAt(text, cursor);
  if (!at) return { text, cursor };
  let end = cursor;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end++;
  const insert = `@${handle} `;
  const rest = text.slice(end).replace(/^ /, '');
  return { text: text.slice(0, at.start) + insert + rest, cursor: at.start + insert.length };
}

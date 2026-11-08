import { insertMention, mentionAt, parseRich } from '@/lib/rich';

const kinds = (s: string) => parseRich(s).map((p) => `${p.kind}:${p.kind === 'text' ? p.text : p.value}`);

describe('parseRich', () => {
  it('finds mentions and hashtags like the server does', () => {
    expect(kinds('Desk day with @Men_Ben and #DeskSetup!')).toEqual([
      'text:Desk day with ', 'mention:men_ben', 'text: and ', 'hashtag:desksetup', 'text:!',
    ]);
  });
  it('ignores emails, short handles, digit-only tags and glued words', () => {
    expect(kinds('mail a@men_ben.com, @me, #2024, x#y, &#39;')).toEqual(['text:mail a@men_ben.com, @me, #2024, x#y, &#39;']);
  });
  it('keeps letters from other scripts in hashtags', () => {
    expect(kinds('#café #موضة #夏')).toEqual(['hashtag:café', 'text: ', 'hashtag:موضة', 'text: ', 'hashtag:夏']);
  });
  it('stops a hashtag at emoji and punctuation', () => {
    expect(kinds('#ootd🔥 #summer—fun')).toEqual(['hashtag:ootd', 'text:🔥 ', 'hashtag:summer', 'text:—fun']);
  });
  it('round-trips the text', () => {
    const s = 'a @bob_1 b #tag c @x';
    expect(parseRich(s).map((p) => p.text).join('')).toBe(s);
  });
});

describe('mentions while typing', () => {
  it('finds the @word at the cursor', () => {
    expect(mentionAt('hi @be', 6)).toEqual({ start: 3, query: 'be' });
    expect(mentionAt('hi @', 4)).toEqual({ start: 3, query: '' });
    expect(mentionAt('mail a@be', 9)).toBeNull();
    expect(mentionAt('hi be', 5)).toBeNull();
  });
  it('replaces it with the chosen handle', () => {
    expect(insertMention('hi @be there', 6, 'men_ben')).toEqual({ text: 'hi @men_ben there', cursor: 12 });
    expect(insertMention('@a', 2, 'ana')).toEqual({ text: '@ana ', cursor: 5 });
  });
});

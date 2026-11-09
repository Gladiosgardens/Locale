import { DETECTION_PROMPT, parseDetection, parseLensMatches, readDetectionResponse, assignMatches } from '../../supabase/functions/_shared/detect';

describe('parseDetection', () => {
  it('reads items, clamps positions, trims text and caps the count', () => {
    const text = `Here you go:\n${JSON.stringify({
      items: [
        { name: ' Camel wool coat ', category: 'Clothing', x: 0.5, y: 0.4, query: 'camel double breasted wool coat' },
        { name: 'Loafers', category: 'shoes', x: -1, y: 2, query: 'brown leather penny loafers' },
        { name: 'x', category: 'bad', x: 0.5, y: 0.5, query: 'too short name' },
        { name: 'Watch', category: 'watch', x: 0.3, y: 0.3, query: '' },
        ...Array.from({ length: 6 }, (_, i) => ({ name: `Item ${i}`, category: 'decor', x: 0.1, y: 0.1, query: 'brass table lamp' })),
      ],
    })}`;
    const items = parseDetection(text);
    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({ name: 'Camel wool coat', category: 'clothing', x: 0.5, y: 0.4, query: 'camel double breasted wool coat' });
    expect(items[1]).toEqual(expect.objectContaining({ x: 0.02, y: 0.98 }));
  });

  it('returns nothing for replies that are not JSON', () => {
    expect(parseDetection('Sorry, I cannot help with that.')).toEqual([]);
    expect(parseDetection('{"items": "nope"}')).toEqual([]);
    expect(parseDetection('{broken')).toEqual([]);
  });

  it('asks never to describe people', () => {
    expect(DETECTION_PROMPT).toMatch(/Never describe or identify people/);
  });
});

describe('parseLensMatches', () => {
  it('prefers shops with prices, keeps only web links, and drops duplicates', () => {
    const json = {
      visual_matches: [
        { title: 'Blog post about coats', link: 'https://blog.example/coat', source: 'Blog' },
        { title: 'Wool coat', link: 'https://www.arket.com/coat', source: 'ARKET', price: { value: '$290.00', extracted_value: 290, currency: '$' }, thumbnail: 'https://t/1.jpg' },
        { title: 'Dup', link: 'https://www.arket.com/coat', source: 'ARKET', price: { value: '$290' } },
        { title: 'Sneaky', link: 'javascript:alert(1)', price: { value: '$1' } },
        { title: 'Euro coat', link: 'https://shop.eu/coat', source: 'Shop', price: { value: '€120', extracted_value: 120 } },
      ],
    };
    const matches = parseLensMatches(json);
    expect(matches.map((m) => m.host)).toEqual(['arket.com', 'shop.eu', 'blog.example']);
    expect(matches[0]).toEqual({
      title: 'Wool coat', store: 'ARKET', url: 'https://www.arket.com/coat', host: 'arket.com',
      priceCents: 29000, currency: 'USD', thumbnail: 'https://t/1.jpg',
    });
    expect(matches[1]).toEqual(expect.objectContaining({ priceCents: 12000, currency: 'EUR' }));
    expect(matches[2]).toEqual(expect.objectContaining({ priceCents: null, currency: null }));
  });

  it('copes with empty or odd responses', () => {
    expect(parseLensMatches(null)).toEqual([]);
    expect(parseLensMatches({ error: 'Google hasn’t returned any results' })).toEqual([]);
  });
});

describe('readDetectionResponse', () => {
  it('reads the forced tool call', () => {
    const r = readDetectionResponse({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', input: { items: [{ name: 'Oak desk', category: 'Furniture', x: 0.4, y: 1.4, query: 'light oak desk' }] } }],
    });
    expect(r.items).toEqual([{ name: 'Oak desk', category: 'furniture', x: 0.4, y: 0.98, query: 'light oak desk' }]);
    expect(r.note).toContain('tool=true');
  });

  it('falls back to JSON in text, and explains an empty answer', () => {
    expect(readDetectionResponse({ content: [{ type: 'text', text: '{"items":[{"name":"Lamp","category":"lighting","x":0.1,"y":0.2,"query":"brass lamp"}]}' }] }).items).toHaveLength(1);
    const empty = readDetectionResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'No products here.' }] });
    expect(empty.items).toEqual([]);
    expect(empty.note).toBe('stop=end_turn tool=false text=No products here.');
  });
});

describe('assignMatches', () => {
  const item = (name: string) => ({ name, category: 'x', x: 0.5, y: 0.5, query: name });
  const m = (url: string) => ({ title: url, store: null, url, host: 'shop.com', priceCents: null, currency: null, thumbnail: null });
  it('keeps each item’s own matches', () => {
    expect(assignMatches([item('chair')], [[m('a')]], [m('w')])[0].matches.map((x) => x.url)).toEqual(['a']);
  });
  it('gives whole-photo shops to the first item without any, only once', () => {
    const r = assignMatches([item('chair'), item('lamp'), item('rug')], [[], [m('b')], []], [m('w1'), m('w2')]);
    expect(r.map((x) => x.matches.map((y) => y.url))).toEqual([['w1', 'w2'], ['b'], []]);
  });
});

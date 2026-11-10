import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { TagEditor } from '@/features/items/TagEditor';
import type { DraftTag } from '@/features/posts/api';
import { sharedLink } from '@/features/share/ShareIntentHandler';
import { Text } from 'react-native';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('sharedLink', () => {
  it('takes the shared web link, or the first https link in shared text', () => {
    expect(sharedLink({ webUrl: 'https://www.zara.com/us/p1.html' })).toBe('https://www.zara.com/us/p1.html');
    expect(sharedLink({ text: 'Look at this! https://shop.com/lamp?ref=app).' })).toBe('https://shop.com/lamp?ref=app');
    expect(sharedLink({ text: 'just words' })).toBeNull();
    expect(sharedLink({ webUrl: 'http://insecure.com/x' })).toBeNull();
  });
});

function Harness(props: {
  prefill?: { url: string; title?: string; store?: string; priceCents?: number | null } | null;
  lookup?: jest.Mock;
}) {
  const [tags, setTags] = useState<DraftTag[]>([]);
  return (
    <>
      <TagEditor
        photo={{ uri: 'file://a.jpg', width: 100, height: 100 }}
        mediaIndex={0}
        tags={tags}
        remainingForPost={20}
        onChange={setTags}
        onClose={jest.fn()}
        onLookupLink={props.lookup}
        prefill={props.prefill}
      />
      {tags.map((t) => (
        <TagSummary key={t.item.title} t={t} />
      ))}
    </>
  );
}

const TagSummary = ({ t }: { t: DraftTag }) => (
  <Text>{`tagged:${t.item.title}:${t.item.url}:${t.item.price_cents ?? ''}`}</Text>
);

const tapPhoto = () =>
  fireEvent.press(screen.getByRole('button', { name: 'Tap the photo where the item is' }), {
    nativeEvent: { locationX: 50, locationY: 50 },
  });

describe('Tagging from a link', () => {
  it('starts the first tag with a product shared from another app', async () => {
    await render(
      <Harness
        prefill={{ url: 'https://lamps.example.com/m', title: 'Mushroom lamp', store: 'Lamp Co', priceCents: 12900 }}
      />,
    );
    await tapPhoto();
    expect(screen.getByLabelText('Item name').props.value).toBe('Mushroom lamp');
    expect(screen.getByLabelText('Price in USD (optional)').props.value).toBe('129.00');
    await fireEvent.press(screen.getByRole('button', { name: 'Add tag' }));
    expect(screen.getByText('tagged:Mushroom lamp:https://lamps.example.com/m:12900')).toBeTruthy();
    // Once tagged, the next spot starts empty.
    await tapPhoto();
    expect(screen.getByLabelText('Item name').props.value).toBe('');
  });

  it('fills empty fields from a pasted link', async () => {
    const lookup = jest
      .fn()
      .mockResolvedValue({
        title: 'Oak desk',
        brand: 'Woodly',
        store: 'Shop',
        image: null,
        priceCents: 24900,
        currency: 'USD',
      });
    await render(<Harness lookup={lookup} />);
    await tapPhoto();
    await fireEvent.changeText(screen.getByLabelText('Store (optional)'), 'My store');
    await fireEvent.changeText(screen.getByLabelText('Link to buy (optional)'), 'https://shop.example.com/desk');
    await fireEvent.press(screen.getByRole('button', { name: 'Fill in from the link' }));
    await waitFor(() => expect(screen.getByLabelText('Item name').props.value).toBe('Oak desk'));
    expect(lookup).toHaveBeenCalledWith('https://shop.example.com/desk');
    expect(screen.getByLabelText('Brand (optional)').props.value).toBe('Woodly');
    expect(screen.getByLabelText('Store (optional)').props.value).toBe('My store');
    expect(screen.getByLabelText('Price in USD (optional)').props.value).toBe('249.00');
  });
});

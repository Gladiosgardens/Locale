import { fireEvent, render, screen } from '@testing-library/react-native';
import { TagEditor } from '@/features/items/TagEditor';
import type { DraftTag } from '@/features/posts/api';

const photo = { uri: 'file:///a.jpg', width: 1000, height: 1000 };

async function tapPhoto() {
  await fireEvent.press(screen.getByRole('button', { name: 'Tap the photo where the item is' }), {
    nativeEvent: { locationX: 100, locationY: 200 },
  });
}

describe('TagEditor', () => {
  it('adds a tag at the tapped spot with item details', async () => {
    const onChange = jest.fn();
    await render(<TagEditor photo={photo} mediaIndex={2} tags={[]} remainingForPost={20} onChange={onChange} onClose={jest.fn()} />);
    await tapPhoto();
    await fireEvent.changeText(screen.getByLabelText('Item name'), ' Linen sofa ');
    await fireEvent.changeText(screen.getByLabelText('Link to buy (optional)'), 'https://www.ikea.com/sofa');
    expect(screen.getByText('Opens www.ikea.com')).toBeTruthy();
    await fireEvent(screen.getByLabelText('I may earn from this link'), 'valueChange', true);
    await fireEvent.changeText(screen.getByLabelText('Price in USD (optional)'), '899');
    await fireEvent.press(screen.getByRole('button', { name: 'Add tag' }));

    const [[tags]] = onChange.mock.calls as [[DraftTag[]]];
    expect(tags).toHaveLength(1);
    expect(tags[0].media).toBe(2);
    expect(tags[0].item).toEqual({
      title: 'Linen sofa', url: 'https://www.ikea.com/sofa', is_affiliate: true, price_cents: 89900, currency: 'USD',
    });
    expect(tags[0].x).toBeGreaterThan(0);
    expect(tags[0].y).toBeGreaterThan(tags[0].x);
  });

  it('rejects shortened links and missing names', async () => {
    const onChange = jest.fn();
    await render(<TagEditor photo={photo} mediaIndex={0} tags={[]} remainingForPost={20} onChange={onChange} onClose={jest.fn()} />);
    await tapPhoto();
    await fireEvent.press(screen.getByRole('button', { name: 'Add tag' }));
    expect(screen.getByText('Give the item a name.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Item name'), 'Lamp');
    await fireEvent.changeText(screen.getByLabelText('Link to buy (optional)'), 'https://bit.ly/abc');
    await fireEvent.press(screen.getByRole('button', { name: 'Add tag' }));
    expect(screen.getByText(/full store link/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops at 5 tags per photo', async () => {
    const tags: DraftTag[] = Array.from({ length: 5 }, (_, i) => ({ media: 0, x: i / 10, y: 0.5, item: { title: `T${i}` } }));
    await render(<TagEditor photo={photo} mediaIndex={0} tags={tags} remainingForPost={15} onChange={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText(/maximum of 5 tags/)).toBeTruthy();
    await tapPhoto();
    expect(screen.queryByLabelText('Item name')).toBeNull();
  });
});

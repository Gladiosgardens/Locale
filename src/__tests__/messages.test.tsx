import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Chat from '@/app/(app)/messages/[id]';
import Inbox from '@/app/(app)/messages/index';
import NewMessage from '@/app/(app)/messages/new';
import SharePost from '@/app/(app)/messages/share';
import type { ConversationSummary, Message } from '@/features/messages/api';
import * as messageHooks from '@/features/messages/hooks';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`redirect:${href}`}</Text>;
  },
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/messages/hooks');
jest.mock('@/features/notifications/PushPrompt', () => ({ PushPrompt: () => null }));
jest.mock('@/features/safety/hooks', () => ({
  useBlockUser: () => ({ mutate: jest.fn() }),
  useReport: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const hooks = messageHooks as jest.Mocked<typeof messageHooks>;
const mut = (over: Record<string, unknown> = {}) => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, ...over });

const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: 'c1', otherId: 'u2', otherHandle: 'cal', otherName: 'Cal', myState: 'active', awaitingReply: false, ...over,
});
const msg = (over: Partial<Message>): Message => ({
  id: 'm', senderId: 'u2', body: 'Hi', createdAt: new Date().toISOString(), removed: false, sharedPost: null, ...over,
});

function setupChat(s: ConversationSummary, messages: Message[]) {
  (hooks.useConversation as jest.Mock).mockReturnValue({ isPending: false, data: s });
  (hooks.useMessages as jest.Mock).mockReturnValue({
    data: { pages: [messages] }, isPending: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'c1' };
  for (const n of ['useSendMessage', 'useRespondToMessageRequest', 'useMarkRead', 'useHideConversation'] as const) {
    (hooks[n] as jest.Mock).mockReturnValue(mut());
  }
  (hooks.useLiveMessages as jest.Mock).mockReturnValue(undefined);
});

describe('Inbox', () => {
  it('shows conversations with unread counts and a Requests tab', async () => {
    (hooks.useConversations as jest.Mock).mockImplementation((requests: boolean) => ({
      isPending: false,
      isError: false,
      data: requests
        ? [{ id: 'r1', otherId: 'u3', otherHandle: 'fin', otherName: 'Fin', lastMessage: 'Love your plants', lastMessageAt: new Date().toISOString(), unread: 1, awaitingReply: false }]
        : [{ id: 'c1', otherId: 'u2', otherHandle: 'ben', otherName: 'Ben', lastMessage: 'Run tomorrow?', lastMessageAt: new Date().toISOString(), unread: 2, awaitingReply: false }],
    }));
    await render(<Inbox />);
    expect(screen.getByRole('button', { name: 'Conversation with Ben, 2 unread' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Requests (1)' }));
    expect(screen.getByText('Wants to message you: Love your plants')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Conversation with Fin, 1 unread' }));
    expect(mockPush).toHaveBeenCalledWith('/messages/r1');
  });
});

describe('Chat', () => {
  it('sends messages and marks them read', async () => {
    const send = mut({ mutateAsync: jest.fn().mockResolvedValue('c1') });
    const markRead = mut();
    (hooks.useSendMessage as jest.Mock).mockReturnValue(send);
    (hooks.useMarkRead as jest.Mock).mockReturnValue(markRead);
    setupChat(summary(), [msg({ id: 'm2', body: 'See you there' }), msg({ id: 'm1', senderId: 'me', body: 'Run tomorrow?' })]);
    await render(<Chat />);
    expect(screen.getByText('See you there')).toBeTruthy();
    expect(markRead.mutate).toHaveBeenCalledWith('c1');
    await fireEvent.changeText(screen.getByLabelText('Message'), '  On my way  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(send.mutateAsync).toHaveBeenCalledWith({ conversationId: 'c1', body: '  On my way  ' }));
    expect(hooks.useLiveMessages).toHaveBeenCalledWith('c1');
  });

  it('shows a request banner with accept and delete, and no composer until accepted', async () => {
    const respond = mut();
    (hooks.useRespondToMessageRequest as jest.Mock).mockReturnValue(respond);
    const markRead = mut();
    (hooks.useMarkRead as jest.Mock).mockReturnValue(markRead);
    setupChat(summary({ myState: 'request' }), [msg({ body: 'Hi! Saw your post.' })]);
    await render(<Chat />);
    expect(screen.getByText(/wants to send you messages/)).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(markRead.mutate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    expect(respond.mutate).toHaveBeenCalledWith(true, expect.anything());
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(respond.mutate).toHaveBeenCalledWith(false, expect.anything());
  });

  it('tells a requester to wait for acceptance', async () => {
    setupChat(summary({ awaitingReply: true }), [msg({ senderId: 'me', body: 'Hi!' })]);
    await render(<Chat />);
    expect(screen.getByText('Request sent. You can send more once Cal accepts.')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('renders shared posts, unavailable posts and removed messages', async () => {
    setupChat(summary(), [
      msg({ id: 'a', body: null, sharedPost: { id: 'p1', caption: 'Morning walk', authorHandle: 'ada', imageUrl: 'https://s/1' } }),
      msg({ id: 'b', body: null, sharedPost: { unavailable: true } }),
      msg({ id: 'c', body: null, removed: true }),
    ]);
    await render(<Chat />);
    expect(screen.getByText('Morning walk')).toBeTruthy();
    expect(screen.getByText('Post unavailable')).toBeTruthy();
    expect(screen.getByText('Message removed')).toBeTruthy();
  });

  it('lets you report someone else’s message with a long press', async () => {
    setupChat(summary(), [msg({ id: 'bad', body: 'Something nasty' })]);
    const alert = jest.spyOn(Alert, 'alert');
    await render(<Chat />);
    await fireEvent(screen.getByText('Something nasty'), 'longPress');
    const report = alert.mock.calls[0][2]!.find((b) => b.text === 'Report')!;
    await act(async () => report.onPress!());
    expect(screen.getByText('Report message')).toBeTruthy();
  });
});

describe('New message', () => {
  it('redirects to an existing conversation', async () => {
    mockParams = { to: 'u2', name: 'Cal' };
    (hooks.useMessageStatus as jest.Mock).mockReturnValue({ isPending: false, data: { status: 'existing', conversationId: 'c9' } });
    await render(<NewMessage />);
    expect(screen.getByText('redirect:/messages/c9')).toBeTruthy();
  });

  it('explains requests and sends the first message', async () => {
    mockParams = { to: 'u2', name: 'Cal' };
    const send = mut({ mutateAsync: jest.fn().mockResolvedValue('c5') });
    (hooks.useSendMessage as jest.Mock).mockReturnValue(send);
    (hooks.useMessageStatus as jest.Mock).mockReturnValue({ isPending: false, data: { status: 'request', conversationId: null } });
    await render(<NewMessage />);
    expect(screen.getByText(/goes to their message requests/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Hello!');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/messages/c5'));
    expect(send.mutateAsync).toHaveBeenCalledWith({ to: 'u2', body: 'Hello!' });
  });

  it('says when someone only accepts connections', async () => {
    mockParams = { to: 'u2', name: 'Dot' };
    (hooks.useMessageStatus as jest.Mock).mockReturnValue({ isPending: false, data: { status: 'closed', conversationId: null } });
    await render(<NewMessage />);
    expect(screen.getByText('Dot only accepts messages from people they’re connected with.')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
  });
});

describe('Share a post', () => {
  it('sends the post into a conversation, skipping pending requests', async () => {
    mockParams = { postId: 'p1' };
    const send = mut({ mutateAsync: jest.fn().mockResolvedValue('c1') });
    (hooks.useSendMessage as jest.Mock).mockReturnValue(send);
    (hooks.useConversations as jest.Mock).mockReturnValue({
      isPending: false,
      data: [
        { id: 'c1', otherId: 'u2', otherHandle: 'ben', otherName: 'Ben', lastMessage: null, lastMessageAt: '', unread: 0, awaitingReply: false },
        { id: 'c2', otherId: 'u3', otherHandle: 'ada', otherName: 'Ada', lastMessage: null, lastMessageAt: '', unread: 0, awaitingReply: true },
      ],
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<SharePost />);
    expect(screen.queryByRole('button', { name: 'Send to Ada' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Send to Ben' }));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(send.mutateAsync).toHaveBeenCalledWith({ conversationId: 'c1', sharedPostId: 'p1' });
  });
});

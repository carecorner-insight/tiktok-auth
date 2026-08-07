import { SharePointLogger } from '@/services/sharePointLogger';
import { TelegramAdapter } from '@/adapters/telegram';
import { makeState } from '@/__tests__/mocks';

// F4 — the daily staff email is built by a Power Automate flow reading the
// SharePoint conversation log. That flow needs two things the log did not carry:
// an explicit crisis flag to filter on, and the Telegram username so staff can
// identify the person.

const update = (from: Record<string, unknown>) => ({
  update_id: 1,
  message: { text: 'hi', date: 1700000000, from },
});

describe('TelegramAdapter — username capture', () => {
  const adapter = new TelegramAdapter('token', (async () => ({ ok: true })) as never);

  it('captures the username when present', () => {
    const msg = adapter.normalizeMessage(update({ id: 42, username: 'jane_doe' }));
    expect(msg.username).toBe('jane_doe');
    expect(msg.userId).toBe('42');
  });

  it('leaves username undefined when the user has none (very common on Telegram)', () => {
    const msg = adapter.normalizeMessage(update({ id: 42 }));
    expect(msg.username).toBeUndefined();
    expect(msg.userId).toBe('42'); // the numeric id is the stable identifier
  });

  it('does not capture first_name / last_name — username only, by decision', () => {
    const msg = adapter.normalizeMessage(
      update({ id: 42, username: 'jane_doe', first_name: 'Jane', last_name: 'Doe' }),
    );
    expect(JSON.stringify({ ...msg, raw: null })).not.toContain('Jane');
    expect(JSON.stringify({ ...msg, raw: null })).not.toContain('Doe');
  });
});

describe('SharePointLogger — flagged-user fields', () => {
  const capture = () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = (async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body));
      return { ok: true };
    }) as never;
    return { calls, fetchMock };
  };

  it('logs crisisDetected so the flow can filter flagged users', async () => {
    const { calls, fetchMock } = capture();
    await new SharePointLogger('https://flow', fetchMock).log(
      makeState({ crisisDetected: true, conversationPhase: 'crisis' }),
      'user text',
      'bot text',
    );
    expect(calls[0].crisisDetected).toBe(true);
  });

  it('logs crisisDetected=false on ordinary turns', async () => {
    const { calls, fetchMock } = capture();
    await new SharePointLogger('https://flow', fetchMock).log(makeState({}), 'u', 'b');
    expect(calls[0].crisisDetected).toBe(false);
  });

  it('includes the username when supplied', async () => {
    const { calls, fetchMock } = capture();
    await new SharePointLogger('https://flow', fetchMock).log(
      makeState({}), 'u', 'b', 'jane_doe',
    );
    expect(calls[0].username).toBe('jane_doe');
  });

  it('sends an empty username rather than omitting the field', async () => {
    const { calls, fetchMock } = capture();
    await new SharePointLogger('https://flow', fetchMock).log(makeState({}), 'u', 'b');
    // A stable schema keeps the Power Automate column mapping from breaking.
    expect(calls[0]).toHaveProperty('username', '');
  });

  it('still redacts PII from the transcript fields (confirmed decision)', async () => {
    const { calls, fetchMock } = capture();
    await new SharePointLogger('https://flow', fetchMock).log(
      makeState({}), 'call me at 91234567', 'noted',
    );
    expect(calls[0].userMessage).not.toContain('91234567');
  });
});

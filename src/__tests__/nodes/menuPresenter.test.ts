import { makeMenuPresenter } from '@/nodes/menuPresenter';
import { makeState } from '@/__tests__/mocks';
import { OPENING_TEXT, MENU_TEXT } from '@/config/questionnaire';

const intentMenu = makeMenuPresenter('intent');
const numberedMenu = makeMenuPresenter('numbered');

describe('menuPresenter', () => {
  it('returns the open-ended opening question in intent mode', () => {
    const result = intentMenu(makeState());
    expect(result.pendingResponse).toBe(OPENING_TEXT);
  });

  it('returns the numbered menu in numbered mode', () => {
    const result = numberedMenu(makeState());
    expect(result.pendingResponse).toBe(MENU_TEXT);
  });

  it('sets conversationPhase to menu', () => {
    const result = intentMenu(makeState({ conversationPhase: 'option' }));
    expect(result.conversationPhase).toBe('menu');
  });

  it('clears aiBotChatId so the next option starts a fresh AIBots session', () => {
    const result = intentMenu(makeState({ aiBotChatId: 'stale-session-id' }));
    expect(result.aiBotChatId).toBeNull();
  });

  it('clears aiBotChatId even when called post-questionnaire (no active session)', () => {
    const result = intentMenu(makeState({ aiBotChatId: null }));
    expect(result.aiBotChatId).toBeNull();
  });
});

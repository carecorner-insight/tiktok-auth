import { menuPresenter } from '@/nodes/menuPresenter';
import { makeState } from '@/__tests__/mocks';
import { MENU_TEXT } from '@/config/questionnaire';

describe('menuPresenter', () => {
  it('returns the menu text as pendingResponse', () => {
    const result = menuPresenter(makeState());
    expect(result.pendingResponse).toBe(MENU_TEXT);
  });

  it('sets conversationPhase to menu', () => {
    const result = menuPresenter(makeState({ conversationPhase: 'option' }));
    expect(result.conversationPhase).toBe('menu');
  });

  it('clears aiBotChatId so the next option starts a fresh AIBots session', () => {
    const result = menuPresenter(makeState({ aiBotChatId: 'stale-session-id' }));
    expect(result.aiBotChatId).toBeNull();
  });

  it('clears aiBotChatId even when called post-questionnaire (no active session)', () => {
    const result = menuPresenter(makeState({ aiBotChatId: null }));
    expect(result.aiBotChatId).toBeNull();
  });
});

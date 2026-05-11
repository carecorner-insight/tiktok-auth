import { makeSessionPersister } from '@/nodes/sessionPersister';
import { makeState, makeSessionManagerMock } from '@/__tests__/mocks';

describe('sessionPersister', () => {
  it('saves state to the session manager', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({ conversationPhase: 'menu' });
    await node(state);
    expect(sessionMock.save).toHaveBeenCalledWith(state);
  });

  it('returns an empty partial (no state changes — just a side effect)', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const result = await node(makeState());
    expect(result).toEqual({});
  });

  it('clears session when conversationPhase is ended', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({ conversationPhase: 'ended' });
    await node(state);
    expect(sessionMock.clear).toHaveBeenCalledWith(state.platform, state.userId);
    expect(sessionMock.save).not.toHaveBeenCalled();
  });
});

import { makeAuthGuard } from '@/nodes/authGuard';
import { makeState, makeWhitelistServiceMock } from '@/__tests__/mocks';
import { UNAUTHORIZED_MESSAGE } from '@/config/questionnaire';

describe('authGuard', () => {
  it('sets isAuthorized=true for a whitelisted user', async () => {
    const whitelist = makeWhitelistServiceMock();
    whitelist.isAuthorized.mockResolvedValue(true);
    const node = makeAuthGuard(whitelist);
    const result = await node(makeState({ userId: 'user-123', platform: 'telegram' }));
    expect(result.isAuthorized).toBe(true);
    expect(result.pendingResponse).toBeUndefined();
  });

  it('sets isAuthorized=false and returns registration message for unknown user', async () => {
    const whitelist = makeWhitelistServiceMock();
    whitelist.isAuthorized.mockResolvedValue(false);
    const node = makeAuthGuard(whitelist);
    const result = await node(makeState({ userId: 'stranger', platform: 'telegram' }));
    expect(result.isAuthorized).toBe(false);
    expect(result.pendingResponse).toContain('stranger');
  });

  it('registration message includes the user ID so they can copy it into the form', async () => {
    const whitelist = makeWhitelistServiceMock();
    whitelist.isAuthorized.mockResolvedValue(false);
    const node = makeAuthGuard(whitelist);
    const result = await node(makeState({ userId: 'tiktok-abc-999', platform: 'tiktok' }));
    expect(result.pendingResponse).toContain('tiktok-abc-999');
  });
});

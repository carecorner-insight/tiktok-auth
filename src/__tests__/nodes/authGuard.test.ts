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

describe('authGuard — BYPASS_AUTH', () => {
  afterEach(() => {
    delete process.env.BYPASS_AUTH;
  });

  it('grants access without calling the whitelist when BYPASS_AUTH=true', async () => {
    process.env.BYPASS_AUTH = 'true';
    const whitelist = makeWhitelistServiceMock();
    whitelist.isAuthorized.mockResolvedValue(false); // would normally deny
    const node = makeAuthGuard(whitelist);
    const result = await node(makeState({ userId: 'load-test-user', platform: 'telegram' }));
    expect(result.isAuthorized).toBe(true);
    expect(result.pendingResponse).toBeUndefined();
    expect(whitelist.isAuthorized).not.toHaveBeenCalled();
  });

  it('does not bypass when BYPASS_AUTH is unset', async () => {
    const whitelist = makeWhitelistServiceMock();
    whitelist.isAuthorized.mockResolvedValue(false);
    const node = makeAuthGuard(whitelist);
    const result = await node(makeState({ userId: 'stranger' }));
    expect(result.isAuthorized).toBe(false);
    expect(whitelist.isAuthorized).toHaveBeenCalled();
  });

  it('does not bypass when BYPASS_AUTH=false', async () => {
    process.env.BYPASS_AUTH = 'false';
    const whitelist = makeWhitelistServiceMock();
    whitelist.isAuthorized.mockResolvedValue(true);
    const node = makeAuthGuard(whitelist);
    await node(makeState({ userId: 'user-123' }));
    expect(whitelist.isAuthorized).toHaveBeenCalled();
  });
});

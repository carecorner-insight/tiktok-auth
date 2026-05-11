import { WhitelistService } from '@/services/whitelistService';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

const mockFetchWhitelist = jest.fn();

const makeService = () =>
  new WhitelistService(mockRedis as any, mockFetchWhitelist);

beforeEach(() => jest.clearAllMocks());

describe('WhitelistService.isAuthorized', () => {
  it('returns true for an approved userId found in Redis cache', async () => {
    mockRedis.get.mockResolvedValue('approved');
    const svc = makeService();
    expect(await svc.isAuthorized('telegram', 'user-123')).toBe(true);
    expect(mockFetchWhitelist).not.toHaveBeenCalled();
  });

  it('returns false for a pending userId found in Redis cache', async () => {
    mockRedis.get.mockResolvedValue('pending');
    const svc = makeService();
    expect(await svc.isAuthorized('telegram', 'user-123')).toBe(false);
  });

  it('returns false for an unknown userId found in Redis cache', async () => {
    mockRedis.get.mockResolvedValue('unknown');
    const svc = makeService();
    expect(await svc.isAuthorized('telegram', 'user-123')).toBe(false);
  });

  it('fetches from SharePoint on cache miss and caches the result', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetchWhitelist.mockResolvedValue('approved');
    const svc = makeService();
    expect(await svc.isAuthorized('telegram', 'user-123')).toBe(true);
    expect(mockFetchWhitelist).toHaveBeenCalledWith('telegram', 'user-123');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'whitelist:telegram:user-123',
      'approved',
      expect.objectContaining({ ex: 300 }),
    );
  });

  it('returns false when SharePoint returns no record', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetchWhitelist.mockResolvedValue(null);
    const svc = makeService();
    expect(await svc.isAuthorized('telegram', 'user-123')).toBe(false);
  });

  it('uses platform-scoped cache keys so tiktok and telegram users are separate', async () => {
    mockRedis.get.mockResolvedValue('approved');
    const svc = makeService();
    await svc.isAuthorized('tiktok', 'user-123');
    expect(mockRedis.get).toHaveBeenCalledWith('whitelist:tiktok:user-123');
  });
});

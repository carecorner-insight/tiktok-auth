import { SessionManager } from '@/services/sessionManager';
import { makeState } from '@/__tests__/mocks';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const makeService = () => new SessionManager(mockRedis as any);

beforeEach(() => jest.clearAllMocks());

describe('SessionManager', () => {
  it('returns null when no session exists', async () => {
    mockRedis.get.mockResolvedValue(null);
    const svc = makeService();
    expect(await svc.load('telegram', 'user-123')).toBeNull();
  });

  it('loads and deserialises existing state', async () => {
    const state = makeState();
    mockRedis.get.mockResolvedValue(JSON.stringify(state));
    const svc = makeService();
    expect(await svc.load('telegram', 'user-123')).toEqual(state);
  });

  it('saves state as JSON with 6hr TTL', async () => {
    const state = makeState();
    mockRedis.set.mockResolvedValue('OK');
    const svc = makeService();
    await svc.save(state);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'session:telegram:user-123',
      JSON.stringify(state),
      { ex: 21600 },
    );
  });

  it('uses platform-scoped key so tiktok and telegram sessions are separate', async () => {
    mockRedis.get.mockResolvedValue(null);
    const svc = makeService();
    await svc.load('tiktok', 'user-123');
    expect(mockRedis.get).toHaveBeenCalledWith('session:tiktok:user-123');
  });

  it('clears session from Redis', async () => {
    mockRedis.del.mockResolvedValue(1);
    const svc = makeService();
    await svc.clear('telegram', 'user-123');
    expect(mockRedis.del).toHaveBeenCalledWith('session:telegram:user-123');
  });
});

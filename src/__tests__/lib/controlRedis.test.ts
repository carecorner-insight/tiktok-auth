import { EventEmitter } from 'events';

function setup() {
  const client = Object.assign(new EventEmitter(), {
    status: 'connecting', get: jest.fn(async () => null), set: jest.fn(async () => 'OK'),
  });
  let redis: import('@/lib/redis').RedisClient;
  let options: Record<string, unknown>;
  jest.isolateModules(() => {
    jest.doMock('ioredis', () => jest.fn((_url, configuration) => { options = configuration; return client; }));
    process.env.REDIS_URL = 'redis://synthetic.invalid';
    redis = require('@/lib/redis').getControlRedis();
  });
  return { client, redis: redis!, options: options! };
}
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; jest.useRealTimers(); jest.dontMock('ioredis'); });
it('disables both offline queuing and replay of unacknowledged control writes', () => {
  expect(setup().options).toMatchObject({ enableOfflineQueue: false, autoResendUnfulfilledCommands: false, commandTimeout: 2000 });
});
it('waits for initial connection readiness without queuing a command', async () => {
  const { client, redis } = setup(); const result = redis.get('mode');
  expect(client.get).not.toHaveBeenCalled();
  client.status = 'ready'; client.emit('ready');
  await expect(result).resolves.toBeNull(); expect(client.get).toHaveBeenCalledWith('mode');
  expect(client.listenerCount('ready')).toBe(0); expect(client.listenerCount('error')).toBe(0);
});
it('does not send a stale write when the connection wait times out', async () => {
  jest.useFakeTimers(); const { client, redis } = setup();
  const result = expect(redis.set('mode', 'ON')).rejects.toThrow('timed out');
  jest.advanceTimersByTime(2000); await result;
  client.status = 'ready'; client.emit('ready');
  expect(client.set).not.toHaveBeenCalled();
});
it('fails closed on connection errors and removes temporary listeners', async () => {
  const { client, redis } = setup(); const result = expect(redis.get('mode')).rejects.toThrow('unavailable');
  client.emit('error', new Error('synthetic connection error')); await result;
  expect(client.get).not.toHaveBeenCalled(); expect(client.listenerCount('ready')).toBe(0);
});

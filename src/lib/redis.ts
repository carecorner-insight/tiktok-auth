import { Redis } from '@upstash/redis';

// Module-level singleton — reused across invocations in the same Vercel
// function instance. Upstash Redis is HTTP-based so there is no persistent
// TCP connection to manage, but a single client avoids re-reading env vars
// and constructing a new object on every request.
let instance: Redis | null = null;

export function getRedis(): Redis {
  if (!instance) {
    instance = new Redis();
  }
  return instance;
}

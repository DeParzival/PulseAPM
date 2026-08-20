import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = createClient({ url: REDIS_URL });

let isConnecting = false;

export async function connectRedis(): Promise<void> {
  if (redisClient.isOpen || isConnecting) return;
  isConnecting = true;
  try {
    await redisClient.connect();
    console.log('[Redis] Connected successfully.');
  } catch (err) {
    console.error('[Redis] Connection failed:', err);
    throw err;
  } finally {
    isConnecting = false;
  }
}

// Auto-connect on import for modules that need it immediately
if (!redisClient.isOpen) {
  redisClient.connect().catch((err) => {
    console.error('[Redis] Auto-connect failed:', err);
  });
}

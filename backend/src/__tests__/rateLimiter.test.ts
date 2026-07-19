import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createClient } from 'redis';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { type Request, type Response, type NextFunction } from 'express';

// Setup a clean Redis connection dedicated to the test context
const testRedisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

describe('Sliding-Window Rate Limiter Middleware', () => {
  beforeAll(async () => {
    await testRedisClient.connect();
  });

  beforeEach(async () => {
    // Clear out testing namespace keys before running each scenario
    const keys = await testRedisClient.keys('test:rate-limit:*');
    if (keys.length > 0) {
      await testRedisClient.del(keys);
    }
  });

  afterAll(async () => {
    await testRedisClient.disconnect();
  });

  // Helper utility to mock Express lifecycle interfaces with strict test tracking properties
  const createMockContext = (projectId: string) => {
    const req = {
      projectId,
      ip: '127.0.0.1',
    } as unknown as Request & { projectId: string };

    // Explicitly shape the mock capture state to fix the inline type errors
    const resMock = {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: any) {
        this.body = body;
        return this;
      },
    };

    // Intersect standard Express Response with our tracker so assertions pass compilation
    const res = resMock as unknown as Response & typeof resMock;
    const next = (() => {}) as NextFunction;

    return { req, res, next };
  };

  it('should pass transparently through to next() if the volume is under the allocation ceiling', async () => {
    const { req, res } = createMockContext('proj_alpha');
    
    let nextCalled = false;
    const interceptedNext = () => {
      nextCalled = true;
    };

    await rateLimiter(req, res, interceptedNext);

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('should block execution and drop a 429 payload if volume spikes above safety limits', async () => {
    const { req, res } = createMockContext('proj_beta');
    
    // Run loop to force trigger the 429 threshold
    for (let i = 0; i < 15; i++) {
      await rateLimiter(req, res, () => {});
    }

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      error: expect.stringContaining('Too many requests'),
    });
  });

  it('should gracefully clean the sliding window history over time', async () => {
    const { req, res } = createMockContext('proj_gamma');

    for (let i = 0; i < 10; i++) {
      await rateLimiter(req, res, () => {});
    }

    // Force an artificial pause allowing historical tracking entries to slide past TTL rules
    await new Promise((resolve) => setTimeout(resolve, 1100));

    let nextCalledAfterDelay = false;
    await rateLimiter(req, res, () => {
      nextCalledAfterDelay = true;
    });

    expect(nextCalledAfterDelay).toBe(true);
  });
});
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createClient } from 'redis';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { type Request, type Response, type NextFunction } from 'express';

const testRedisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

describe('Sliding-Window Rate Limiter Middleware', () => {
  beforeAll(async () => {
    await testRedisClient.connect();
  });

  beforeEach(async () => {
    // Corrected namespace cleanup to match application key design
    const keys = await testRedisClient.keys('rate_limit:*');
    if (keys.length > 0) {
      await testRedisClient.del(keys);
    }
  });

  afterAll(async () => {
    await testRedisClient.disconnect();
  });

  const createMockContext = (projectId: string) => {
    const req = {
      projectId,
      ip: '127.0.0.1',
    } as unknown as Request & { projectId: string };

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
    
    // Fire 65 rapid requests to guarantee breach over the 60 threshold
    for (let i = 0; i < 65; i++) {
      await rateLimiter(req, res, () => {});
      if (res.statusCode === 429) break;
    }

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      error: expect.stringContaining('Too many requests'),
    });
  });

  it('should gracefully clean the sliding window history over time', async () => {
    const { req, res } = createMockContext('proj_gamma');

    for (let i = 0; i < 65; i++) {
      await rateLimiter(req, res, () => {});
      if (res.statusCode === 429) break;
    }
    
    expect(res.statusCode).toBe(429);

    // Simulate 60 seconds passing by dropping the tracking key from the cluster
    await testRedisClient.del('rate_limit:proj_gamma');

    let nextCalledAfterDelay = false;
    res.statusCode = 200; 
    
    await rateLimiter(req, res, () => {
      nextCalledAfterDelay = true;
    });

    expect(nextCalledAfterDelay).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from 'redis';

// 1. Use vi.hoisted to ensure the mock function initializes before vi.mock calls run
const { mockFindUnique } = vi.hoisted(() => {
  return { mockFindUnique: vi.fn() };
});

// 2. Mock external dependencies using ES6 classes
vi.mock('pg', () => {
  return {
    default: {
      Pool: class {
        constructor() {}
      }
    }
  };
});

vi.mock('@prisma/adapter-pg', () => {
  return {
    PrismaPg: class {
      constructor() {}
    }
  };
});

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      apiKey = {
        findUnique: mockFindUnique
      };
    }
  };
});

// 3. Import the target middleware after mocks are configured
import { validateApiKey } from '../middleware/validateKey.js';
import { type Request, type Response, type NextFunction } from 'express';

const testRedisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

describe('API Key Validation Middleware - Integration Tests', () => {
  beforeAll(async () => {
    await testRedisClient.connect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const keys = await testRedisClient.keys('api_key_meta:*');
    if (keys.length > 0) {
      await testRedisClient.del(keys);
    }
  });

  afterAll(async () => {
    await testRedisClient.disconnect();
  });

  const createMockContext = (apiKey?: string) => {
    const req = {
      headers: apiKey ? { 'x-api-key': apiKey } : {},
      projectId: undefined,
      environment: undefined,
    } as unknown as Request & { projectId?: string; environment?: string };

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
      }
    };

    const res = resMock as unknown as Response & typeof resMock;
    const next = (() => {}) as NextFunction;

    return { req, res, next };
  };

  it('should return 401 if x-api-key header is entirely missing', async () => {
    const { req, res } = createMockContext();
    
    await validateApiKey(req, res, () => {});

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: expect.stringContaining('API Key is missing')
    });
  });

  it('should query DB on cache miss, populate Redis metadata cache, and enrich request context', async () => {
    const apiKey = 'test_live_key_123';
    const { req, res } = createMockContext(apiKey);

    mockFindUnique.mockResolvedValueOnce({
      projectId: 'project_omega',
      isActive: true,
      project: { environment: 'production' }
    });

    let nextCalled = false;
    await validateApiKey(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.projectId).toBe('project_omega');
    expect(req.environment).toBe('production');

    const cachedData = await testRedisClient.get(`api_key_meta:${apiKey}`);
    expect(cachedData).not.toBeNull();
    expect(JSON.parse(cachedData!)).toMatchObject({
      projectId: 'project_omega',
      environment: 'production',
      isActive: true
    });
  });

  it('should pull metadata straight from Redis on cache hit and bypass database completely', async () => {
    const apiKey = 'test_warmed_key_789';
    const { req, res } = createMockContext(apiKey);

    const warmCachePayload = {
      projectId: 'project_cached_fast',
      environment: 'staging',
      isActive: true
    };
    await testRedisClient.set(`api_key_meta:${apiKey}`, JSON.stringify(warmCachePayload));

    let nextCalled = false;
    await validateApiKey(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.projectId).toBe('project_cached_fast');
    expect(req.environment).toBe('staging');
    
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('should drop a 403 status and write a short negative cache record when key is invalid', async () => {
    const apiKey = 'test_malicious_key_abc';
    const { req, res } = createMockContext(apiKey);

    mockFindUnique.mockResolvedValueOnce(null);

    await validateApiKey(req, res, () => {});

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      error: expect.stringContaining('Invalid or inactive API Key')
    });

    const cachedData = await testRedisClient.get(`api_key_meta:${apiKey}`);
    expect(cachedData).not.toBeNull();
    expect(JSON.parse(cachedData!)).toMatchObject({
      isActive: false
    });
  });
});
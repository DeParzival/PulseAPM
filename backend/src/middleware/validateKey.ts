import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { type Request, type Response, type NextFunction } from "express";
import { createClient } from "redis";

// Connect to PostgreSQL 
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Connect to ultra-fast Redis Cache Guard
const redisClient = createClient({ url: 'redis://localhost:6379' });
redisClient.connect().catch(console.error);

export interface AuthenticateRequest extends Request {
    projectId?: string;
    environment?: string;
}

export const validateApiKey = async (req: AuthenticateRequest, res: Response, next: NextFunction): Promise<any> => {
    try {
        const apiKey = req.headers['x-api-key'] as string;
        if (!apiKey) {
            return res.status(401).json({ error: 'Authentication failed. API Key is missing' });
        }

        const cacheKey = `api_key_meta:${apiKey}`;

        // 1. Try to read credentials from the fast Redis cache memory
        const cachedMeta = await redisClient.get(cacheKey);

        if (cachedMeta) {
            const { projectId, environment, isActive } = JSON.parse(cachedMeta);
            
            if (!isActive) {
                return res.status(403).json({ error: 'Authentication failed. Invalid or inactive API Key' });
            }

            req.projectId = projectId;
            req.environment = environment;
            return next();
        }

        // 2. Cache Miss: Read from slow PostgreSQL database instead
        const foundKey = await prisma.apiKey.findUnique({
            where: { key: apiKey },
            include: { project: true }
        });

        if (!foundKey || !foundKey.isActive) {
            // Cache the rejection negative result for a short time to block spam abuse
            await redisClient.set(cacheKey, JSON.stringify({ isActive: false }), { EX: 60 });
            return res.status(403).json({ error: 'Authentication failed. Invalid or inactive API Key' });
        }

        const metaPayload = {
            projectId: foundKey.projectId,
            environment: foundKey.project.environment,
            isActive: true
        };

        // 3. Save to Redis for 10 minutes so next requests bypass PostgreSQL completely
        await redisClient.set(cacheKey, JSON.stringify(metaPayload), { EX: 600 });

        req.projectId = foundKey.projectId;
        req.environment = foundKey.project.environment;
        
        next();
    } catch (error) {
        console.error('Security verification pipeline failed:', error);
        res.status(500).json({ error: 'Internal pipeline validation failure' });
    }
};
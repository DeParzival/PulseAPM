import {Router, type Request, type Response} from "express";
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { timeStamp } from "node:console";
import type { tryCatch } from "bullmq";

const router = Router();
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({adapter});

// 1. Fetch Historical Chart Data
router.get('/history/:projectId', async (req: Request, res: Response): Promise<any> => {
    try {
        const {projectId} = req.params;
        const hoursAgo = parseInt(req.query.hours as string ) || 24;

        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours()-hoursAgo);

        // Fetch aggregated 5-minute summaries sorted chronologically
        const history = await prisma.metricSummary.findMany({
            where:{
                projectId,
                timeStamp: {gte: cutoffDate}
            },
            orderBy: {timeStamp: 'asc'}
        });

        res.json(history);

    } catch (error) {
        console.error('Failed to fetch historical metrics:', error);
        res.status(500).json({ error: 'Failed to fetch historical chart data' });
    }
})

// 2. Fetch Top Recurring Errors
router.get('/errors/:projectId', async (req:Request, res:Response): Promise<any> => {
    try {
        const {projectId} = req.params;

        // Fetch the 10 most frequent bugs, just like Sentry.io does
        const topErrors = await prisma.errorGroup.findMany({
            where:{projectId},
            orderBy: {count:'asc'},
            take:10
        });

        res.json(topErrors);

    } catch (error) {
        console.error('Failed to fetch top errors:', error);
        res.status(500).json({ error: 'Failed to fetch error groupings' });
    }
});

export default router;

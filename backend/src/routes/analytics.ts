import {Router, type Request, type Response} from "express";
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';


const router = Router();
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({adapter});

// 1. Fetch Historical Chart Data
router.get('/history/:projectId', async (req: Request, res: Response): Promise<any> => {
    try {
        const projectId = req.params.projectId as string;
        const hoursAgo = parseInt(req.query.hours as string ) || 24;

        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours()-hoursAgo);

        // Fetch aggregated 5-minute summaries sorted chronologically
        const history = await prisma.metricSummary.findMany({
            where:{
                projectId,
                timestamp: {gte: cutoffDate}
            },
            orderBy: {timestamp: 'asc'}
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
        const projectId = req.params.projectId as string;

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

// 3. Fetch Single Error Group with child Occurrences, Breadcrumbs, and Telemetry
router.get('/error-group/:fingerprint', async (req: Request, res: Response): Promise<any> => {
    try {
        const fingerprint = req.params.fingerprint as string;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 5; // Fetch 5 occurrences at a time

        const errorGroup = await prisma.errorGroup.findUnique({
            where: { fingerprint }
        });

        if (!errorGroup) {
            return res.status(404).json({ error: 'Error Group not found' });
        }

        // Paginate individual crashes (containing heavy breadcrumb JSON structures)
        const occurrences = await prisma.errorOccurrence.findMany({
            where: { errorGroupFingerprint: fingerprint },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit
        });

        // Parse stringified JSON fields back into clean objects before returning to client
        const enrichedOccurrences = occurrences.map(occ => ({
            ...occ,
            breadcrumbs: typeof occ.breadcrumbs === 'string' ? JSON.parse(occ.breadcrumbs) : occ.breadcrumbs,
            telemetry: typeof occ.telemetry === 'string' ? JSON.parse(occ.telemetry) : occ.telemetry
        }));

        res.json({
            errorGroup,
            occurrences: enrichedOccurrences,
            pagination: {
                page,
                limit
            }
        });
    } catch (error) {
        console.error('Failed to fetch Error Group details:', error);
        res.status(500).json({ error: 'Failed to fetch occurrence details' });
    }
});

export default router;

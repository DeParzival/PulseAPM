import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { redisClient } from '../lib/redis.js';

const router = Router();

// 1. Fetch Historical Chart Data
router.get('/history/:projectId', async (req: Request, res: Response): Promise<any> => {
    try {
        const projectId = req.params.projectId as string;
        const hoursAgo = parseInt(req.query.hours as string) || 24;

        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - hoursAgo);

        // Fetch aggregated 5-minute summaries sorted chronologically
        const history = await prisma.metricSummary.findMany({
            where: {
                projectId,
                timeStamp: { gte: cutoffDate }
            },
            orderBy: { timeStamp: 'asc' }
        });

        res.json(history);

    } catch (error) {
        console.error('Failed to fetch historical metrics:', error);
        res.status(500).json({ error: 'Failed to fetch historical chart data' });
    }
});

// 2. Fetch Top Recurring Errors
router.get('/errors/:projectId', async (req: Request, res: Response): Promise<any> => {
    try {
        const projectId = req.params.projectId as string;

        // Fetch the 10 most frequent bugs, just like Sentry.io does
        const topErrors = await prisma.errorGroup.findMany({
            where: { projectId },
            orderBy: { count: 'desc' },
            take: 10
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
        const limit = parseInt(req.query.limit as string) || 5;

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

// 4. Dashboard Overview — combined live + historical summary
router.get('/overview/:projectId', async (req: Request, res: Response): Promise<any> => {
    try {
        const projectId = req.params.projectId as string;

        // Get live metrics from Redis
        const currentMinute = new Date().toISOString().substring(0, 16);
        const metricKey = `metrics:${projectId}:${currentMinute}`;
        
        let liveMetrics = { totalRequests: 0, errorRequests: 0 };
        try {
          const liveData = await redisClient.hGetAll(metricKey);
          liveMetrics = {
            totalRequests: parseInt(liveData.total_requests || '0', 10),
            errorRequests: parseInt(liveData.error_requests || '0', 10)
          };
        } catch {
          // Redis may not be available
        }

        // Get recent historical totals (last 1 hour)
        const oneHourAgo = new Date();
        oneHourAgo.setHours(oneHourAgo.getHours() - 1);

        const recentMetrics = await prisma.metricSummary.findMany({
            where: {
                projectId,
                timeStamp: { gte: oneHourAgo }
            }
        });

        const hourlyTotals = recentMetrics.reduce(
            (acc, m) => ({
                totalRequests: acc.totalRequests + m.totalRequests,
                errorRequests: acc.errorRequests + m.errorRequests
            }),
            { totalRequests: 0, errorRequests: 0 }
        );

        // Get error group count
        const errorGroupCount = await prisma.errorGroup.count({
            where: { projectId }
        });

        // Get project info
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { name: true, environment: true, createdAt: true }
        });

        res.json({
            project,
            live: liveMetrics,
            hourly: hourlyTotals,
            errorGroupCount
        });

    } catch (error) {
        console.error('Failed to fetch overview:', error);
        res.status(500).json({ error: 'Failed to fetch overview data' });
    }
});

export default router;
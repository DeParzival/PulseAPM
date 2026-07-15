import {Queue, Worker} from "bullmq";
import { createClient } from 'redis';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';


const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const redisClient = createClient({ url: 'redis://localhost:6379' });

const aggregationQueue = new Queue('metrics-aggregation',{
    connection: {host:'localhost', port: 6379}
});

async function flushMetrics() {
    console.log('Aggregator waking up to flush Redis metrics to PostgreSQL...');

    // 1. Find all active metric keys in Redis (e.g., metrics:project-id-123:2024-10-27T10:05)
    const keys = await redisClient.keys('metrics:*:*');
    if(keys.length === 0)
        return console.log('No new metrics to aggregate. Going back to sleep.');

    for(const key of keys){
        try {
            // we extract the project id and the minute stamp from the key name
            const [, projectId, minuteString] = key.split(':');
            const timeStamp = new Date(minuteString + ':00Z');

            // we read the final count from the redis scoreboard
            const totals = await redisClient.hGetAll(key);
            const totalReqs = parseInt(totals.total_requests || '0', 10);
            const errorReqs = parseInt(totals.error_requests || '0', 10);

            // 3. Save these counts permanently into PostgreSQL's history vault
            await prisma.metricSummary.upsert({
                where:{
                    projectId_timestamp: {projectId, timeStamp}
                },
                update:{
                    totalRequests: {increment: totalReqs},
                    errorRequests: {increment: errorReqs}
                },
                create:{
                    projectId,
                    timeStamp,
                    totalRequests:totalReqs,
                    errorRequests:errorReqs
                }
            });

            await redisClient.del(key);

        } catch (error) {
            console.error(`Failed to aggregate key ${key}`, error);
        }
    }
    console.log(`Successfully archived ${keys.length} metric windows to PostgreSQL.`);
}

// 5. The Worker that actually executes the job when BullMQ tells it to
const worker = new Worker('metrics-aggregation', async job => {
    if(job.name === 'flush-metrics')
        await flushMetrics();

}, {connection: {host: 'localhost', port: 6379}});

// 6. Schedule the job to run automatically
async function startcron(){
    await redisClient.connect();

    await aggregationQueue.add('flush-metrics', {}, {
        repeat: {
            pattern: '*/5 * * * *' // Standard Cron syntax: Run exactly every 5 minutes
        }
    });

    console.log('BullMQ Aggregator initialized. Scheduled to run every 5 minutes.');
}

startcron();
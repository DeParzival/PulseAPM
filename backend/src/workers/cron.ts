import {Queue, Worker} from "bullmq";
import { createClient } from 'redis';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import { uploadArchiveToMinIO } from "../services/storageService.js";


const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const redisClient = createClient({ url: 'redis://localhost:6379' });

const aggregationQueue = new Queue('metrics-aggregation',{
    connection: {host:'localhost', port: 6379}
});

const gzip = promisify(zlib.gzip);
const ARCHIVE_DIR = path.join(__dirname, "../../archive");

async function flushMetrics() {
    console.log('Aggregator waking up to flush Redis metrics to PostgreSQL...');

    // 1. Find all active metric keys in Redis
    const keys = await redisClient.keys('metrics:*:*');
    if(keys.length === 0)
        return console.log('No new metrics to aggregate. Going back to sleep.');

    for(const key of keys){
        try {
            // Extract the project id and the minute stamp from the key name
            const parts = key.split(':');
            const projectId = parts[1];
            const minuteString = parts[2];

            // FIX 1 & 2: Explicit type guard ensures strings are defined, narrowing out 'undefined'
            if (!projectId || !minuteString) {
                console.warn(`[Aggregator] Malformed Redis key skipped: ${key}`);
                continue;
            }

            const timeStamp = new Date(minuteString + ':00Z');

            // 2. Read the final count from the redis scoreboard
            const totals = await redisClient.hGetAll(key);
            const totalReqs = parseInt(totals.total_requests || '0', 10);
            const errorReqs = parseInt(totals.error_requests || '0', 10);

            // 3. Save these counts permanently into PostgreSQL's history vault
            await prisma.metricSummary.upsert({
                where:{
                    projectId_timeStamp: { projectId, timeStamp }
                },
                update:{
                    totalRequests: { increment: totalReqs },
                    errorRequests: { increment: errorReqs }
                },
                create:{
                    projectId,
                    timeStamp, // FIX 3: Fixed casing matching the variable name above
                    totalRequests: totalReqs,
                    errorRequests: errorReqs
                }
            });

            await redisClient.del(key);

        } catch (error) {
            console.error(`Failed to aggregate key ${key}`, error);
        }
    }
    console.log(`Successfully archived ${keys.length} metric windows to PostgreSQL.`);
}

async function processColdStorageArchiving() {
  console.log("[Cron Worker] Checking for local cold logs to archive...");
  
  try {
    const files = await fs.readdir(ARCHIVE_DIR);
    const logFiles = files.filter(file => file.endsWith(".json.log"));

    for (const file of logFiles) {
      const localPath = path.join(ARCHIVE_DIR, file);
      const fileStats = await fs.stat(localPath);

      // Skip empty files or files currently being written to
      if (fileStats.size === 0) continue;

      const fileData = await fs.readFile(localPath);
      const compressedData = await gzip(fileData);
      
      const zipFileName = `${file}.gz`;
      const tempZipPath = path.join(ARCHIVE_DIR, zipFileName);
      
      // Write temporary zip to prepare stream
      await fs.writeFile(tempZipPath, compressedData);

      // S3 upload key structure partitioned by date pattern: logs/YYYY-MM-DD/filename.gz
      const datePrefix = new Date().toISOString().split("T")[0];
      const s3Key = `logs/${datePrefix}/${zipFileName}`;

      try {
        await uploadArchiveToMinIO(s3Key, tempZipPath);
        console.log(`[Cron Worker] Successfully archived ${file} to cold storage slot: ${s3Key}`);
        
        // Evict local artifacts once safely stored
        await fs.unlink(localPath);
        await fs.unlink(tempZipPath);
      } catch (uploadError) {
        console.error(`[Cron Worker] Failed uploading ${file} to storage:`, uploadError);
        // Clean up temp zip but preserve raw source .json.log for retry execution
        await fs.unlink(tempZipPath).catch(() => {});
      }
    }
  } catch (error) {
    console.error("[Cron Worker] Error running cold storage pipeline:", error);
  }
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
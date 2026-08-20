import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { redisClient } from '../lib/redis.js';
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { uploadArchiveToMinIO } from '../services/storageService.js';
import { fileURLToPath } from 'url';

const gzip = promisify(zlib.gzip);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARCHIVE_DIR = path.join(__dirname, '../../archive');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const aggregationQueue = new Queue('metrics-aggregation', {
  connection: { host: REDIS_HOST, port: REDIS_PORT }
});

/**
 * Use SCAN instead of KEYS to avoid blocking Redis in production.
 * Returns all keys matching the given pattern.
 */
async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const result = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    keys.push(...result.keys);
  } while (cursor !== 0);
  return keys;
}

async function flushMetrics() {
  console.log('Aggregator waking up to flush Redis metrics to PostgreSQL...');

  // 1. Find all active metric keys in Redis using SCAN (non-blocking)
  const keys = await scanKeys('metrics:*:*');
  if (keys.length === 0)
    return console.log('No new metrics to aggregate. Going back to sleep.');

  for (const key of keys) {
    try {
      // Extract the project id and the minute stamp from the key name
      const parts = key.split(':');
      const projectId = parts[1];
      const minuteString = parts[2];

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
        where: {
          projectId_timeStamp: { projectId, timeStamp }
        },
        update: {
          totalRequests: { increment: totalReqs },
          errorRequests: { increment: errorReqs }
        },
        create: {
          projectId,
          timeStamp,
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
  console.log('[Cron Worker] Checking for local cold logs to archive...');
  
  try {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    const files = await fs.readdir(ARCHIVE_DIR);
    const logFiles = files.filter(file => file.endsWith('.json.log'));

    if (logFiles.length === 0) {
      console.log('[Cron Worker] No local log files to archive.');
      return;
    }

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
      const datePrefix = new Date().toISOString().split('T')[0];
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
    console.error('[Cron Worker] Error running cold storage pipeline:', error);
  }
}

// The Worker that actually executes the jobs when BullMQ tells it to
const worker = new Worker('metrics-aggregation', async job => {
  if (job.name === 'flush-metrics') {
    await flushMetrics();
  }
  if (job.name === 'archive-cold-storage') {
    await processColdStorageArchiving();
  }
}, { connection: { host: REDIS_HOST, port: REDIS_PORT } });

// Schedule the jobs to run automatically
async function startCron() {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    
  // Flush Redis metrics to PostgreSQL every 5 minutes
  await aggregationQueue.add('flush-metrics', {}, {
    repeat: {
      pattern: '*/5 * * * *'
    }
  });

  // Archive cold storage logs every 15 minutes
  await aggregationQueue.add('archive-cold-storage', {}, {
    repeat: {
      pattern: '*/15 * * * *'
    }
  });

  console.log('BullMQ Aggregator initialized. Metrics flush every 5min, cold storage archive every 15min.');
}

startCron();
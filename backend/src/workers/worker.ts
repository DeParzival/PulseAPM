import { Kafka } from "kafkajs";
import crypto from "crypto";
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createClient } from "redis";
import fs from "fs";
import path from "path";

// 1. Database Connections
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const redisClient = createClient({ url: 'redis://localhost:6379' });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// 2. Kafka Broker Configuration
const kafka = new Kafka({
    clientId: 'pulse-apm-worker',
    brokers: ['localhost:9092']
});
const consumer = kafka.consumer({ groupId: 'pulse-processing-group' });

// 3. Cold Storage Directory Setup (Matches your .gitignore settings)
const ARCHIVE_DIR = path.join(process.cwd(), 'archive');
if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

async function startWorker() {
    await redisClient.connect();
    await consumer.connect();
    
    // Subscribe to the incoming log flow
    await consumer.subscribe({ topic: 'incoming-logs', fromBeginning: true });
    console.log('Pulse High-Throughput Batch Worker is online...');

    // Switch from eachMessage to eachBatch to ingest data in bulk chunks
    await consumer.run({
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
            console.log(`Received an armful of ${batch.messages.length} messages from Kafka!`);
            
            const rawLogLines: string[] = [];

            for (const message of batch.messages) {
                if (!message.value) continue;

                try {
                    const log = JSON.parse(message.value.toString());
                    const { projectId, error, message: msgText, service } = log;

                    if (!projectId) continue;

                    // A. Archive the raw log line for Cold Storage
                    rawLogLines.push(JSON.stringify(log));

                    // B. Hot Storage: Compute Real-time counters inside Redis
                    const currentMinute = new Date().toISOString().substring(0, 16); 
                    const metricKey = `metrics:${projectId}:${currentMinute}`;

                    // Corrected Counter Logic: Track total hits distinctly from errors
                    await redisClient.hIncrBy(metricKey, 'total_requests', 1);
                    await redisClient.expire(metricKey, 3600); // Keep hot metrics alive for 1 hour

                    // C. Relational Storage: Process unique errors into PostgreSQL
                    if (error) {
                        // Keep a direct counter tally in Redis for immediate UI charting
                        await redisClient.hIncrBy(metricKey, 'error_requests', 1);

                        // Safe extraction formatting so worker never crashes on raw object variations
                        const errName = typeof error === 'object' ? error.name : 'ConsoleError';
                        const errMsg = typeof error === 'object' ? error.message : error;
                        const errStack = typeof error === 'object' ? error.stack : '';

                        const fingerprintData = `${projectId}:${errName}:${errMsg}:${errStack?.substring(0, 100) || ''}`;
                        const fingerprint = crypto.createHash('sha256').update(fingerprintData).digest('hex');

                        // Update statistical footprint trends in Postgres
                        await prisma.errorGroup.upsert({
                            where: { fingerprint },
                            update: {
                                count: { increment: 1 },
                                lastSeen: new Date()
                            },
                            create: {
                                fingerprint,
                                message: errMsg || msgText || 'Unknown Exception',
                                service: service || 'unnamed-service',
                                projectId,
                                count: 1
                            }
                        });
                    }
                } catch (parseError) {
                    console.error('Skipping broken/corrupted payload line:', parseError);
                }

                // Tell Kafka we successfully processed this specific message index
                resolveOffset(message.offset);
            }

            // D. Flush the raw logs directly out to our Cold Storage Archive file
            if (rawLogLines.length > 0) {
                const today = new Date().toISOString().split('T')[0];
                const archiveFilePath = path.join(ARCHIVE_DIR, `${today}.json.log`);
                
                // Append lines with newline breaks (\n) for clean JSON-Lines format tracking
                fs.appendFileSync(archiveFilePath, rawLogLines.join('\n') + '\n');
                console.log(`Successfully archived ${rawLogLines.length} raw events to cold storage disk.`);
            }

            // Keep the Kafka connection alive during heavy processing loops
            await heartbeat();
        }
    });
}

startWorker();
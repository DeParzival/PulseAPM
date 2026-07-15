// src/workers/worker.ts
import { Kafka } from "kafkajs";
import crypto from "crypto";
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createClient } from "redis";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const redisClient = createClient({ url: 'redis://localhost:6379' });
redisClient.connect().catch(console.error);

const kafka = new Kafka({
    clientId: 'pulse-apm-worker',
    brokers: ['localhost:9092']
});
const consumer = kafka.consumer({ groupId: 'pulse-processing-group' });

async function startWorker() {
    await consumer.connect();
    await consumer.subscribe({ topic: 'incoming-logs', fromBeginning: true });
    console.log('Pulse High-Throughput Worker is online and processing Kafka streams...');

    await consumer.run({
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
            console.log(`Pulled batch of ${batch.messages.length} messages from Kafka queue`);
            
            // Local memory bucket to collapse duplicate errors before hitting PostgreSQL
            const errorAggregationMap = new Map<string, {
                message: string;
                service: string;
                projectId: string;
                incrementCount: number;
            }>();

            for (const message of batch.messages) {
                if (!message.value) continue;

                try {
                    const log = JSON.parse(message.value.toString());
                    const { projectId, error, message: textMsg, service } = log;

                    if (!projectId) continue;

                    // 1. Accumulate Live Real-time Counters inside Redis Caching
                    const currentMinute = new Date().toISOString().substring(0, 16); 
                    const metricKey = `metrics:${projectId}:${currentMinute}`;
                    
                    await redisClient.hIncrBy(metricKey, 'total_requests', 1);
                    await redisClient.expire(metricKey, 3600); // Live details persist for 1 hour

                    if (error) {
                        await redisClient.hIncrBy(metricKey, 'error_requests', 1);

                        // Secure extraction logic ensuring text strings don't crash the signature step
                        const errName = typeof error === 'object' ? error.name : 'UncaughtException';
                        const errMsg = typeof error === 'object' ? error.message : error;
                        const errStack = typeof error === 'object' ? error.stack : '';

                        const fingerprintData = `${projectId}:${errName}:${errMsg}:${errStack?.substring(0, 100) || ''}`;
                        const fingerprint = crypto.createHash('sha256').update(fingerprintData).digest('hex');

                        // 2. Aggregate counts inside local memory buffer
                        const existing = errorAggregationMap.get(fingerprint);
                        if (existing) {
                            existing.incrementCount += 1;
                        } else {
                            errorAggregationMap.set(fingerprint, {
                                message: errMsg || textMsg || 'Unknown Error Payload',
                                service: service || 'unnamed-service',
                                projectId,
                                incrementCount: 1
                            });
                        }
                    }
                } catch (parseError) {
                    console.error('Found un-parseable event payload line:', parseError);
                }
                
                // Mark this message offset as parsed within the batch
                resolveOffset(message.offset);
            }

            // 3. Commit the accumulated error maps directly down to PostgreSQL in sequences
            for (const [fingerprint, metadata] of errorAggregationMap.entries()) {
                await prisma.errorGroup.upsert({
                    where: { fingerprint },
                    update: {
                        count: { increment: metadata.incrementCount },
                        lastSeen: new Date()
                    },
                    create: {
                        fingerprint,
                        message: metadata.message,
                        service: metadata.service,
                        projectId: metadata.projectId,
                        count: metadata.incrementCount
                    }
                });
            }

            console.log(`Completed processing and synchronized database metrics states.`);
            
            // Keep the consumer heartbeat alive to let Kafka know the node hasn't died
            await heartbeat();
        }
    });
}

startWorker();
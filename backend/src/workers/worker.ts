import 'dotenv/config';
import { Kafka } from "kafkajs";
import crypto from "crypto";
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createClient } from "redis";
import { checkAlertThreshold } from '../services/alertEngine.js';

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

// DLQ Recovery Step: Establish a dedicated producer to route poisoned payloads
const dlqProducer = kafka.producer();
const DLQ_TOPIC = 'incoming-logs-dlq';

// Route a malformed or invalid Kafka record to the Dead-Letter Queue
async function sendToDLQ(rawMessageValue: Buffer, reason: string, originalOffset: string) {
    try {
        await dlqProducer.send({
            topic: DLQ_TOPIC,
            messages: [{
                value: rawMessageValue,
                headers: {
                    'x-dead-letter-reason': Buffer.from(reason),
                    'x-dead-letter-timestamp': Buffer.from(new Date().toISOString()),
                    'x-original-offset': Buffer.from(originalOffset)
                }
            }]
        });
        console.warn(`[DLQ] Payload safely isolated to '${DLQ_TOPIC}'. Reason: "${reason}"`);
    } catch (dlqError) {
        console.error('FATAL: Failed to publish message to Dead-Letter Queue:', dlqError);
    }
}

async function startWorker() {
    await consumer.connect();
    await dlqProducer.connect(); // Connect the DLQ helper producer
    await consumer.subscribe({ topic: 'incoming-logs', fromBeginning: true });
    
    console.log('Pulse High-Throughput Worker is online with DLQ Recovery integration...');

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

            // Array to store individual occurrences to bulk-insert later
            const occurrencesToCreate: Array<{
                errorGroupFingerprint: string,
                message: string,
                breadcrumbs: any,
                telemetry: any,
                environment: string,
                releaseVersion: string | null;
            }>=[];

            for (const message of batch.messages) {
                if (!message.value) {
                    resolveOffset(message.offset);
                    continue;
                }

                let log: any;

                // 1. Safe JSON parsing with DLQ routing on failure
                try {
                    log = JSON.parse(message.value.toString());
                } catch (parseError: any) {
                    console.error(`Found un-parseable event payload at offset ${message.offset}. Isolating...`);
                    await sendToDLQ(message.value, `JSON_PARSE_ERROR: ${parseError.message}`, message.offset);
                    resolveOffset(message.offset);
                    continue;
                }

                const { projectId, error, message: textMsg, service, environment, breadcrumbs, telemetry, releaseVersion } = log;

                // 2. Validate essential fields (e.g., projectId) before processing
                if (!projectId) {
                    console.error(`Payload lacks crucial 'projectId' property at offset ${message.offset}. Isolating...`);
                    await sendToDLQ(message.value, 'MISSING_PROJECT_ID_ERROR', message.offset);
                    resolveOffset(message.offset);
                    continue;
                }

                try {
                    // Accumulate Live Real-time Counters inside Redis Caching
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

                        // Aggregate counts inside local memory buffer
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

                        occurrencesToCreate.push({
                            errorGroupFingerprint: fingerprint,
                            message: errMsg || textMsg || 'Unknown Error Payload',
                            breadcrumbs: breadcrumbs ? JSON.stringify(breadcrumbs) : null,
                            telemetry: telemetry ? JSON.stringify(telemetry) : null,
                            environment: environment || 'production',
                            releaseVersion: releaseVersion || 'v1.0.0'
                        });

                        await checkAlertThreshold(projectId, log.environment || 'production');
                    }
                } catch (processingError: any) {
                    // Isolation for runtime database failures while dealing with bad payload inputs
                    console.error(`Fatal processing crash during record indexing at offset ${message.offset}:`, processingError);
                    await sendToDLQ(message.value, `PROCESSING_ERROR: ${processingError.message}`, message.offset);
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

            // Bulk-insert individual occurrences in a single optimized database trip
            if (occurrencesToCreate.length > 0) {
                await prisma.errorOccurrence.createMany({
                    data: occurrencesToCreate,
                    skipDuplicates: false
                });
                console.log(`Successfully bulk-inserted ${occurrencesToCreate.length} individual occurrences.`);
            }

            console.log(`Completed processing and synchronized database metrics states.`);
            
            // Keep the consumer heartbeat alive to let Kafka know the node hasn't died
            await heartbeat();
        }
    });
}

startWorker();
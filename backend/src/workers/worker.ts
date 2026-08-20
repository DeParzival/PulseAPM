import 'dotenv/config';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { redisClient } from '../lib/redis.js';
import { kafka } from '../lib/kafka.js';
import { checkAlertThreshold } from '../services/alertEngine.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARCHIVE_DIR = path.join(__dirname, '../../archive');
const BATCH_SIZE = 1000;

// Local batch buffer for cold storage (Worker B)
let coldStorageBatch: any[] = [];
let batchFileCounter = 0;

async function flushColdStorageBatch() {
  if (coldStorageBatch.length === 0) return;
  
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  
  const timestamp = Date.now();
  const fileName = `batch-${timestamp}-${batchFileCounter++}.json.log`;
  const filePath = path.join(ARCHIVE_DIR, fileName);
  
  const data = coldStorageBatch.map(item => JSON.stringify(item)).join('\n');
  await fs.writeFile(filePath, data);
  console.log(`[Worker B] Flushed ${coldStorageBatch.length} raw logs to ${fileName}`);
  
  coldStorageBatch = [];
}

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

/**
 * Normalize incoming error payloads to handle both formats:
 * - Structured: { error: { name, message, stack } }
 * - Flat (load-test): { type, message, location }
 */
function normalizeError(log: any): { name: string; message: string; stack: string } | null {
  if (log.error && typeof log.error === 'object') {
    return {
      name: log.error.name || 'UnknownError',
      message: log.error.message || log.message || 'Unknown error',
      stack: log.error.stack || ''
    };
  }
  if (log.error && typeof log.error === 'string') {
    return {
      name: 'UncaughtException',
      message: log.error,
      stack: ''
    };
  }
  // Handle flat format from load-test.js (type + message at root)
  if (log.status === 'error' && log.type) {
    return {
      name: log.type,
      message: log.message || 'Unknown error',
      stack: log.location ? `at ${log.location}` : ''
    };
  }
  return null;
}

async function startWorker() {
    await consumer.connect();
    await dlqProducer.connect();
    await consumer.subscribe({ topic: 'incoming-logs', fromBeginning: false });
    
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
            }> = [];

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

                const { projectId, message: textMsg, service, environment, breadcrumbs, telemetry, releaseVersion } = log;

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
                    await redisClient.expire(metricKey, 3600);

                    // Normalize the error payload (handles both structured and flat formats)
                    const normalizedError = normalizeError(log);

                    if (normalizedError) {
                        await redisClient.hIncrBy(metricKey, 'error_requests', 1);

                        const fingerprintData = `${projectId}:${normalizedError.name}:${normalizedError.message}:${normalizedError.stack?.substring(0, 100) || ''}`;
                        const fingerprint = crypto.createHash('sha256').update(fingerprintData).digest('hex');

                        // Aggregate counts inside local memory buffer
                        const existing = errorAggregationMap.get(fingerprint);
                        if (existing) {
                            existing.incrementCount += 1;
                        } else {
                            errorAggregationMap.set(fingerprint, {
                                message: normalizedError.message || textMsg || 'Unknown Error Payload',
                                service: service || 'unnamed-service',
                                projectId,
                                incrementCount: 1
                            });
                        }

                        occurrencesToCreate.push({
                            errorGroupFingerprint: fingerprint,
                            message: normalizedError.message || textMsg || 'Unknown Error Payload',
                            breadcrumbs: breadcrumbs ? JSON.stringify(breadcrumbs) : null,
                            telemetry: telemetry ? JSON.stringify(telemetry) : null,
                            environment: environment || 'production',
                            releaseVersion: releaseVersion || null
                        });

                        await checkAlertThreshold(projectId, log.environment || 'production');
                    }

                    // Worker B: Append raw log to cold storage batch
                    coldStorageBatch.push(log);
                    if (coldStorageBatch.length >= BATCH_SIZE) {
                      await flushColdStorageBatch();
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

// Flush remaining batch on shutdown
process.on('SIGTERM', async () => {
  await flushColdStorageBatch();
  process.exit(0);
});

startWorker();
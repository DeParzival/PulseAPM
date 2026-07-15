import { Kafka } from "kafkajs";
import crypto from "crypto";
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createClient } from "redis";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// Pass the adapter into Prisma
const prisma = new PrismaClient({ adapter });



// connnect to redis
const redisClient = createClient({url:'redis://localhost:6379'});
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// connect to kafa
const kafka = new Kafka({
    clientId:'pulse-apm-worker',
    brokers:['localhost:9092']
});

const consumer = kafka.consumer({ groupId: 'pulse-processing-group' });

async function processLog(messageValue:string){
    const log = JSON.parse(messageValue);

    const {projectId, environment, error, message, service} = log;

    if(!projectId)
        return;

    // 1. LIVE METRICS AGGREGATION
    const currentMinute = new Date().toISOString().substring(0, 16); 
    const metricKey = `metrics:${projectId}:${currentMinute}`;

    // Increment total requests for this minute
    await redisClient.hIncrBy(metricKey, 'requests', 1);
    await redisClient.expire(metricKey, 60*60); // Keep this live data in RAM for 1 hour

    // 2. ERROR FINGERPRINTING & DEDUPLICATION
    if(error){
        // Increment the error counter on the live scoreboard
        await redisClient.hIncrBy(metricKey, 'requests', 1);

        // Create a unique string combining the Project ID, Error Name, and where it happened
        const fingerprintData = `${projectId}:${error.name}:${error.message}:${error.stack?.substring(0, 100) || ''}`;

        // Cryptographically hash that string into a clean, unique 64-character ID
        const fingerprint = crypto.createHash('sha256').update(fingerprintData).digest('hex');

        // UPSERT: "Update it if it exists, Insert it if it doesn't."
        await prisma.errorGroup.upsert({
            where:{fingerprint},
            update:{
                count:{ increment:1 },
                lastSeen : new Date()
            },
            create: {
                fingerprint,
                message: error.message || message || 'Unknown Error',
                service: service || 'Unknown service',
                projectId,
                count:1
            }
        });
    }
}

async function startWorker(){
    await redisClient.connect();
    await consumer.connect();

    await consumer.subscribe({topic: 'incoming-logs', fromBeginning: true});
    console.log('Pulse Worker is online and processing Kafka messages...');

    await consumer.run({
        eachMessage: async({message}) => {
            if(!message.value)  return;
            try {
                await processLog(message.value.toString());
            } catch (error) {
                console.error('Failed to process message from queue:', error);
            }
        }
    })
}

startWorker();
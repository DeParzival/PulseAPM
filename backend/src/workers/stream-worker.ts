import { Kafka } from "kafkajs";
import {createClient} from "redis";

// Connect to the ticket wheel
const kafka = new Kafka({
    clientId:'pulse-apm-worker',
    brokers:['localhost:9092']
});

// Creating a consumer instead of a producer
const consumer = kafka.consumer({groupId:'real-time-metrics-team'});

// Connect to the live scoreboard (Redis)
const redis = createClient({
    url:'redis://localhost:6379'
});

async function startWorker(){
    // Turn on the redis connection
    await redis.connect();
    console.log("Connected to the live scoreboard (Redis)!");

    await consumer.connect();
    console.log("Chef is standing by the ticket wheel (Kafka)!");

    // tell the chef which tickets to look for
    await consumer.subscribe({topic:'incoming-logs', fromBeginning:true});

    // start actively pulling tickets
    await consumer.run({
        eachMessage: async ({message}) => {
            // translate the ticket from a buffer back into readable format
            const logData = message.value?.toString();
            console.log(`Chef grabbed a ticket: ${logData}`);

            await redis.incr('live_error_count');

            const currentCount = await redis.get('live_error_count');
            console.log(`Scoreboard update -> Total live errors: ${currentCount}`);
        },
    });
}

startWorker();


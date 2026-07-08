import {Kafka} from "kafkajs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const kafka = new Kafka({
    clientId:'pulse-apm-batch-worker',
    brokers:['localhost:9092']
});

// create a consumer with it's own distinct id
const consumer = kafka.consumer({groupId:'cold-storage-archiver-team'});

let logBatch: any[] = [];

const BATCH_LIMIT=5;

async function startBatchWorker(){
    await consumer.connect();
    console.log("Archivist Worker is standing by the ticket wheel");

    // listen to the incoming logs
    await consumer.subscribe({topic:'incoming-logs', fromBeginning:true});

    await consumer.run({
        eachMessage: async ({message}) => {
            const rawLog = message.value?.toString();

            if(rawLog){
                // parse the flat string text back into a clean javascript object
                const parsedLog = JSON.parse(rawLog);

                // save it in our memory box
                logBatch.push(parsedLog);
                console.log(`Archivist added log to box. Box count: ${logBatch.length}/${BATCH_LIMIT}`);
            }

            // if the box is full
            if(logBatch.length>=BATCH_LIMIT){
                console.log("Box is full");

                // a unique filename using the current exact timestamp
                const fileName = `logs-batch-${Date.now()}.json`;

                // we are going to write code that mimics S3 perfectly by saving files into a local folder named archive
                const archiveDirectory = path.join(__dirname, '../../archive');
                const fullFilePath = path.join(archiveDirectory, fileName);

                if(!fs.existsSync(archiveDirectory))    fs.mkdirSync(archiveDirectory, {recursive:true});

                fs.writeFileSync(fullFilePath,JSON.stringify(logBatch, null, 2));
                console.log(` Successfully saved data lake file: ${fileName}`);

                // Empty our temporary box
                logBatch = [];
            }
        }
    })
}

startBatchWorker();
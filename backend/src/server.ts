import express from 'express';
import { Kafka } from 'kafkajs';
import authRoutes from './routes/auth.js'
import { validateApiKey, type AuthenticateRequest } from './middleware/validateKey.js';
import { rateLimiter } from './middleware/rateLimiter.js';

const app = express();
app.use(express.json());

app.use('/api/routes', authRoutes);

const kafka = new Kafka({
  clientId: 'pulse-apm-ingestion',
  brokers: ['localhost:9092']
});

const producer = kafka.producer();

app.post('/api/logs', validateApiKey, rateLimiter,async (req: AuthenticateRequest, res) => {
  try{
    const logData = req.body;
    
    // enrich the incoming data by baking the verified projectId directly into the message
    const enrichedLog = {
      ...logData,
      projectId: req.projectId,
      environment: req.environment,
      receivedAt: new Date().toISOString()
    };
      
    await producer.send({
      topic: 'incoming-logs',
      messages: [
        { value: JSON.stringify(enrichedLog) }
      ]
    });

    res.status(202).send({ message: 'Log safely checked by security and received in Kafka!' });
  } catch(error){
    console.error('Failed to stream log to Kafka queue:', error);
    res.status(500).json({error: 'Internal pipeline error processing log data'});
  }
});

async function startServer() {
  await producer.connect();
  console.log('Connected to Kafka Ticket Wheel!');
  
  app.listen(3000, () => {
    console.log('Waiter (Express) is listening on port 3000!');
  });
}

startServer();
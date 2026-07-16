import express from 'express';
import { Kafka } from 'kafkajs';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import analyticRoutes from './routes/analytics.js';
import { validateApiKey, type AuthenticateRequest } from './middleware/validateKey.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { createServer } from 'node:http';
import { createClient } from 'redis';

const app = express();

const httpServer = createServer(app);
const io = new Server(httpServer, {cors: {origin: '*'}});

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/analytics', analyticRoutes);


// Kafka ingestion
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

// Websocket
const redisClient = createClient({url: 'redis://localhost:6379'});

io.on('conneciton', (socket) => {
  console.log(`Browser connected to Dashboard Live Feed: ${socket.id}`);

  // When the UI loads a project dashboard, it asks to join a "room" for that specific project
    socket.on('subscribe', (projectId) => {
        socket.join(projectId);
        console.log(`User subscribed to live updates for project: ${projectId}`);
    });
});

setInterval( async () => {
  // Get all projects that currently have someone looking at their dashboard
  const activeProjects = Array.from(io.sockets.adapter.rooms.keys());

  for(const projectId of activeProjects){
    if(projectId.startsWith('socket'))  continue;

    const currentMinute = new Date().toISOString().substring(0, 16);
    const metricKey = `metrics:${projectId}:${currentMinute}`;

    const liveData = await redisClient.hGetAll(metricKey);

    // Push the ticking numbers straight into the user's browser!
    io.to(projectId).emit('live-metrics', {
        totalRequests: parseInt(liveData.total_requests || '0', 10),
        errorRequests: parseInt(liveData.error_requests || '0', 10)
    });

  }
}, 1000);

async function startServer() {
  await producer.connect();
  console.log('Connected to Kafka Ticket Wheel!');
  
  app.listen(3000, () => {
    console.log('Waiter (Express) is listening on port 3000!');
  });
}

startServer();
import 'dotenv/config';
import express from 'express';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import analyticRoutes from './routes/analytics.js';
import { validateApiKey, type AuthenticateRequest } from './middleware/validateKey.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { createServer } from 'node:http';
import { redisClient } from './lib/redis.js';
import { kafka } from './lib/kafka.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// Middleware
app.use(express.json());

// CORS for dashboard
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-api-key, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/analytics', analyticRoutes);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Kafka ingestion
const producer = kafka.producer();

app.post('/api/logs', validateApiKey, rateLimiter, async (req: AuthenticateRequest, res) => {
  try {
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
  } catch (error) {
    console.error('Failed to stream log to Kafka queue:', error);
    res.status(500).json({ error: 'Internal pipeline error processing log data' });
  }
});

// WebSocket
io.on('connection', (socket) => {
  console.log(`Browser connected to Dashboard Live Feed: ${socket.id}`);

  // When the UI loads a project dashboard, it asks to join a "room" for that specific project
  socket.on('subscribe', (projectId: string) => {
    socket.join(projectId);
    console.log(`User subscribed to live updates for project: ${projectId}`);
  });
});

setInterval(async () => {
  // Get all rooms, then filter out socket-id rooms by checking against the sids map
  const rooms = io.sockets.adapter.rooms;
  const sids = io.sockets.adapter.sids;

  for (const [roomId] of rooms) {
    // Skip rooms that are just individual socket IDs
    if (sids.has(roomId)) continue;

    const currentMinute = new Date().toISOString().substring(0, 16);
    const metricKey = `metrics:${roomId}:${currentMinute}`;

    try {
      const liveData = await redisClient.hGetAll(metricKey);

      // Push the ticking numbers straight into the user's browser!
      io.to(roomId).emit('live-metrics', {
        totalRequests: parseInt(liveData.total_requests || '0', 10),
        errorRequests: parseInt(liveData.error_requests || '0', 10)
      });
    } catch (err) {
      // Silently skip if Redis is temporarily unavailable
    }
  }
}, 1000);

async function startServer() {
  await producer.connect();
  console.log('Connected to Kafka!');
  
  httpServer.listen(3000, () => {
    console.log('PulseAPM API Server is listening on port 3000');
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await producer.disconnect();
  httpServer.close();
  process.exit(0);
});

startServer();
import express from 'express';
import { Kafka } from 'kafkajs';

const app = express();
app.use(express.json());

const kafka = new Kafka({
  clientId: 'pulse-apm-ingestion',
  brokers: ['localhost:9092']
});

const producer = kafka.producer();

app.post('/api/logs', async (req, res) => {
  const logData = req.body;
  
  await producer.send({
    topic: 'incoming-logs',
    messages: [
      { value: JSON.stringify(logData) }
    ]
  });

  res.status(202).send({ message: 'Log safely received in Kafka!' });
});

async function startServer() {
  await producer.connect();
  console.log('Connected to Kafka Ticket Wheel!');
  
  app.listen(3000, () => {
    console.log('Waiter (Express) is listening on port 3000!');
  });
}

startServer();
/**
 * PulseAPM Ingestion Simulator
 * Run this script to generate live traffic and error telemetry.
 */

const INGEST_URL = 'http://localhost:3000/api/logs';
const PROJECT_ID = 'proj_bench_99';

// Configuration parameters
const INTERVAL_MS = 300; // Time between simulated requests
const ERROR_CHANCE = 0.15; // 15% chance a request is an error crash event

const errorTemplates = [
  {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'fetchUser')",
    stack: 'TypeError: Cannot read properties of null\n    at UserService.fetchUser (/services/userService.js:88:12)\n    at processRequest (/middleware/auth.js:34:8)'
  },
  {
    name: 'ReferenceError',
    message: 'config is not defined',
    stack: 'ReferenceError: config is not defined\n    at Object.<anonymous> (/config/database.js:14:5)\n    at Module._compile (node:internal/modules/cjs/loader:1241:14)'
  },
  {
    name: 'PrismaClientValidationError',
    message: 'Invalid invocation: Got invalid value for argument data',
    stack: 'PrismaClientValidationError: Invalid invocation\n    at Document.validate (/api/v1/posts.js:215:18)\n    at PrismaClient._executeRequest (prisma-client:6723:11)'
  }
];

async function sendLog(payload) {
  try {
    const response = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sk_bench_test_key_xyz' 
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`[Ingestion] Server responded with status: ${response.status}`);
    }
  } catch (error) {
    console.error(`[Ingestion Error] Failed to connect to backend server: ${error.message}`);
  }
}

function generateMockTraffic() {
  const isError = Math.random() < ERROR_CHANCE;
  
  const basePayload = {
    service: 'benchmark-service',
    timestamp: new Date().toISOString(),
    environment: 'production'
  };

  if (isError) {
    // Pick a random error template — now properly structured with error object
    const template = errorTemplates[Math.floor(Math.random() * errorTemplates.length)];
    const payload = {
      ...basePayload,
      message: template.message,
      error: {
        name: template.name,
        message: template.message,
        stack: template.stack
      }
    };
    console.log(`\u{1F4A5} Simulating Exception: ${template.name} — ${template.message.substring(0, 50)}...`);
    sendLog(payload);
  } else {
    const payload = {
      ...basePayload,
      message: 'GET /api/v1/products - Status 200'
    };
    console.log(`\u{2705} Simulating Successful Traffic Ingress`);
    sendLog(payload);
  }
}

console.log(`\u{1F680} Starting PulseAPM traffic simulator targeting project: ${PROJECT_ID}`);
console.log(`\u{1F4E1} Sending payloads to: ${INGEST_URL} every ${INTERVAL_MS}ms...`);
console.log(`Press Ctrl+C to terminate simulator.`);

// Initialize the event loop
setInterval(generateMockTraffic, INTERVAL_MS);
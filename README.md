<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff" />
  <img src="https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=fff" />
  <img src="https://img.shields.io/badge/Apache%20Kafka-231F20?logo=apachekafka&logoColor=fff" />
  <img src="https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=fff" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=fff" />
  <img src="https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=fff" />
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=fff" />
</p>

# PulseAPM

> A real-time Application Performance Monitoring system built from scratch. Ingest, process, and visualize thousands of error logs and traffic metrics per second through a distributed pipeline.

PulseAPM is a lightweight, self-hosted alternative to tools like Sentry and Datadog. It receives telemetry data from client applications, buffers it through Apache Kafka, processes it in real-time with intelligent error deduplication, and streams live metrics to a Next.js dashboard via WebSockets.

---

## Architecture

```
Client App                                              Dashboard (Next.js)
    │                                                        ▲
    │  POST /api/logs                                        │  WebSocket
    ▼                                                        │  (live-metrics)
┌──────────────────┐    ┌─────────┐    ┌──────────────┐    ┌─────────────┐
│  Express API     │───▶│  Kafka  │───▶│  Worker      │───▶│  Redis      │
│  (Ingestion)     │    │  Queue  │    │  (Processor)  │    │  (Live)     │
│                  │    └─────────┘    │              │    └─────────────┘
│  • validateKey   │                   │  • Normalize  │          │
│  • rateLimiter   │                   │  • Fingerprint│          │ every 5 min
│  • 202 Accepted  │                   │  • DLQ        │          ▼
└──────────────────┘                   │  • Batch      │    ┌─────────────┐
                                       └──────┬───────┘    │ PostgreSQL  │
                                              │            │ (Historical)│
                                              │ batch      └─────────────┘
                                              ▼
                                        ┌─────────────┐
                                        │  MinIO (S3)  │
                                        │ (Cold Store) │
                                        └─────────────┘
```

### Data Flow

1. **Ingestion** — Client sends a log to the Express API. The API validates the API key via Redis cache, applies rate limiting, publishes the payload to a Kafka topic (`incoming-logs`), and returns `202 Accepted` immediately.
2. **Stream Processing** — A background Kafka consumer pulls batches of messages. For each log, it increments live traffic counters in Redis. Error payloads are normalized, fingerprinted using SHA-256, and deduplicated into `ErrorGroup` records in PostgreSQL.
3. **Cold Storage** — Raw logs are buffered locally and flushed to disk in batches of 1,000. A BullMQ cron job compresses these files with gzip and uploads them to MinIO (S3) every 15 minutes.
4. **Aggregation** — Every 5 minutes, a BullMQ cron job scans Redis for temporary metric keys, persists them to PostgreSQL's `MetricSummary` table, and deletes the Redis keys.
5. **Live Dashboard** — The Next.js frontend subscribes to a WebSocket room for a specific project. The server polls Redis every second and pushes live request/error counts to the browser.

---

## Tech Stack

| Technology | Role | Why This Over Alternatives |
|---|---|---|
| **TypeScript / Node.js** | API Server, Workers, Cron | Non-blocking I/O for high-concurrency ingestion; type safety across the entire pipeline |
| **Apache Kafka** | Event streaming buffer | High-throughput log ingestion with replay capability. Unlike RabbitMQ, Kafka retains messages and supports multiple consumer groups |
| **Redis** | Live metrics, rate limiting, API key cache | Sub-millisecond atomic counters (`HINCRBY`). No other datastore can match this latency for real-time ticking |
| **PostgreSQL** | Users, projects, historical analytics | APM data is highly relational (Users → Projects → API Keys → Error Groups). MongoDB would sacrifice referential integrity |
| **MinIO (S3)** | Cold storage archival | Infinitely scalable object storage for compressed raw logs. Far cheaper than storing raw JSON in PostgreSQL |
| **BullMQ** | Background job scheduling | Redis-backed, prevents overlapping cron executions across distributed workers |
| **Next.js + Tailwind** | Dashboard UI | App Router with built-in API proxy; component-driven architecture for real-time charts |
| **Socket.io** | Real-time streaming | Bi-directional WebSocket with room-based pub/sub for multi-tenant live feeds |
| **Docker Compose** | Local orchestration | Spins up Kafka, Zookeeper, Redis, PostgreSQL, and MinIO with a single command |

---

## Project Structure

```
pulse-apm/
├── docker-compose.yml          # Infrastructure services
├── .env                        # Environment variables
│
├── backend/
│   ├── src/
│   │   ├── server.ts           # Express API + WebSocket server
│   │   ├── lib/
│   │   │   ├── prisma.ts       # Singleton Prisma client
│   │   │   ├── redis.ts        # Singleton Redis client
│   │   │   └── kafka.ts        # Shared Kafka instance
│   │   ├── middleware/
│   │   │   ├── validateKey.ts  # API key auth with Redis cache-aside
│   │   │   └── rateLimiter.ts  # Sliding-window rate limiter
│   │   ├── routes/
│   │   │   ├── auth.ts         # Register, login, project creation
│   │   │   └── analytics.ts   # Historical charts, error groups, overview
│   │   ├── workers/
│   │   │   ├── worker.ts       # Kafka consumer, fingerprinting, DLQ
│   │   │   └── cron.ts         # BullMQ metrics flush + cold archival
│   │   └── services/
│   │       ├── alertEngine.ts  # Threshold-based alerting with cooldown
│   │       ├── alertNotifier.ts# Discord webhook notifications
│   │       └── storageService.ts# MinIO S3 upload client
│   ├── prisma/
│   │   └── schema.prisma       # Database schema (6 models)
│   ├── seed.js                 # Database seeder (bcrypt-hashed passwords)
│   ├── load-test.js            # Traffic simulator
│   └── package.json
│
└── dashboard/
    ├── app/
    │   ├── page.tsx            # Main dashboard (WebSocket + REST)
    │   ├── layout.tsx          # Root layout with dark theme
    │   ├── globals.css         # Tailwind v4 + custom animations
    │   └── components/
    │       ├── Header.tsx      # App header with project selector
    │       ├── StatCard.tsx    # Animated metric cards
    │       ├── LiveChart.tsx   # Interactive SVG chart
    │       ├── ErrorPanel.tsx  # Error group viewer with drill-down
    │       └── StatusIndicator.tsx # WebSocket connection status
    └── package.json
```

---

## Database Schema

```
User ──┐
       │ 1:N
       ▼
    Project ──┬── ApiKey (1:N)
              │
              ├── ErrorGroup (1:N) ── ErrorOccurrence (1:N)
              │     • fingerprint (SHA-256, unique)
              │     • count (deduplicated)
              │     • breadcrumbs (JSONB)
              │     • telemetry (JSONB)
              │
              └── MetricSummary (1:N)
                    • totalRequests
                    • errorRequests
                    • @@unique([projectId, timeStamp])
```

---

## API Endpoints

### Ingestion
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/logs` | `x-api-key` header | Ingest telemetry. Validates key, rate-limits, publishes to Kafka. Returns `202 Accepted`. |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/analytics/overview/:projectId` | Combined live (Redis) + historical (PostgreSQL) dashboard summary |
| `GET` | `/api/analytics/history/:projectId?hours=24` | Time-series metrics for charts |
| `GET` | `/api/analytics/errors/:projectId` | Top 10 deduplicated error groups sorted by frequency |
| `GET` | `/api/analytics/error-group/:fingerprint?page=1&limit=5` | Detailed occurrences with breadcrumbs and telemetry |

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Create account (bcrypt-hashed password) |
| `POST` | `/api/auth/login` | Returns JWT token (24h expiry) |
| `POST` | `/api/auth/projects` | Create project + auto-generate API key |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server uptime and timestamp |

### WebSocket Events
| Event | Direction | Description |
|-------|-----------|-------------|
| `subscribe(projectId)` | Client → Server | Join a project's live feed room |
| `live-metrics` | Server → Client | Pushed every 1s with `{ totalRequests, errorRequests }` |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1. Start Infrastructure

```bash
docker compose up -d
```

This spins up Kafka, Zookeeper, Redis, PostgreSQL, and MinIO with health checks.

### 2. Backend Setup

```bash
cd backend
npm install
npx prisma migrate deploy
node seed.js
npm run dev
```

This starts the API server (port 3000), Kafka worker, and BullMQ cron concurrently.

### 3. Dashboard Setup

```bash
cd dashboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the live dashboard.

### 4. Simulate Traffic

```bash
cd backend
node load-test.js
```

Sends mock requests and error payloads every 300ms to populate live charts and error groups.

---

## Environment Variables

```env
# PostgreSQL
DATABASE_URL=postgresql://pulse_admin:pulse_secure_password_2026@localhost:5432/pulse_apm_db?schema=public

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# Kafka
KAFKA_BROKERS=localhost:9092

# MinIO (S3)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=pulse-cold-storage

# Alerts
DISCORD_WEBHOOK_URL=your_discord_webhook_url

# Auth
JWT_SECRET=your_jwt_secret
```

---

## Running Tests

```bash
cd backend
npm test
```

Tests cover rate limiting logic and API key validation middleware using Vitest.

---

## Key Engineering Decisions

- **Kafka `fromBeginning: false`** — Prevents full stream replay and data duplication on worker restart.
- **Redis `SCAN` over `KEYS`** — Non-blocking cursor iteration to avoid freezing the single-threaded Redis event loop.
- **Singleton Pattern** (`src/lib/`) — A single shared Prisma/Redis/Kafka instance prevents connection pool exhaustion across server, worker, and cron processes.
- **Error Normalization** — A `normalizeError()` adapter handles polymorphic payloads (nested `{ error: {} }`, flat `{ type, message }`, string exceptions) without dropping data.
- **Dead-Letter Queue** — Malformed Kafka messages are routed to `incoming-logs-dlq` with diagnostic headers instead of crashing the consumer.
- **Negative Caching** — Invalid API keys are cached in Redis for 60s to block repeated unauthorized flood attacks.

---

## License

MIT

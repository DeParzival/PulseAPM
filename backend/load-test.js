import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp up to 50 concurrent users
    { duration: '1m', target: 200 },  // Spike up to 200 concurrent users
    { duration: '30s', target: 0 },   // Ramp down to cold
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],     // Error rate must be under 1%
    http_req_duration: ['p(95)<200'],   // 95% of requests must complete below 200ms
  },
};

export default function () {
  const url = 'http://localhost:3000/api/logs'; 
  
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'Performance benchmark log payload entries',
    meta: { service: 'k6-load-runner', runtime: 'edge' }
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'test_live_key_123', 
    },
  };

  const res = http.post(url, payload, params);

  check(res, {
    'status is 202 or 200': (r) => r.status === 200 || r.status === 202,
  });

  sleep(0.1); 
}
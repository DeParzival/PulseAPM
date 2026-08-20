'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Header from './components/Header';
import StatCard from './components/StatCard';
import LiveChart from './components/LiveChart';
import ErrorPanel from './components/ErrorPanel';

const SOCKET_URL = 'http://localhost:3000';
const API_BASE = 'http://localhost:3000';

interface HistoryPoint {
  timeStamp: string;
  totalRequests: number;
  errorRequests: number;
}

export default function Dashboard() {
  const [projectId, setProjectId] = useState('proj_bench_99');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  
  // Live metrics
  const [totalRequests, setTotalRequests] = useState(0);
  const [errorRequests, setErrorRequests] = useState(0);
  const [errorRate, setErrorRate] = useState(0);
  const [chartHistory, setChartHistory] = useState<number[]>(new Array(30).fill(0));
  const [chartLabels, setChartLabels] = useState<string[]>(new Array(30).fill(''));

  // Historical data
  const [historyData, setHistoryData] = useState<number[]>([]);
  const [historyLabels, setHistoryLabels] = useState<string[]>([]);
  const [historyErrors, setHistoryErrors] = useState<number[]>([]);

  // Overview
  const [hourlyTotal, setHourlyTotal] = useState(0);
  const [hourlyErrors, setHourlyErrors] = useState(0);
  const [errorGroupCount, setErrorGroupCount] = useState(0);
  const [projectName, setProjectName] = useState('');
  
  // Uptime
  const [uptime, setUptime] = useState(0);

  // Fetch historical chart data
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/history/${projectId}?hours=1`);
      if (res.ok) {
        const data: HistoryPoint[] = await res.json();
        setHistoryData(data.map(d => d.totalRequests));
        setHistoryErrors(data.map(d => d.errorRequests));
        setHistoryLabels(data.map(d => {
          const date = new Date(d.timeStamp);
          return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }));
      }
    } catch {
      // API may not be available yet
    }
  }, [projectId]);

  // Fetch overview data
  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/overview/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setHourlyTotal(data.hourly?.totalRequests || 0);
        setHourlyErrors(data.hourly?.errorRequests || 0);
        setErrorGroupCount(data.errorGroupCount || 0);
        setProjectName(data.project?.name || projectId);
      }
    } catch {
      // API may not be available yet
    }
  }, [projectId]);

  // Fetch health
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setUptime(Math.floor(data.uptime || 0));
      }
    } catch {
      // ignore
    }
  }, []);

  // WebSocket connection
  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      setConnectionStatus('connected');
      socket.emit('subscribe', projectId);
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socket.on('reconnecting', () => {
      setConnectionStatus('reconnecting');
    });

    socket.on('connect_error', () => {
      setConnectionStatus('disconnected');
    });

    socket.on('live-metrics', (data: { totalRequests: number; errorRequests: number }) => {
      setTotalRequests(data.totalRequests);
      setErrorRequests(data.errorRequests);

      const rate = data.totalRequests > 0
        ? (data.errorRequests / data.totalRequests) * 100
        : 0;
      setErrorRate(rate);

      const now = new Date();
      const label = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

      setChartHistory(prev => [...prev.slice(1), data.totalRequests]);
      setChartLabels(prev => [...prev.slice(1), label]);
    });

    return () => {
      socket.disconnect();
    };
  }, [projectId]);

  // Periodic data fetching
  useEffect(() => {
    fetchHistory();
    fetchOverview();
    fetchHealth();

    const historyInterval = setInterval(fetchHistory, 30000);
    const overviewInterval = setInterval(fetchOverview, 15000);
    const healthInterval = setInterval(fetchHealth, 10000);

    return () => {
      clearInterval(historyInterval);
      clearInterval(overviewInterval);
      clearInterval(healthInterval);
    };
  }, [fetchHistory, fetchOverview, fetchHealth]);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  const getErrorSeverity = (): 'normal' | 'warning' | 'critical' => {
    if (errorRate > 25) return 'critical';
    if (errorRate > 10) return 'warning';
    return 'normal';
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-violet-500/30 selection:text-violet-200">
      <Header
        connectionStatus={connectionStatus}
        projectId={projectId}
        onProjectChange={setProjectId}
      />

      <main className="max-w-7xl mx-auto p-5 space-y-5">
        {/* Project title bar */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100 tracking-tight">
              {projectName || projectId}
            </h1>
            <p className="text-[10px] text-zinc-500 font-mono mt-0.5">ID: {projectId}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-zinc-500">Server Uptime</p>
            <p className="text-xs text-zinc-400 font-mono">{formatUptime(uptime)}</p>
          </div>
        </div>

        {/* Stats grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Live Requests (This Minute)"
            value={totalRequests}
            suffix="reqs"
            format="number"
            subtitle="Real-time via WebSocket stream"
            trend={totalRequests > 0 ? 'up' : 'neutral'}
          />
          <StatCard
            label="Error Rate"
            value={errorRate}
            suffix="%"
            format="percent"
            severity={getErrorSeverity()}
            subtitle={`${errorRequests} errors this minute`}
          />
          <StatCard
            label="Hourly Volume"
            value={hourlyTotal}
            suffix="total"
            format="number"
            subtitle={`${hourlyErrors} errors in last hour`}
          />
          <StatCard
            label="Error Groups"
            value={errorGroupCount}
            suffix="unique"
            format="number"
            subtitle="Deduplicated error fingerprints"
            severity={errorGroupCount > 20 ? 'warning' : 'normal'}
          />
        </section>

        {/* Charts + Errors grid */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <LiveChart
              data={chartHistory}
              labels={chartLabels}
              title="Real-time Ingestion Stream"
              subtitle="Live second-by-second request volume via WebSocket"
            />
            {historyData.length > 0 && (
              <LiveChart
                data={historyData}
                labels={historyLabels}
                title="Historical Request Volume"
                subtitle="Aggregated minute-by-minute summaries from PostgreSQL"
              />
            )}
          </div>

          <ErrorPanel
            projectId={projectId}
            apiBase={API_BASE}
          />
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-800/50 pt-4 pb-6 flex items-center justify-between text-[10px] text-zinc-600">
          <span>PulseAPM v1.0 • Kafka → Redis → PostgreSQL → S3 Pipeline</span>
          <span className="font-mono">ws://{SOCKET_URL.replace('http://', '')}</span>
        </footer>
      </main>
    </div>
  );
}
"use client";

import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface ExceptionPayload {
  id: string;
  type: string;
  message: string;
  location: string;
  timeAgo: string;
}

export default function Dashboard() {
  const [totalRequests, setTotalRequests] = useState<number>(0);
  const [errorRate, setErrorRate] = useState<number>(0);
  const [chartHistory, setChartHistory] = useState<number[]>(new Array(20).fill(0));
  
  const [exceptions] = useState<ExceptionPayload[]>([
    {
      id: '1',
      type: 'TypeError',
      message: "Cannot read properties of undefined (reading 'map')",
      location: '/api/v1/checkout.ts • line 42',
      timeAgo: 'Just now'
    }
  ]);

  useEffect(() => {
    // Open a persistent pipe to the Express engine running on Port 3000
    const socket: Socket = io('http://localhost:3000', {
      transports: ['websocket']
    });

    socket.on('connect', () => {
      // Direct match to your server.ts: socket.on('subscribe', (projectId) => { ... })
      // Subscribing to the benchmark project seeded by your backend function
      socket.emit('subscribe', 'proj_bench_99');
    });

    // Direct match to your server.ts: io.to(projectId).emit('live-metrics', { ... })
    socket.on('live-metrics', (data: { totalRequests: number; errorRequests: number }) => {
      setTotalRequests(data.totalRequests);
      
      const calculatedErrorRate = data.totalRequests > 0 
        ? (data.errorRequests / data.totalRequests) * 100 
        : 0;
      setErrorRate(calculatedErrorRate);
      
      // Feed the real-time vector trendline
      setChartHistory((prev) => [...prev.slice(1), data.totalRequests]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const generateSvgPath = () => {
    const maxVal = Math.max(...chartHistory, 10);
    const width = 500;
    const height = 180;
    const points = chartHistory.map((val, index) => {
      const x = (index / (chartHistory.length - 1)) * width;
      const y = height - (val / maxVal) * height;
      return `${x},${y}`;
    });
    return `M ${points.join(' L ')}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-violet-500/30 selection:text-violet-200">
      <header className="border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-6 w-6 rounded bg-violet-600 flex items-center justify-center font-black text-xs text-white tracking-tighter">P</div>
          <span className="font-semibold tracking-tight text-sm">PulseAPM</span>
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-medium">Console</span>
        </div>
        <div className="flex items-center space-x-4 text-xs text-zinc-400">
          <span className="flex items-center space-x-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-zinc-300 font-medium">Ingestion Online</span>
          </span>
          <div className="h-4 w-px bg-zinc-800"></div>
          <button className="hover:text-zinc-100 transition-colors">Documentation</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm space-y-2">
            <p className="text-xs font-medium text-zinc-400 tracking-wide uppercase">Minute Volumetric load</p>
            <div className="flex items-baseline space-x-2">
              <span className="text-4xl font-bold tracking-tight">{totalRequests}</span>
              <span className="text-xs text-zinc-500 font-medium">total requests</span>
            </div>
            <p className="text-xs text-emerald-400 font-medium">Streaming project room: proj_bench_99</p>
          </div>

          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm space-y-2">
            <p className="text-xs font-medium text-zinc-400 tracking-wide uppercase">Ingestion Latency</p>
            <div className="flex items-baseline space-x-2">
              <span className="text-4xl font-bold tracking-tight text-zinc-400">7.14</span>
              <span className="text-xs text-zinc-500 font-medium">ms benchmark baseline</span>
            </div>
            <p className="text-xs text-zinc-500">Redis cache engine connection active</p>
          </div>

          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm space-y-2">
            <p className="text-xs font-medium text-zinc-400 tracking-wide uppercase">Calculated Error Rate</p>
            <div className="flex items-baseline space-x-2">
              <span className="text-4xl font-bold tracking-tight text-zinc-100">{errorRate.toFixed(2)}</span>
              <span className="text-xs text-zinc-500 font-medium">%</span>
            </div>
            <p className="text-xs text-zinc-500">Evaluating Kafka message failures</p>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 p-6 rounded-xl border border-zinc-800 bg-zinc-900/20 flex flex-col justify-between min-h-[350px]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">Real-time Ingestion Stream</h3>
                <p className="text-xs text-zinc-500">Live minute delta updates via streaming sockets</p>
              </div>
              <span className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-300 font-mono">Live</span>
            </div>
            
            <div className="flex-1 my-4 border border-zinc-800/60 rounded-lg p-2 flex items-end bg-zinc-950/80 relative overflow-hidden h-44">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 500 180" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2"/>
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0"/>
                  </linearGradient>
                </defs>
                <path
                  d={`${generateSvgPath()} L 500,180 L 0,180 Z`}
                  fill="url(#chartGlow)"
                  className="transition-all duration-300 ease-in-out"
                />
                <path
                  d={generateSvgPath()}
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-all duration-300 ease-in-out"
                />
              </svg>
            </div>
          </div>

          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/20 flex flex-col min-h-[350px]">
            <h3 className="font-semibold text-sm mb-1">Recent Ingress Exceptions</h3>
            <p className="text-xs text-zinc-500 mb-4">Latest unhandled crash payloads caught by SDK</p>

            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {exceptions.map((item) => (
                <div 
                  key={item.id} 
                  className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-mono text-violet-400 font-medium">{item.type}</span>
                    <span className="text-zinc-500">{item.timeAgo}</span>
                  </div>
                  <p className="text-xs text-zinc-300 truncate font-medium">{item.message}</p>
                  <p className="text-[10px] text-zinc-500 font-mono mt-1">{item.location}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
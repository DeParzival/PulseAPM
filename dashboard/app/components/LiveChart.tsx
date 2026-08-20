'use client';

import React, { useState } from 'react';

interface LiveChartProps {
  data: number[];
  labels?: string[];
  title: string;
  subtitle: string;
}

export default function LiveChart({ data, labels, title, subtitle }: LiveChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 45 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data, 10);
  const minVal = 0;

  const getX = (index: number) => padding.left + (index / Math.max(data.length - 1, 1)) * chartWidth;
  const getY = (value: number) => padding.top + chartHeight - ((value - minVal) / (maxVal - minVal)) * chartHeight;

  // Generate smooth path
  const linePath = data.map((val, i) => {
    const x = getX(i);
    const y = getY(val);
    return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
  }).join(' ');

  // Area fill path
  const areaPath = `${linePath} L ${getX(data.length - 1)},${padding.top + chartHeight} L ${padding.left},${padding.top + chartHeight} Z`;

  // Y-axis gridlines
  const yTicks = 5;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = Math.round((maxVal / yTicks) * i);
    const y = getY(value);
    return { value, y };
  });

  return (
    <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/20 flex flex-col min-h-[380px]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-sm text-zinc-100">{title}</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
          <span className="text-[10px] bg-zinc-800/80 px-2 py-0.5 rounded text-zinc-400 font-mono">Live</span>
        </div>
      </div>
      
      <div className="flex-1 border border-zinc-800/40 rounded-lg bg-zinc-950/60 relative overflow-hidden">
        <svg
          className="w-full h-full"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {yLines.map(({ value, y }, i) => (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#27272a" strokeWidth="0.5" strokeDasharray="4,4" />
              <text x={padding.left - 8} y={y + 3} textAnchor="end" fill="#52525b" fontSize="9" fontFamily="monospace">
                {value}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {labels && data.map((_, i) => {
            if (i % Math.max(1, Math.floor(data.length / 6)) !== 0 && i !== data.length - 1) return null;
            return (
              <text key={i} x={getX(i)} y={height - 5} textAnchor="middle" fill="#52525b" fontSize="8" fontFamily="monospace">
                {labels[i] || ''}
              </text>
            );
          })}

          {/* Area fill */}
          <path d={areaPath} fill="url(#chartGradient)" className="transition-all duration-500" />

          {/* Line */}
          <path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-500" />

          {/* Data points */}
          {data.map((val, i) => (
            <circle
              key={i}
              cx={getX(i)}
              cy={getY(val)}
              r={hoveredIndex === i ? 4 : 2}
              fill={hoveredIndex === i ? '#a78bfa' : '#8b5cf6'}
              stroke={hoveredIndex === i ? '#c4b5fd' : 'none'}
              strokeWidth="2"
              className="transition-all duration-200 cursor-pointer"
              onMouseEnter={() => setHoveredIndex(i)}
            />
          ))}

          {/* Hover tooltip */}
          {hoveredIndex !== null && (
            <g>
              <line x1={getX(hoveredIndex)} y1={padding.top} x2={getX(hoveredIndex)} y2={padding.top + chartHeight} stroke="#8b5cf6" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
              <rect x={getX(hoveredIndex) - 30} y={getY(data[hoveredIndex]!) - 28} width="60" height="20" rx="4" fill="#18181b" stroke="#3f3f46" strokeWidth="0.5" />
              <text x={getX(hoveredIndex)} y={getY(data[hoveredIndex]!) - 14} textAnchor="middle" fill="#e4e4e7" fontSize="10" fontWeight="bold" fontFamily="monospace">
                {data[hoveredIndex]}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

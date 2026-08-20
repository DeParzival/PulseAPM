'use client';

import React, { useEffect, useRef, useState } from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  suffix?: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  severity?: 'normal' | 'warning' | 'critical';
  format?: 'number' | 'percent' | 'raw';
}

export default function StatCard({ label, value, suffix, subtitle, trend, severity = 'normal', format = 'raw' }: StatCardProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value) {
      setIsAnimating(true);
      setDisplayValue(value);
      prevValue.current = value;
      const timer = setTimeout(() => setIsAnimating(false), 300);
      return () => clearTimeout(timer);
    }
  }, [value]);

  const severityColors = {
    normal: 'text-zinc-100',
    warning: 'text-amber-400',
    critical: 'text-red-400'
  };

  const severityBorders = {
    normal: 'border-zinc-800',
    warning: 'border-amber-500/30',
    critical: 'border-red-500/30'
  };

  const trendIcons = {
    up: '↑',
    down: '↓',
    neutral: '→'
  };

  const trendColors = {
    up: 'text-emerald-400',
    down: 'text-red-400',
    neutral: 'text-zinc-500'
  };

  const formattedValue = format === 'number' && typeof displayValue === 'number'
    ? displayValue.toLocaleString()
    : format === 'percent' && typeof displayValue === 'number'
    ? displayValue.toFixed(2)
    : displayValue;

  return (
    <div className={`p-5 rounded-xl border ${severityBorders[severity]} bg-zinc-900/30 backdrop-blur-sm space-y-2 transition-all duration-300 hover:bg-zinc-900/50`}>
      <p className="text-[10px] font-semibold text-zinc-400 tracking-wider uppercase">{label}</p>
      <div className="flex items-baseline space-x-2">
        <span className={`text-3xl font-bold tracking-tight ${severityColors[severity]} ${isAnimating ? 'animate-count' : ''}`}>
          {formattedValue}
        </span>
        {suffix && <span className="text-xs text-zinc-500 font-medium">{suffix}</span>}
        {trend && (
          <span className={`text-xs font-semibold ${trendColors[trend]}`}>
            {trendIcons[trend]}
          </span>
        )}
      </div>
      {subtitle && <p className="text-[10px] text-zinc-500 font-medium">{subtitle}</p>}
    </div>
  );
}

'use client';

import React from 'react';

interface StatusIndicatorProps {
  status: 'connected' | 'disconnected' | 'reconnecting';
}

export default function StatusIndicator({ status }: StatusIndicatorProps) {
  const config = {
    connected: {
      color: 'bg-emerald-500',
      glow: 'shadow-emerald-500/50',
      label: 'Ingestion Online',
      textColor: 'text-emerald-400'
    },
    disconnected: {
      color: 'bg-red-500',
      glow: 'shadow-red-500/50',
      label: 'Disconnected',
      textColor: 'text-red-400'
    },
    reconnecting: {
      color: 'bg-amber-500',
      glow: 'shadow-amber-500/50',
      label: 'Reconnecting...',
      textColor: 'text-amber-400'
    }
  };

  const { color, glow, label, textColor } = config[status];

  return (
    <span className="flex items-center space-x-1.5">
      <span className={`h-2 w-2 rounded-full ${color} ${glow} shadow-sm ${status === 'connected' ? 'animate-pulse-glow' : status === 'reconnecting' ? 'animate-pulse' : ''}`} />
      <span className={`font-medium text-xs ${textColor}`}>{label}</span>
    </span>
  );
}

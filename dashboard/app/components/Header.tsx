'use client';

import React from 'react';
import StatusIndicator from './StatusIndicator';

interface HeaderProps {
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  projectId: string;
  onProjectChange: (id: string) => void;
}

export default function Header({ connectionStatus, projectId, onProjectChange }: HeaderProps) {
  return (
    <header className="border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center font-black text-xs text-white tracking-tighter shadow-lg shadow-violet-500/20">
          P
        </div>
        <span className="font-semibold tracking-tight text-sm text-zinc-100">PulseAPM</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-semibold border border-violet-500/20">
          Console
        </span>
      </div>

      <div className="flex items-center space-x-4">
        {/* Project selector */}
        <div className="flex items-center space-x-2">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Project</label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => onProjectChange(e.target.value)}
            className="bg-zinc-800/60 border border-zinc-700/50 rounded-md px-2.5 py-1 text-xs text-zinc-300 font-mono w-36 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all"
          />
        </div>

        <div className="h-4 w-px bg-zinc-800" />
        <StatusIndicator status={connectionStatus} />
      </div>
    </header>
  );
}

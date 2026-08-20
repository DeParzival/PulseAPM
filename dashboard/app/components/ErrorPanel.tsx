'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface ErrorGroup {
  id: string;
  fingerprint: string;
  message: string;
  service: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  projectId: string;
}

interface ErrorOccurrence {
  id: string;
  message: string;
  breadcrumbs: any;
  telemetry: any;
  environment: string;
  releaseVersion: string | null;
  createdAt: string;
}

interface ErrorPanelProps {
  projectId: string;
  apiBase: string;
}

export default function ErrorPanel({ projectId, apiBase }: ErrorPanelProps) {
  const [errors, setErrors] = useState<ErrorGroup[]>([]);
  const [expandedFingerprint, setExpandedFingerprint] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<ErrorOccurrence[]>([]);
  const [loading, setLoading] = useState(false);
  const [occLoading, setOccLoading] = useState(false);

  const fetchErrors = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/analytics/errors/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setErrors(data);
      }
    } catch (err) {
      console.error('Failed to fetch errors:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, apiBase]);

  useEffect(() => {
    fetchErrors();
    const interval = setInterval(fetchErrors, 10000);
    return () => clearInterval(interval);
  }, [fetchErrors]);

  const toggleExpand = async (fingerprint: string) => {
    if (expandedFingerprint === fingerprint) {
      setExpandedFingerprint(null);
      setOccurrences([]);
      return;
    }
    
    setExpandedFingerprint(fingerprint);
    setOccLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/analytics/error-group/${fingerprint}?limit=3`);
      if (res.ok) {
        const data = await res.json();
        setOccurrences(data.occurrences || []);
      }
    } catch (err) {
      console.error('Failed to fetch occurrences:', err);
    } finally {
      setOccLoading(false);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/20 flex flex-col min-h-[380px]">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-sm text-zinc-100">Error Groups</h3>
        <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full font-semibold border border-red-500/20">
          {errors.length} groups
        </span>
      </div>
      <p className="text-[10px] text-zinc-500 mb-3">Top recurring exceptions from error fingerprinting</p>

      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {loading && errors.length === 0 && (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-xs">Loading errors...</div>
        )}
        {!loading && errors.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-zinc-600">
            <span className="text-2xl mb-2">✓</span>
            <span className="text-xs font-medium">No errors detected</span>
            <span className="text-[10px] text-zinc-700 mt-0.5">Your application is running clean</span>
          </div>
        )}
        {errors.map((error) => (
          <div key={error.id}>
            <div
              onClick={() => toggleExpand(error.fingerprint)}
              className={`p-3 rounded-lg border transition-all cursor-pointer group ${
                expandedFingerprint === error.fingerprint
                  ? 'bg-zinc-800/60 border-violet-500/30'
                  : 'bg-zinc-900/60 border-zinc-800/80 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-red-400 font-medium text-[11px]">{error.service}</span>
                  <span className="bg-red-500/10 text-red-300 px-1.5 py-0.5 rounded text-[9px] font-bold">
                    ×{error.count.toLocaleString()}
                  </span>
                </div>
                <span className="text-zinc-500 text-[10px]">{timeAgo(error.lastSeen)}</span>
              </div>
              <p className="text-xs text-zinc-300 truncate font-medium">{error.message}</p>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[9px] text-zinc-600 font-mono truncate max-w-[70%]">
                  {error.fingerprint.substring(0, 16)}...
                </p>
                <span className="text-[9px] text-zinc-600">
                  {expandedFingerprint === error.fingerprint ? '▲ Collapse' : '▼ Details'}
                </span>
              </div>
            </div>

            {/* Expanded detail panel */}
            {expandedFingerprint === error.fingerprint && (
              <div className="mt-1 p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/50 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-zinc-600">First Seen</span>
                    <p className="text-zinc-400 font-mono">{new Date(error.firstSeen).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-zinc-600">Last Seen</span>
                    <p className="text-zinc-400 font-mono">{new Date(error.lastSeen).toLocaleString()}</p>
                  </div>
                </div>

                <div className="border-t border-zinc-800/50 pt-2">
                  <p className="text-[10px] text-zinc-500 font-semibold mb-1.5">Recent Occurrences</p>
                  {occLoading ? (
                    <p className="text-[10px] text-zinc-600">Loading...</p>
                  ) : occurrences.length === 0 ? (
                    <p className="text-[10px] text-zinc-600">No occurrences found</p>
                  ) : (
                    <div className="space-y-1.5">
                      {occurrences.map((occ) => (
                        <div key={occ.id} className="p-2 rounded bg-zinc-900/60 border border-zinc-800/40">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-zinc-400 font-mono">{occ.environment}</span>
                            <span className="text-[9px] text-zinc-600">{timeAgo(occ.createdAt)}</span>
                          </div>
                          <p className="text-[10px] text-zinc-300 truncate">{occ.message}</p>
                          {occ.releaseVersion && (
                            <span className="text-[9px] text-violet-400 font-mono">{occ.releaseVersion}</span>
                          )}
                          {occ.telemetry && typeof occ.telemetry === 'object' && (
                            <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]">
                              {occ.telemetry.platform && <span className="text-zinc-500">Platform: {occ.telemetry.platform}</span>}
                              {occ.telemetry.nodeVersion && <span className="text-zinc-500">Node: {occ.telemetry.nodeVersion}</span>}
                            </div>
                          )}
                          {occ.breadcrumbs && Array.isArray(occ.breadcrumbs) && occ.breadcrumbs.length > 0 && (
                            <div className="mt-1.5 border-t border-zinc-800/30 pt-1">
                              <p className="text-[9px] text-zinc-600 font-semibold mb-0.5">Breadcrumb Trail</p>
                              {occ.breadcrumbs.slice(-3).map((bc: any, idx: number) => (
                                <div key={idx} className="flex items-center space-x-1.5 text-[9px]">
                                  <span className={`w-1 h-1 rounded-full ${
                                    bc.level === 'error' ? 'bg-red-400' : bc.level === 'warn' ? 'bg-amber-400' : 'bg-zinc-600'
                                  }`} />
                                  <span className="text-zinc-500 truncate">{bc.message}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

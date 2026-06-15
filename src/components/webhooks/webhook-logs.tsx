"use client";

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { RefreshCw, Play, CheckCircle, XCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function WebhookLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/webhooks/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpandLog = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
            <CheckCircle className="h-3 w-3" />
            Success
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-400 border border-red-500/20">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        );
      case 'no_match':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-400 border border-slate-700">
            <AlertCircle className="h-3 w-3" />
            No Match
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-400">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Execution Logs</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            View history of webhook trigger execution results and diagnostic payloads.
          </p>
        </div>

        <Button
          onClick={fetchLogs}
          variant="outline"
          disabled={loading}
          className="border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900 flex items-center gap-1.5"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 p-12 text-center bg-slate-900/10">
          <Play className="h-10 w-10 text-slate-500" />
          <h4 className="mt-4 text-sm font-semibold text-white">No Logs Found</h4>
          <p className="mt-1 text-xs text-slate-400 max-w-sm">
            Webhook triggers will log execution details here when payloads hit your workflow URL.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/60 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Workflow Name</th>
                  <th className="px-6 py-3">Customer Phone</th>
                  <th className="px-6 py-3">Customer Name</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs text-slate-300">
                {logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-900/20">
                        <td className="whitespace-nowrap px-6 py-4 font-mono text-[11px] text-slate-400">
                          {format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss')}
                        </td>
                        <td className="px-6 py-4 font-medium text-white">{log.workflow_name}</td>
                        <td className="whitespace-nowrap px-6 py-4 font-mono">{log.customer_phone || '—'}</td>
                        <td className="px-6 py-4">{log.customer_name || '—'}</td>
                        <td className="whitespace-nowrap px-6 py-4">{getStatusBadge(log.status)}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Button
                            onClick={() => toggleExpandLog(log.id)}
                            variant="ghost"
                            size="sm"
                            className="text-slate-400 hover:text-white px-2 py-1 text-[11px] h-7 flex items-center gap-1 ml-auto"
                          >
                            {isExpanded ? (
                              <>
                                <EyeOff className="h-3.5 w-3.5" /> Hide Details
                              </>
                            ) : (
                              <>
                                <Eye className="h-3.5 w-3.5" /> View Details
                              </>
                            )}
                          </Button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-950/40 px-6 py-4 border-t border-b border-slate-800/50">
                            <div className="space-y-3">
                              {log.error_message && (
                                <div className="rounded border border-red-500/10 bg-red-500/5 p-3">
                                  <span className="text-[11px] font-bold text-red-400 block uppercase tracking-wide">Error Message</span>
                                  <p className="mt-1 text-xs text-red-300">{log.error_message}</p>
                                </div>
                              )}
                              <div>
                                <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wide mb-1 font-mono">Payload Payload JSON</span>
                                <pre className="max-h-60 overflow-y-auto rounded bg-slate-900/60 p-3 text-[10px] font-mono text-slate-300 border border-slate-800/50">
                                  {JSON.stringify(log.payload, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// React import helper inside component file for Next.js compile safety
import React from 'react';

"use client";

import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { Copy, RefreshCw, Radio, CheckCircle, AlertCircle, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { extractJsonPaths } from '@/lib/generic-webhooks/utils';

export function WebhookConfiguration() {
  const [integrationName, setIntegrationName] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [channels, setChannels] = useState<{ id: string; display_phone_number: string }[]>([]);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Payload listening state
  const [isListening, setIsListening] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadData() {
      try {
        // Fetch active WhatsApp configurations
        const { data: configs } = await supabase
          .from('whatsapp_config')
          .select('id, phone_number_id');
        
        // Fetch detailed phone numbers from Meta verify or fallback to id
        // In wacrm, we can query public profiles or display phone number id.
        // Let's resolve what we have in whatsapp_config
        const channelsList = (configs || []).map((c) => ({
          id: c.id,
          display_phone_number: c.phone_number_id // Fallback representation
        }));
        setChannels(channelsList);

        // Fetch existing webhook integration
        const res = await fetch('/api/webhooks/config');
        if (res.ok) {
          const data = await res.json();
          if (data.config) {
            setIntegrationName(data.config.name);
            setSelectedChannel(data.config.whatsapp_config_id || '');
            setIntegrationId(data.config.id);
            setLastPayload(data.config.last_payload);
          }
        }
      } catch (err) {
        console.error('Failed to load webhook configuration:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleSave = async () => {
    if (!integrationName) {
      toast.error('Integration Name is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/webhooks/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: integrationName,
          whatsapp_config_id: selectedChannel || null
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save configuration');
      }

      const data = await res.json();
      setIntegrationId(data.config.id);
      setLastPayload(data.config.last_payload);
      toast.success('Webhook settings updated.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const getWebhookUrl = () => {
    if (!integrationId) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/api/webhooks/incoming/${integrationId}`;
  };

  const copyUrl = () => {
    const url = getWebhookUrl();
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success('Webhook URL copied to clipboard.');
  };

  // Polls the config API for updates to last_payload
  const startListening = () => {
    if (!integrationId) {
      toast.error('Please save your configuration first to generate a Webhook URL.');
      return;
    }
    setIsListening(true);
    toast.info('Listening for incoming payloads. Send a request to your Webhook URL now.');

    let count = 0;
    timerRef.current = setInterval(async () => {
      count++;
      if (count > 20) { // Stop polling after 1 minute (20 * 3s)
        stopListening();
        toast.warning('Listening timed out. No payload received.');
        return;
      }

      try {
        const res = await fetch('/api/webhooks/config');
        if (res.ok) {
          const data = await res.json();
          if (data.config && JSON.stringify(data.config.last_payload) !== JSON.stringify(lastPayload)) {
            setLastPayload(data.config.last_payload);
            stopListening();
            toast.success('Sample payload captured successfully!');
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);
  };

  const stopListening = () => {
    setIsListening(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const flattenedPaths = lastPayload ? extractJsonPaths(lastPayload) : [];

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Settings Form */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Integration Settings</h3>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-400">Integration Name</label>
            <Input
              value={integrationName}
              onChange={(e) => setIntegrationName(e.target.value)}
              placeholder="e.g. HubSpot Integration"
              className="bg-slate-950 text-white border-slate-800 focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-400">Select WhatsApp Channel</label>
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
            >
              <option value="">Select a channel...</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_phone_number}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/95 flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>

      {integrationId && (
        <>
          {/* Webhook URL Display */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Webhook URL</h3>
            <p className="mt-1 text-xs text-slate-400">
              Copy this URL and add it under the webhook section of the application you are integrating with.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={getWebhookUrl()}
                className="flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none"
              />
              <Button
                onClick={copyUrl}
                variant="outline"
                className="border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Test Payload Capture */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Response Received</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Send a test request from your external system to capture the JSON schema.
                </p>
              </div>

              <Button
                onClick={isListening ? stopListening : startListening}
                variant={isListening ? 'destructive' : 'outline'}
                className="flex items-center gap-2 shrink-0"
              >
                {isListening ? (
                  <>
                    <Radio className="h-4 w-4 animate-pulse text-white" />
                    Listening...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Test Connection
                  </>
                )}
              </Button>
            </div>

            {lastPayload ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 mb-3">
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-slate-200">Captured Schema Paths ({flattenedPaths.length} fields)</span>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto pr-2">
                    {flattenedPaths.map((path) => (
                      <span key={path} className="rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                        {path}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <span className="text-xs font-semibold text-slate-400 block mb-2 font-mono">Payload Sample:</span>
                  <pre className="max-h-60 overflow-y-auto rounded bg-slate-900 p-3 text-[11px] font-mono text-slate-300">
                    {JSON.stringify(lastPayload, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 p-8 text-center bg-slate-950/20">
                <AlertCircle className="h-8 w-8 text-slate-500" />
                <p className="mt-2 text-xs text-slate-400 max-w-xs">
                  No sample payload captured yet. Start listening and submit a request from your system.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

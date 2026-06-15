"use client";

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Copy, ToggleLeft, ToggleRight, Settings2, Play, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EditWorkflowModal } from './edit-workflow-modal';

export function WebhookWorkflows() {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [lastPayload, setLastPayload] = useState<any>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<any | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // 1. Fetch integration to get isConfigured & lastPayload
      const configRes = await fetch('/api/webhooks/config');
      if (configRes.ok) {
        const configData = await configRes.json();
        if (configData.config) {
          setIsConfigured(true);
          setLastPayload(configData.config.last_payload);
        }
      }

      // 2. Fetch workflows
      const workflowsRes = await fetch('/api/webhooks/workflows');
      if (workflowsRes.ok) {
        const workflowsData = await workflowsRes.json();
        setWorkflows(workflowsData.workflows || []);
      }
    } catch (err) {
      console.error('Failed to load workflows data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this workflow?')) return;
    try {
      const res = await fetch(`/api/webhooks/workflows/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        toast.success('Workflow deleted.');
        loadData();
      } else {
        throw new Error('Failed to delete');
      }
    } catch (err) {
      toast.error('Failed to delete workflow.');
    }
  };

  const handleToggleActive = async (workflow: any) => {
    try {
      const res = await fetch(`/api/webhooks/workflows/${workflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: workflow.name,
          recipient_name_field: workflow.recipient_name_field,
          recipient_phone_field: workflow.recipient_phone_field,
          conditions: workflow.conditions,
          actions: workflow.actions,
          is_active: !workflow.is_active
        })
      });
      if (res.ok) {
        toast.success(workflow.is_active ? 'Workflow deactivated.' : 'Workflow activated.');
        loadData();
      } else {
        throw new Error('Failed to update status.');
      }
    } catch (err) {
      toast.error('Failed to update active state.');
    }
  };

  const getWorkflowUrl = (workflowId: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/api/webhooks/incoming/${workflowId}`;
  };

  const copyUrl = (id: string) => {
    const url = getWorkflowUrl(id);
    navigator.clipboard.writeText(url);
    toast.success('Workflow Webhook URL copied.');
  };

  const openCreateModal = () => {
    if (!isConfigured) {
      toast.error('Please configure your webhook settings and select a WhatsApp channel first.');
      return;
    }
    if (!lastPayload) {
      toast.error('Please submit a test payload in the Configuration tab before creating workflows.');
      return;
    }
    if (workflows.length >= 5) {
      toast.error('Maximum limit of 5 workflows reached.');
      return;
    }
    setSelectedWorkflow(null);
    setIsModalOpen(true);
  };

  const openEditModal = (workflow: any) => {
    setSelectedWorkflow(workflow);
    setIsModalOpen(true);
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Workflows</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Define triggers and actions to send WhatsApp messages automatically ({workflows.length}/5 allowed).
          </p>
        </div>

        <Button
          onClick={openCreateModal}
          disabled={workflows.length >= 5 || !lastPayload}
          className="bg-primary text-primary-foreground hover:bg-primary/95 flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Create Workflow
        </Button>
      </div>

      {!isConfigured ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 p-12 text-center bg-slate-900/10">
          <AlertCircle className="h-10 w-10 text-slate-500" />
          <h4 className="mt-4 text-sm font-semibold text-white">Integration Not Configured</h4>
          <p className="mt-1 text-xs text-slate-400 max-w-sm">
            Configure integration settings and save under the Configuration tab before building workflows.
          </p>
        </div>
      ) : !lastPayload ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 p-12 text-center bg-slate-900/10">
          <AlertCircle className="h-10 w-10 text-slate-500" />
          <h4 className="mt-4 text-sm font-semibold text-white">Test Payload Required</h4>
          <p className="mt-1 text-xs text-slate-400 max-w-sm">
            Go to the Configuration tab and capture a test payload to map variables before setting up workflows.
          </p>
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 p-12 text-center bg-slate-900/10">
          <Settings2 className="h-10 w-10 text-slate-500" />
          <h4 className="mt-4 text-sm font-semibold text-white">No Workflows Configured</h4>
          <p className="mt-1 text-xs text-slate-400 max-w-sm">
            Build your first workflow to trigger WhatsApp templates on incoming JSON payloads.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {workflows.map((wf) => {
            const templateAction = wf.actions?.find((a: any) => a.type === 'send_template');
            return (
              <div key={wf.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-white">{wf.name}</h4>
                      <p className="text-[11px] text-slate-400 mt-1 font-mono break-all">{getWorkflowUrl(wf.id)}</p>
                    </div>

                    <button
                      onClick={() => handleToggleActive(wf)}
                      className="text-slate-400 hover:text-white shrink-0 p-1"
                    >
                      {wf.is_active ? (
                        <ToggleRight className="h-6 w-6 text-primary" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-slate-600" />
                      )}
                    </button>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 rounded-lg bg-slate-950 border border-slate-800/80 p-3 text-xs">
                    <div className="flex justify-between items-center text-slate-400 border-b border-slate-900 pb-1.5 mb-1.5">
                      <span className="font-semibold text-slate-200">Action details</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Trigger:</span>
                      <span className="text-white font-medium">On JSON Post</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">WhatsApp Template:</span>
                      <span className="text-white font-medium">{templateAction?.template_name || 'None'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex justify-between items-center border-t border-slate-800 pt-4">
                  <Button
                    onClick={() => copyUrl(wf.id)}
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-white text-xs px-2"
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy URL
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => openEditModal(wf)}
                      variant="ghost"
                      size="icon"
                      className="text-slate-400 hover:text-white h-8 w-8"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      onClick={() => handleDelete(wf.id)}
                      variant="ghost"
                      size="icon"
                      className="text-slate-400 hover:text-red-400 h-8 w-8"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isModalOpen && (
        <EditWorkflowModal
          workflow={selectedWorkflow}
          lastPayload={lastPayload}
          onClose={() => setIsModalOpen(false)}
          onSave={() => {
            setIsModalOpen(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

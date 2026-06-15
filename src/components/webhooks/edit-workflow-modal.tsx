"use client";

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, X, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { createClient } from '@/lib/supabase/client';
import { extractJsonPaths, type WebhookCondition } from '@/lib/generic-webhooks/utils';

interface EditWorkflowModalProps {
  workflow: any | null; // Null if creating a new workflow
  lastPayload: any;
  onClose: () => void;
  onSave: () => void;
}

export function EditWorkflowModal({ workflow, lastPayload, onClose, onSave }: EditWorkflowModalProps) {
  const isEditing = !!workflow;
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [recipientNameField, setRecipientNameField] = useState('');
  const [recipientPhoneField, setRecipientPhoneField] = useState('');
  
  // Conditions
  const [matchType, setMatchType] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<WebhookCondition[]>([]);

  // Templates & Action
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [bodyMappings, setBodyMappings] = useState<any[]>([]); // [{ index: 1, type: 'payload', value: '' }]
  const [headerMapping, setHeaderMapping] = useState<any>(null); // { type: 'payload', value: '' }

  const [saving, setSaving] = useState(false);

  const supabase = createClient();
  const availablePaths = lastPayload ? extractJsonPaths(lastPayload) : [];

  useEffect(() => {
    // Load approved templates
    async function loadTemplates() {
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .eq('status', 'Approved')
        .order('name');
      setTemplates(data || []);
    }
    loadTemplates();

    if (workflow) {
      setName(workflow.name);
      setIsActive(workflow.is_active);
      setRecipientNameField(workflow.recipient_name_field);
      setRecipientPhoneField(workflow.recipient_phone_field);

      const condsObj = workflow.conditions || {};
      setMatchType(condsObj.matchType === 'any' ? 'any' : 'all');
      setConditions(Array.isArray(condsObj.rules) ? condsObj.rules : []);

      const actionsList = workflow.actions || [];
      const templateAct = actionsList.find((a: any) => a.type === 'send_template');
      if (templateAct) {
        // Find template by name
        setSelectedTemplateId(templateAct.template_name || '');
        
        // Load mappings
        const bodyM = templateAct.mappings?.body || [];
        setBodyMappings(
          bodyM.map((m: any, idx: number) => ({
            index: idx + 1,
            type: m.type || 'payload',
            value: m.value || ''
          }))
        );

        if (templateAct.mappings?.headerText) {
          setHeaderMapping({
            type: templateAct.mappings.headerText.type || 'payload',
            value: templateAct.mappings.headerText.value || ''
          });
        }
      }
    }
  }, [workflow, supabase]);

  // Extracts variable indices like {{1}}, {{2}} from body text
  const parseTemplateVariables = (bodyText: string): number[] => {
    const regex = /\{\{(\d+)\}\}/g;
    const indices: number[] = [];
    let match;
    while ((match = regex.exec(bodyText)) !== null) {
      const idx = parseInt(match[1]);
      if (!indices.includes(idx)) indices.push(idx);
    }
    return indices.sort((a, b) => a - b);
  };

  const handleTemplateChange = (templateName: string) => {
    setSelectedTemplateId(templateName);
    const tmpl = templates.find((t) => t.name === templateName);
    if (!tmpl) {
      setBodyMappings([]);
      setHeaderMapping(null);
      return;
    }

    // Body variables
    const vars = parseTemplateVariables(tmpl.body_text);
    setBodyMappings(
      vars.map((v) => ({
        index: v,
        type: 'payload',
        value: ''
      }))
    );

    // Header variable check
    if (tmpl.header_type === 'text' && tmpl.header_content?.includes('{{1}}')) {
      setHeaderMapping({ type: 'payload', value: '' });
    } else {
      setHeaderMapping(null);
    }
  };

  const addCondition = () => {
    setConditions([...conditions, { field: '', operator: 'equals', value: '' }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, fieldKey: keyof WebhookCondition, val: string) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], [fieldKey]: val } as WebhookCondition;
    setConditions(updated);
  };

  const updateBodyMapping = (index: number, key: 'type' | 'value', val: string) => {
    setBodyMappings(
      bodyMappings.map((m) => (m.index === index ? { ...m, [key]: val } : m))
    );
  };

  const handleSave = async () => {
    if (!name) {
      toast.error('Workflow Name is required.');
      return;
    }
    if (!recipientPhoneField) {
      toast.error('Recipient Phone Mapping is required.');
      return;
    }
    if (!recipientNameField) {
      toast.error('Recipient Name Mapping is required.');
      return;
    }
    if (!selectedTemplateId) {
      toast.error('Please select a template action.');
      return;
    }

    setSaving(true);
    try {
      const selectedTmpl = templates.find((t) => t.name === selectedTemplateId);
      
      const payloadData = {
        name,
        is_active: isActive,
        recipient_name_field: recipientNameField,
        recipient_phone_field: recipientPhoneField,
        conditions: {
          matchType,
          rules: conditions
        },
        actions: [
          {
            type: 'send_template',
            template_name: selectedTemplateId,
            language: selectedTmpl?.language || 'en_US',
            mappings: {
              body: bodyMappings.map((m) => ({ type: m.type, value: m.value })),
              headerText: headerMapping ? { type: headerMapping.type, value: headerMapping.value } : null
            }
          }
        ]
      };

      const url = isEditing ? `/api/webhooks/workflows/${workflow.id}` : '/api/webhooks/workflows';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadData)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save workflow');
      }

      toast.success(isEditing ? 'Workflow updated.' : 'Workflow created.');
      onSave();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedTmpl = templates.find((t) => t.name === selectedTemplateId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex h-full max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-4">
          <h3 className="text-base font-semibold text-white">
            {isEditing ? `Edit Workflow: ${workflow.name}` : 'Create New Workflow'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md text-slate-400 hover:bg-slate-800 hover:text-white p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* General Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 pr-4">
                <label className="block text-xs font-semibold text-slate-400">Workflow Name *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Lead Alert Notification"
                  className="mt-1 bg-slate-950 text-white border-slate-800 focus:border-primary"
                />
              </div>

              <div className="flex flex-col items-end pt-5">
                <span className="text-xs text-slate-400 font-semibold mb-1">Is Active</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-400">Recipient Name Mapping *</label>
                <select
                  value={recipientNameField}
                  onChange={(e) => setRecipientNameField(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                >
                  <option value="">Select payload path...</option>
                  {availablePaths.map((path) => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400">Recipient Phone Mapping *</label>
                <select
                  value={recipientPhoneField}
                  onChange={(e) => setRecipientPhoneField(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                >
                  <option value="">Select payload path...</option>
                  {availablePaths.map((path) => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Conditions Section */}
          <div className="border-t border-slate-800/80 pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Conditions</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">Determine if the payload triggers this workflow.</p>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value as any)}
                  className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none"
                >
                  <option value="all">Match All Conditions</option>
                  <option value="any">Match Any Condition</option>
                </select>

                <Button
                  onClick={addCondition}
                  variant="outline"
                  size="sm"
                  className="border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900 text-xs py-1 px-2.5 flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Condition
                </Button>
              </div>
            </div>

            {conditions.length > 0 ? (
              <div className="space-y-3">
                {conditions.map((cond, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-lg bg-slate-950/40 border border-slate-800/60 p-3">
                    <select
                      value={cond.field}
                      onChange={(e) => updateCondition(idx, 'field', e.target.value)}
                      className="flex-1 rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    >
                      <option value="">Select path...</option>
                      {availablePaths.map((path) => (
                        <option key={path} value={path}>{path}</option>
                      ))}
                    </select>

                    <select
                      value={cond.operator}
                      onChange={(e) => updateCondition(idx, 'operator', e.target.value as any)}
                      className="w-36 rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    >
                      <option value="equals">Equals</option>
                      <option value="not_equals">Does not equal</option>
                      <option value="contains">Contains</option>
                      <option value="not_contains">Does not contain</option>
                      <option value="exists">Exists</option>
                      <option value="not_exists">Does not exist</option>
                    </select>

                    {!['exists', 'not_exists'].includes(cond.operator) && (
                      <Input
                        value={cond.value}
                        onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                        placeholder="Compare value"
                        className="w-36 bg-slate-950 text-white border-slate-800 py-1 h-8 text-xs focus:border-primary"
                      />
                    )}

                    <Button
                      onClick={() => removeCondition(idx)}
                      variant="ghost"
                      size="icon"
                      className="text-slate-400 hover:text-red-400 shrink-0 h-8 w-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 border border-dashed border-slate-800 rounded-lg bg-slate-950/10 text-center">
                <span className="text-xs text-slate-500 font-medium">No conditions configured. Trigger on any payload.</span>
              </div>
            )}
          </div>

          {/* Actions / Template Mapping */}
          <div className="border-t border-slate-800/80 pt-6 space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Action: Send Template</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">Choose which WhatsApp Template to send and map its variables.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">WhatsApp Template</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                >
                  <option value="">Select a template...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </select>
              </div>

              {selectedTmpl && (
                <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-4 space-y-4">
                  {/* Template text preview */}
                  <div className="rounded bg-slate-900 border border-slate-800/80 p-3 text-xs text-slate-300 font-mono leading-relaxed relative">
                    <span className="absolute right-2 top-2 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold text-slate-400">Preview</span>
                    {selectedTmpl.body_text}
                  </div>

                  {/* Header parameters */}
                  {headerMapping && (
                    <div className="space-y-2 border-t border-slate-900 pt-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                        <Info className="h-3.5 w-3.5" />
                        <span>Header Text Parameter</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={headerMapping.type}
                          onChange={(e) => setHeaderMapping({ ...headerMapping, type: e.target.value })}
                          className="rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none w-36"
                        >
                          <option value="payload">Payload Field</option>
                          <option value="static">Static Text</option>
                        </select>
                        {headerMapping.type === 'payload' ? (
                          <select
                            value={headerMapping.value}
                            onChange={(e) => setHeaderMapping({ ...headerMapping, value: e.target.value })}
                            className="flex-1 rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none"
                          >
                            <option value="">Select path...</option>
                            {availablePaths.map((path) => (
                              <option key={path} value={path}>{path}</option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            value={headerMapping.value}
                            onChange={(e) => setHeaderMapping({ ...headerMapping, value: e.target.value })}
                            placeholder="Static text"
                            className="flex-1 bg-slate-900 text-white border-slate-800 py-1 h-8 text-xs focus:border-primary"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Body parameters */}
                  {bodyMappings.length > 0 && (
                    <div className="space-y-3 border-t border-slate-900 pt-3">
                      <span className="text-xs font-semibold text-slate-400 block">Body Parameters Variables</span>
                      {bodyMappings.map((m) => (
                        <div key={m.index} className="flex items-center gap-2">
                          <span className="w-12 text-xs font-mono font-bold text-slate-500">{`{{${m.index}}}`}</span>
                          <select
                            value={m.type}
                            onChange={(e) => updateBodyMapping(m.index, 'type', e.target.value)}
                            className="rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none w-36"
                          >
                            <option value="payload">Payload Field</option>
                            <option value="static">Static Text</option>
                          </select>
                          {m.type === 'payload' ? (
                            <select
                              value={m.value}
                              onChange={(e) => updateBodyMapping(m.index, 'value', e.target.value)}
                              className="flex-1 rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none"
                            >
                              <option value="">Select path...</option>
                              {availablePaths.map((path) => (
                                <option key={path} value={path}>{path}</option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              value={m.value}
                              onChange={(e) => updateBodyMapping(m.index, 'value', e.target.value)}
                              placeholder="Static text"
                              className="flex-1 bg-slate-900 text-white border-slate-800 py-1 h-8 text-xs focus:border-primary"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-800 bg-slate-900 px-6 py-4">
          <Button
            onClick={onClose}
            variant="outline"
            className="border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900"
          >
            Cancel
          </Button>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/95 flex items-center gap-2"
          >
            {saving ? 'Saving...' : isEditing ? 'Update Workflow' : 'Create Workflow'}
          </Button>
        </div>
      </div>
    </div>
  );
}

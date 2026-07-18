'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  MessageCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  Copy,
  ExternalLink,
  Info,
  Check,
  Reply,
  XCircle,
  RefreshCw,
  RotateCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBroadcastStatus,
  getRecipientStatus,
} from '@/lib/broadcast-status';
import { useTranslations } from 'next-intl';

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, total, icon, color }: StatCardProps) {
  const safeValue = value || 0;
  const pct = total > 0 ? Math.round((safeValue / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          {icon}
        </div>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{safeValue.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

/**
 * Pure-CSS funnel chart: decreasing-width rounded bars.
 * Width is relative to the largest step (typically Sent) so we
 * always render a full bar at the top and proportional tails.
 */
function getGraphColor(twClass: string) {
  if (twClass.includes('primary')) return 'hsl(var(--primary))';
  if (twClass.includes('teal')) return '#14b8a6';
  if (twClass.includes('blue')) return '#3b82f6';
  if (twClass.includes('indigo')) return '#6366f1';
  if (twClass.includes('emerald')) return '#10b981';
  if (twClass.includes('red')) return '#ef4444';
  return 'hsl(var(--primary))';
}

function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const safeSteps = steps.map((s) => ({ ...s, value: s.value || 0 }));
  const max = Math.max(...safeSteps.map((s) => s.value), 1);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">Funnel</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={safeSteps} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
            <XAxis type="number" hide />
            <YAxis 
              type="category" 
              dataKey="label" 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 13, fontWeight: 500 }}
              width={100}
            />
            <Tooltip 
              cursor={{ fill: 'hsl(var(--muted)/0.5)' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  const pct = safeSteps[0].value > 0 ? Math.round((data.value / safeSteps[0].value) * 100) : 0;
                  return (
                    <div className="rounded-lg border border-border bg-popover p-3 shadow-md">
                      <p className="font-medium text-popover-foreground">{data.label}</p>
                      <p className="text-sm text-muted-foreground">{data.value.toLocaleString()} recipients</p>
                      <p className="text-xs text-muted-foreground mt-1">({pct}% of sent)</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
              {safeSteps.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getGraphColor(entry.color)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'not_in_whatsapp',
  'frequency_limit',
  'failed',
];

/**
 * CSV export helper — RFC 4180 quoting. Quote every field so
 * commas/newlines/quotes round-trip cleanly.
 */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getInitials(name?: string) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function renderStatusValue(status: string) {
  const label = status.toUpperCase().replace(/_/g, ' ');
  let icon: React.ReactNode = null;
  let colorClass = "text-muted-foreground";

  switch (status) {
    case 'sent':
      icon = <Check className="h-3.5 w-3.5" />;
      colorClass = "text-muted-foreground";
      break;
    case 'delivered':
      icon = <CheckCheck className="h-3.5 w-3.5" />;
      colorClass = "text-muted-foreground";
      break;
    case 'read':
      icon = <CheckCheck className="h-3.5 w-3.5 text-blue-500" />;
      colorClass = "text-blue-500 font-semibold";
      break;
    case 'replied':
      icon = <Reply className="h-3.5 w-3.5 text-purple-400" />;
      colorClass = "text-purple-400 font-semibold";
      break;
    case 'not_in_whatsapp':
      icon = <AlertCircle className="h-3.5 w-3.5 text-orange-400" />;
      colorClass = "text-orange-400 font-semibold";
      break;
    case 'frequency_limit':
      icon = <AlertCircle className="h-3.5 w-3.5 text-amber-400" />;
      colorClass = "text-amber-400 font-semibold";
      break;
    case 'unsubscribed':
      icon = <XCircle className="h-3.5 w-3.5 text-pink-400" />;
      colorClass = "text-pink-400 font-semibold";
      break;
    case 'failed':
      icon = <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      colorClass = "text-red-500 font-semibold";
      break;
    default:
      icon = null;
      colorClass = "text-muted-foreground";
  }

  return (
    <div className={`flex items-center gap-1.5 text-xs ${colorClass}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('Broadcasts.detail');
  const tStatus = useTranslations('Broadcasts.status');
  const broadcastId = params.id as string;

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all',
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatorName, setCreatorName] = useState<string>('');

  useEffect(() => {
    async function fetchData() {
      try {
        const supabase = createClient();

        const { data: bc, error: bcError } = await supabase
          .from('broadcasts')
          .select('*')
          .eq('id', broadcastId)
          .single();

        if (bcError) throw bcError;
        setBroadcast(bc);

        if (bc.user_id) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('user_id', bc.user_id)
            .maybeSingle();
          if (prof?.full_name) {
            setCreatorName(prof.full_name);
          }
        }

        const { data: recs, error: recsError } = await supabase
          .from('broadcast_recipients')
          .select('*, contact:contacts(*)')
          .eq('broadcast_id', broadcastId)
          .order('created_at', { ascending: false });

        if (recsError) throw recsError;
        setRecipients(recs ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('notFound'));
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [broadcastId]);

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter],
  );

  function handleExport() {
    if (!broadcast) return;
    const header = [
      t('table.contact'),
      t('table.phone'),
      t('table.status'),
      t('table.sent'),
      t('table.delivered'),
      t('table.read'),
      t('table.error'),
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(`broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // broadcast_recipients cascades on broadcasts.id (migration 001), so a
    // single delete is sufficient — the aggregate trigger in migration 003
    // is defined on broadcast_recipients but fires only on its own row
    // changes, not on a cascaded drop of the parent row.
    const { error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', broadcastId);
    setDeleting(false);
    if (delErr) {
      toast.error(t('toastFailedDelete', { error: delErr.message }));
      return;
    }
    toast.success(t('toastDeleted'));
    router.push('/broadcasts');
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? t('notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/broadcasts')}>
          {t('backToBroadcasts')}
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);

  const funnelSteps: FunnelStep[] = [
    { label: t('stats.sent'), value: broadcast.sent_count, color: 'bg-primary' },
    { label: t('stats.delivered'), value: broadcast.delivered_count, color: 'bg-teal-500' },
    { label: t('stats.read'), value: broadcast.read_count, color: 'bg-blue-500' },
    { label: t('stats.replied'), value: broadcast.replied_count, color: 'bg-indigo-500' },
  ];

  const displayStatusLabel = broadcast.status === 'sent' ? 'COMPLETED' : status.label.toUpperCase();
  const displayStatusClasses = broadcast.status === 'sent'
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : status.classes;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/broadcasts')}
            className="border-border"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{broadcast.name}</h1>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${displayStatusClasses}`}
              >
                {displayStatusLabel}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{creatorName || 'System'}</span>
              <span>|</span>
              <span>
                {new Date(broadcast.created_at).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="border-border text-xs gap-1.5 text-muted-foreground hover:bg-muted">
            <RefreshCw className="h-3.5 w-3.5" />
            Repeat Broadcast
          </Button>
          <Button size="sm" className="bg-primary text-white text-xs gap-1.5 hover:bg-primary/95">
            <RotateCw className="h-3.5 w-3.5" />
            Sync
          </Button>
          {confirmDelete ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
              <span className="text-red-300">{t('deletePrompt')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="h-7 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? t('deleting') : t('confirm')}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={broadcast.status === 'sending'}
              onClick={() => setConfirmDelete(true)}
              title={
                broadcast.status === 'sending'
                  ? t('cannotDeleteSending')
                  : t('deleteHover')
              }
              className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('delete')}
            </Button>
          )}
        </div>
      </div>

      {/* Metadata Panel */}
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-5 text-sm">
        <div>
          <p className="text-xs text-muted-foreground font-medium">Scheduled For</p>
          <p className="mt-1 font-semibold text-foreground">
            {broadcast.scheduled_at 
              ? new Date(broadcast.scheduled_at).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Immediate'}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">Message Template</p>
          <div className="mt-1 flex items-center gap-1.5 font-semibold text-foreground">
            <span className="truncate max-w-[140px]" title={broadcast.template_name}>{broadcast.template_name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 text-muted-foreground hover:text-foreground"
              onClick={() => {
                navigator.clipboard.writeText(broadcast.template_name);
                toast.success('Template name copied to clipboard');
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">Target Audience</p>
          <div className="mt-1 flex items-center gap-1.5 font-semibold text-foreground text-primary">
            <span className="truncate max-w-[140px]">
              {(broadcast.audience_filter?.filename as string) || 'broadcast_audience.csv'}
            </span>
            <Download className="h-3.5 w-3.5 shrink-0 cursor-pointer" />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">Reply Settings</p>
          <div className="mt-1 flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground cursor-pointer">
            <span>Learn more</span>
            <ExternalLink className="h-3 w-3" />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">Spend Estimate</p>
          <div className="mt-1 flex items-center gap-1 font-semibold text-foreground">
            <span>₹{(broadcast.sent_count * 0.12).toFixed(2)}</span>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
          </div>
        </div>
      </div>

      {/* Stats Section Header */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">Stats</h2>
          <span className="text-xs text-muted-foreground hover:underline cursor-pointer flex items-center gap-0.5">
            Learn more <ExternalLink className="h-3 w-3" />
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={recipients.length === 0}
          className="border-border text-xs gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Download Report
        </Button>
      </div>

      {/* Stats — 8 cards: Total / Sent / Delivered / Read / Replied / Not in WhatsApp / Frequency Limit / Failed */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard
          label={t('stats.totalRecipients')}
          value={broadcast.total_recipients}
          total={broadcast.total_recipients}
          icon={<Users className="h-4 w-4" />}
          color="bg-muted text-muted-foreground"
        />
        <StatCard
          label={t('stats.sent')}
          value={broadcast.sent_count}
          total={broadcast.total_recipients}
          icon={<Send className="h-4 w-4" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label={t('stats.delivered')}
          value={broadcast.delivered_count}
          total={broadcast.total_recipients}
          icon={<CheckCheck className="h-4 w-4" />}
          color="bg-teal-500/10 text-teal-400"
        />
        <StatCard
          label={t('stats.read')}
          value={broadcast.read_count}
          total={broadcast.total_recipients}
          icon={<Eye className="h-4 w-4" />}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          label={t('stats.replied')}
          value={broadcast.replied_count}
          total={broadcast.total_recipients}
          icon={<MessageCircle className="h-4 w-4" />}
          color="bg-indigo-500/10 text-indigo-400"
        />
        <StatCard
          label={t('stats.notInWhatsapp')}
          value={broadcast.not_in_whatsapp_count || 0}
          total={broadcast.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-orange-500/10 text-orange-400"
        />
        <StatCard
          label={t('stats.frequencyLimit')}
          value={broadcast.frequency_limit_count || 0}
          total={broadcast.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-amber-500/10 text-amber-400"
        />
        <StatCard
          label={t('stats.failed')}
          value={broadcast.failed_count}
          total={broadcast.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-red-500/10 text-red-400"
        />
      </div>

      <FunnelChart steps={funnelSteps} />

      {/* Recipients Table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {statusFilter !== 'all'
              ? t('recipientsHeader', { filtered: filteredRecipients.length, total: recipients.length })
              : t('recipientsHeaderAll', { total: recipients.length })}
          </h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-muted-foreground hover:bg-muted"
                  />
                }
              >
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === 'all'
                  ? t('allStatuses')
                  : tStatus(getRecipientStatus(statusFilter).label)}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-popover">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all' ? 'text-primary' : 'text-popover-foreground'
                  }
                >
                  {t('allStatuses')}
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      statusFilter === s
                        ? 'text-primary'
                        : 'text-popover-foreground'
                    }
                  >
                    {tStatus(getRecipientStatus(s).label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {recipients.length === 0
                ? t('noRecipients')
                : t('noRecipientsFilter')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">RECIPIENT NAME</TableHead>
                  <TableHead className="text-muted-foreground">PHONE</TableHead>
                  <TableHead className="text-muted-foreground">MESSAGE STATUS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const contactName = recipient.contact?.name ?? 'guest';
                  const initials = getInitials(contactName);
                  return (
                    <TableRow key={recipient.id} className="border-border">
                      <TableCell className="font-medium text-foreground">
                        <Link 
                          href={recipient.contact_id ? `/inbox?contactId=${recipient.contact_id}` : '#'}
                          className="flex items-center gap-3 hover:underline"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {initials}
                          </div>
                          <span>{contactName}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.contact?.phone ?? '-'}
                      </TableCell>
                      <TableCell>
                        {renderStatusValue(recipient.status)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

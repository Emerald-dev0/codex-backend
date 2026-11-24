import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, CreditCard, Download, LineChart as LineIcon, MessageSquare, ShieldAlert, Users } from 'lucide-react';
import Shell from '../components/Shell';
import {
  Avatar, Card, Delta, EmptyState, ErrorState, FilterSelect, PageHeader, Skeleton, StatCard, StatusPill, Table, TableSkeleton,
} from '../components/ui';
import { LineChart } from '../components/charts';
import { adminApi } from '../lib/api';
import useAsync from '../lib/useAsync';
import useSession from '../store/session';
import { compact, moneyWhole, number, pct, relative, time, MONTH_LABELS } from '../lib/format';
import { downloadCsv } from '../lib/csv';
import { toast } from '../store/toast';

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

function presetRange(preset) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (preset === 'last7') return { from: iso(new Date(today - 6 * DAY)), to: iso(today) };
  if (preset === 'last30') return { from: iso(new Date(today - 29 * DAY)), to: iso(today) };
  if (preset === 'last90') return { from: iso(new Date(today - 89 * DAY)), to: iso(today) };
  if (preset === 'lastMonth') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { from: iso(start), to: iso(end) };
  }
  return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(today) };
}

function rangeLabel(from, to) {
  if (!from || !to) return '';
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const ma = MONTH_LABELS[a.getUTCMonth()];
  const mb = MONTH_LABELS[b.getUTCMonth()];
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `${ma} ${a.getUTCDate()} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  }
  if (a.getUTCFullYear() === b.getUTCFullYear()) return `${ma} ${a.getUTCDate()} – ${mb} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  return `${ma} ${a.getUTCDate()}, ${a.getUTCFullYear()} – ${mb} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
}

const MIX_COLORS = ['#12dce5', '#5b4fd6', '#3a5876', '#59687a', '#2a7f86', '#8a38f5'];
const ATTENTION_ICONS = { sla: ShieldAlert, failed_payments: CreditCard, notifications: MessageSquare };

function activityStatus(item) {
  if (item.kind === 'payment' && item.status === 'successful') return 'paid';
  return item.status;
}

export default function Overview() {
  const admin = useSession((s) => s.admin);
  const [preset, setPreset] = useState('mtd');
  const range = useMemo(() => presetRange(preset), [preset]);
  const { data, error, loading, reload } = useAsync(() => adminApi.overview(range), [range.from, range.to]);
  const firstName = (admin?.fullName || '').split(' ')[0] || 'there';

  const growthLabels = useMemo(() => (data?.growth.days || []).map((d) => {
    const dt = new Date(`${d.day}T00:00:00Z`);
    return `${MONTH_LABELS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  }), [data]);
  const growthValues = (data?.growth.days || []).map((d) => d.users);
  // Show ~6 axis labels regardless of range length, like the frame (Oct 1, Oct 5…).
  const sparseLabels = growthLabels.map((l, i) => {
    const n = growthLabels.length;
    const step = Math.max(1, Math.ceil(n / 6));
    return i === 0 || i === n - 1 || (i % step === 0 && n - 1 - i >= step / 2) ? l : '';
  });

  const exportReport = () => {
    if (!data) return;
    const k = data.kpis;
    downloadCsv(`buildrshq-overview-${range.from}-to-${range.to}.csv`, [
      {
        title: `BuildrsHQ platform report (${rangeLabel(range.from, range.to)}, UTC)`,
        columns: ['Metric', 'Value', 'Detail'],
        rows: [
          ['Total users', k.totalUsers.count, `${k.totalUsers.newThisMonth} new this month`],
          ['Monthly recurring revenue (USD)', (k.mrr.amountMinor / 100).toFixed(2), k.mrr.changePct !== null ? `${k.mrr.changePct}% vs last month` : ''],
          ['Active workspaces', k.activeWorkspaces.count, `${k.activeWorkspaces.newThisMonth} new this month`],
          ['Open disputes', k.openDisputes.count, `${k.openDisputes.dueToday} need review within 24 hours`],
          ['Active users in range', data.growth.current, data.growth.changePct !== null ? `${data.growth.changePct}% vs previous period` : ''],
        ],
      },
      { title: 'Daily active users', columns: ['Date', 'Active users'], rows: data.growth.days.map((d) => [d.day, d.users]) },
      { title: 'Subscription mix', columns: ['Plan', 'Accounts', 'Share %'], rows: data.subscriptionMix.plans.map((p) => [p.label, p.count, p.pct]) },
      {
        title: 'Recent platform activity',
        columns: ['Account', 'Email', 'Activity', 'Status', 'Time (UTC)'],
        rows: data.recentActivity.map((a) => [a.account.name, a.account.email, a.activity, activityStatus(a), new Date(a.at).toISOString()]),
      },
    ]);
    toast.success('Report exported');
  };

  const k = data?.kpis;
  return (
    <Shell title="Overview">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle="Here’s what’s happening across BuildrsHQ today."
        actions={(
          <>
            <FilterSelect
              large
              value={preset}
              onChange={setPreset}
              placeholder={rangeLabel(range.from, range.to)}
              options={[
                { value: 'mtd', label: rangeLabel(presetRange('mtd').from, presetRange('mtd').to) },
                { value: 'last7', label: 'Last 7 days' },
                { value: 'last30', label: 'Last 30 days' },
                { value: 'last90', label: 'Last 90 days' },
                { value: 'lastMonth', label: 'Last month' },
              ]}
            />
            <button type="button" className="btn-secondary h-11 text-[15px]" onClick={exportReport} disabled={!data}>
              <Download className="h-4 w-4" /> Export report
            </button>
          </>
        )}
      />

      {error && !data ? (
        <Card><ErrorState message={error.message} onRetry={reload} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              loading={!data}
              href="/users"
              label="Total users"
              value={k && number(k.totalUsers.count)}
              delta={k && (k.totalUsers.changePct !== null
                ? <Delta value={pct(k.totalUsers.changePct)} label="vs. last month" tone={k.totalUsers.changePct >= 0 ? 'up' : 'down'} />
                : <Delta label={`${number(k.totalUsers.newThisMonth)} new this month`} />)}
            />
            <StatCard
              loading={!data}
              href="/billing"
              label="Monthly recurring revenue"
              value={k && moneyWhole(k.mrr.amountMinor)}
              delta={k && (k.mrr.changePct !== null
                ? <Delta value={pct(k.mrr.changePct)} label="vs. last month" tone={k.mrr.changePct >= 0 ? 'up' : 'down'} />
                : <Delta label={k.mrr.amountMinor ? 'Paid subscriptions' : 'No paid subscriptions yet'} />)}
            />
            <StatCard
              loading={!data}
              label="Active workspaces"
              value={k && number(k.activeWorkspaces.count)}
              delta={k && <Delta value={k.activeWorkspaces.newThisMonth ? `${number(k.activeWorkspaces.newThisMonth)} new` : ''} label={k.activeWorkspaces.newThisMonth ? 'this month' : 'No new workspaces this month'} />}
            />
            <StatCard
              loading={!data}
              href="/disputes"
              label="Open disputes"
              value={k && number(k.openDisputes.count)}
              delta={k && (k.openDisputes.dueToday
                ? <Delta value={`${k.openDisputes.dueToday} need review`} label="within 24 hours" tone="warn" arrow={false} />
                : <Delta label={k.openDisputes.count ? 'None due within 24 hours' : 'No open disputes'} />)}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
            <Card className="min-h-[333px]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[20px] font-medium text-white">Platform growth</h2>
                  <p className="mt-2 text-[14px] text-figma-text-muted">Active users over time · {rangeLabel(range.from, range.to)}</p>
                </div>
                <Link href="/insights" className="link flex items-center gap-1 text-[13px]">Insights <ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              {!data ? (
                <div className="mt-6 space-y-3"><Skeleton className="h-8 w-32" /><Skeleton className="h-[180px] w-full" /></div>
              ) : !data.growth.hasData ? (
                <EmptyState icon={LineIcon} title="No activity in this period" message="Active user trends will appear as people begin using the platform." />
              ) : (
                <>
                  <div className="mt-5 flex items-baseline gap-3">
                    <span className="text-[28px] font-semibold text-white">{number(data.growth.current)}</span>
                    {data.growth.changePct !== null && (
                      <span className={`text-[12px] ${data.growth.changePct >= 0 ? 'text-[#56e5a9]' : 'text-[#ec8f8f]'}`}>
                        {data.growth.changePct >= 0 ? '+' : ''}{pct(data.growth.changePct)}
                      </span>
                    )}
                    <span className="text-[12px] text-figma-text-muted">active users vs. previous period</span>
                  </div>
                  <div className={loading ? 'opacity-60 transition-opacity' : ''}>
                    <LineChart values={growthValues} labels={sparseLabels} area formatTick={compact} formatValue={(v) => `${number(v)} users`} height={190} tickSize={12} />
                  </div>
                </>
              )}
            </Card>

            <Card>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[20px] font-medium text-white">Subscription mix</h2>
                  <p className="mt-2 text-[14px] text-figma-text-muted">{data ? `${number(data.subscriptionMix.totalAccounts)} accounts across all plans` : 'Accounts across all plans'}</p>
                </div>
                <Link href="/billing" className="link flex items-center gap-1 text-[13px]">Details <ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              {!data ? (
                <div className="mt-6 space-y-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : data.subscriptionMix.plans.length === 0 ? (
                <EmptyState icon={Users} title="No accounts yet" message="Plan distribution appears once people sign up." />
              ) : (
                <>
                  <div className="mt-6 flex h-3.5 w-full gap-1 overflow-hidden rounded">
                    {data.subscriptionMix.plans.map((p, i) => (
                      <div key={p.tier} title={`${p.label} · ${p.pct}%`} style={{ width: `${Math.max(p.pct, 2)}%`, background: MIX_COLORS[i % MIX_COLORS.length] }} />
                    ))}
                  </div>
                  <ul className="mt-6 space-y-5">
                    {data.subscriptionMix.plans.slice(0, 5).map((p, i) => (
                      <li key={p.tier}>
                        <div className="flex justify-between text-[13px]">
                          <span className="text-white">{p.label}</span>
                          <span className="text-figma-text-muted">{number(p.count)} · {pct(p.pct, 0)}</span>
                        </div>
                        <div className="mt-2 h-1 rounded-full bg-[#1d263b]">
                          <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: MIX_COLORS[i % MIX_COLORS.length] }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[20px] font-medium text-white">Recent platform activity</h2>
                <Link href="/notifications" className="link flex items-center gap-1 text-[13px]">View all activity <ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              <Table minWidth={620} columns={[{ label: 'Account' }, { label: 'Activity' }, { label: 'Status' }, { label: 'Time', className: 'text-right' }]}>
                {!data ? <TableSkeleton rows={4} cols={4} /> : data.recentActivity.length === 0 ? (
                  <tr><td colSpan={4}><EmptyState title="No activity yet" message="Sign-ups, payments and disputes will appear here." /></td></tr>
                ) : data.recentActivity.map((a, i) => (
                  <tr key={`${a.kind}-${i}`} className="hover:bg-white/[0.02]">
                    <td className="td">
                      <Link href={a.link || '#'} className="flex items-center gap-3">
                        <Avatar name={a.account.name || a.account.email} size={32} />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-medium text-white">{a.account.name || '—'}</span>
                          <span className="block truncate text-[12px] text-figma-text-muted">{a.account.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="td text-[14px] text-figma-text-soft">{a.activity}</td>
                    <td className="td"><StatusPill status={activityStatus(a)} size="sm" /></td>
                    <td className="td whitespace-nowrap text-right text-[14px] text-figma-text-soft" title={new Date(a.at).toUTCString()}>
                      {Date.now() - new Date(a.at).getTime() < DAY ? `${new Date(a.at).toISOString().slice(11, 16)} UTC` : relative(a.at)}
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>

            <Card className="flex flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[20px] font-medium text-white">Needs your attention</h2>
                  <p className="mt-2 text-[14px] text-figma-text-muted">Your operations checklist</p>
                </div>
                {data && <span className="mt-2 text-[12px] text-figma-accent">{data.needsAttention.length} {data.needsAttention.length === 1 ? 'item' : 'items'}</span>}
              </div>
              <div className="mt-4 flex-1">
                {!data ? [0, 1, 2].map((i) => <Skeleton key={i} className="mb-4 h-14 w-full" />) : data.needsAttention.length === 0 ? (
                  <EmptyState icon={ShieldAlert} title="You’re all caught up" message="Nothing needs your attention right now." />
                ) : data.needsAttention.map((item) => {
                  const Icon = ATTENTION_ICONS[item.kind] || ShieldAlert;
                  return (
                    <Link key={item.kind} href={item.link} className="group flex items-start gap-3 border-b border-white/10 py-4 last:border-0">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${item.kind === 'failed_payments' ? 'text-[#ec8f8f]' : item.kind === 'sla' ? 'text-figma-warning' : 'text-figma-accent'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium text-white">{item.title}</span>
                        <span className="mt-1 block text-[12px] text-figma-text-muted">{item.detail}</span>
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-figma-text-muted group-hover:text-white" />
                    </Link>
                  );
                })}
              </div>
              {data && <p className="mt-4 text-[11px] text-figma-text-faint">Updated {relative(data.generatedAt)} · {time(data.generatedAt)} local · All activity times in UTC</p>}
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}

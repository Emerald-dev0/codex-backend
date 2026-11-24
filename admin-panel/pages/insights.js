import { Bot, CalendarDays, ChartNoAxesColumnIncreasing, TrendingUp } from 'lucide-react';
import Shell from '../components/Shell';
import { Card, CardTitle, Delta, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from '../components/ui';
import { BarRow, LineChart } from '../components/charts';
import { adminApi } from '../lib/api';
import useAsync from '../lib/useAsync';
import { MONTH_LABELS, compact, money, number, pct } from '../lib/format';

const PLAN_COLORS = ['#12dce5', '#a78bfa', '#3a6b8a', '#59687a', '#2a7f86', '#8a38f5'];
const AGENT_COLORS = ['#12dce5', '#12dce5', '#239aa1', '#2a6f7a', '#2a5a6a'];

/** Retention heat: brighter teal = higher retention. */
function heat(value) {
  if (value === null || value === undefined) return { background: '#121926', color: '#59687a' };
  const alpha = 0.18 + Math.min(1, value / 100) * 0.62;
  return { background: `rgba(35, 154, 161, ${alpha.toFixed(2)})`, color: '#fff' };
}

function cohortLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export default function InsightsPage() {
  const { data: d, error, reload } = useAsync(() => adminApi.insights(), []);

  return (
    <Shell title="Insights">
      <PageHeader title="Insights" subtitle="Understand engagement, conversion, and long-term customer value." />
      {error && !d ? <Card><ErrorState message={error.message} onRetry={reload} /></Card> : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard loading={!d} label="Monthly active users" value={d && number(d.monthlyActiveUsers.count)}
              delta={d && (!d.monthlyActiveUsers.count ? <Delta label="No user activity yet" /> : d.monthlyActiveUsers.changePct !== null
                ? <Delta value={pct(d.monthlyActiveUsers.changePct)} label="vs. last month" tone={d.monthlyActiveUsers.changePct >= 0 ? 'up' : 'down'} />
                : <Delta label="Last 30 days" />)} />
            <StatCard loading={!d} label="Activation rate" value={d && (d.activationRate.pct === null ? '—' : pct(d.activationRate.pct))}
              delta={d && (d.activationRate.pct === null ? <Delta label="No users to calculate a rate" /> : d.activationRate.changePts !== null
                ? <Delta value={`${Math.abs(d.activationRate.changePts)} pp`} label="vs. last month" tone={d.activationRate.changePts >= 0 ? 'up' : 'down'} />
                : <Delta label="Completed onboarding" />)} />
            <StatCard loading={!d} label="Deployed Project" value={d && number(d.deployedProjects.total)}
              delta={d && (d.deployedProjects.total ? <Delta value={number(d.deployedProjects.thisMonth)} label="this month" arrow={false} /> : <Delta label="No projects deployed yet" />)} />
            <StatCard loading={!d} label="Revenue per user" value={d && (d.revenuePerUser.amountMinor === null ? '—' : money(d.revenuePerUser.amountMinor, d.revenuePerUser.currency))}
              delta={d && (d.revenuePerUser.amountMinor === null ? <Delta label="No users or revenue yet" /> : d.revenuePerUser.changePct !== null
                ? <Delta value={pct(d.revenuePerUser.changePct)} label="vs. last month" tone={d.revenuePerUser.changePct >= 0 ? 'up' : 'down'} />
                : <Delta label="Per monthly active user" />)} />
          </div>
          {d && <p className="mt-2 text-[11px] text-figma-text-faint">Activation rate: {d.activationRate.definition.toLowerCase()}.</p>}

          <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_362px]">
            <Card className="min-h-[340px]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-medium text-white">User Engagement</h2>
                  <p className="mt-2 text-[14px] text-figma-text-muted">Yearly active users{d ? ` · ${d.engagement.year}` : ''}</p>
                </div>
                {d?.engagement.hasData && (
                  <span className="flex items-center gap-2 text-[14px] text-white">
                    <span className="h-2 w-2 rounded-full bg-figma-accent" /> Active users
                    {d.engagement.changePct !== null && (
                      <span className={`rounded px-2 py-0.5 text-[13px] ${d.engagement.changePct >= 0 ? 'bg-[#0f2a22] text-[#56e5a9]' : 'bg-[#2a1214] text-[#ff8a8a]'}`}>
                        {d.engagement.changePct >= 0 ? '+' : ''}{pct(d.engagement.changePct)}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {!d ? <Skeleton className="mt-6 h-[230px] w-full" /> : !d.engagement.hasData ? (
                <EmptyState icon={ChartNoAxesColumnIncreasing} title="No engagement data yet" message="Active user trends will appear as people begin using the platform." />
              ) : (
                <div className="mt-4">
                  <LineChart
                    values={d.engagement.months.map((m) => m.users)}
                    labels={MONTH_LABELS}
                    lastIndex={d.engagement.currentMonth - 1}
                    formatTick={compact}
                    formatValue={(v) => `${number(v)} active users`}
                    height={230}
                    tickSize={13}
                  />
                </div>
              )}
            </Card>

            <Card>
              <CardTitle title="Top Subscribed Plans" subtitle="Most subscribed plans" />
              {!d ? <Skeleton className="h-[200px] w-full" /> : (
                <>
                  <div className="space-y-6">
                    {(d.topPlans.plans.length ? d.topPlans.plans : [{ tier: 'none', label: 'Developer', count: 0, pct: 0 }]).slice(0, 5).map((p, i) => (
                      <BarRow key={p.tier} label={p.label} value={d.topPlans.total ? `${number(p.count)} · ${pct(p.pct, 0)}` : '0'} pct={p.pct} color={PLAN_COLORS[i % PLAN_COLORS.length]} />
                    ))}
                  </div>
                  {d.topPlans.newPaidThisMonth > 0 && (
                    <p className="mt-6 flex items-center gap-2 text-[11px] text-figma-text-soft"><TrendingUp className="h-3.5 w-3.5 text-[#56e5a9]" /> {number(d.topPlans.newPaidThisMonth)} new paid subscriptions this month</p>
                  )}
                </>
              )}
            </Card>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[440px_minmax(0,1fr)]">
            <Card className="min-h-[400px]">
              <CardTitle title="Most Used AI Agent" subtitle="Frequently used AI Agents by Users · last 30 days" />
              {!d ? <Skeleton className="h-[260px] w-full" /> : !d.aiModels.hasData ? (
                <EmptyState icon={Bot} title="No AI agent usage yet" message="Usage rankings will appear once users start working with AI agents." />
              ) : (
                <div className="space-y-6">
                  {d.aiModels.models.slice(0, 5).map((m, i) => (
                    <BarRow key={m.model} label={m.model} value={`${number(m.runs)} · ${pct(m.pctOfTop)}`} pct={m.pctOfTop} color={AGENT_COLORS[i]} thick />
                  ))}
                </div>
              )}
            </Card>

            <Card className="min-h-[400px]">
              <h2 className="text-[20px] font-medium text-white">Retention by signup cohort</h2>
              <p className="mt-2 text-[12px] text-figma-text-soft">Share of users returning each week · last 6 cohorts</p>
              {!d ? <Skeleton className="mt-6 h-[260px] w-full" /> : (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[560px] border-separate border-spacing-[6px] text-center text-[14px]">
                    <thead>
                      <tr className={d.retention.hasData ? 'text-figma-text-soft' : 'bg-[#1d263b] text-figma-text-soft'}>
                        <th className="text-left font-normal">SIGNUP WEEK</th>
                        <th className="font-normal">Users</th>
                        {[1, 2, 3, 4, 5].map((w) => <th key={w} className="font-normal">Wk {w}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {d.retention.hasData && d.retention.cohorts.map((c) => (
                        <tr key={c.weekStart}>
                          <td className="py-1 text-left text-figma-text-soft">{cohortLabel(c.weekStart)}</td>
                          <td className="rounded bg-[#1d263b] py-1.5 text-white">{number(c.users)}</td>
                          {c.retention.map((v, i) => (
                            <td key={i} className="rounded py-1.5" style={heat(v)}>{v === null ? '–' : `${Math.round(v)}%`}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!d.retention.hasData ? (
                    <EmptyState icon={CalendarDays} title="No signup cohorts yet" message="Retention will be available after users sign up and return to the platform." />
                  ) : (
                    <p className="mt-4 flex flex-wrap items-center gap-3 text-[14px] text-figma-text-soft">
                      Higher retention
                      <span className="flex gap-1">{[100, 60, 20].map((v) => <span key={v} className="h-1.5 w-1.5 rounded-sm" style={{ background: heat(v).background }} />)}</span>
                      Lower retention <span className="text-figma-text-faint">·</span> Cohorts use UTC signup dates
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}

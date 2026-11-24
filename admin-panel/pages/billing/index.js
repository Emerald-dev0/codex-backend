import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { CreditCard, LineChart as LineIcon } from 'lucide-react';
import Shell from '../../components/Shell';
import {
  Avatar, Card, Delta, EmptyState, ErrorState, FilterSelect, PageHeader, Pagination, SearchInput, Skeleton, StatCard, StatusPill, Table, TableSkeleton,
} from '../../components/ui';
import { LineChart } from '../../components/charts';
import SubscriberModal from '../../components/SubscriberModal';
import { adminApi } from '../../lib/api';
import useAsync, { useDebounced } from '../../lib/useAsync';
import { MONTH_LABELS, compact, date, dateTime, interval, money, moneyWhole, number, pct } from '../../lib/format';
import { PLAN_OPTIONS } from '../../lib/plans';

const PLAN_COLORS = ['#12dce5', '#239aa1', '#3a5876', '#59687a', '#2a7f86'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function seriesLabel(series) {
  if (!series?.length) return '';
  const [y1, m1] = series[0].month.split('-').map(Number);
  const [y2, m2] = series[series.length - 1].month.split('-').map(Number);
  return y1 === y2 ? `${MONTH_LABELS[m1 - 1]} – ${MONTH_LABELS[m2 - 1]} ${y2}` : `${MONTH_LABELS[m1 - 1]} ${y1} – ${MONTH_LABELS[m2 - 1]} ${y2}`;
}

export default function BillingPage() {
  const router = useRouter();
  const [months, setMonths] = useState('12');
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [duration, setDuration] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim());
  useEffect(() => { setPage(1); }, [term, plan, status, duration]);

  const selected = typeof router.query.subscriber === 'string' ? router.query.subscriber : null;
  const openSubscriber = (id) => router.push({ pathname: '/billing', query: { ...router.query, subscriber: id } }, undefined, { shallow: true, scroll: false });
  const closeSubscriber = () => {
    const { subscriber, ...rest } = router.query;
    router.push({ pathname: '/billing', query: rest }, undefined, { shallow: true, scroll: false });
  };

  const summary = useAsync(() => adminApi.billingSummary(), []);
  const perf = useAsync(() => adminApi.performance(months), [months]);
  const byPlan = useAsync(() => adminApi.byPlan(), []);
  const subs = useAsync(() => adminApi.subscribers({ q: term, plan, status, duration, page, limit: 7 }), [term, plan, status, duration, page]);

  const s = summary.data;
  const p = perf.data;
  const bp = byPlan.data;
  const filtered = Boolean(term || plan || status || duration);
  const prevMonthName = p?.series?.length > 1 ? MONTH_FULL[Number(p.series[p.series.length - 2].month.slice(5)) - 1] : '';

  return (
    <Shell title="Billing Plan">
      <PageHeader
        title="Billing Plan"
        subtitle="Track subscription performance and manage your subscribers."
        actions={<button type="button" className="btn-primary h-12 px-6 text-[16px]" onClick={() => router.push('/billing/plans')}>Manage Plans</button>}
      />

      {summary.error && !s ? <Card><ErrorState compact message={summary.error.message} onRetry={summary.reload} /></Card> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard loading={!s} href="#subscribers" label="Total subscribers" value={s && number(s.totalSubscribers.count)}
            delta={s && (s.totalSubscribers.changePct !== null ? <Delta value={pct(s.totalSubscribers.changePct)} label="vs. last month" tone={s.totalSubscribers.changePct >= 0 ? 'up' : 'down'} /> : <Delta label={s.totalSubscribers.count ? 'Paid subscribers' : 'No subscribers yet'} />)} />
          <StatCard loading={!s} href="#subscribers" label="Active subscriptions" value={s && number(s.activeSubscriptions.count)}
            delta={s && <Delta value={pct(s.activeSubscriptions.pctOfAll)} label="of all subscribers" arrow={false} />} />
          <StatCard loading={!s} href="/finance" label="Monthly recurring revenue" value={s && moneyWhole(s.mrr.amountMinor)}
            delta={s && (s.mrr.changePct !== null ? <Delta value={pct(s.mrr.changePct)} label="vs. last month" tone={s.mrr.changePct >= 0 ? 'up' : 'down'} /> : <Delta label="Recurring revenue" />)} />
          <StatCard loading={!s} href="#subscribers" label="Expired subscriptions" value={s && number(s.expiredSubscriptions.count)}
            delta={s && <Delta value={pct(s.expiredSubscriptions.pctOfAll)} label="of all subscribers" tone="warn" arrow={false} />} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_362px]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[22px] font-medium text-white">Subscription Performance</h2>
              <p className="mt-2 text-[14px] text-figma-text-muted">Active subscriptions over time</p>
            </div>
            <FilterSelect
              value={months}
              onChange={setMonths}
              placeholder={seriesLabel(p?.series)}
              options={[
                { value: '3', label: 'Last 3 months' },
                { value: '6', label: 'Last 6 months' },
                { value: '12', label: p && months === '12' ? seriesLabel(p.series) : 'Last 12 months' },
                { value: '24', label: 'Last 24 months' },
              ]}
            />
          </div>
          {perf.error && !p ? <ErrorState compact message={perf.error.message} onRetry={perf.reload} /> : !p ? <Skeleton className="mt-6 h-[230px] w-full" /> : !p.hasData ? (
            <EmptyState icon={LineIcon} title="No subscriptions yet" message="Active subscription trends will appear after your first paid subscriber." />
          ) : (
            <>
              <div className="mt-4 flex items-baseline gap-3">
                <span className="text-[24px] font-semibold text-white">{number(p.current)}</span>
                {p.changePct !== null && <span className={`text-[13px] ${p.changePct >= 0 ? 'text-[#56e5a9]' : 'text-[#ec8f8f]'}`}>{p.changePct >= 0 ? '↗' : '↘'} {pct(Math.abs(p.changePct))}</span>}
                {prevMonthName && <span className="text-[13px] text-figma-text-soft">compared with {prevMonthName}</span>}
              </div>
              <div className={perf.loading ? 'opacity-60' : ''}>
                <LineChart
                  values={p.series.map((x) => x.count)}
                  labels={p.series.map((x, i) => (p.series.length > 12 && i % 2 ? '' : MONTH_LABELS[Number(x.month.slice(5)) - 1]))}
                  area
                  endBadge
                  formatTick={compact}
                  formatValue={(v) => number(v)}
                  height={210}
                />
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-[22px] font-medium text-white">Subscribers by Plan</h2>
          <p className="mt-2 text-[14px] text-figma-text-muted">Distribution of active subscriptions</p>
          {byPlan.error && !bp ? <ErrorState compact message={byPlan.error.message} onRetry={byPlan.reload} /> : !bp ? <Skeleton className="mt-6 h-[200px] w-full" /> : (
            <>
              <p className="mt-5"><span className="text-[28px] font-semibold text-white">{number(bp.total)}</span> <span className="text-[12px] text-figma-text-soft">active subscribers</span></p>
              <div className="mt-4 flex h-2.5 w-full gap-1 overflow-hidden rounded-sm bg-[#1d263b]">
                {bp.plans.map((x, i) => <div key={x.tier} title={`${x.label} · ${x.pct}%`} style={{ width: `${x.pct}%`, background: PLAN_COLORS[i % PLAN_COLORS.length] }} />)}
              </div>
              {bp.plans.length === 0 ? <p className="mt-6 text-[14px] text-figma-text-muted">No active paid subscriptions.</p> : (
                <ul className="mt-6 space-y-4">
                  {bp.plans.map((x, i) => (
                    <li key={x.tier} className="grid grid-cols-[1fr_auto_56px] items-center gap-3 text-[14px]">
                      <span className="flex items-center gap-2.5 text-white"><span className="h-2 w-2 rounded-sm" style={{ background: PLAN_COLORS[i % PLAN_COLORS.length] }} />{x.label}</span>
                      <span className="text-white">{number(x.count)}</span>
                      <span className="text-right text-[12px] text-figma-text-soft">{pct(x.pct)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-6 text-[11px] text-figma-text-soft">Last updated {dateTime(new Date())}</p>
            </>
          )}
        </Card>
      </div>

      <Card className="mt-6" id="subscribers">
        <div className="mb-1 flex items-baseline gap-3">
          <h2 className="text-[24px] font-medium text-white">Subscribers</h2>
          {subs.data && <span className="text-[12px] text-white">{number(subs.data.total)} total</span>}
        </div>
        <p className="mb-6 text-[14px] text-figma-text-muted">Manage subscription plans, billing cycles, and subscriber status</p>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput value={q} onChange={setQ} placeholder="Search by name, email or subscription ID" className="w-full lg:max-w-[324px]" />
          <div className="flex flex-wrap gap-3">
            <FilterSelect value={plan} onChange={setPlan} placeholder="All plans" options={[{ value: '', label: 'All plans' }, ...PLAN_OPTIONS.filter((o) => o.value !== 'developer')]} />
            <FilterSelect value={status} onChange={setStatus} placeholder="All status" options={[{ value: '', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'trial', label: 'Trial' }, { value: 'past_due', label: 'Past due' }, { value: 'expired', label: 'Expired' }]} />
            <FilterSelect value={duration} onChange={setDuration} placeholder="Duration" options={[{ value: '', label: 'Any duration' }, { value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }, { value: 'custom', label: 'Custom' }]} />
          </div>
        </div>
        {subs.error && !subs.data ? <ErrorState message={subs.error.message} onRetry={subs.reload} /> : (
          <>
            <Table columns={[{ label: 'Subscriber' }, { label: 'Plan' }, { label: 'Amount' }, { label: 'Duration' }, { label: 'Status' }, { label: 'Next billing' }, { label: 'Action' }]}>
              {!subs.data ? <TableSkeleton rows={7} cols={7} /> : subs.data.subscribers.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon={CreditCard} title={filtered ? 'No subscribers match your filters' : 'No subscribers yet'} message={filtered ? 'Try a different search or filter.' : 'Paid subscriptions will appear here.'} /></td></tr>
              ) : subs.data.subscribers.map((x) => (
                <tr key={x.id} className={subs.loading ? 'opacity-60' : 'hover:bg-white/[0.02]'}>
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <Avatar name={x.user.name} src={x.user.profilePicture} size={32} />
                      <div className="min-w-0"><p className="truncate text-white">{x.user.name}</p><p className="truncate text-[14px] text-figma-text-soft">{x.user.email}</p></div>
                    </div>
                  </td>
                  <td className="td whitespace-nowrap">{x.planLabel}</td>
                  <td className="td whitespace-nowrap">{money(x.amountMinor, x.currency)}</td>
                  <td className="td">{interval(x.duration)}</td>
                  <td className="td"><StatusPill status={x.status} dot size="sm" /></td>
                  <td className="td whitespace-nowrap">{x.nextBillingAt ? date(x.nextBillingAt) : '—'}</td>
                  <td className="td"><button type="button" className="link whitespace-nowrap" onClick={() => openSubscriber(x.id)}>View details</button></td>
                </tr>
              ))}
            </Table>
            {subs.data && <Pagination {...subs.data} noun="subscribers" onPage={setPage} />}
          </>
        )}
      </Card>
      <SubscriberModal id={selected} onClose={closeSubscriber} />
    </Shell>
  );
}

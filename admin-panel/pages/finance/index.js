import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3, Landmark, ReceiptText, RefreshCw } from 'lucide-react';
import Shell from '../../components/Shell';
import {
  Avatar, Card, CardTitle, Delta, EmptyState, ErrorState, FilterSelect, Modal, PageHeader, Pagination, SearchInput, Skeleton, StatCard, StatusPill, Table, TableSkeleton, Spinner,
} from '../../components/ui';
import { BarChart } from '../../components/charts';
import GatewayIcon from '../../components/GatewayIcon';
import WithdrawModal from '../../components/WithdrawModal';
import { adminApi } from '../../lib/api';
import useAsync, { useDebounced } from '../../lib/useAsync';
import useSession from '../../store/session';
import { MONTH_LABELS, compact, dateTime, interval, money, moneyWhole, number, pct } from '../../lib/format';

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'successful', label: 'Successful' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partially_refunded', label: 'Partially refunded' },
];

const CONNECT_HELP = [
  { id: 'stripe', name: 'Stripe', env: 'STRIPE_SECRET_KEY' },
  { id: 'paystack', name: 'Paystack', env: 'PAYSTACK_SECRET_KEY' },
  { id: 'flutterwave', name: 'Flutterwave', env: 'FLUTTERWAVE_SECRET_KEY' },
];

function ConnectGatewayModal({ open, onClose, gateways, onRefresh, refreshing }) {
  const byId = new Map((gateways?.gateways || []).map((g) => [g.id, g]));
  return (
    <Modal open={open} onClose={onClose} width="max-w-[560px]" title={<span className="text-[24px]">Connect a payment gateway</span>} subtitle="Gateways are connected on the server. Add the provider’s secret key to the backend environment and restart it, then refresh.">
      <ul className="space-y-3">
        {CONNECT_HELP.map((g) => {
          const state = byId.get(g.id);
          return (
            <li key={g.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0a0d15] px-4 py-3">
              <GatewayIcon id={g.id} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] text-white">{g.name}</p>
                <p className="font-mono text-[12px] text-figma-text-muted">{g.env}</p>
              </div>
              <span className={`text-[12px] ${state?.configured ? 'text-[#56e5a9]' : 'text-figma-text-faint'}`}>{state?.configured ? 'Connected' : 'Not connected'}</span>
            </li>
          );
        })}
        <li className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0a0d15] px-4 py-3 opacity-70">
          <GatewayIcon id="paypal" />
          <p className="flex-1 text-[15px] text-white">PayPal</p>
          <span className="text-[12px] text-figma-text-faint">Not available yet</span>
        </li>
      </ul>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn-primary" onClick={onRefresh} disabled={refreshing}>{refreshing ? <Spinner /> : <><RefreshCw className="h-4 w-4" /> Refresh status</>}</button>
      </div>
    </Modal>
  );
}

export default function FinancePage() {
  const admin = useSession((s) => s.admin);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const term = useDebounced(q.trim());
  useEffect(() => { setPage(1); }, [term, status]);

  const summary = useAsync(() => adminApi.financeSummary(), []);
  const revenue = useAsync(() => adminApi.revenue(), []);
  const [freshGateways, setFreshGateways] = useState(false);
  const gateways = useAsync(() => adminApi.gateways(freshGateways), [freshGateways]);
  const tx = useAsync(() => adminApi.transactions({ q: term, status, page, limit: 10 }), [term, status, page]);

  const s = summary.data;
  const g = gateways.data;
  const r = revenue.data;
  const connected = g ? g.gateways.filter((x) => x.configured && x.supported !== false) : [];
  const isSuper = admin?.role === 'super_admin';
  const refreshGateways = () => { if (freshGateways) gateways.reload(); else setFreshGateways(true); };

  return (
    <Shell title="Finances">
      <PageHeader
        title="Finances"
        subtitle="Monitor revenue, reconcile payments, and manage transactions."
        actions={(
          <button
            type="button"
            className="btn-primary h-12 px-6 text-[16px]"
            onClick={() => setWithdrawOpen(true)}
            disabled={!g || !connected.length || !isSuper}
            title={!isSuper ? 'Only a super admin can withdraw funds' : !connected.length ? 'Connect a payment gateway first' : undefined}
          >
            Withdraw
          </button>
        )}
      />

      {summary.error && !s ? <Card className="mb-6"><ErrorState compact message={summary.error.message} onRetry={summary.reload} /></Card> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            loading={!s}
            href="/billing"
            label="Monthly recurring revenue"
            value={s && moneyWhole(s.mrr.amountMinor)}
            delta={s && (s.mrr.changePct !== null ? <Delta value={pct(s.mrr.changePct)} label="vs. last month" tone={s.mrr.changePct >= 0 ? 'up' : 'down'} /> : <Delta label={s.mrr.amountMinor ? 'Recurring revenue' : 'No paid subscriptions yet'} />)}
          />
          <StatCard
            loading={!s}
            href="#transactions"
            label="Collected this month"
            value={s && moneyWhole(s.collected.amountMinor)}
            delta={s && (s.collected.changePct !== null ? <Delta value={pct(s.collected.changePct)} label="vs. last month" tone={s.collected.changePct >= 0 ? 'up' : 'down'} /> : <Delta label={s.collected.count ? `${number(s.collected.count)} payments` : 'No payments received'} />)}
          />
          <StatCard
            loading={!s}
            label="Outstanding invoices"
            value={s && moneyWhole(s.outstanding.amountMinor)}
            delta={s && <Delta value={`${number(s.outstanding.count)} invoices`} label="awaiting payment" tone={s.outstanding.count ? 'warn' : 'muted'} arrow={false} />}
          />
          <StatCard
            loading={!s}
            label="Refunds issued"
            value={s && moneyWhole(s.refunds.amountMinor)}
            delta={s && (s.refunds.count ? <Delta value={pct(s.refunds.pctOfGross)} label="of gross revenue" arrow={false} /> : <Delta label="No refunds issued" />)}
          />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[362px_minmax(0,1fr)]">
        <Card className="min-h-[370px]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-medium text-white">Available balance &amp; Bank</h2>
              <p className="mt-2 text-[14px] text-figma-text-muted">Bank balance and Payment Gateway</p>
            </div>
            {g && connected.length > 0 && (
              <button type="button" onClick={refreshGateways} className="rounded p-1 text-figma-text-muted hover:bg-white/5 hover:text-white" aria-label="Refresh balances" title="Refresh balances">
                <RefreshCw className={`h-4 w-4 ${gateways.loading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
          {gateways.error && !g ? <ErrorState compact message={gateways.error.message} onRetry={gateways.reload} /> : !g ? (
            <div className="mt-6 space-y-4"><Skeleton className="h-9 w-44" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : (
            <>
              <p className="mt-6 text-[32px] font-semibold tracking-tight text-white">{money(g.totalAvailableMinor, g.currency)}</p>
              {connected.length === 0 ? (
                <EmptyState
                  icon={Landmark}
                  title="No payment gateway connected"
                  message="Connect a gateway to start collecting payments."
                  action={<button type="button" className="btn-primary btn-sm px-7" onClick={() => setConnectOpen(true)}>Connect gateway</button>}
                />
              ) : (
                <ul className="mt-6 space-y-5">
                  {g.gateways.map((gw) => {
                    const bal = gw.balances.find((b) => b.currency === g.currency);
                    return (
                      <li key={gw.id} className="flex items-center gap-3 rounded-lg bg-[#0f1520] px-3 py-3">
                        <GatewayIcon id={gw.id} size={30} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-white">{gw.name}</p>
                          <p className="truncate text-[11px] text-figma-text-soft">
                            {gw.supported === false ? 'Not available yet' : !gw.configured ? 'Not connected' : gw.payout.configured ? gw.payout.label : `${gw.name} Banking`}
                          </p>
                        </div>
                        <span className="text-right text-[12px] text-figma-text-soft">
                          {gw.error ? <span className="text-figma-warning">{gw.error}</span> : gw.configured && bal ? money(bal.availableMinor, bal.currency) : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </Card>

        <Card>
          <CardTitle title="Revenue performance" subtitle="Monthly subscription revenue performance" className="mb-4" />
          {revenue.error && !r ? <ErrorState compact message={revenue.error.message} onRetry={revenue.reload} /> : !r ? (
            <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-[200px] w-full" /></div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="text-[24px] font-semibold text-white">{moneyWhole(r.currentAmountMinor, r.currency)}</span>
                {r.changePct !== null && (
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${r.changePct >= 0 ? 'bg-[#0f2a22] text-[#56e5a9]' : 'bg-[#2a1214] text-[#ff8a8a]'}`}>
                    {r.changePct >= 0 ? '+' : ''}{pct(r.changePct)}
                  </span>
                )}
                {r.currentMonth > 1 && r.hasData && <span className="text-[12px] text-figma-text-soft">compared with {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][r.currentMonth - 2]}</span>}
              </div>
              {!r.hasData ? (
                <EmptyState icon={BarChart3} title="No revenue data yet" message="Revenue performance will appear after your first subscription payment." />
              ) : (
                <BarChart
                  values={r.months.map((m) => m.amountMinor / 100)}
                  labels={MONTH_LABELS}
                  highlight={r.currentMonth - 1}
                  formatTick={(t) => `$${compact(t)}`}
                  formatValue={(v) => money(Math.round(v * 100), r.currency)}
                />
              )}
            </>
          )}
        </Card>
      </div>

      <Card className="mt-6" id="transactions">
        <CardTitle title="Transactions" subtitle="Your most recent subscription payments and refunds" />
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={q} onChange={setQ} placeholder="Search transaction or customer" className="w-full sm:max-w-[300px]" />
          <FilterSelect value={status} onChange={setStatus} placeholder="All Status" options={STATUS_OPTIONS} large />
        </div>
        {tx.error && !tx.data ? <ErrorState message={tx.error.message} onRetry={tx.reload} /> : (
          <>
            <Table columns={[{ label: 'Transaction' }, { label: 'Customer' }, { label: 'Plan / Type' }, { label: 'Amount' }, { label: 'Status' }, { label: 'Timestamp' }, { label: 'Action' }]}>
              {!tx.data ? <TableSkeleton rows={6} cols={7} /> : tx.data.transactions.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState
                    icon={ReceiptText}
                    title={term || status ? 'No matching transactions' : 'No transactions yet'}
                    message={term || status ? 'Try a different search or status.' : 'Subscription payments and refunds will appear here once your platform starts processing payments.'}
                  />
                </td></tr>
              ) : tx.data.transactions.map((t) => (
                <tr key={t.id} className={tx.loading ? 'opacity-60' : 'hover:bg-white/[0.02]'}>
                  <td className="td whitespace-nowrap">{t.reference}</td>
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <Avatar name={t.customer.name} size={32} />
                      <div className="min-w-0">
                        {t.customer.id ? <Link href={`/users/${t.customer.id}`} className="block truncate text-white hover:text-figma-accent">{t.customer.name}</Link> : <p className="truncate">{t.customer.name}</p>}
                        <p className="truncate text-[14px] text-figma-text-soft">{t.customer.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="td whitespace-nowrap">{t.planLabel}{t.plan ? ` · ${interval(t.interval)}` : ''}</td>
                  <td className="td whitespace-nowrap">{money(t.amountMinor, t.currency)}</td>
                  <td className="td"><StatusPill status={t.status} /></td>
                  <td className="td whitespace-nowrap">{dateTime(t.createdAt)}</td>
                  <td className="td"><Link href={`/finance/transactions/${t.id}`} className="link whitespace-nowrap">View More</Link></td>
                </tr>
              ))}
            </Table>
            {tx.data && (tx.data.total > 0
              ? <Pagination {...tx.data} noun="transactions" onPage={setPage} />
              : <p className="mt-4 text-[13px] text-figma-text-soft">0 transactions</p>)}
          </>
        )}
      </Card>

      {g && (
        <WithdrawModal
          open={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          gateways={g}
          canWithdraw={isSuper}
          onDone={() => { refreshGateways(); }}
        />
      )}
      <ConnectGatewayModal open={connectOpen} onClose={() => setConnectOpen(false)} gateways={g} onRefresh={refreshGateways} refreshing={gateways.loading} />
    </Shell>
  );
}

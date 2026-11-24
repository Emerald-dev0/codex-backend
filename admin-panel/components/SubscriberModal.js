import Link from 'next/link';
import { Avatar, ErrorState, Modal, Skeleton, StatusPill } from './ui';
import GatewayIcon from './GatewayIcon';
import { adminApi } from '../lib/api';
import useAsync from '../lib/useAsync';
import { date, interval, money, providerName, shortDate } from '../lib/format';

const PAY_STATUS = { successful: ['Paid', 'text-[#56e5a9]'], refunded: ['Refunded', 'text-figma-text-soft'], partially_refunded: ['Partly refunded', 'text-figma-accent'], pending: ['Pending', 'text-figma-warning'], failed: ['Failed', 'text-[#ff6b6b]'] };

export default function SubscriberModal({ id, onClose }) {
  const open = Boolean(id);
  const { data: s, error, reload } = useAsync(() => adminApi.subscriber(id), [id], { enabled: open });
  const per = s?.duration === 'annual' ? 'year' : s?.duration === 'custom' ? 'term' : 'month';
  return (
    <Modal open={open} onClose={onClose} title="Subscriber details" subtitle="Subscription and billing information">
      {error ? <ErrorState compact message={error.message} onRetry={reload} /> : !s ? <div className="space-y-4"><Skeleton className="h-12 w-72" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div> : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={s.user.name} src={s.user.profilePicture} size={48} />
              <div className="min-w-0">
                <Link href={`/users/${s.user.id}`} className="text-[18px] font-medium text-white hover:text-figma-accent">{s.user.name}</Link>
                <p className="truncate text-[14px] text-figma-text-soft">{[s.company, s.user.email].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <StatusPill status={s.status} dot size="sm" />
          </div>

          <div className="mt-6 flex items-center justify-between rounded-lg border border-white/15 bg-[#0a0d15] px-4 py-4">
            <div>
              <p className="text-[14px] text-figma-text-soft">Current plan</p>
              <p className="mt-1 text-[20px] font-medium text-white">{s.planLabel}</p>
            </div>
            <div className="text-right">
              <p><span className="text-[24px] font-semibold text-white">{money(s.amountMinor, s.currency)}</span> <span className="text-[12px] text-figma-text-soft">/ {per}</span></p>
              <p className="mt-1 text-[13px] text-figma-text-soft">{interval(s.duration)} billing · {s.currency}</p>
            </div>
          </div>

          <h3 className="mt-7 text-[17px] font-medium text-white">Subscription information</h3>
          <dl className="mt-4 grid grid-cols-1 gap-x-10 gap-y-5 border-b border-white/10 pb-6 sm:grid-cols-[1fr_auto]">
            <div><dt className="text-[14px] text-figma-text-soft">Subscription ID</dt><dd className="mt-1 text-[16px] text-white">{s.subscriptionId}</dd></div>
            <div><dt className="text-[14px] text-figma-text-soft">Start date</dt><dd className="mt-1 text-[16px] text-white">{date(s.startDate)}</dd></div>
            <div><dt className="text-[14px] text-figma-text-soft">Current period</dt><dd className="mt-1 text-[16px] text-white">{s.currentPeriod.end ? `${shortDate(s.currentPeriod.start)} – ${date(s.currentPeriod.end)}` : `Since ${date(s.currentPeriod.start)}`}</dd></div>
            <div><dt className="text-[14px] text-figma-text-soft">End date</dt><dd className="mt-1 text-[16px] text-white">{date(s.endDate)}</dd></div>
            <div><dt className="text-[14px] text-figma-text-soft">Next renewal</dt><dd className="mt-1 text-[16px] text-white">{s.renewal.nextRenewalAt ? `${date(s.renewal.nextRenewalAt)} · ${money(s.renewal.amountMinor, s.currency)}` : '—'}</dd></div>
            <div><dt className="text-[14px] text-figma-text-soft">Renewal setting</dt><dd className="mt-1 text-[16px] text-white">{s.renewal.automatic ? 'Automatic renewal enabled' : s.cancelAtPeriodEnd ? 'Cancels at period end' : 'Not renewing'}</dd></div>
          </dl>

          <div className="flex items-center gap-3 py-5">
            <GatewayIcon id={s.paymentMethod.provider} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-white">{s.paymentMethod.method || providerName(s.paymentMethod.provider)}</p>
              <p className="truncate text-[12px] text-figma-text-soft">{s.paymentMethod.email}</p>
            </div>
            <span className="text-[12px] text-figma-text-soft">{s.duration === 'custom' ? 'Invoiced' : 'Recurring payment'}</span>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-[17px] font-medium text-white">Recent billing</h3>
            <span className="text-[14px] text-figma-text-soft">{s.recentBilling.length} {s.recentBilling.length === 1 ? 'payment' : 'payments'}</span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-separate border-spacing-0 text-[14px]">
              <thead><tr>{['Date', 'Invoice', 'Amount', 'Status'].map((h, i) => <th key={h} className={`bg-[#1d263b] px-3 py-2 text-left font-normal uppercase text-figma-text-soft ${i === 0 ? 'rounded-l' : ''} ${i === 3 ? 'rounded-r' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {s.recentBilling.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-figma-text-muted">No payments recorded yet.</td></tr> : s.recentBilling.map((p) => {
                  const [label, tone] = PAY_STATUS[p.status] || [p.status, 'text-white'];
                  return (
                    <tr key={p.id}>
                      <td className="border-b border-white/10 px-3 py-2.5 text-white">{date(p.date)}</td>
                      <td className="border-b border-white/10 px-3 py-2.5"><Link className="text-figma-text-soft hover:text-figma-accent" href={`/finance/transactions/${p.id}`}>{p.invoiceNumber || '—'}</Link></td>
                      <td className="border-b border-white/10 px-3 py-2.5 text-white">{money(p.amountMinor, p.currency)}</td>
                      <td className={`border-b border-white/10 px-3 py-2.5 ${tone}`}>{label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <p className="text-[13px] text-figma-text-soft">Total paid to date: {money(s.totalPaidMinor, s.totalPaidCurrency)}</p>
            <button type="button" className="btn-primary w-[112px] text-[15px]" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </Modal>
  );
}

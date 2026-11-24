import { useRouter } from 'next/router';
import { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, FileText, Info, RotateCcw } from 'lucide-react';
import Shell from '../../../components/Shell';
import { Avatar, Card, DetailItem, ErrorState, PageHeader, Skeleton, StatusPill, cx } from '../../../components/ui';
import RefundModal from '../../../components/RefundModal';
import InvoiceModal from '../../../components/InvoiceModal';
import { adminApi } from '../../../lib/api';
import useAsync from '../../../lib/useAsync';
import useSession from '../../../store/session';
import { dateTime, interval, money, providerName } from '../../../lib/format';
import { toast } from '../../../store/toast';

const BANNERS = {
  successful: { icon: CheckCircle2, tone: 'text-[#56e5a9]', title: 'Payment successful', text: 'The subscription payment completed successfully' },
  pending: { icon: Clock, tone: 'text-figma-warning', title: 'Payment pending', text: 'The provider has not confirmed this payment yet' },
  failed: { icon: AlertCircle, tone: 'text-[#ff6b6b]', title: 'Payment failed', text: 'The payment could not be completed' },
  refunded: { icon: RotateCcw, tone: 'text-figma-text-soft', title: 'Payment refunded', text: 'The full amount was returned to the customer' },
  partially_refunded: { icon: RotateCcw, tone: 'text-figma-accent', title: 'Partially refunded', text: 'Part of this payment was returned to the customer' },
};

const STATE_LABEL = { successful: 'Payment completed', pending: 'Awaiting confirmation', failed: 'Payment failed', refunded: 'Refunded', partially_refunded: 'Partially refunded' };
const DOT = { successful: 'bg-[#56e5a9]', authorized: 'bg-figma-accent', failed: 'bg-[#ff6b6b]', refund_failed: 'bg-[#ff6b6b]', refunded: 'bg-figma-warning', refund_requested: 'bg-figma-warning' };

export default function TransactionDetail() {
  const router = useRouter();
  const { id } = router.query;
  const admin = useSession((s) => s.admin);
  const { data: t, error, reload, setData } = useAsync(() => adminApi.transaction(id), [id], { enabled: Boolean(id) });
  const [refundOpen, setRefundOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const isSuper = admin?.role === 'super_admin';
  const banner = t && (BANNERS[t.status] || BANNERS.pending);

  return (
    <Shell title={t ? `Transaction ${t.reference}` : 'Transaction details'}>
      <PageHeader back="/finance" title="Transaction details" subtitle="Review subscription payment details and manage the next action." />
      {error && !t ? (
        <Card><ErrorState message={error.status === 404 ? 'This transaction could not be found.' : error.message} onRetry={error.status === 404 ? undefined : reload} /></Card>
      ) : !t ? (
        <div className="space-y-6"><Skeleton className="h-36 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-72 w-full" /></div>
      ) : (
        <>
          <Card className="grid grid-cols-1 gap-6 px-6 py-6 md:grid-cols-[300px_minmax(0,1fr)]">
            <div className="self-center">
              <p className="text-[12px] text-figma-text-soft">Amount paid</p>
              <p className="mt-2 flex items-baseline gap-3">
                <span className="text-[36px] font-semibold text-white">{money(t.amountMinor, t.currency)}</span>
                <span className="text-[14px] text-figma-text-soft">{t.currency}</span>
              </p>
              <p className="mt-2 text-[13px] text-figma-text-soft">{t.plan ? 'Subscription payment' : 'One-time payment'}</p>
            </div>
            <div>
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <p className="text-[20px] font-semibold text-white">{t.reference}</p>
                <StatusPill status={t.status} />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-6">
                <DetailItem label="Plan / type" value={`${t.planLabel}${t.plan ? ` · ${interval(t.interval)}` : ''}`} />
                <DetailItem label="Timestamp" value={dateTime(t.createdAt)} />
              </div>
            </div>
          </Card>

          <Card className="mt-6 flex items-center gap-4 py-4">
            <span className={cx('inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#1d263b]', banner.tone)}><banner.icon className="h-5 w-5" /></span>
            <div>
              <p className={cx('text-[16px]', banner.tone)}>{banner.title}</p>
              <p className="text-[16px] text-figma-text-soft">{t.status === 'failed' && t.failureReason ? t.failureReason : banner.text}</p>
            </div>
          </Card>

          <p className="mt-5 flex items-center gap-2 text-[12px] text-figma-text-soft"><Info className="h-3.5 w-3.5" /> Payment details · Recorded from the payment provider’s verified webhook events.</p>

          <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_412px]">
            <div className="space-y-6">
              <Card>
                <h2 className="text-[20px] font-medium text-white">Customer &amp; subscription</h2>
                <div className="mt-5 flex items-center gap-3 border-b border-white/10 pb-5">
                  <Avatar name={t.customer.name} src={t.customer.profilePicture} size={42} />
                  <div className="min-w-0">
                    {t.customer.id ? <button type="button" onClick={() => router.push(`/users/${t.customer.id}`)} className="text-[18px] text-white hover:text-figma-accent">{t.customer.name}</button> : <p className="text-[18px] text-white">{t.customer.name}</p>}
                    <p className="truncate text-[14px] text-figma-text-soft">{t.customer.email}</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <DetailItem label="Billing email" value={t.customer.billingEmail || '—'} />
                  <DetailItem label="Billing frequency" value={t.plan ? interval(t.subscription?.interval || t.interval) : 'One-time'} />
                </div>
              </Card>

              <Card>
                <h2 className="text-[20px] font-medium text-white">Payment &amp; invoice</h2>
                <div className="mt-5 grid grid-cols-1 gap-6 border-b border-white/10 pb-6 sm:grid-cols-3">
                  <DetailItem label="Payment method" value={t.paymentMethod || '—'} />
                  <DetailItem label="Payment state" value={STATE_LABEL[t.status] || t.status} />
                  <DetailItem label="Payment provider" value={providerName(t.provider)} />
                </div>
                <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <DetailItem label="Invoice" value={t.invoiceNumber || '—'} />
                  <DetailItem label="Invoice status" value={t.status === 'pending' ? 'Open' : t.status === 'failed' ? 'Unpaid' : 'Paid'} />
                </div>
                <div className="mt-5 flex items-center gap-3 rounded-lg bg-[#0f1520] px-4 py-3">
                  <FileText className="h-5 w-5 text-figma-text-soft" />
                  <div className="flex-1">
                    <p className="text-[12px] text-figma-text-soft">Receipt</p>
                    <p className="text-[13px] text-white">{t.providerReference || t.reference} · {t.status === 'failed' ? 'Unavailable' : 'Available'}</p>
                  </div>
                  <button type="button" className="link text-[16px]" onClick={() => setInvoiceOpen(true)} disabled={!t.invoiceNumber}>View invoice</button>
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <h2 className="text-[20px] font-medium text-white">Amount breakdown</h2>
                <dl className="mt-5 space-y-5 text-[16px]">
                  <div className="flex justify-between"><dt className="text-figma-text-soft">Subscription</dt><dd className="text-white">{money(t.breakdown.subtotalMinor, t.currency)}</dd></div>
                  <div className="flex justify-between"><dt className="text-figma-text-soft">Discount</dt><dd className="text-white">{money(t.breakdown.discountMinor, t.currency)}</dd></div>
                  <div className="flex justify-between"><dt className="text-figma-text-soft">Tax</dt><dd className="text-white">{money(t.breakdown.taxMinor, t.currency)}</dd></div>
                  {t.breakdown.refundedMinor > 0 && <div className="flex justify-between"><dt className="text-figma-text-soft">Refunded</dt><dd className="text-figma-warning">−{money(t.breakdown.refundedMinor, t.currency)}</dd></div>}
                  <div className="flex items-baseline justify-between border-t border-white/10 pt-5"><dt className="text-figma-text-soft">Total paid</dt><dd className="text-[20px] font-semibold text-white">{money(t.breakdown.totalMinor, t.currency)}</dd></div>
                </dl>
              </Card>

              <Card>
                <h2 className="text-[20px] font-medium text-white">Transaction activity</h2>
                {t.timeline.length === 0 ? <p className="mt-4 text-[14px] text-figma-text-muted">No activity recorded.</p> : (
                  <ol className="relative mt-5 space-y-7 border-l border-white/10 pl-6">
                    {t.timeline.map((e, i) => (
                      <li key={`${e.type}-${i}`} className="relative">
                        <span className={cx('absolute -left-[28.5px] top-1.5 h-2 w-2 rounded-full', DOT[e.type] || 'bg-figma-text-muted')} />
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[16px] text-white">{e.label}</p>
                          <span className="shrink-0 text-[12px] text-figma-text-soft">{dateTime(e.at)}</span>
                        </div>
                        {e.detail && <p className="mt-1 text-[14px] text-figma-text-soft">{e.detail}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center gap-2">
            <div className="flex gap-8">
              <button type="button" className="btn-secondary w-[100px] text-[16px]" onClick={() => router.push('/finance')}>Back</button>
              <button
                type="button"
                className="btn-primary text-[16px]"
                onClick={() => setRefundOpen(true)}
                disabled={!isSuper || t.refundableMinor <= 0}
              >
                Initiate Refund
              </button>
            </div>
            {!isSuper && <p className="text-[12px] text-figma-text-muted">Only a super admin can issue refunds.</p>}
            {isSuper && t.refundableMinor <= 0 && <p className="text-[12px] text-figma-text-muted">{t.status === 'refunded' ? 'This payment has been fully refunded.' : 'Only collected payments can be refunded.'}</p>}
          </div>

          <RefundModal
            open={refundOpen}
            onClose={() => setRefundOpen(false)}
            refundableMinor={t.refundableMinor}
            currency={t.currency}
            reference={t.reference}
            onSubmit={async (body) => {
              const result = await adminApi.refund(t.id, body.amountMinor, body.reason);
              setData(result.transaction);
              toast.success(result.refund.status === 'failed' ? 'Refund failed at the provider' : `Refund of ${money(result.refund.amountMinor, t.currency)} submitted`);
            }}
          />
          <InvoiceModal open={invoiceOpen} onClose={() => setInvoiceOpen(false)} transactionId={t.id} />
        </>
      )}
    </Shell>
  );
}

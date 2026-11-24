import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Download, FileImage, FileText, Scale, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import Shell from '../components/Shell';
import {
  Avatar, Card, Delta, EmptyState, ErrorState, Field, InlineAlert, Modal, PageHeader, Pagination, Pill, Skeleton, Spinner, StatCard, StatusPill, cx,
} from '../components/ui';
import RefundModal from '../components/RefundModal';
import { adminApi, downloadAuthenticated } from '../lib/api';
import useAsync from '../lib/useAsync';
import useSession from '../store/session';
import { MONTH_LABELS, money, moneyWhole, number, pct, time } from '../lib/format';
import { toast } from '../store/toast';

const TABS = [
  { id: 'open', label: 'Open' },
  { id: 'in_review', label: 'In review' },
  { id: 'resolved', label: 'Resolved' },
];
const PRIORITY = { urgent: ['danger', 'Urgent'], high: ['danger', 'High'], medium: ['warning', 'Medium'], low: ['muted', 'Low'] };
const LIMIT = 5;

function openedLabel(at) {
  const d = new Date(at);
  return `Opened ${MONTH_LABELS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${time(at)}`;
}
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function caseTitle(c) {
  return `${c.caseNumber || c.referenceNumber || 'Case'} · ${c.categoryLabel}${c.subcategory ? ` / ${c.subcategory}` : ''}`;
}

function ReplyModal({ open, onClose, onSend, customer }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setText(''); setError(''); } }, [open]);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) { setError('Write a reply first'); return; }
    setBusy(true);
    setError('');
    try { await onSend(text.trim()); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} width="max-w-[600px]" title={<span className="text-[26px]">Reply to {customer?.name || 'customer'}</span>} subtitle={customer?.id ? 'They’ll get an in-app notification and see your reply in Support.' : 'Your reply is added to the case conversation.'}>
      <form onSubmit={send} noValidate>
        <Field label="Message">
          <textarea className="input h-40 resize-y py-2.5" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} placeholder="Hi, thanks for reaching out…" autoFocus />
        </Field>
        <p className="mt-1 text-right text-[11px] text-figma-text-faint">{text.length}/5000</p>
        {error && <div className="mt-3"><InlineAlert>{error}</InlineAlert></div>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary min-w-[130px]" disabled={busy}>{busy ? <Spinner /> : 'Send reply'}</button>
        </div>
      </form>
    </Modal>
  );
}

function SolveModal({ open, onClose, onConfirm, reopen }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setNote(''); setError(''); } }, [open]);
  const run = async () => {
    setBusy(true);
    setError('');
    try { await onConfirm(note.trim()); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} width="max-w-[520px]" title={<span className="text-[24px]">{reopen ? 'Reopen this case?' : 'Mark this case as solved?'}</span>}>
      <p className="-mt-2 text-[15px] text-figma-text-soft">{reopen ? 'The case moves back to the open queue.' : 'The case moves to Resolved. You can reopen it later if needed.'}</p>
      <Field label="Note (optional)" className="mt-5">
        <textarea className="input h-20 resize-none py-2" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={reopen ? 'Why is it being reopened?' : 'e.g. Duplicate charge refunded'} />
      </Field>
      {error && <div className="mt-3"><InlineAlert>{error}</InlineAlert></div>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary min-w-[140px]" onClick={run} disabled={busy}>{busy ? <Spinner /> : reopen ? 'Reopen case' : 'Mark as Solved'}</button>
      </div>
    </Modal>
  );
}

function CaseDetail({ id, onChanged }) {
  const admin = useSession((s) => s.admin);
  const { data: c, error, reload, setData } = useAsync(() => adminApi.dispute(id), [id], { enabled: Boolean(id) });
  const [modal, setModal] = useState(null);
  const [starting, setStarting] = useState(false);
  const isSuper = admin?.role === 'super_admin';

  const apply = (next, message) => { setData(next); onChanged?.(); if (message) toast.success(message); };

  if (!id) {
    return <EmptyState icon={FileText} title="No case selected" message="Select a case from the queue to see the customer statement, evidence and activity." />;
  }
  if (error && !c) return <ErrorState message={error.status === 404 ? 'This case no longer exists.' : error.message} onRetry={error.status === 404 ? undefined : reload} />;
  if (!c) return <div className="space-y-4"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-40 w-full" /><Skeleton className="h-24 w-full" /></div>;

  const payments = [c.linkedPayment, ...(c.recentPayments || []).filter((p) => p.id !== c.linkedPayment?.id)].filter(Boolean);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold text-white">{caseTitle(c)}</h2>
          <p className="mt-1 text-[12px] text-figma-text-soft">{openedLabel(c.createdAt)}{c.disputedAmountMinor ? ` · Disputed ${money(c.disputedAmountMinor, c.currency)}` : ''}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusPill status={c.status} size="sm" />
          {c.status === 'open' && (
            <button type="button" className="link text-[12px]" disabled={starting} onClick={async () => {
              setStarting(true);
              try { apply(await adminApi.reviewDispute(c.id), 'Case moved to review'); } catch (err) { toast.error(err.message); } finally { setStarting(false); }
            }}>{starting ? 'Starting…' : 'Start review'}</button>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Avatar name={c.customer.name} src={c.customer.profilePicture} size={32} />
        <div className="min-w-0 text-[13px]">
          {c.customer.id ? <Link href={`/users/${c.customer.id}`} className="text-white hover:text-figma-accent">{c.customer.name}</Link> : <span className="text-white">{c.customer.name}</span>}
          <span className="text-figma-text-soft"> · {c.customer.email || 'No email'} · {c.accountType}</span>
        </div>
      </div>

      <h3 className="mb-3 mt-6 text-[16px] font-medium text-white">Customer statement</h3>
      <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-md bg-[#0f1520] px-3 py-3 text-[15px] leading-relaxed text-white">
        {c.statement || <span className="text-figma-text-muted">No statement provided.</span>}
      </div>

      {c.messages.length > 1 && (
        <details className="mt-3 rounded-md bg-[#0f1520] px-3 py-2 text-[13px]">
          <summary className="cursor-pointer text-figma-accent">Conversation ({c.messages.length} messages)</summary>
          <ul className="mt-3 space-y-3">
            {c.messages.slice(1).map((m, i) => (
              <li key={i} className={cx('rounded-md px-3 py-2', m.sender === 'agent' ? 'bg-[#10303a]/50' : 'bg-white/5')}>
                <p className="text-[12px] text-figma-text-soft">{m.senderName} · {new Date(m.at).toLocaleString()}</p>
                <p className="mt-1 whitespace-pre-wrap text-white">{m.message}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <h3 className="mb-3 mt-6 text-[16px] font-medium text-white">Evidence &amp; attachments</h3>
      {c.attachments.length === 0 ? <p className="text-[13px] text-figma-text-muted">No attachments uploaded.</p> : (
        <ul className="space-y-2.5">
          {c.attachments.map((a) => {
            const Icon = /^image\//.test(a.mimeType || '') ? FileImage : FileText;
            return (
              <li key={a.index} className="flex items-center gap-3 rounded-md bg-[#0f1520] px-3 py-3">
                <Icon className="h-4 w-4 text-figma-text-soft" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-white">{a.name}</p>
                  <p className="text-[10px] text-figma-text-soft">Customer upload{a.size ? ` · ${formatSize(a.size)}` : ''}</p>
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-figma-text-soft hover:bg-white/5 hover:text-white"
                  aria-label={`Download ${a.name}`}
                  onClick={() => downloadAuthenticated(adminApi.attachmentUrl(c.id, a.index), a.name).catch((err) => toast.error(err.message))}
                >
                  <Download className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {c.linkedPayment && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-figma-text-soft">
          Linked transaction:
          <Link className="link inline-flex items-center gap-1" href={`/finance/transactions/${c.linkedPayment.id}`}>{c.linkedPayment.reference} <ExternalLink className="h-3 w-3" /></Link>
          · {money(c.linkedPayment.amountMinor, c.linkedPayment.currency)}
        </p>
      )}

      <h3 className="mb-3 mt-6 text-[16px] font-medium text-white">Activity timeline</h3>
      <ul className="max-h-[200px] space-y-3 overflow-y-auto rounded-md bg-[#0f1520] px-3 py-3 text-[12px]">
        {c.activity.map((a, i) => (
          <li key={i} className="flex gap-4">
            <span className="w-[72px] shrink-0 text-figma-text-soft" title={new Date(a.at).toLocaleString()}>
              {new Date(a.at).toDateString() === new Date().toDateString() ? time(a.at) : `${MONTH_LABELS[new Date(a.at).getMonth()]} ${new Date(a.at).getDate()}`}
            </span>
            <span className="text-white/90">{a.message}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap justify-between gap-3 pt-8">
        <button type="button" className="btn-secondary h-11 flex-1 text-[16px]" onClick={() => setModal('reply')} disabled={c.status === 'resolved'}>Reply User</button>
        {c.status === 'resolved' ? (
          <button type="button" className="btn-primary h-11 flex-1 text-[16px]" onClick={() => setModal('reopen')}>Reopen Case</button>
        ) : (
          <button type="button" className="btn-primary h-11 flex-1 text-[16px]" onClick={() => setModal('solve')}>Mark as Solved</button>
        )}
        <button type="button" className="btn-secondary h-11 flex-1 text-[16px]" onClick={() => setModal('refund')} disabled={!isSuper} title={!isSuper ? 'Only a super admin can issue refunds' : undefined}>Initiate Refund</button>
      </div>

      <ReplyModal open={modal === 'reply'} onClose={() => setModal(null)} customer={c.customer} onSend={async (message) => apply(await adminApi.replyDispute(c.id, message), 'Reply sent')} />
      <SolveModal open={modal === 'solve' || modal === 'reopen'} reopen={modal === 'reopen'} onClose={() => setModal(null)}
        onConfirm={async (note) => apply(await adminApi.disputeStatus(c.id, modal === 'reopen' ? 'open' : 'resolved', note || undefined), modal === 'reopen' ? 'Case reopened' : 'Case marked as solved')} />
      <RefundModal
        open={modal === 'refund'}
        onClose={() => setModal(null)}
        payments={payments}
        defaultReason={`Dispute ${c.caseNumber || ''}`.trim()}
        onSubmit={async ({ amountMinor, reason, paymentId }) => apply(await adminApi.refundDispute(c.id, { amountMinor, reason, paymentId }), 'Refund submitted')}
      />
    </div>
  );
}

export default function DisputesPage() {
  const router = useRouter();
  const [tab, setTab] = useState('open');
  const [page, setPage] = useState(1);
  const selected = typeof router.query.case === 'string' ? router.query.case : null;
  const select = (id) => router.replace({ pathname: '/disputes', query: id ? { case: id } : {} }, undefined, { shallow: true, scroll: false });

  const summary = useAsync(() => adminApi.disputesSummary(), []);
  const list = useAsync(() => adminApi.disputes({ status: tab, page, limit: LIMIT }), [tab, page]);
  useEffect(() => { setPage(1); }, [tab]);

  // Auto-select the first case when nothing (valid) is selected, on wide screens.
  useEffect(() => {
    if (!router.isReady || selected || !list.data?.cases.length) return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches) select(list.data.cases[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, list.data]);

  const s = summary.data;
  const counts = list.data?.counts;
  const refreshAll = () => { summary.reload(); list.reload(); };

  return (
    <Shell title="Dispute">
      <PageHeader title="Dispute" subtitle="Review payment issues, gather evidence, and resolve cases fairly." />

      {summary.error && !s ? <Card><ErrorState compact message={summary.error.message} onRetry={summary.reload} /></Card> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard loading={!s} label="Open cases" value={s && number(s.openCases.count)}
            delta={s && (s.openCases.count ? <Delta value={`${s.openCases.newThisWeek} new`} label="this week" tone="warn" arrow={false} /> : <Delta label="No disputes submitted" />)} />
          <StatCard loading={!s} label="Awaiting response" value={s && number(s.awaitingResponse.count)}
            delta={s && (s.awaitingResponse.count ? <Delta value={`${s.awaitingResponse.dueToday} due today`} label="requires attention" tone="warn" arrow={false} /> : <Delta label="No responses needed" />)} />
          <StatCard loading={!s} label="Disputed amount" value={s && moneyWhole(s.disputedAmount.amountMinor)}
            delta={s && (s.disputedAmount.amountMinor ? <Delta value={pct(s.disputedAmount.pctOfMonthlyRevenue)} label="of monthly revenue" arrow={false} /> : <Delta label="No disputed payments" />)} />
          <StatCard loading={!s} label="Resolution rate" value={s && (s.resolutionRate.pct === null ? '—' : pct(s.resolutionRate.pct))}
            delta={s && (s.resolutionRate.pct === null ? <Delta label="No cases to calculate a rate" /> : s.resolutionRate.changePts !== null
              ? <Delta value={`${Math.abs(s.resolutionRate.changePts)}%`} label="vs. last month" tone={s.resolutionRate.changePts >= 0 ? 'up' : 'down'} />
              : <Delta label="Resolved within 30 days" />)} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,564px)_minmax(0,1fr)]">
        <Card className={cx('flex min-h-[640px] flex-col', selected && 'hidden xl:flex')}>
          <h2 className="text-[20px] font-medium text-white">Dispute queue</h2>
          <p className="mt-2 text-[14px] text-figma-text-muted">Prioritized by response deadline</p>
          <div className="mt-5 flex gap-6 border-b border-white/15" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cx('-mb-px border-b-2 pb-3 text-[16px]', tab === t.id ? 'border-figma-accent font-medium text-figma-accent' : 'border-transparent text-figma-text-soft hover:text-white')}
              >
                {t.label} {counts ? counts[t.id] : ''}
              </button>
            ))}
          </div>
          {list.error && !list.data ? <ErrorState message={list.error.message} onRetry={list.reload} /> : !list.data ? (
            <div className="mt-5 space-y-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[98px] w-full" />)}</div>
          ) : list.data.cases.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={Scale}
                title={counts && (counts.open + counts.in_review + counts.resolved) === 0 ? 'No disputes yet' : `No ${TABS.find((t) => t.id === tab).label.toLowerCase()} cases`}
                message={counts && (counts.open + counts.in_review + counts.resolved) === 0 ? 'When a customer submits a dispute, it will appear here for review.' : 'Cases will appear here as their status changes.'}
              />
            </div>
          ) : (
            <ul className={cx('mt-5 flex-1 space-y-4', list.loading && 'opacity-60')}>
              {list.data.cases.map((c) => {
                const [tone, label] = PRIORITY[c.priority] || PRIORITY.medium;
                const active = c.id === selected;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => select(c.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cx('w-full rounded-md border px-3.5 py-3 text-left transition-colors', active ? 'border-figma-accent bg-[#0f3a40]/50' : 'border-white/10 bg-[#121926] hover:border-white/25')}
                    >
                      <p className="text-[12px] font-medium text-white">{c.caseNumber || c.referenceNumber}</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={c.customer.name} src={c.customer.profilePicture} size={32} />
                          <div className="min-w-0">
                            <p className="truncate text-[16px] text-white">{c.customer.name}</p>
                            <p className="truncate text-[12px] text-figma-text-soft">{c.customer.company || c.accountType}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <p className="max-w-[240px] truncate text-[14px] text-white">{c.categoryLabel}{c.subcategory ? `/${c.subcategory}` : ''}</p>
                          <div className="flex items-center gap-2">
                            {c.awaitingResponse && c.status !== 'resolved' && new Date(c.dueAt) <= new Date(Date.now() + 86400000) && <span className="text-[11px] text-figma-warning">Due {new Date(c.dueAt) < new Date() ? 'now' : time(c.dueAt)}</span>}
                            <Pill tone={tone} size="sm">{label}</Pill>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list.data && (list.data.total > 0
            ? <Pagination {...list.data} onPage={setPage} label={`Showing ${list.data.cases.length} of ${number(list.data.total)} ${TABS.find((t) => t.id === tab).label.toLowerCase()} cases`} />
            : <p className="mt-4 text-[13px] text-figma-text-soft">0 cases</p>)}
        </Card>

        <Card className={cx('min-h-[640px]', !selected && 'hidden xl:block')}>
          {selected && <button type="button" className="mb-4 text-[13px] text-figma-accent xl:hidden" onClick={() => select(null)}>← Back to queue</button>}
          {!selected && list.data && list.data.cases.length === 0 && counts && (counts.open + counts.in_review + counts.resolved) === 0 ? (
            <>
              <h2 className="text-[20px] font-medium text-white">Case details</h2>
              <div className="flex min-h-[520px] items-center justify-center">
                <EmptyState icon={FileText} title="No case selected" message="Case details, customer statements, and evidence will appear here when a dispute is available to review." />
              </div>
            </>
          ) : <CaseDetail key={selected || 'none'} id={selected} onChanged={refreshAll} />}
        </Card>
      </div>
    </Shell>
  );
}

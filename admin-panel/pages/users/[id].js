import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { Ban, LogOut, RotateCcw, ShieldCheck } from 'lucide-react';
import Shell from '../../components/Shell';
import {
  Card, CardTitle, DetailItem, EmptyState, ErrorState, Field, GradientAvatar, InlineAlert, Modal, PageHeader, Pill, Skeleton, Spinner, StatusPill,
} from '../../components/ui';
import { adminApi } from '../../lib/api';
import useAsync from '../../lib/useAsync';
import useSession from '../../store/session';
import { date, dateTime, interval, money, number, relative, roleLabel } from '../../lib/format';
import { toast } from '../../store/toast';

function ConfirmModal({ open, onClose, title, body, confirmLabel, danger, onConfirm, children, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} width="max-w-[520px]" title={<span className="text-[24px]">{title}</span>}>
      <p className="-mt-2 text-[15px] leading-relaxed text-figma-text-soft">{body}</p>
      {children}
      {error && <div className="mt-4"><InlineAlert>{error}</InlineAlert></div>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={run} disabled={busy || disabled}>{busy ? <Spinner /> : confirmLabel}</button>
      </div>
    </Modal>
  );
}

export default function UserDetail() {
  const router = useRouter();
  const { id } = router.query;
  const me = useSession((s) => s.admin);
  const { data: user, error, reload, setData } = useAsync(() => adminApi.user(id), [id], { enabled: Boolean(id) });
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');

  const self = user && me && user.id === me.id;
  const protectedTarget = user && user.platformRole === 'super_admin' && me?.role !== 'super_admin';
  const canManage = user && !self && !protectedTarget;

  return (
    <Shell title={user ? user.name || user.email : 'User'}>
      <PageHeader back="/users" title="User details" subtitle="Account, subscription and activity" />
      {error && !user ? (
        <Card><ErrorState message={error.status === 404 ? 'This user no longer exists.' : error.message} onRetry={error.status === 404 ? undefined : reload} /></Card>
      ) : !user ? (
        <Card><Skeleton className="h-16 w-72" /><Skeleton className="mt-6 h-40 w-full" /></Card>
      ) : (
        <>
          <Card className="mb-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <GradientAvatar name={user.name || user.email} src={user.profilePicture} size={64} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[22px] font-semibold text-white">
                    {user.name || user.email}
                    <StatusPill status={user.status} />
                    {user.platformRole && <Pill tone="info"><ShieldCheck className="h-3.5 w-3.5" /> {roleLabel(user.platformRole)}</Pill>}
                  </p>
                  <p className="mt-1 text-[15px] text-figma-text-soft">{user.email}{user.company ? ` · ${user.company}` : ''}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn-secondary" disabled={!canManage} onClick={() => setModal('signout')} title={self ? 'You cannot sign yourself out here' : undefined}>
                  <LogOut className="h-4 w-4" /> Sign out everywhere
                </button>
                {user.status === 'suspended' ? (
                  <button type="button" className="btn-primary" disabled={!canManage} onClick={() => setModal('reinstate')}>
                    <RotateCcw className="h-4 w-4" /> Reinstate
                  </button>
                ) : (
                  <button type="button" className="btn-danger" disabled={!canManage} onClick={() => { setReason(''); setModal('suspend'); }}>
                    <Ban className="h-4 w-4" /> Suspend
                  </button>
                )}
              </div>
            </div>
            {self && <p className="mt-4 text-[13px] text-figma-text-muted">This is your account. Manage it from Settings.</p>}
            {protectedTarget && <p className="mt-4 text-[13px] text-figma-text-muted">Only a super admin can manage another super admin.</p>}
            {user.status === 'suspended' && (
              <div className="mt-4"><InlineAlert tone="danger">Suspended {user.bannedAt ? relative(user.bannedAt) : ''}{user.banReason ? ` — ${user.banReason}` : ''}</InlineAlert></div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardTitle title="Account" />
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <DetailItem label="User ID" value={<span className="font-mono text-[14px]">{user.id}</span>} />
                <DetailItem label="Sign-in method" value={user.authProvider === 'local' ? 'Email & password' : user.authProvider[0].toUpperCase() + user.authProvider.slice(1)} />
                <DetailItem label="Joined" value={date(user.createdAt)} />
                <DetailItem label="Last sign-in" value={user.lastLogin ? dateTime(user.lastLogin) : 'Never'} />
                <DetailItem label="Email verified" value={user.status === 'unverified' ? 'No' : 'Yes'} />
                <DetailItem label="Onboarding" value={user.onboardingCompleted ? 'Completed' : 'Not completed'} />
              </div>
            </Card>
            <Card>
              <CardTitle title="Subscription" right={user.subscription && <Link className="link text-[14px]" href={`/billing?subscriber=${user.subscription.id}`}>Billing details</Link>} />
              {user.subscription ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <DetailItem label="Plan" value={user.subscription.planLabel} />
                  <DetailItem label="Status" value={<StatusPill status={user.subscription.status} />} />
                  <DetailItem label="Amount" value={user.subscription.amountMinor ? `${money(user.subscription.amountMinor, user.subscription.currency)} / ${interval(user.subscription.interval).toLowerCase()}` : 'Free'} />
                  <DetailItem label="Next billing" value={user.subscription.nextBillingAt ? date(user.subscription.nextBillingAt) : '—'} />
                  <DetailItem label="Lifetime value" value={user.lifetimeValue.length ? user.lifetimeValue.map((v) => money(v.amountMinor, v.currency)).join(' · ') : money(0)} />
                </div>
              ) : <p className="text-[15px] text-figma-text-muted">Developer (free) — no subscription on record.</p>}
            </Card>
            <Card>
              <CardTitle title="Usage" subtitle="Platform activity" />
              <div className="grid grid-cols-3 gap-6">
                <DetailItem label="Deployments" value={number(user.usage.deployments)} />
                <DetailItem label="AI agent runs" value={number(user.usage.agentRuns)} />
                <DetailItem label="Active days (30d)" value={number(user.usage.activeDaysLast30)} />
              </div>
            </Card>
            <Card>
              <CardTitle title="Recent payments" />
              {user.recentPayments.length === 0 ? <EmptyState title="No payments yet" message="Payments made by this user will appear here." /> : (
                <ul className="divide-y divide-white/10">
                  {user.recentPayments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                      <Link href={`/finance/transactions/${p.id}`} className="link">{p.reference}</Link>
                      <span className="text-[14px] text-figma-text-soft">{date(p.createdAt)}</span>
                      <span className="text-[15px] text-white">{money(p.amountMinor, p.currency)}</span>
                      <StatusPill status={p.status} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <ConfirmModal
        open={modal === 'suspend'}
        onClose={() => setModal(null)}
        title="Suspend this user?"
        body={`${user?.name || user?.email} will be signed out everywhere and blocked from signing in until reinstated.`}
        confirmLabel="Suspend user"
        danger
        disabled={!reason.trim()}
        onConfirm={async () => { setData(await adminApi.suspendUser(id, reason.trim())); toast.success('User suspended'); }}
      >
        <Field label="Reason" hint="Recorded in the audit log." className="mt-5">
          <textarea className="input h-24 resize-none py-2" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Chargeback fraud" />
        </Field>
      </ConfirmModal>
      <ConfirmModal
        open={modal === 'reinstate'}
        onClose={() => setModal(null)}
        title="Reinstate this user?"
        body={`${user?.name || user?.email} will be able to sign in again.`}
        confirmLabel="Reinstate"
        onConfirm={async () => { setData(await adminApi.reinstateUser(id)); toast.success('User reinstated'); }}
      />
      <ConfirmModal
        open={modal === 'signout'}
        onClose={() => setModal(null)}
        title="Sign out everywhere?"
        body="Every active session for this user will end immediately. They can sign in again."
        confirmLabel="Sign out"
        onConfirm={async () => { setData(await adminApi.signOutUser(id)); toast.success('All sessions ended'); }}
      />
    </Shell>
  );
}

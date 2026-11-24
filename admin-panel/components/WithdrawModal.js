import { useEffect, useMemo, useState } from 'react';
import { Info, Lock } from 'lucide-react';
import { Field, InlineAlert, Modal, Spinner, cx } from './ui';
import GatewayIcon from './GatewayIcon';
import { adminApi } from '../lib/api';
import { idempotencyKey, money, toMinor } from '../lib/format';
import { toast } from '../store/toast';

export default function WithdrawModal({ open, onClose, gateways, onDone, canWithdraw }) {
  const view = gateways;
  const options = useMemo(() => (view?.gateways || []), [view]);
  const firstReady = options.find((g) => g.configured && g.supported !== false && g.payout.configured);
  const [provider, setProvider] = useState(firstReady?.id || options[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(idempotencyKey());

  useEffect(() => {
    if (open) {
      setProvider(firstReady?.id || options[0]?.id || '');
      setAmount('');
      setError('');
      setKey(idempotencyKey());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const currency = view?.currency || 'USD';
  const gateway = options.find((g) => g.id === provider);
  const balance = gateway?.balances.find((b) => b.currency === currency);
  const available = balance?.availableMinor || 0;
  const minor = toMinor(amount);
  const ready = gateway && gateway.configured && gateway.supported !== false && gateway.payout.configured;
  const remaining = minor !== null ? available - minor : available;

  let blocker = '';
  if (!canWithdraw) blocker = 'Only a super admin can withdraw funds.';
  else if (!gateway) blocker = 'No payment gateway is connected.';
  else if (gateway.supported === false) blocker = `${gateway.name} is not integrated with BuildrsHQ yet.`;
  else if (!gateway.configured) blocker = `${gateway.name} is not connected.`;
  else if (gateway.error) blocker = `${gateway.name} balance is unavailable right now. Try again shortly.`;
  else if (!gateway.payout.configured) blocker = `No settlement account is configured for ${gateway.name}.`;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (minor === null || minor <= 0) { setError('Enter an amount greater than zero'); return; }
    if (minor > available) { setError('Amount exceeds the available balance'); return; }
    setBusy(true);
    try {
      const { withdrawal } = await adminApi.withdraw({ provider, amountMinor: minor, currency, idempotencyKey: key });
      toast.success(withdrawal.status === 'requested'
        ? `Withdrawal request ${withdrawal.reference} recorded`
        : `Withdrawal ${withdrawal.reference} initiated`);
      onDone?.();
      onClose();
    } catch (err) {
      setError(err.message);
      if (err.status && err.status < 500) setKey(idempotencyKey());
    } finally {
      setBusy(false);
    }
  };

  const requestMode = view?.payoutMode !== 'live';
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="Withdraw funds" subtitle="Transfer your available balance to a connected account.">
      <form onSubmit={submit} noValidate>
        <div className="flex items-center justify-between rounded-lg border border-white/15 bg-[#0a0d15] px-4 py-4">
          <div>
            <p className="text-[12px] text-figma-text-soft">Available to withdraw</p>
            <p className="mt-1 text-[28px] font-semibold text-white">{money(available, currency)}</p>
          </div>
          <span className="rounded bg-[#1d263b] px-2.5 py-1 text-[12px] text-figma-text-soft">{currency}</span>
        </div>

        <p className="mb-3 mt-6 text-[15px] font-medium text-white">Withdrawal destination</p>
        <div role="radiogroup" aria-label="Withdrawal destination" className={cx('grid grid-cols-1 gap-3', options.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
          {options.map((g) => {
            const selected = g.id === provider;
            return (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => { setProvider(g.id); setError(''); }}
                className={cx(
                  'relative flex h-[96px] flex-col justify-between rounded-lg border p-3 text-left transition-colors',
                  selected ? 'border-figma-accent bg-[#0f3a40]/60' : 'border-white/15 bg-[#0a0d15] hover:border-white/30'
                )}
              >
                <GatewayIcon id={g.id} size={32} />
                <span className={cx('absolute right-3 top-3 inline-flex h-4 w-4 items-center justify-center rounded-full border', selected ? 'border-figma-accent' : 'border-white/60')}>
                  {selected && <span className="h-2 w-2 rounded-full bg-figma-accent" />}
                </span>
                <span className="flex items-baseline justify-between gap-2 text-[15px] text-white">
                  {g.name}
                  {!(g.configured && g.supported !== false) && <span className="text-[11px] text-figma-text-faint">Not connected</span>}
                </span>
              </button>
            );
          })}
        </div>

        <Field label="Amount" className="mt-6">
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-figma-text-soft">$</span>
            <input
              className="input h-12 pl-9 pr-24 text-[16px]"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              disabled={Boolean(blocker)}
              aria-label="Amount in US dollars"
            />
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-figma-accent hover:text-figma-accent-bright disabled:opacity-40"
              onClick={() => setAmount((available / 100).toFixed(2))}
              disabled={Boolean(blocker) || !available}
            >
              Use max
            </button>
          </div>
        </Field>

        <p className="mb-2 mt-6 text-[15px] font-medium text-white">Destination account</p>
        {gateway ? (
          <div className="flex items-center gap-3 rounded-lg border border-white/15 bg-[#0a0d15] px-4 py-3.5">
            <GatewayIcon id={gateway.id} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] text-white">{gateway.name}</p>
              <p className="truncate text-[13px] text-figma-text-soft">{gateway.payout.configured ? gateway.payout.label : 'No settlement account configured'}</p>
            </div>
            <span className={cx('text-[12px]', ready ? 'text-[#56e5a9]' : 'text-figma-text-faint')}>{ready ? 'Connected' : 'Not connected'}</span>
          </div>
        ) : <p className="text-[14px] text-figma-text-muted">No gateways available.</p>}

        <p className="mt-5 flex items-start gap-2 border-b border-white/10 pb-5 text-[13px] text-figma-text-soft">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {requestMode
            ? `This records a withdrawal request for the finance team to complete in the ${gateway?.name || 'provider'} dashboard. Remaining available balance after payout: ${money(Math.max(remaining, 0), currency)}.`
            : `Funds usually arrive within 1–3 business days. Your remaining available balance will be ${money(Math.max(remaining, 0), currency)}.`}
        </p>

        {(blocker || error) && <div className="mt-4"><InlineAlert tone={blocker && !error ? 'warning' : 'danger'}>{error || blocker}</InlineAlert></div>}

        <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-1.5 text-[13px] text-figma-text-soft"><Lock className="h-3.5 w-3.5" /> Secure withdrawal</span>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary min-w-[190px]" disabled={busy || Boolean(blocker) || !minor}>
              {busy ? <Spinner /> : `Withdraw ${money(minor || 0, currency)}`}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

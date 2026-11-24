import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Field, InlineAlert, Modal, Spinner } from './ui';
import { money, toMinor } from '../lib/format';

/**
 * Refund confirmation (Finance › Transaction details and Dispute › Initiate
 * refund). `onSubmit({ amountMinor, reason })` performs the API call.
 */
const REFUNDABLE = ['successful', 'partially_refunded'];

export default function RefundModal({ open, onClose, refundableMinor: fixedRefundable, currency: fixedCurrency = 'USD', reference: fixedReference, onSubmit, defaultReason = '', payments }) {
  // Dispute refunds choose which of the customer's payments to refund.
  const choices = (payments || []).filter((p) => REFUNDABLE.includes(p.status) && p.amountMinor - (p.refundedMinor || 0) > 0);
  const [paymentId, setPaymentId] = useState('');
  const chosen = choices.find((p) => p.id === paymentId);
  const refundableMinor = payments ? (chosen ? chosen.amountMinor - (chosen.refundedMinor || 0) : 0) : fixedRefundable;
  const currency = payments ? (chosen?.currency || 'USD') : fixedCurrency;
  const reference = payments ? chosen?.reference : fixedReference;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPaymentId(choices[0]?.id || '');
      setReason(defaultReason);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultReason]);
  useEffect(() => {
    if (open) setAmount(((refundableMinor || 0) / 100).toFixed(2));
  }, [open, refundableMinor]);

  const minor = toMinor(amount);
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (payments && !chosen) { setError('Choose the payment to refund'); return; }
    if (minor === null || minor <= 0) { setError('Enter a refund amount greater than zero'); return; }
    if (minor > refundableMinor) { setError(`You can refund at most ${money(refundableMinor, currency)}`); return; }
    if (!reason.trim()) { setError('A refund reason is required'); return; }
    setBusy(true);
    try {
      await onSubmit({ amountMinor: minor, reason: reason.trim(), paymentId: chosen?.id });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      width="max-w-[540px]"
      icon={<RotateCcw className="h-6 w-6" />}
      title={<span className="text-[26px]">Initiate refund</span>}
      subtitle={reference ? `Refund ${reference} to the customer’s original payment method.` : 'Refund the customer’s original payment method.'}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {payments && (
          <Field label="Payment" hint={choices.length ? 'The customer’s refundable payments, newest first.' : undefined}>
            {choices.length === 0 ? (
              <InlineAlert tone="warning">This customer has no collected payments that can be refunded.</InlineAlert>
            ) : (
              <select className="input h-12" value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>{p.reference} · {money(p.amountMinor, p.currency)}{p.refundedMinor ? ` (${money(p.refundedMinor, p.currency)} refunded)` : ''} · {new Date(p.createdAt).toLocaleDateString()}</option>
                ))}
              </select>
            )}
          </Field>
        )}
        <div className="flex items-center justify-between rounded-lg bg-[#0a0d15] px-4 py-3">
          <span className="text-[14px] text-figma-text-soft">Refundable balance</span>
          <span className="text-[16px] font-semibold text-white">{money(refundableMinor, currency)}</span>
        </div>
        <Field label="Refund amount">
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-figma-text-soft">$</span>
            <input className="input h-12 pl-9 pr-24" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Refund amount" />
            <button type="button" className="absolute right-4 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-figma-accent" onClick={() => setAmount((refundableMinor / 100).toFixed(2))}>Full amount</button>
          </div>
        </Field>
        <Field label="Reason" hint="Shared in the audit log and the transaction timeline.">
          <textarea className="input h-24 resize-none py-2" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Duplicate charge" />
        </Field>
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary min-w-[170px]" disabled={busy || (payments && !chosen)}>{busy ? <Spinner /> : `Refund ${money(minor || 0, currency)}`}</button>
        </div>
      </form>
    </Modal>
  );
}

import { Printer } from 'lucide-react';
import { ErrorState, Modal, Skeleton } from './ui';
import { adminApi } from '../lib/api';
import useAsync from '../lib/useAsync';
import { date, money, providerName } from '../lib/format';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function printInvoice(inv) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  const row = (label, value, bold) => `<tr><td>${escapeHtml(label)}</td><td style="text-align:right;${bold ? 'font-weight:700' : ''}">${escapeHtml(value)}</td></tr>`;
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(inv.invoiceNumber)}</title>
<style>body{font-family:Inter,Arial,sans-serif;color:#111;padding:40px;max-width:720px;margin:auto}h1{font-size:28px;margin:0}
table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:10px 0;border-bottom:1px solid #eee}.muted{color:#666;font-size:13px}</style></head><body>
<h1>Invoice</h1><p class="muted">${escapeHtml(inv.invoiceNumber)} · ${escapeHtml(inv.status)}</p>
<p><strong>${escapeHtml(inv.seller.name)}</strong><br><span class="muted">${escapeHtml(inv.seller.url || '')} ${escapeHtml(inv.seller.email || '')}</span></p>
<p>Bill to<br><strong>${escapeHtml(inv.billTo.name)}</strong><br><span class="muted">${escapeHtml(inv.billTo.email)}</span></p>
<p class="muted">Issued ${escapeHtml(date(inv.issuedAt))}${inv.paidAt ? ` · Paid ${escapeHtml(date(inv.paidAt))}` : ''} · Reference ${escapeHtml(inv.reference)}</p>
<table>${inv.lines.map((l) => row(l.description, money(l.amountMinor, inv.currency))).join('')}
${row('Discount', money(-inv.discountMinor, inv.currency))}${row('Tax', money(inv.taxMinor, inv.currency))}
${row('Total', money(inv.totalMinor, inv.currency), true)}${inv.refundedMinor ? row('Refunded', money(-inv.refundedMinor, inv.currency)) : ''}</table>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

export default function InvoiceModal({ open, onClose, transactionId }) {
  const { data: inv, error, reload } = useAsync(() => adminApi.invoice(transactionId), [transactionId, open], { enabled: open && Boolean(transactionId) });
  return (
    <Modal open={open} onClose={onClose} width="max-w-[640px]" title={<span className="text-[26px]">Invoice</span>} subtitle={inv ? `${inv.invoiceNumber} · ${inv.status}` : undefined}>
      {error ? <ErrorState compact message={error.message} onRetry={reload} /> : !inv ? <Skeleton className="h-56 w-full" /> : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[13px] text-figma-text-muted">From</p>
              <p className="mt-1 text-[15px] text-white">{inv.seller.name}</p>
              <p className="text-[13px] text-figma-text-soft">{inv.seller.email || inv.seller.url}</p>
            </div>
            <div>
              <p className="text-[13px] text-figma-text-muted">Bill to</p>
              <p className="mt-1 text-[15px] text-white">{inv.billTo.name}</p>
              <p className="text-[13px] text-figma-text-soft">{inv.billTo.email}</p>
            </div>
          </div>
          <p className="mt-5 text-[13px] text-figma-text-muted">Issued {date(inv.issuedAt)}{inv.paidAt ? ` · Paid ${date(inv.paidAt)}` : ''} · {providerName(inv.provider)} · {inv.reference}</p>
          <div className="mt-4 divide-y divide-white/10 rounded-lg border border-white/10 px-4">
            {inv.lines.map((l) => (
              <div key={l.description} className="flex justify-between py-3 text-[15px]"><span className="text-white">{l.description}</span><span className="text-white">{money(l.amountMinor, inv.currency)}</span></div>
            ))}
            <div className="flex justify-between py-3 text-[14px] text-figma-text-soft"><span>Discount</span><span>{money(inv.discountMinor, inv.currency)}</span></div>
            <div className="flex justify-between py-3 text-[14px] text-figma-text-soft"><span>Tax</span><span>{money(inv.taxMinor, inv.currency)}</span></div>
            <div className="flex justify-between py-3 text-[16px] font-semibold text-white"><span>Total</span><span>{money(inv.totalMinor, inv.currency)}</span></div>
            {inv.refundedMinor > 0 && <div className="flex justify-between py-3 text-[14px] text-figma-warning"><span>Refunded</span><span>−{money(inv.refundedMinor, inv.currency)}</span></div>}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
            <button type="button" className="btn-primary" onClick={() => printInvoice(inv)}><Printer className="h-4 w-4" /> Print / Save PDF</button>
          </div>
        </>
      )}
    </Modal>
  );
}

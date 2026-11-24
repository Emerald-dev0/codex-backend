/**
 * Admin › Finances.
 *   GET  /api/admin/finance/summary
 *   GET  /api/admin/finance/revenue?year
 *   GET  /api/admin/finance/gateways?fresh=1
 *   GET  /api/admin/finance/transactions?q&status&page&limit
 *   GET  /api/admin/finance/transactions/:id
 *   GET  /api/admin/finance/transactions/:id/invoice
 *   POST /api/admin/finance/transactions/:id/refund   { amountMinor?, reason }   (super_admin)
 *   GET  /api/admin/finance/withdrawals
 *   POST /api/admin/finance/withdrawals   { provider, amountMinor, currency, idempotencyKey }   (super_admin)
 */
const express = require('express');
const finance = require('../utils/admin/financeService');
const { route } = require('../utils/admin/http');
const { requireRole } = require('../middleware/platformAdmin');
const { recordAdminAction } = require('../utils/adminAudit');

const router = express.Router();

router.get('/summary', route(() => finance.getSummary(), 'Could not load finance metrics'));
router.get('/revenue', route((req) => finance.getRevenue({ year: req.query.year }), 'Could not load revenue'));
router.get('/gateways', route((req) => finance.getGatewaysView({ fresh: req.query.fresh === '1' }), 'Could not load gateway balances'));
router.get('/transactions', route((req) => finance.listTransactions(req.query), 'Could not load transactions'));
router.get('/transactions/:id', route((req) => finance.getTransaction(req.params.id), 'Could not load this transaction'));
router.get('/transactions/:id/invoice', route((req) => finance.getInvoice(req.params.id), 'Could not load the invoice'));

router.post('/transactions/:id/refund', requireRole('super_admin'), route(async (req) => {
    const { amountMinor, reason } = req.body || {};
    const result = await finance.refundTransaction(req.params.id, { amountMinor, reason }, req.admin);
    await recordAdminAction({
        action: 'payment.refund',
        target: req.params.id,
        details: { reference: result.payment.reference, amountMinor: result.refund.amountMinor, currency: result.payment.currency, reason },
        req,
    });
    return { refund: result.refund, transaction: await finance.getTransaction(req.params.id) };
}, 'Could not process the refund'));

router.get('/withdrawals', route((req) => finance.listWithdrawals(req.query), 'Could not load withdrawals'));

router.post('/withdrawals', requireRole('super_admin'), route(async (req) => {
    const result = await finance.createWithdrawal(req.body || {}, req.admin);
    if (!result.replayed) {
        await recordAdminAction({
            action: 'finance.withdrawal',
            target: result.withdrawal.reference,
            details: { provider: result.withdrawal.provider, amountMinor: result.withdrawal.amountMinor, currency: result.withdrawal.currency, status: result.withdrawal.status },
            req,
        });
    }
    return result;
}, 'Could not create the withdrawal'));

module.exports = router;

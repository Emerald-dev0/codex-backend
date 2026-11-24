/**
 * Admin › Dispute (cases are Support Center tickets).
 *   GET   /api/admin/disputes/summary
 *   GET   /api/admin/disputes?status=open|in_review|resolved&page&limit
 *   GET   /api/admin/disputes/:id
 *   POST  /api/admin/disputes/:id/review
 *   POST  /api/admin/disputes/:id/reply          { message }
 *   PATCH /api/admin/disputes/:id                { priority?, subcategory?, disputedAmountMinor?, paymentId? }
 *   POST  /api/admin/disputes/:id/status         { status, note? }
 *   POST  /api/admin/disputes/:id/refund         { amountMinor?, reason, paymentId? }   (super_admin)
 *   GET   /api/admin/disputes/:id/attachments/:index
 */
const express = require('express');
const disputes = require('../utils/admin/disputeService');
const { route, fail } = require('../utils/admin/http');
const { requireRole } = require('../middleware/platformAdmin');
const { recordAdminAction } = require('../utils/adminAudit');

const router = express.Router();

router.get('/summary', route(() => disputes.getSummary(), 'Could not load dispute metrics'));
router.get('/', route((req) => disputes.listCases(req.query), 'Could not load cases'));
router.get('/:id', route((req) => disputes.getCase(req.params.id), 'Could not load this case'));

router.post('/:id/review', route((req) => disputes.startReview(req.params.id, req.admin), 'Could not start the review'));

router.post('/:id/reply', route(async (req) => {
    const result = await disputes.reply(req.params.id, req.body || {}, req.admin);
    await recordAdminAction({ action: 'dispute.reply', target: req.params.id, details: { caseNumber: result.caseNumber }, req });
    return result;
}, 'Could not send the reply'));

router.patch('/:id', route(async (req) => {
    const result = await disputes.updateDetails(req.params.id, req.body || {}, req.admin);
    await recordAdminAction({ action: 'dispute.update', target: req.params.id, details: { caseNumber: result.caseNumber, fields: Object.keys(req.body || {}) }, req });
    return result;
}, 'Could not update this case'));

router.post('/:id/status', route(async (req) => {
    const result = await disputes.updateStatus(req.params.id, req.body || {}, req.admin);
    await recordAdminAction({ action: 'dispute.status', target: req.params.id, details: { caseNumber: result.caseNumber, status: result.status }, req });
    return result;
}, 'Could not update the case status'));

router.post('/:id/refund', requireRole('super_admin'), route(async (req) => {
    const result = await disputes.refundCase(req.params.id, req.body || {}, req.admin);
    await recordAdminAction({ action: 'dispute.refund', target: req.params.id, details: { caseNumber: result.caseNumber, amountMinor: req.body?.amountMinor ?? null }, req });
    return result;
}, 'Could not process the refund'));

router.get('/:id/attachments/:index', async (req, res) => {
    try {
        const file = await disputes.getAttachment(req.params.id, req.params.index);
        if (file.type === 'redirect') return res.redirect(file.url);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        return res.download(file.path, file.name);
    } catch (error) {
        return fail(req, res, error, 'Could not download the attachment');
    }
});

module.exports = router;

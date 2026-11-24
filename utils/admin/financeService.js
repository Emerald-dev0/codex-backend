/**
 * Admin › Finances: revenue summary, revenue chart, transactions ledger,
 * transaction details, refunds and withdrawals.
 */
const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const Subscription = require('../../models/Subscription');
const User = require('../../models/User');
const BillingSchedule = require('../../models/BillingSchedule');
const Withdrawal = require('../../models/Withdrawal');
const { nextSequence } = require('../../models/Counter');
const providerOps = require('./providerOps');
const { notifyAdmins } = require('../adminNotifications');
const {
    PAID_TIERS, tierLabel, parsePage, pageMeta, searchRegex, startOfMonth, addMonths,
    pctChange, pct, monthlyValueMinor, wasActiveAt, endOfMonth,
} = require('./common');

const REPORTING_CURRENCY = 'USD';
const COLLECTED_STATUSES = ['successful', 'partially_refunded', 'refunded'];

function httpError(message, statusCode = 400, code = 'REQUEST_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

async function sumPayments(match) {
    const rows = await Payment.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$currency',
                grossMinor: { $sum: '$amountMinor' },
                refundedMinor: { $sum: '$refundedMinor' },
                count: { $sum: 1 },
            },
        },
    ]);
    const primary = rows.find((r) => r._id === REPORTING_CURRENCY) || { grossMinor: 0, refundedMinor: 0, count: 0 };
    return {
        grossMinor: primary.grossMinor,
        refundedMinor: primary.refundedMinor,
        count: primary.count,
        otherCurrencies: rows
            .filter((r) => r._id !== REPORTING_CURRENCY)
            .map((r) => ({ currency: r._id, grossMinor: r.grossMinor, refundedMinor: r.refundedMinor, count: r.count })),
    };
}

async function refundsBetween(from, to) {
    const rows = await Payment.aggregate([
        { $unwind: '$refunds' },
        { $match: { 'refunds.createdAt': { $gte: from, $lt: to }, 'refunds.status': { $ne: 'failed' }, currency: REPORTING_CURRENCY } },
        { $group: { _id: null, amountMinor: { $sum: '$refunds.amountMinor' }, count: { $sum: 1 } } },
    ]);
    return rows[0] || { amountMinor: 0, count: 0 };
}

async function computeMrr(now = new Date()) {
    const subs = await Subscription.find({ tier: { $in: PAID_TIERS } })
        .select('tier status pricing startDate endDate cancelledAt createdAt updatedAt')
        .lean();
    const lastMonthEnd = new Date(startOfMonth(now).getTime() - 1);
    let current = 0;
    let previous = 0;
    for (const sub of subs) {
        if (sub.status === 'active' || sub.status === 'past_due') current += monthlyValueMinor(sub);
        if (wasActiveAt(sub, lastMonthEnd)) previous += monthlyValueMinor(sub);
    }
    return { mrrMinor: current, previousMrrMinor: previous, changePct: pctChange(current, previous) };
}

async function getSummary(now = new Date()) {
    const monthStart = startOfMonth(now);
    const prevMonthStart = addMonths(monthStart, -1);

    const [mrr, collected, collectedPrev, outstandingPayments, overdueSchedules, refunds] = await Promise.all([
        computeMrr(now),
        sumPayments({ status: { $in: COLLECTED_STATUSES }, paidAt: { $gte: monthStart, $lte: now } }),
        sumPayments({ status: { $in: COLLECTED_STATUSES }, paidAt: { $gte: prevMonthStart, $lt: monthStart } }),
        sumPayments({ status: 'pending' }),
        BillingSchedule.aggregate([
            { $match: { status: { $in: ['pending', 'failed'] }, scheduledFor: { $lte: now } } },
            { $group: { _id: null, amountMinor: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        refundsBetween(monthStart, addMonths(monthStart, 1)),
    ]);

    const schedule = overdueSchedules[0] || { amountMinor: 0, count: 0 };
    return {
        currency: REPORTING_CURRENCY,
        mrr: { amountMinor: mrr.mrrMinor, changePct: mrr.changePct },
        collected: {
            amountMinor: collected.grossMinor,
            count: collected.count,
            changePct: pctChange(collected.grossMinor, collectedPrev.grossMinor),
            otherCurrencies: collected.otherCurrencies,
        },
        outstanding: {
            amountMinor: outstandingPayments.grossMinor + (schedule.amountMinor || 0),
            count: outstandingPayments.count + (schedule.count || 0),
        },
        refunds: {
            amountMinor: refunds.amountMinor,
            count: refunds.count,
            pctOfGross: pct(refunds.amountMinor, collected.grossMinor),
        },
    };
}

async function getRevenue({ year } = {}, now = new Date()) {
    const y = Number.isInteger(Number(year)) && Number(year) > 2000 ? Number(year) : now.getUTCFullYear();
    const from = new Date(Date.UTC(y, 0, 1));
    const to = new Date(Date.UTC(y + 1, 0, 1));
    const rows = await Payment.aggregate([
        { $match: { status: { $in: COLLECTED_STATUSES }, currency: REPORTING_CURRENCY, paidAt: { $gte: from, $lt: to } } },
        { $group: { _id: { $month: '$paidAt' }, grossMinor: { $sum: '$amountMinor' }, refundedMinor: { $sum: '$refundedMinor' } } },
    ]);
    const byMonth = new Map(rows.map((r) => [r._id, r]));
    const months = Array.from({ length: 12 }, (_, i) => {
        const row = byMonth.get(i + 1);
        return { month: i + 1, amountMinor: row ? row.grossMinor - row.refundedMinor : 0 };
    });
    const currentIndex = y === now.getUTCFullYear() ? now.getUTCMonth() : 11;
    const current = months[currentIndex].amountMinor;
    const previous = currentIndex > 0 ? months[currentIndex - 1].amountMinor : 0;
    return {
        year: y,
        currency: REPORTING_CURRENCY,
        months,
        currentMonth: currentIndex + 1,
        currentAmountMinor: current,
        changePct: pctChange(current, previous),
        hasData: rows.length > 0,
    };
}

function transactionRow(p) {
    return {
        id: String(p._id),
        reference: p.reference,
        customer: {
            id: p.userId ? String(p.userId._id || p.userId) : null,
            name: p.customerName || p.userId?.fullName || 'Unknown customer',
            email: p.customerEmail || p.userId?.email || '',
        },
        plan: p.plan,
        planLabel: p.plan ? tierLabel(p.plan) : 'One-time',
        interval: p.interval,
        amountMinor: p.amountMinor,
        refundedMinor: p.refundedMinor || 0,
        currency: p.currency,
        status: p.status,
        provider: p.provider,
        createdAt: p.paidAt || p.createdAt,
    };
}

async function listTransactions(query = {}) {
    const { page, limit, skip } = parsePage(query, { defaultLimit: 10, maxLimit: 100 });
    const filter = {};
    const statuses = ['successful', 'pending', 'failed', 'refunded', 'partially_refunded'];
    if (query.status && statuses.includes(query.status)) filter.status = query.status;
    const rx = searchRegex(query.q);
    if (rx) filter.$or = [{ reference: rx }, { customerName: rx }, { customerEmail: rx }, { invoiceNumber: rx }];
    const [total, rows] = await Promise.all([
        Payment.countDocuments(filter),
        Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    return { transactions: rows.map(transactionRow), ...pageMeta(total, page, limit) };
}

function assertObjectId(id, label = 'id') {
    if (!mongoose.isValidObjectId(String(id))) throw httpError(`Invalid ${label}`, 400, 'INVALID_ID');
}

async function getTransaction(id) {
    assertObjectId(id, 'transaction id');
    const payment = await Payment.findById(id).lean();
    if (!payment) throw httpError('Transaction not found', 404, 'NOT_FOUND');
    const [user, subscription] = await Promise.all([
        payment.userId ? User.findById(payment.userId).select('fullName email profilePicture company').lean() : null,
        payment.subscriptionId ? Subscription.findById(payment.subscriptionId).select('tier status pricing nextBillingDate endDate').lean() : null,
    ]);
    const subtotal = payment.amountMinor - (payment.taxMinor || 0) + (payment.discountMinor || 0);
    return {
        ...transactionRow(payment),
        invoiceNumber: payment.invoiceNumber,
        providerReference: payment.providerReference,
        paymentMethod: payment.paymentMethod,
        failureReason: payment.failureReason,
        paidAt: payment.paidAt,
        customer: {
            id: user ? String(user._id) : null,
            name: user?.fullName || payment.customerName || 'Unknown customer',
            email: user?.email || payment.customerEmail || '',
            billingEmail: payment.customerEmail || user?.email || '',
            profilePicture: user?.profilePicture || null,
        },
        subscription: subscription ? {
            id: String(subscription._id),
            tier: subscription.tier,
            planLabel: tierLabel(subscription.tier),
            status: subscription.status,
            interval: subscription.pricing?.interval || payment.interval,
        } : null,
        breakdown: {
            subtotalMinor: Math.max(0, subtotal),
            discountMinor: payment.discountMinor || 0,
            taxMinor: payment.taxMinor || 0,
            totalMinor: payment.amountMinor,
            refundedMinor: payment.refundedMinor || 0,
        },
        refunds: (payment.refunds || []).map((r) => ({
            id: String(r._id),
            amountMinor: r.amountMinor,
            reason: r.reason,
            status: r.status,
            initiatedByName: r.initiatedByName,
            createdAt: r.createdAt,
        })),
        refundableMinor: refundableMinor(payment),
        timeline: [...(payment.timeline || [])].sort((a, b) => new Date(b.at) - new Date(a.at)),
    };
}

function refundableMinor(payment) {
    if (!['successful', 'partially_refunded'].includes(payment.status)) return 0;
    return Math.max(0, payment.amountMinor - (payment.refundedMinor || 0));
}

async function getInvoice(id) {
    const tx = await getTransaction(id);
    const settings = await require('../platformSettings').getSettings();
    return {
        invoiceNumber: tx.invoiceNumber,
        reference: tx.reference,
        issuedAt: tx.createdAt,
        paidAt: tx.paidAt,
        status: tx.status === 'pending' ? 'Open' : (tx.status === 'failed' ? 'Unpaid' : 'Paid'),
        seller: {
            name: settings.general.platformName,
            url: settings.general.platformUrl,
            email: settings.general.billingEmail,
        },
        billTo: { name: tx.customer.name, email: tx.customer.billingEmail },
        lines: [{
            description: `${tx.planLabel} subscription · ${tx.interval === 'yearly' ? 'Annual' : 'Monthly'} billing`,
            amountMinor: tx.breakdown.subtotalMinor,
        }],
        ...tx.breakdown,
        currency: tx.currency,
        provider: tx.provider,
    };
}

/**
 * Issue a (partial) refund through the provider and record it on the ledger.
 * Concurrency: the refundable amount is re-checked with an atomic guard.
 */
async function refundTransaction(id, { amountMinor, reason, disputeId } = {}, admin) {
    assertObjectId(id, 'transaction id');
    const payment = await Payment.findById(id);
    if (!payment) throw httpError('Transaction not found', 404, 'NOT_FOUND');
    const available = refundableMinor(payment);
    if (available <= 0) throw httpError('This transaction has nothing left to refund', 409, 'NOT_REFUNDABLE');
    const amount = amountMinor == null ? available : Number(amountMinor);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw httpError('Refund amount must be a positive amount', 400, 'VALIDATION_ERROR');
    if (amount > available) throw httpError('Refund amount exceeds the refundable balance', 400, 'VALIDATION_ERROR');
    const note = String(reason || '').trim().slice(0, 500);
    if (!note) throw httpError('A refund reason is required', 400, 'VALIDATION_ERROR');

    // Reserve the amount first so two admins cannot double-refund.
    const reserved = await Payment.findOneAndUpdate(
        { _id: payment._id, refundedMinor: payment.refundedMinor || 0 },
        { $inc: { refundedMinor: amount } },
        { new: true }
    );
    if (!reserved) throw httpError('This transaction was updated by someone else. Refresh and try again.', 409, 'CONFLICT');

    let result;
    try {
        result = await providerOps.refundCharge({
            provider: payment.provider,
            chargeId: payment.providerReference,
            amountMinor: amount,
            currency: payment.currency,
            reason: note,
        });
    } catch (error) {
        await Payment.updateOne({ _id: payment._id }, {
            $inc: { refundedMinor: -amount },
            $push: { timeline: { type: 'refund_failed', label: 'Refund failed', detail: error.message, at: new Date() } },
        });
        throw error;
    }

    const refunded = reserved.refundedMinor;
    const status = refunded >= reserved.amountMinor ? 'refunded' : 'partially_refunded';
    const money = `${(amount / 100).toFixed(2)} ${payment.currency}`;
    const updated = await Payment.findByIdAndUpdate(payment._id, {
        $set: { status },
        $push: {
            refunds: {
                amountMinor: amount,
                reason: note,
                status: result.status,
                providerRefundId: result.providerRefundId,
                initiatedBy: admin?.id || null,
                initiatedByName: admin?.fullName || '',
                disputeId: disputeId || null,
            },
            timeline: {
                type: result.status === 'processed' ? 'refunded' : 'refund_requested',
                label: result.status === 'processed' ? 'Refund processed' : 'Refund initiated',
                detail: `${money} refund by ${admin?.fullName || 'an admin'}: ${note}`,
                at: new Date(),
            },
        },
    }, { new: true });

    await notifyAdmins({
        type: 'refund',
        severity: 'info',
        title: `Refund ${result.status === 'processed' ? 'issued' : 'initiated'} · ${payment.reference}`,
        message: `${money} to ${payment.customerName || payment.customerEmail || 'customer'} by ${admin?.fullName || 'an admin'}`,
        link: `/finance/transactions/${payment._id}`,
    });

    return { payment: updated, refund: { amountMinor: amount, status: result.status, providerRefundId: result.providerRefundId } };
}

function withdrawalView(w) {
    return {
        id: String(w._id),
        reference: w.reference,
        provider: w.provider,
        amountMinor: w.amountMinor,
        currency: w.currency,
        destinationLabel: w.destinationLabel,
        status: w.status,
        failureReason: w.failureReason,
        requestedByName: w.requestedByName,
        createdAt: w.createdAt,
    };
}

async function listWithdrawals(query = {}) {
    const { page, limit, skip } = parsePage(query, { defaultLimit: 10, maxLimit: 50 });
    const [total, rows] = await Promise.all([
        Withdrawal.countDocuments({}),
        Withdrawal.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    return { withdrawals: rows.map(withdrawalView), ...pageMeta(total, page, limit) };
}

/**
 * Live provider payouts are opt-in (ADMIN_PAYOUTS_ENABLED=true). By default a
 * withdrawal is recorded as a request for finance to execute in the provider
 * dashboard — no money moves from the admin panel.
 */
function payoutsLive() {
    return String(process.env.ADMIN_PAYOUTS_ENABLED || '').toLowerCase() === 'true';
}

async function createWithdrawal({ provider, amountMinor, currency, idempotencyKey } = {}, admin) {
    if (!providerOps.GATEWAYS[provider]) throw httpError('Choose a supported withdrawal destination', 400, 'VALIDATION_ERROR');
    const amount = Number(amountMinor);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw httpError('Enter an amount greater than zero', 400, 'VALIDATION_ERROR');
    const cur = String(currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw httpError('A valid currency is required', 400, 'VALIDATION_ERROR');
    const key = String(idempotencyKey || '').trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw httpError('A valid idempotency key is required', 400, 'VALIDATION_ERROR');

    const existing = await Withdrawal.findOne({ idempotencyKey: key }).lean();
    if (existing) return { withdrawal: withdrawalView(existing), replayed: true };

    const gateways = await providerOps.getGateways({ fresh: true });
    const gateway = gateways.find((g) => g.id === provider);
    if (!gateway || !gateway.configured || gateway.supported === false) throw httpError(`${providerOps.GATEWAYS[provider].name} is not connected`, 409, 'PROVIDER_NOT_CONFIGURED');
    if (!gateway.payout.configured) throw httpError('No settlement account is configured for this gateway', 409, 'PAYOUT_DESTINATION_MISSING');
    const balance = gateway.balances.find((b) => b.currency === cur);
    if (!balance) throw httpError(`No ${cur} balance on ${gateway.name}`, 400, 'VALIDATION_ERROR');
    if (amount > balance.availableMinor) throw httpError('Amount exceeds the available balance', 400, 'INSUFFICIENT_BALANCE');

    const reference = `WD-${await nextSequence('withdrawal', 1001)}`;
    const live = payoutsLive();
    let withdrawal = await Withdrawal.create({
        reference,
        provider,
        amountMinor: amount,
        currency: cur,
        destinationLabel: gateway.payout.label,
        status: live ? 'processing' : 'requested',
        idempotencyKey: key,
        requestedBy: admin.id,
        requestedByName: admin.fullName,
    });

    if (!live) {
        await notifyAdmins({
            type: 'withdrawal',
            severity: 'info',
            title: `Withdrawal requested · ${reference}`,
            message: `${(amount / 100).toFixed(2)} ${cur} from ${gateway.name} to ${gateway.payout.label}, requested by ${admin.fullName}`,
            link: '/finance',
        });
        withdrawal = withdrawal.toObject ? withdrawal.toObject() : withdrawal;
        return { withdrawal: withdrawalView(withdrawal), replayed: false };
    }

    try {
        const result = await providerOps.createPayout({ provider, amountMinor: amount, currency: cur, reference });
        withdrawal.providerTransferId = result.providerTransferId;
        withdrawal.status = result.status;
        await withdrawal.save();
    } catch (error) {
        withdrawal.status = 'failed';
        withdrawal.failureReason = error.message;
        await withdrawal.save();
        providerOps.clearBalanceCache();
        throw error;
    }
    providerOps.clearBalanceCache();

    await notifyAdmins({
        type: 'withdrawal',
        severity: 'success',
        title: `Withdrawal ${withdrawal.status === 'completed' ? 'completed' : 'initiated'} · ${reference}`,
        message: `${(amount / 100).toFixed(2)} ${cur} from ${gateway.name} to ${gateway.payout.label} by ${admin.fullName}`,
        link: '/finance',
    });
    withdrawal = withdrawal.toObject ? withdrawal.toObject() : withdrawal;
    return { withdrawal: withdrawalView(withdrawal), replayed: false };
}

async function getGatewaysView({ fresh = false } = {}) {
    const gateways = await providerOps.getGateways({ fresh });
    const totalMinor = gateways.reduce((sum, g) => sum + g.balances
        .filter((b) => b.currency === REPORTING_CURRENCY)
        .reduce((s, b) => s + b.availableMinor, 0), 0);
    return {
        currency: REPORTING_CURRENCY,
        totalAvailableMinor: totalMinor,
        connected: gateways.filter((g) => g.configured).length,
        payoutMode: payoutsLive() ? 'live' : 'request',
        gateways: gateways.map((g) => ({
            id: g.id,
            name: g.name,
            supported: g.supported,
            configured: g.configured,
            balances: g.balances,
            error: g.error,
            payout: { configured: g.payout.configured, label: g.payout.label },
        })),
    };
}

module.exports = {
    REPORTING_CURRENCY,
    COLLECTED_STATUSES,
    computeMrr,
    getSummary,
    getRevenue,
    listTransactions,
    getTransaction,
    getInvoice,
    refundTransaction,
    refundableMinor,
    listWithdrawals,
    createWithdrawal,
    getGatewaysView,
    transactionRow,
    endOfMonth,
};

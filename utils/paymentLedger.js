/**
 * Payment ledger writer. Turns verified, normalized provider webhook events
 * into Payment rows (Admin › Finances). Idempotent per provider event id and
 * per provider charge reference, and never throws into the webhook route.
 */
const mongoose = require('mongoose');
const { nextSequence } = require('../models/Counter');
const { notifyAdmins } = require('./adminNotifications');

const SUCCESS_EVENTS = {
    stripe: new Set(['invoice.paid']),
    paystack: new Set(['charge.success']),
    flutterwave: new Set(['charge.completed']), // status decides success/failure
};
const FAILURE_EVENTS = {
    stripe: new Set(['invoice.payment_failed']),
    paystack: new Set(['charge.failed']),
    flutterwave: new Set(),
};
const REFUND_EVENTS = {
    stripe: new Set(['charge.refunded']),
    paystack: new Set(['refund.processed', 'refund.failed']),
    flutterwave: new Set(['refund.completed']),
};

const TIMELINE_LABELS = {
    initiated: 'Payment initiated',
    authorized: 'Payment authorized',
    successful: 'Payment successful',
    failed: 'Payment failed',
};

function classify(normalized) {
    const provider = normalized.provider;
    const type = String(normalized.type || '');
    if (REFUND_EVENTS[provider]?.has(type)) return 'refund';
    if (FAILURE_EVENTS[provider]?.has(type)) return 'failed';
    if (SUCCESS_EVENTS[provider]?.has(type)) {
        if (provider === 'flutterwave') return normalized.status === 'active' ? 'successful' : 'failed';
        return 'successful';
    }
    return null;
}

function money(minor, currency) {
    const value = (Number(minor) || 0) / 100;
    return `${currency === 'USD' ? '$' : ''}${value.toFixed(2)}${currency === 'USD' ? '' : ` ${currency}`}`;
}

async function resolveUser(normalized) {
    const User = require('../models/User');
    let userId = normalized.userId && mongoose.isValidObjectId(String(normalized.userId))
        ? String(normalized.userId)
        : null;
    if (!userId && normalized.customerId) {
        const Entitlement = require('../server/models/EntitlementModel');
        const ent = await Entitlement.findOne({ providerCustomerId: String(normalized.customerId) }).select('userId').lean();
        if (ent) userId = String(ent.userId);
    }
    if (!userId && normalized.ledger?.customerEmail) {
        const byEmail = await User.findOne({ email: String(normalized.ledger.customerEmail).toLowerCase() }).select('_id').lean();
        if (byEmail) userId = String(byEmail._id);
    }
    if (!userId) return { user: null, subscription: null };
    const user = await User.findById(userId).select('fullName email').lean();
    const Subscription = require('../models/Subscription');
    const subscription = await Subscription.findOne({ userId }).select('_id tier pricing').lean();
    return { user, subscription };
}

async function nextRefs() {
    const seq = await nextSequence('payment', 10001);
    return { reference: `TXN-${seq}`, invoiceNumber: `INV-${seq}` };
}

async function recordCharge(normalized, outcome) {
    const Payment = require('../models/Payment');
    const ledger = normalized.ledger || {};
    const provider = normalized.provider;
    const providerReference = ledger.chargeId || normalized.subscriptionId || null;
    const currency = String(normalized.currency || 'USD').toUpperCase();
    const amountMinor = Number.isFinite(Number(ledger.grossMinor)) && ledger.grossMinor != null
        ? Number(ledger.grossMinor)
        : Number(normalized.amountMinor) || 0;

    if (await Payment.exists({ providerEventId: normalized.eventId })) return { recorded: false, reason: 'duplicate event' };

    // A retried charge (failed -> successful) updates the existing row
    // instead of producing a second transaction.
    let existing = providerReference
        ? await Payment.findOne({ provider, providerReference })
        : null;
    const at = new Date();

    if (existing) {
        if (existing.status === 'successful' && outcome === 'successful') return { recorded: false, reason: 'already successful' };
        existing.status = outcome;
        existing.providerEventId = existing.providerEventId || normalized.eventId;
        existing.failureReason = outcome === 'failed' ? (ledger.failureReason || 'Payment was declined by the provider') : '';
        if (outcome === 'successful') existing.paidAt = at;
        existing.timeline.push({ type: outcome, label: TIMELINE_LABELS[outcome], detail: outcome === 'successful' ? `${money(amountMinor, currency)} paid. Receipt made available.` : existing.failureReason, at });
        await existing.save();
        return { recorded: true, payment: existing };
    }

    const { user, subscription } = await resolveUser(normalized);
    const refs = await nextRefs();
    const timeline = [
        { type: 'initiated', label: TIMELINE_LABELS.initiated, detail: `${normalized.interval === 'yearly' ? 'Annual' : 'Monthly'} subscription invoice created.`, at },
    ];
    if (outcome === 'successful') {
        timeline.push({ type: 'authorized', label: TIMELINE_LABELS.authorized, detail: 'Authorization accepted by provider.', at });
        timeline.push({ type: 'successful', label: TIMELINE_LABELS.successful, detail: `${money(amountMinor, currency)} paid. Receipt made available.`, at });
    } else {
        timeline.push({ type: 'failed', label: TIMELINE_LABELS.failed, detail: ledger.failureReason || 'Payment was declined by the provider.', at });
    }

    const payment = await Payment.create({
        ...refs,
        userId: user ? user._id : null,
        subscriptionId: subscription ? subscription._id : null,
        provider,
        providerEventId: normalized.eventId,
        providerReference,
        providerCustomerId: normalized.customerId ? String(normalized.customerId) : null,
        plan: normalized.plan || subscription?.tier || null,
        interval: normalized.interval === 'yearly' ? 'yearly' : 'monthly',
        amountMinor,
        taxMinor: Number(ledger.taxMinor) || 0,
        discountMinor: Number(ledger.discountMinor) || 0,
        currency,
        status: outcome,
        paymentMethod: ledger.paymentMethod || '',
        customerName: user?.fullName || ledger.customerName || '',
        customerEmail: user?.email || ledger.customerEmail || '',
        failureReason: outcome === 'failed' ? (ledger.failureReason || 'Payment was declined by the provider') : '',
        paidAt: outcome === 'successful' ? at : null,
        timeline,
    });

    if (outcome === 'failed') {
        await notifyAdmins({
            type: 'payment',
            severity: 'warning',
            title: `Payment failed · ${payment.reference}`,
            message: `${payment.customerName || payment.customerEmail || 'A customer'} · ${money(amountMinor, currency)} via ${provider}`,
            link: `/finance/transactions/${payment._id}`,
            dedupeKey: `payment-failed:${payment._id}`,
        });
    }
    return { recorded: true, payment };
}

async function recordRefundEvent(normalized) {
    const Payment = require('../models/Payment');
    const ledger = normalized.ledger || {};
    const ref = ledger.chargeId || normalized.subscriptionId;
    if (!ref) return { recorded: false, reason: 'no charge reference' };
    const payment = await Payment.findOne({ provider: normalized.provider, providerReference: String(ref) });
    if (!payment) return { recorded: false, reason: 'payment not found' };
    const failed = String(normalized.type).endsWith('.failed');
    const pending = payment.refunds.filter((r) => r.status === 'pending');
    if (pending.length === 0) {
        // Refund issued outside the admin panel (provider dashboard).
        if (failed) return { recorded: false, reason: 'no pending refund' };
        const refundedMinor = Number(ledger.refundedMinor) || Number(normalized.amountMinor) || payment.amountMinor;
        const delta = Math.max(0, Math.min(payment.amountMinor, refundedMinor) - payment.refundedMinor);
        if (delta === 0) return { recorded: false, reason: 'already refunded' };
        payment.refunds.push({ amountMinor: delta, reason: 'Issued from provider dashboard', status: 'processed' });
        payment.refundedMinor += delta;
    } else {
        for (const refund of pending) {
            refund.status = failed ? 'failed' : 'processed';
            if (failed) {
                refund.failureReason = ledger.failureReason || 'Provider rejected the refund';
                payment.refundedMinor = Math.max(0, payment.refundedMinor - refund.amountMinor);
            }
        }
    }
    payment.status = payment.refundedMinor <= 0
        ? 'successful'
        : (payment.refundedMinor >= payment.amountMinor ? 'refunded' : 'partially_refunded');
    payment.timeline.push({
        type: failed ? 'refund_failed' : 'refunded',
        label: failed ? 'Refund failed' : 'Refund processed',
        detail: failed ? 'The provider could not complete the refund.' : 'The provider confirmed the refund.',
        at: new Date(),
    });
    await payment.save();
    return { recorded: true, payment };
}

/**
 * Entry point used by the billing webhook route. `normalized` must already
 * be signature-verified by the provider adapter.
 */
async function recordFromWebhook(normalized) {
    if (!normalized || !normalized.eventId || !normalized.provider) return { recorded: false, reason: 'invalid event' };
    if (mongoose.connection.readyState !== 1) return { recorded: false, reason: 'database unavailable' };
    const kind = classify(normalized);
    if (!kind) return { recorded: false, reason: 'not a payment event' };
    try {
        if (kind === 'refund') return await recordRefundEvent(normalized);
        return await recordCharge(normalized, kind);
    } catch (error) {
        if (error && error.code === 11000) return { recorded: false, reason: 'duplicate event' };
        console.error('[payment-ledger] record failed:', error.message);
        return { recorded: false, reason: 'error' };
    }
}

module.exports = { recordFromWebhook, classify, recordCharge, recordRefundEvent };

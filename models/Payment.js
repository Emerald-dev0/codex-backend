const mongoose = require('mongoose');

/**
 * Payment ledger (admin Finances / Billing). One row per provider charge.
 *
 * Written only from already-verified provider events (server/routes/billing
 * webhook -> utils/paymentLedger), deduplicated by `providerEventId`, so a
 * webhook replay never creates a second row. Amounts are minor units.
 */
const PAYMENT_STATUSES = ['pending', 'successful', 'failed', 'refunded', 'partially_refunded'];
const PROVIDERS = ['stripe', 'paystack', 'flutterwave', 'manual'];

const timelineSchema = new mongoose.Schema({
    type: { type: String, required: true }, // initiated | authorized | successful | failed | refund_requested | refunded | refund_failed | note
    label: { type: String, required: true },
    detail: { type: String, default: '' },
    at: { type: Date, default: Date.now },
}, { _id: false });

const refundSchema = new mongoose.Schema({
    amountMinor: { type: Number, required: true, min: 1 },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending' },
    providerRefundId: { type: String, default: null },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    initiatedByName: { type: String, default: '' },
    disputeId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket', default: null },
    failureReason: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
}, { _id: true });

const paymentSchema = new mongoose.Schema({
    reference: { type: String, required: true, unique: true }, // TXN-10842
    invoiceNumber: { type: String, required: true, unique: true }, // INV-10842
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    provider: { type: String, enum: PROVIDERS, required: true },
    providerEventId: { type: String, default: null },
    providerReference: { type: String, default: null }, // charge / payment intent / tx_ref
    providerCustomerId: { type: String, default: null },
    type: { type: String, enum: ['subscription_payment', 'one_time'], default: 'subscription_payment' },
    plan: { type: String, default: null },
    interval: { type: String, default: 'monthly' },
    amountMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    taxMinor: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'USD', uppercase: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending', index: true },
    paymentMethod: { type: String, default: '' },
    customerName: { type: String, default: '' },
    customerEmail: { type: String, default: '' },
    failureReason: { type: String, default: '' },
    refundedMinor: { type: Number, default: 0, min: 0 },
    refunds: { type: [refundSchema], default: [] },
    timeline: { type: [timelineSchema], default: [] },
    paidAt: { type: Date, default: null },
}, { timestamps: true });

paymentSchema.index({ providerEventId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ provider: 1, providerReference: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ userId: 1, createdAt: -1 });

paymentSchema.virtual('netMinor').get(function netMinor() {
    return Math.max(0, (this.amountMinor || 0) - (this.refundedMinor || 0));
});

module.exports = mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.PROVIDERS = PROVIDERS;

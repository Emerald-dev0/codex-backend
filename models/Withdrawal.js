const mongoose = require('mongoose');

/**
 * Admin payout requests from a payment gateway balance to the platform's
 * connected settlement account (Admin › Finances › Withdraw).
 */
const withdrawalSchema = new mongoose.Schema({
    reference: { type: String, required: true, unique: true }, // WD-1001
    provider: { type: String, enum: ['stripe', 'paystack', 'flutterwave'], required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true },
    destinationLabel: { type: String, default: '' },
    status: { type: String, enum: ['requested', 'processing', 'completed', 'failed'], default: 'processing' },
    providerTransferId: { type: String, default: null },
    failureReason: { type: String, default: '' },
    idempotencyKey: { type: String, required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: { type: String, default: '' },
}, { timestamps: true });

withdrawalSchema.index({ idempotencyKey: 1 }, { unique: true });
withdrawalSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);

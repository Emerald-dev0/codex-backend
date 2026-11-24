const mongoose = require('mongoose');

/**
 * Pending second-factor step of a sign-in. The client only ever holds the
 * opaque challenge token; we store its SHA-256 so a database leak cannot be
 * replayed. Email codes are stored as SHA-256 too. Expires after 10 minutes.
 */
const twoFactorChallengeSchema = new mongoose.Schema({
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['admin', 'user', 'email_change'], required: true },
    newEmail: { type: String, default: null, lowercase: true, trim: true },
    method: { type: String, enum: ['email', 'authenticator'], required: true },
    codeHash: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    resends: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
}, { timestamps: true });

twoFactorChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TwoFactorChallenge', twoFactorChallengeSchema);

const mongoose = require('mongoose');

/**
 * Server-side admin panel session. Admin JWTs carry `scope: 'admin'` and a
 * `sid`; middleware/platformAdmin requires a live row here, enforces the
 * idle timeout from Admin › Settings and supports real sign-out.
 */
const adminSessionSchema = new mongoose.Schema({
    sid: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
}, { timestamps: true });

adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AdminSession', adminSessionSchema);

const mongoose = require('mongoose');

/**
 * Platform-wide feed for staff (Admin › Notification). One row per event,
 * shared by all admins; read state is tracked per admin in `readBy`.
 */
const ADMIN_NOTIFICATION_TYPES = ['dispute', 'payment', 'refund', 'withdrawal', 'user', 'system'];

const adminNotificationSchema = new mongoose.Schema({
    type: { type: String, enum: ADMIN_NOTIFICATION_TYPES, required: true },
    severity: { type: String, enum: ['info', 'success', 'warning', 'critical'], default: 'info' },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, default: '', maxlength: 1000 },
    link: { type: String, default: '' }, // admin-panel route, e.g. /disputes?case=...
    dedupeKey: { type: String, default: null },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
}, { timestamps: true });

adminNotificationSchema.index({ createdAt: -1 });
adminNotificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
adminNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AdminNotification', adminNotificationSchema);
module.exports.ADMIN_NOTIFICATION_TYPES = ADMIN_NOTIFICATION_TYPES;

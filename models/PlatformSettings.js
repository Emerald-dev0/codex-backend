const mongoose = require('mongoose');

/**
 * Singleton platform configuration managed from Admin › Settings.
 * Read through utils/platformSettings (cached) — never query directly on hot
 * paths.
 */
const platformSettingsSchema = new mongoose.Schema({
    key: { type: String, default: 'platform', unique: true },
    general: {
        platformName: { type: String, default: 'BuildrsHQ', trim: true, maxlength: 80 },
        platformUrl: { type: String, default: 'app.buildrshq.com', trim: true, maxlength: 200 },
        supportEmail: { type: String, default: 'support@buildrshq.com', trim: true, lowercase: true },
        billingEmail: { type: String, default: 'billing@buildrshq.com', trim: true, lowercase: true },
    },
    registration: {
        allowRegistrations: { type: Boolean, default: true },
        requireEmailVerification: { type: Boolean, default: true },
        allowBusinessAccounts: { type: Boolean, default: true },
        maintenanceMode: { type: Boolean, default: false },
    },
    security: {
        enforceAdmin2FA: { type: Boolean, default: false },
        requireUser2FA: { type: Boolean, default: false },
        twoFactorMethods: { type: [String], default: ['email'] },
        minPasswordLength: { type: Number, default: 8, min: 8, max: 64 },
        requireSpecialChars: { type: Boolean, default: false },
        requireNumbers: { type: Boolean, default: false },
        sessionTimeoutMinutes: { type: Number, default: 30, min: 5, max: 1440 },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);

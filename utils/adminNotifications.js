/**
 * Emit platform events into the shared admin notification feed.
 * Best-effort: never throws into the caller (webhooks, ticket creation).
 */
const mongoose = require('mongoose');

async function notifyAdmins({ type, severity = 'info', title, message = '', link = '', dedupeKey = null }) {
    if (mongoose.connection.readyState !== 1) return null;
    try {
        const AdminNotification = require('../models/AdminNotification');
        if (dedupeKey) {
            return await AdminNotification.findOneAndUpdate(
                { dedupeKey },
                { $setOnInsert: { type, severity, title, message, link, dedupeKey } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }
        return await AdminNotification.create({ type, severity, title, message, link });
    } catch (error) {
        if (error && error.code === 11000) return null;
        console.error('[admin-notify] failed:', error.message);
        return null;
    }
}

module.exports = { notifyAdmins };

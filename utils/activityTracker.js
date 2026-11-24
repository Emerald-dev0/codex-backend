/**
 * Daily-active tracking for admin Insights. `touch(userId)` is called from
 * authenticateToken; it writes at most one upsert per user per UTC day per
 * process and never blocks or fails the request.
 */
const mongoose = require('mongoose');

const MAX_ENTRIES = parseInt(process.env.ACTIVITY_TRACKER_MAX_ENTRIES, 10) || 100000;
const seen = new Map(); // userId -> 'YYYY-MM-DD'

function utcDay(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function dayStart(day) {
    return new Date(`${day}T00:00:00.000Z`);
}

function touch(userId, now = new Date()) {
    if (process.env.DISABLE_ACTIVITY_TRACKING === 'true') return false;
    if (!userId || !mongoose.isValidObjectId(String(userId))) return false;
    const key = String(userId);
    const day = utcDay(now);
    if (seen.get(key) === day) return false;
    if (mongoose.connection.readyState !== 1) return false;

    if (!seen.has(key) && seen.size >= MAX_ENTRIES) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
    }
    seen.set(key, day);

    let UserActivityDay;
    try {
        UserActivityDay = require('../models/UserActivityDay');
    } catch {
        return false;
    }
    UserActivityDay.updateOne(
        { userId: key, day },
        { $setOnInsert: { userId: key, day, date: dayStart(day) } },
        { upsert: true }
    ).catch((error) => {
        if (error && error.code === 11000) return; // concurrent upsert from another instance
        seen.delete(key); // allow a retry on the next request
        console.error('[activity] touch failed:', error.message);
    });
    return true;
}

function resetActivityCache() {
    seen.clear();
}

module.exports = { touch, utcDay, dayStart, resetActivityCache };

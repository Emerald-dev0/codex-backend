const mongoose = require('mongoose');

/**
 * One row per user per UTC day with authenticated activity. Feeds admin
 * Insights (MAU, engagement, retention cohorts). Written at most once per
 * user per day per process (utils/activityTracker), so the write cost is
 * bounded by daily active users, not request volume.
 */
const userActivityDaySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    date: { type: Date, required: true }, // midnight UTC of `day`, for range queries
}, { versionKey: false });

userActivityDaySchema.index({ userId: 1, day: 1 }, { unique: true });
userActivityDaySchema.index({ date: 1 });

module.exports = mongoose.model('UserActivityDay', userActivityDaySchema);

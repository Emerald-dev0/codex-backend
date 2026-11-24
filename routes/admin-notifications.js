/**
 * Admin › Notification (shared staff feed, per-admin read state).
 *   GET  /api/admin/notifications?filter=all|unread&type&page&limit
 *   GET  /api/admin/notifications/unread-count
 *   POST /api/admin/notifications/:id/read
 *   POST /api/admin/notifications/read-all
 */
const express = require('express');
const mongoose = require('mongoose');
const AdminNotification = require('../models/AdminNotification');
const { route } = require('../utils/admin/http');
const { parsePage, pageMeta } = require('../utils/admin/common');

const router = express.Router();

function view(n, adminId) {
    return {
        id: String(n._id),
        type: n.type,
        severity: n.severity,
        title: n.title,
        message: n.message,
        link: n.link,
        read: (n.readBy || []).some((id) => String(id) === String(adminId)),
        createdAt: n.createdAt,
    };
}

router.get('/unread-count', route(async (req) => ({
    count: await AdminNotification.countDocuments({ readBy: { $ne: req.admin.id } }),
}), 'Could not load notifications'));

router.get('/', route(async (req) => {
    const { page, limit, skip } = parsePage(req.query, { defaultLimit: 20, maxLimit: 100 });
    const filter = {};
    if (req.query.filter === 'unread') filter.readBy = { $ne: req.admin.id };
    if (AdminNotification.ADMIN_NOTIFICATION_TYPES.includes(req.query.type)) filter.type = req.query.type;
    const [total, rows, unread] = await Promise.all([
        AdminNotification.countDocuments(filter),
        AdminNotification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AdminNotification.countDocuments({ readBy: { $ne: req.admin.id } }),
    ]);
    return { notifications: rows.map((n) => view(n, req.admin.id)), unread, ...pageMeta(total, page, limit) };
}, 'Could not load notifications'));

router.post('/read-all', route(async (req) => {
    const result = await AdminNotification.updateMany({ readBy: { $ne: req.admin.id } }, { $addToSet: { readBy: req.admin.id } });
    return { updated: result.modifiedCount || 0 };
}, 'Could not update notifications'));

router.post('/:id/read', route(async (req) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        const e = new Error('Invalid notification id'); e.statusCode = 400; e.code = 'INVALID_ID'; throw e;
    }
    const n = await AdminNotification.findByIdAndUpdate(req.params.id, { $addToSet: { readBy: req.admin.id } }, { new: true }).lean();
    if (!n) { const e = new Error('Notification not found'); e.statusCode = 404; e.code = 'NOT_FOUND'; throw e; }
    return view(n, req.admin.id);
}, 'Could not update the notification'));

module.exports = router;

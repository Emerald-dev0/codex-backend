/**
 * Admin › Users.
 *   GET  /api/admin/users/summary
 *   GET  /api/admin/users?q&status&plan&role&sort&page&limit
 *   GET  /api/admin/users/:id
 *   POST /api/admin/users/:id/suspend      { reason }
 *   POST /api/admin/users/:id/reinstate
 *   POST /api/admin/users/:id/sign-out     revoke every session
 */
const express = require('express');
const users = require('../utils/admin/usersService');
const { route } = require('../utils/admin/http');
const { recordAdminAction } = require('../utils/adminAudit');

const router = express.Router();

router.get('/summary', route(() => users.getSummary(), 'Could not load user metrics'));
router.get('/', route((req) => users.listUsers(req.query), 'Could not load users'));
router.get('/:id', route((req) => users.getUser(req.params.id), 'Could not load this user'));

router.post('/:id/suspend', route(async (req) => {
    const result = await users.suspendUser(req.params.id, req.body || {}, req.admin);
    await recordAdminAction({ action: 'user.ban', target: req.params.id, details: { email: result.email, reason: result.banReason }, req });
    return result;
}, 'Could not suspend this user'));

router.post('/:id/reinstate', route(async (req) => {
    const result = await users.reinstateUser(req.params.id, req.admin);
    await recordAdminAction({ action: 'user.unban', target: req.params.id, details: { email: result.email }, req });
    return result;
}, 'Could not reinstate this user'));

router.post('/:id/sign-out', route(async (req) => {
    const result = await users.signOutEverywhere(req.params.id, req.admin);
    await recordAdminAction({ action: 'user.sign_out_all', target: req.params.id, details: { email: result.email }, req });
    return result;
}, 'Could not sign this user out'));

module.exports = router;

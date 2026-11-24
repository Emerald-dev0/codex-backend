/**
 * Admin › Billing and Plans.
 *   GET /api/admin/billing/summary
 *   GET /api/admin/billing/performance?months
 *   GET /api/admin/billing/by-plan
 *   GET /api/admin/billing/subscribers?q&plan&status&duration&page&limit
 *   GET /api/admin/billing/subscribers/:id
 *   GET /api/admin/billing/plans?q&status&cycle
 */
const express = require('express');
const billing = require('../utils/admin/billingService');
const { route } = require('../utils/admin/http');

const router = express.Router();

router.get('/summary', route(() => billing.getSummary(), 'Could not load billing metrics'));
router.get('/performance', route((req) => billing.getPerformance({ months: req.query.months }), 'Could not load subscription performance'));
router.get('/by-plan', route(() => billing.getByPlan(), 'Could not load subscribers by plan'));
router.get('/subscribers', route((req) => billing.listSubscribers(req.query), 'Could not load subscribers'));
router.get('/subscribers/:id', route((req) => billing.getSubscriber(req.params.id), 'Could not load this subscriber'));
router.get('/plans', route((req) => billing.getPlans(req.query), 'Could not load plans'));

module.exports = router;

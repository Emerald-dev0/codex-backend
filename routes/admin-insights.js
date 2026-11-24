/**
 * Admin › Insights.
 *   GET /api/admin/insights
 */
const express = require('express');
const insights = require('../utils/admin/insightsService');
const { route } = require('../utils/admin/http');

const router = express.Router();

router.get('/', route(() => insights.getInsights(), 'Could not load insights'));

module.exports = router;

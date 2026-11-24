/**
 * Admin › Overview.
 *   GET /api/admin/overview?from=YYYY-MM-DD&to=YYYY-MM-DD   (default: month to date, UTC)
 */
const express = require('express');
const overview = require('../utils/admin/overviewService');
const { route } = require('../utils/admin/http');

const router = express.Router();

/**
 * @swagger
 * /api/admin/overview:
 *   get:
 *     summary: Platform snapshot for the admin Overview screen
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 */
router.get('/', route((req) => overview.getOverview(new Date(), req.admin.id, {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
}), 'Could not load the overview'));

module.exports = router;

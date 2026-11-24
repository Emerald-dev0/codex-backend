/**
 * Admin › Settings (platform configuration).
 *   GET /api/admin/settings
 *   PUT /api/admin/settings/general    (super_admin)
 *   PUT /api/admin/settings/security   (super_admin)
 *   GET /api/admin/settings/ai-models
 */
const express = require('express');
const User = require('../models/User');
const platformSettings = require('../utils/platformSettings');
const overview = require('../utils/admin/overviewService');
const { route } = require('../utils/admin/http');
const { requireRole } = require('../middleware/platformAdmin');
const { recordAdminAction } = require('../utils/adminAudit');

const router = express.Router();

async function settingsView() {
    const [settings, adminCount] = await Promise.all([
        platformSettings.getSettings({ fresh: true }),
        User.countDocuments({ platformRole: { $in: ['admin', 'super_admin'] } }),
    ]);
    return {
        settings,
        adminCount,
        capabilities: {
            twoFactorMethods: platformSettings.TWO_FACTOR_METHODS.map((m) => ({
                id: m,
                available: m === 'sms' ? platformSettings.SMS_AVAILABLE() : true,
            })),
        },
    };
}

router.get('/', route(() => settingsView(), 'Could not load settings'));

router.put('/general', requireRole('super_admin'), route(async (req) => {
    await platformSettings.updateGeneral(req.body || {}, req.admin.id);
    await recordAdminAction({ action: 'settings.general', target: 'platform', details: req.body || {}, req });
    return settingsView();
}, 'Could not save settings'));

router.put('/security', requireRole('super_admin'), route(async (req) => {
    await platformSettings.updateSecurity(req.body || {}, req.admin.id);
    await recordAdminAction({ action: 'settings.security', target: 'platform', details: req.body || {}, req });
    return settingsView();
}, 'Could not save security settings'));

router.get('/ai-models', route(() => overview.getAiModels(), 'Could not load AI models'));

module.exports = router;

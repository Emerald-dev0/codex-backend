#!/usr/bin/env node
/**
 * Grant or revoke admin panel access. The role is never assignable over
 * HTTP, so the first super admin must be created here.
 *
 *   node scripts/grant-platform-admin.js <email> [admin|super_admin]   (default: super_admin)
 *   node scripts/grant-platform-admin.js <email> --revoke
 *
 * The account must already exist (sign up through the app first).
 * Revoking also ends every live admin panel session for that account.
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const User = require('../models/User');
const AdminSession = require('../models/AdminSession');

async function main() {
    const [emailArg, roleArg] = process.argv.slice(2);
    const email = String(emailArg || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
        console.error('Usage: node scripts/grant-platform-admin.js <email> [admin|super_admin|--revoke]');
        process.exit(1);
    }
    const revoke = roleArg === '--revoke';
    const role = revoke ? null : (roleArg || 'super_admin');
    if (!revoke && !['admin', 'super_admin'].includes(role)) {
        console.error(`Unknown role "${roleArg}". Use admin or super_admin.`);
        process.exit(1);
    }
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

    const user = await User.findOne({ email });
    if (!user) throw new Error(`No account found for ${email}. Sign up first, then re-run.`);

    if (revoke) {
        await User.updateOne({ _id: user._id }, { $unset: { platformRole: 1 } });
        const { modifiedCount } = await AdminSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
        console.log(`Revoked admin access for ${email} (${modifiedCount} session(s) ended).`);
    } else {
        await User.updateOne({ _id: user._id }, { $set: { platformRole: role } });
        console.log(`${email} is now a platform ${role}. Sign in at the admin panel.`);
    }
    const AdminAudit = require('../models/AdminAudit');
    await AdminAudit.create({
        action: revoke ? 'admin.role_revoked' : 'admin.role_granted',
        target: String(user._id),
        details: { email, role, via: 'scripts/grant-platform-admin.js' },
    }).catch(() => {});
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());

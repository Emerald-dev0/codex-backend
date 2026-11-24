/**
 * Admin › Dispute. Cases are Support Center tickets (SupportTicket) — the
 * same records support agents work in /support-admin — enriched with a case
 * number, disputed amount, linked transaction and an activity timeline.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const SupportTicket = require('../../models/SupportTicket');
const User = require('../../models/User');
const Payment = require('../../models/Payment');
const Company = require('../../models/Company');
const { nextReference } = require('../../models/Counter');
const { parsePage, pageMeta, startOfDay, addDays, pctChange, pct, DAY_MS } = require('./common');
const { computeMrr, refundTransaction } = require('./financeService');

const TAB_STATUSES = Object.freeze({
    open: ['open'],
    in_review: ['in-progress'],
    resolved: ['resolved', 'closed'],
});
const SLA_HOURS = Object.freeze({ urgent: 4, high: 24, medium: 48, low: 72 });
const PRIORITY_RANK = Object.freeze({ urgent: 0, high: 1, medium: 2, low: 3 });
const CATEGORY_LABELS = Object.freeze({
    billing: 'Billing & Payment',
    account: 'Account & Access',
    plans: 'Plans & Subscriptions',
    technical: 'Technical Issue',
    direct: 'Direct Message',
    general: 'General Enquiry',
});

function httpError(message, statusCode = 400, code = 'REQUEST_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function uiStatus(status) {
    if (status === 'in-progress') return 'in_review';
    if (status === 'resolved' || status === 'closed') return 'resolved';
    return 'open';
}

function dueAt(ticket) {
    const hours = SLA_HOURS[ticket.priority] || SLA_HOURS.medium;
    return new Date(new Date(ticket.createdAt).getTime() + hours * 60 * 60 * 1000);
}

function awaitingResponse(ticket) {
    const messages = ticket.messages || [];
    const last = messages[messages.length - 1];
    return uiStatus(ticket.status) !== 'resolved' && (!last || last.sender === 'user');
}

async function ensureDisputeNumber(ticket) {
    if (ticket.disputeNumber) return ticket.disputeNumber;
    const number = await nextReference('dispute', 'DSP', { start: 1, pad: 4 });
    const updated = await SupportTicket.findOneAndUpdate(
        { _id: ticket._id, disputeNumber: { $exists: false } },
        { $set: { disputeNumber: number } },
        { new: true }
    ).select('disputeNumber').lean();
    if (updated) return updated.disputeNumber;
    const current = await SupportTicket.findById(ticket._id).select('disputeNumber').lean();
    return current?.disputeNumber || number;
}

async function accountTypes(userIds) {
    const ids = userIds.filter(Boolean);
    if (!ids.length) return new Map();
    const companies = await Company.find({ 'members.user': { $in: ids } }).select('members.user').lean();
    const business = new Set();
    for (const c of companies) for (const m of c.members || []) business.add(String(m.user));
    return new Map(ids.map((id) => [String(id), business.has(String(id)) ? 'Business account' : 'Individual account']));
}

function customerOf(ticket, user) {
    return {
        id: user ? String(user._id) : null,
        name: user?.fullName || ticket.guestName || 'Guest',
        email: user?.email || ticket.guestEmail || '',
        company: user?.company || '',
        profilePicture: user?.profilePicture || null,
    };
}

function caseRow(ticket, user, accountType) {
    return {
        id: String(ticket._id),
        caseNumber: ticket.disputeNumber || null,
        referenceNumber: ticket.referenceNumber || null,
        subject: ticket.subject,
        category: ticket.category,
        categoryLabel: CATEGORY_LABELS[ticket.category] || 'General Enquiry',
        subcategory: ticket.subcategory || '',
        priority: ticket.priority,
        status: uiStatus(ticket.status),
        customer: customerOf(ticket, user),
        accountType: user ? (accountType || 'Individual account') : 'Guest',
        disputedAmountMinor: ticket.disputedAmountMinor || 0,
        currency: ticket.disputedCurrency || 'USD',
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        dueAt: dueAt(ticket),
        awaitingResponse: awaitingResponse(ticket),
    };
}

async function getSummary(now = new Date()) {
    const weekAgo = addDays(now, -7);
    const endOfToday = addDays(startOfDay(now), 1);
    const last30 = addDays(now, -30);
    const prev30 = addDays(now, -60);
    const unresolved = await SupportTicket.find({ status: { $in: ['open', 'in-progress'] } })
        .select('status priority createdAt messages.sender disputedAmountMinor disputedCurrency')
        .lean();

    const open = unresolved.filter((t) => t.status === 'open');
    const awaiting = unresolved.filter(awaitingResponse);
    const dueToday = awaiting.filter((t) => dueAt(t) <= endOfToday);
    const disputedMinor = unresolved
        .filter((t) => (t.disputedCurrency || 'USD') === 'USD')
        .reduce((s, t) => s + (t.disputedAmountMinor || 0), 0);
    const [mrr, resolvedRecent, createdRecent, resolvedPrev, createdPrev] = await Promise.all([
        computeMrr(now),
        SupportTicket.countDocuments({ status: { $in: ['resolved', 'closed'] }, createdAt: { $gte: last30 } }),
        SupportTicket.countDocuments({ createdAt: { $gte: last30 } }),
        SupportTicket.countDocuments({ status: { $in: ['resolved', 'closed'] }, createdAt: { $gte: prev30, $lt: last30 } }),
        SupportTicket.countDocuments({ createdAt: { $gte: prev30, $lt: last30 } }),
    ]);
    const rate = createdRecent ? pct(resolvedRecent, createdRecent) : null;
    const prevRate = createdPrev ? pct(resolvedPrev, createdPrev) : null;
    return {
        openCases: { count: open.length, newThisWeek: open.filter((t) => new Date(t.createdAt) >= weekAgo).length },
        awaitingResponse: { count: awaiting.length, dueToday: dueToday.length },
        disputedAmount: { amountMinor: disputedMinor, currency: 'USD', pctOfMonthlyRevenue: pct(disputedMinor, mrr.mrrMinor) },
        resolutionRate: {
            pct: rate,
            changePts: rate != null && prevRate != null ? Math.round((rate - prevRate) * 10) / 10 : null,
        },
    };
}

async function listCases(query = {}) {
    const tab = TAB_STATUSES[query.status] ? query.status : 'open';
    const { page, limit, skip } = parsePage(query, { defaultLimit: 5, maxLimit: 50 });
    const match = { status: { $in: TAB_STATUSES[tab] } };
    const [counts, total, tickets] = await Promise.all([
        SupportTicket.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        SupportTicket.countDocuments(match),
        SupportTicket.aggregate([
            { $match: match },
            {
                $addFields: {
                    _rank: {
                        $switch: {
                            branches: Object.entries(PRIORITY_RANK).map(([k, v]) => ({ case: { $eq: ['$priority', k] }, then: v })),
                            default: 2,
                        },
                    },
                },
            },
            // Prioritized by response deadline: most urgent first, then oldest.
            { $sort: tab === 'resolved' ? { updatedAt: -1 } : { _rank: 1, createdAt: 1 } },
            { $skip: skip },
            { $limit: limit },
            { $project: { messages: { $slice: ['$messages', -1] }, attachments: 0, activity: 0 } },
        ]),
    ]);
    const tabCounts = { open: 0, in_review: 0, resolved: 0 };
    for (const row of counts) tabCounts[uiStatus(row._id)] += row.count;

    await Promise.all(tickets.map(async (t) => { t.disputeNumber = await ensureDisputeNumber(t); }));
    const userIds = tickets.map((t) => t.userId).filter(Boolean);
    const [users, types] = await Promise.all([
        User.find({ _id: { $in: userIds } }).select('fullName email company profilePicture').lean(),
        accountTypes(userIds),
    ]);
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return {
        tab,
        counts: tabCounts,
        cases: tickets.map((t) => caseRow(t, t.userId ? byId.get(String(t.userId)) : null, types.get(String(t.userId)))),
        ...pageMeta(total, page, limit),
    };
}

function assertId(id) {
    if (!mongoose.isValidObjectId(String(id))) throw httpError('Invalid case id', 400, 'INVALID_ID');
}

async function getCase(id) {
    assertId(id);
    const ticket = await SupportTicket.findById(id).lean();
    if (!ticket) throw httpError('Case not found', 404, 'NOT_FOUND');
    ticket.disputeNumber = await ensureDisputeNumber(ticket);
    const user = ticket.userId ? await User.findById(ticket.userId).select('fullName email company profilePicture').lean() : null;
    const types = await accountTypes(ticket.userId ? [ticket.userId] : []);
    const [linkedPayment, recentPayments] = await Promise.all([
        ticket.paymentId ? Payment.findById(ticket.paymentId).lean() : null,
        ticket.userId ? Payment.find({ userId: ticket.userId }).sort({ createdAt: -1 }).limit(10).lean() : [],
    ]);
    const toPayment = (p) => p && ({
        id: String(p._id),
        reference: p.reference,
        invoiceNumber: p.invoiceNumber,
        amountMinor: p.amountMinor,
        refundedMinor: p.refundedMinor || 0,
        currency: p.currency,
        status: p.status,
        provider: p.provider,
        createdAt: p.paidAt || p.createdAt,
    });

    const firstUserMessage = (ticket.messages || []).find((m) => m.sender === 'user');
    const activity = [
        { type: 'opened', message: `Case opened by ${customerOf(ticket, user).name}`, at: ticket.createdAt },
        ...(ticket.activity || []).map((a) => ({ type: a.type, message: a.message, actorName: a.actorName, at: a.at })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    return {
        ...caseRow(ticket, user, types.get(String(ticket.userId))),
        statement: firstUserMessage?.message || '',
        messages: (ticket.messages || []).map((m) => ({
            sender: m.sender,
            senderName: m.senderName || (m.sender === 'agent' ? 'Customer Care' : customerOf(ticket, user).name),
            message: m.message,
            at: m.timestamp,
        })),
        attachments: (ticket.attachments || []).map((a, index) => ({
            index,
            name: a.name,
            size: a.size,
            mimeType: a.mimeType,
        })),
        activity,
        linkedPayment: toPayment(linkedPayment),
        recentPayments: recentPayments.map(toPayment),
        reviewStartedAt: ticket.reviewStartedAt || null,
        resolvedAt: ticket.resolvedAt || null,
    };
}

function activityEntry(type, message, admin) {
    return { type, message, actorName: admin?.fullName || 'Admin', at: new Date() };
}

/** Selecting an open case moves it into review (design: "started reviewing the case"). */
async function startReview(id, admin) {
    assertId(id);
    const updated = await SupportTicket.findOneAndUpdate(
        { _id: id, status: 'open' },
        {
            $set: { status: 'in-progress', reviewStartedAt: new Date(), reviewedBy: admin?.id || null, updatedAt: new Date() },
            $push: { activity: activityEntry('review_started', `${admin?.fullName || 'Admin'} started reviewing the case`, admin) },
        },
        { new: true }
    ).lean();
    if (!updated && !(await SupportTicket.exists({ _id: id }))) throw httpError('Case not found', 404, 'NOT_FOUND');
    return getCase(id);
}

async function reply(id, { message } = {}, admin) {
    assertId(id);
    const text = String(message || '').trim();
    if (!text) throw httpError('Reply message is required', 400, 'VALIDATION_ERROR');
    if (text.length > 5000) throw httpError('Reply must be 5,000 characters or fewer', 400, 'VALIDATION_ERROR');
    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw httpError('Case not found', 404, 'NOT_FOUND');
    ticket.messages.push({ sender: 'agent', senderName: admin?.fullName || 'Customer Care', message: text, timestamp: new Date() });
    if (ticket.status === 'open') {
        ticket.status = 'in-progress';
        ticket.reviewStartedAt = ticket.reviewStartedAt || new Date();
    }
    ticket.activity.push(activityEntry('replied', `${admin?.fullName || 'Admin'} replied to the customer`, admin));
    await ticket.save();

    if (ticket.userId) {
        try {
            const NotificationService = require('../notificationService');
            await NotificationService.notify({
                userIds: [String(ticket.userId)],
                type: 'system_alert',
                title: `Customer Care replied · ${ticket.referenceNumber || ticket.disputeNumber || 'your request'}`,
                message: text.length > 140 ? `${text.slice(0, 137)}…` : text,
                link: '/support',
                priority: 'high',
            });
        } catch (error) {
            console.error('[disputes] reply notification failed:', error.message);
        }
    }
    return getCase(id);
}

async function updateStatus(id, { status, note } = {}, admin) {
    assertId(id);
    const map = { open: 'open', in_review: 'in-progress', resolved: 'resolved' };
    if (!map[status]) throw httpError('Status must be open, in_review or resolved', 400, 'VALIDATION_ERROR');
    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw httpError('Case not found', 404, 'NOT_FOUND');
    ticket.status = map[status];
    ticket.resolvedAt = status === 'resolved' ? new Date() : undefined;
    const labels = { open: 'reopened the case', in_review: 'moved the case to review', resolved: 'marked the case as solved' };
    const extra = note ? `: ${String(note).trim().slice(0, 300)}` : '';
    ticket.activity.push(activityEntry(`status_${status}`, `${admin?.fullName || 'Admin'} ${labels[status]}${extra}`, admin));
    await ticket.save();
    return getCase(id);
}

async function updateDetails(id, body = {}, admin) {
    assertId(id);
    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw httpError('Case not found', 404, 'NOT_FOUND');
    const changes = [];
    if (body.priority !== undefined) {
        if (!SLA_HOURS[body.priority]) throw httpError('Priority must be low, medium, high or urgent', 400, 'VALIDATION_ERROR');
        ticket.priority = body.priority;
        changes.push(`priority to ${body.priority}`);
    }
    if (body.subcategory !== undefined) {
        ticket.subcategory = String(body.subcategory || '').trim().slice(0, 120);
        changes.push('reason');
    }
    if (body.disputedAmountMinor !== undefined) {
        const amount = Number(body.disputedAmountMinor);
        if (!Number.isSafeInteger(amount) || amount < 0) throw httpError('Disputed amount must be zero or more', 400, 'VALIDATION_ERROR');
        ticket.disputedAmountMinor = amount;
        changes.push('disputed amount');
    }
    if (body.paymentId !== undefined) {
        if (body.paymentId === null || body.paymentId === '') {
            ticket.paymentId = null;
        } else {
            if (!mongoose.isValidObjectId(String(body.paymentId))) throw httpError('Invalid transaction id', 400, 'INVALID_ID');
            const payment = await Payment.findById(body.paymentId).select('userId currency amountMinor reference').lean();
            if (!payment) throw httpError('Transaction not found', 404, 'NOT_FOUND');
            if (ticket.userId && payment.userId && String(payment.userId) !== String(ticket.userId)) {
                throw httpError('That transaction belongs to a different customer', 400, 'VALIDATION_ERROR');
            }
            ticket.paymentId = payment._id;
            ticket.disputedCurrency = payment.currency;
            if (!ticket.disputedAmountMinor) ticket.disputedAmountMinor = payment.amountMinor;
            changes.push(`linked transaction ${payment.reference}`);
        }
    }
    if (!changes.length) throw httpError('Nothing to update', 400, 'VALIDATION_ERROR');
    ticket.activity.push(activityEntry('updated', `${admin?.fullName || 'Admin'} updated ${changes.join(', ')}`, admin));
    await ticket.save();
    return getCase(id);
}

async function refundCase(id, { amountMinor, reason, paymentId } = {}, admin) {
    assertId(id);
    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw httpError('Case not found', 404, 'NOT_FOUND');
    const target = paymentId || ticket.paymentId;
    if (!target) throw httpError('Link a transaction to this case before issuing a refund', 409, 'NO_LINKED_TRANSACTION');
    if (!ticket.paymentId || String(ticket.paymentId) !== String(target)) {
        await updateDetails(id, { paymentId: target }, admin);
    }
    const { refund, payment } = await refundTransaction(target, { amountMinor, reason, disputeId: ticket._id }, admin);
    const fresh = await SupportTicket.findById(id);
    fresh.activity.push(activityEntry(
        'refund',
        `${admin?.fullName || 'Admin'} ${refund.status === 'processed' ? 'refunded' : 'initiated a refund of'} ${(refund.amountMinor / 100).toFixed(2)} ${payment.currency} on ${payment.reference}`,
        admin
    ));
    await fresh.save();
    return getCase(id);
}

/** Resolve an attachment for download; enforces it belongs to this case. */
async function getAttachment(id, index) {
    assertId(id);
    const i = Number.parseInt(index, 10);
    const ticket = await SupportTicket.findById(id).select('attachments').lean();
    if (!ticket) throw httpError('Case not found', 404, 'NOT_FOUND');
    const file = Number.isInteger(i) ? (ticket.attachments || [])[i] : null;
    if (!file) throw httpError('Attachment not found', 404, 'NOT_FOUND');
    if (file.storage === 'local' && file.key) {
        const base = path.join(__dirname, '..', '..', 'uploads', 'support');
        const full = path.join(base, path.basename(file.key));
        if (!full.startsWith(base) || !fs.existsSync(full)) throw httpError('Attachment file is no longer available', 404, 'NOT_FOUND');
        return { type: 'file', path: full, name: file.name, mimeType: file.mimeType };
    }
    if (file.url && /^https:\/\//.test(file.url)) return { type: 'redirect', url: file.url, name: file.name };
    throw httpError('Attachment file is no longer available', 404, 'NOT_FOUND');
}

module.exports = {
    TAB_STATUSES,
    SLA_HOURS,
    CATEGORY_LABELS,
    uiStatus,
    dueAt,
    awaitingResponse,
    getSummary,
    listCases,
    getCase,
    startReview,
    reply,
    updateStatus,
    updateDetails,
    refundCase,
    getAttachment,
    DAY_MS,
    pctChange,
};

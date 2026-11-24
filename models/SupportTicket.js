const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
    ticketId: {
        type: String,
        unique: true,
        default: function() {
            return 'TKT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
        }
    },
    // Short, human-readable reference shown on the support success screen
    // (Figma: "BH-10428"). ticketId stays the internal/capability identifier.
    referenceNumber: {
        type: String,
        unique: true,
        sparse: true
    },
    // Support Center path: which guided topic (or direct message) was used.
    category: {
        type: String,
        enum: ['general', 'billing', 'account', 'plans', 'technical', 'direct'],
        default: 'general'
    },
    attachments: [{
        name: String,
        size: Number,
        mimeType: String,
        url: String,
        key: String,
        storage: String
    }],
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    guestName: {
        type: String,
        default: 'Guest'
    },
    guestEmail: {
        type: String,
        default: null
    },
    subject: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['open', 'in-progress', 'resolved', 'closed'],
        default: 'open'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    messages: [{
        sender: {
            type: String,
            enum: ['user', 'agent'],
            required: true
        },
        senderName: String,
        message: String,
        timestamp: {
            type: Date,
            default: Date.now
        },
        read: {
            type: Boolean,
            default: false
        }
    }],
    tags: [String],
    // ---- Admin › Dispute case management ----------------------------------
    // Human case number shown in the admin queue (DSP-0248). Assigned lazily
    // by utils/admin/disputeService so legacy tickets get one on first view.
    disputeNumber: { type: String, unique: true, sparse: true },
    // Optional finer-grained reason chosen by staff ("Duplicate Charge").
    subcategory: { type: String, default: '', maxlength: 120 },
    disputedAmountMinor: { type: Number, default: 0, min: 0 },
    disputedCurrency: { type: String, default: 'USD' },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    reviewStartedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    activity: [{
        type: { type: String },
        message: String,
        actorName: String,
        at: { type: Date, default: Date.now }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    resolvedAt: Date,
    rating: {
        type: Number,
        min: 1,
        max: 5
    },
    feedback: String
});

// Update timestamp on save
supportTicketSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Indexes: the agent queue and owner lookups scanned the whole collection.
supportTicketSchema.index({ userId: 1, status: 1, updatedAt: -1 });
supportTicketSchema.index({ status: 1, updatedAt: -1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });
supportTicketSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);

const mongoose = require('mongoose');

/**
 * Atomic named sequences for human-readable references (TXN-10842,
 * DSP-0248, WD-1001). `findOneAndUpdate` + `$inc` + upsert is atomic, so
 * concurrent writers never receive the same number.
 */
const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
}, { versionKey: false });

const Counter = mongoose.model('Counter', counterSchema);

async function nextSequence(name, start = 1) {
    const doc = await Counter.findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    // First allocation starts at `start` (e.g. 10001) rather than 1.
    return (Number(doc?.seq) || 1) + Math.max(0, start - 1);
}

async function nextReference(name, prefix, { start = 1, pad = 4 } = {}) {
    const seq = await nextSequence(name, start);
    return `${prefix}-${String(seq).padStart(pad, '0')}`;
}

module.exports = Counter;
module.exports.nextSequence = nextSequence;
module.exports.nextReference = nextReference;

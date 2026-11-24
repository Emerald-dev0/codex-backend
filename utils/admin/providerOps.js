/**
 * Admin money operations against payment providers: balances, refunds and
 * payouts. Uses the same secret env vars as the checkout adapters. Every
 * call has a timeout and returns a normalized shape; provider error bodies
 * are logged, never forwarded verbatim to the client.
 */
const axios = require('axios');

const TIMEOUT_MS = 15000;
const BALANCE_TTL_MS = 60 * 1000;
let balanceCache = { at: 0, value: null };

const GATEWAYS = Object.freeze({
    stripe: { id: 'stripe', name: 'Stripe', secretEnv: 'STRIPE_SECRET_KEY' },
    paystack: { id: 'paystack', name: 'Paystack', secretEnv: 'PAYSTACK_SECRET_KEY' },
    flutterwave: { id: 'flutterwave', name: 'Flutterwave', secretEnv: 'FLUTTERWAVE_SECRET_KEY' },
    // Shown in the panel per the design, but no PayPal integration exists yet.
    paypal: { id: 'paypal', name: 'PayPal', secretEnv: null, supported: false },
});

function providerError(message, statusCode = 502, code = 'PROVIDER_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function secret(provider) {
    const def = GATEWAYS[provider];
    return def && def.secretEnv ? process.env[def.secretEnv] || '' : '';
}

function isConfigured(provider) {
    return Boolean(secret(provider));
}

/** Settlement destination configured for payouts (env-driven, never client-supplied). */
function payoutDestination(provider) {
    if (provider === 'stripe') {
        return { configured: isConfigured('stripe'), label: process.env.STRIPE_PAYOUT_LABEL || 'Default Stripe payout account' };
    }
    if (provider === 'paystack') {
        const recipient = process.env.PAYSTACK_PAYOUT_RECIPIENT_CODE || '';
        return { configured: Boolean(recipient), recipient, label: process.env.PAYSTACK_PAYOUT_LABEL || (recipient ? `Recipient ${recipient}` : 'Not configured') };
    }
    if (provider === 'flutterwave') {
        const bank = process.env.FLUTTERWAVE_PAYOUT_ACCOUNT_BANK || '';
        const account = process.env.FLUTTERWAVE_PAYOUT_ACCOUNT_NUMBER || '';
        const masked = account ? `•••• ${account.slice(-4)}` : '';
        return { configured: Boolean(bank && account), bank, account, label: process.env.FLUTTERWAVE_PAYOUT_LABEL || (masked ? `Bank account ${masked}` : 'Not configured') };
    }
    return { configured: false, label: 'Not configured' };
}

function logProviderFailure(op, provider, error) {
    const detail = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 500) : error?.message;
    console.error(`[admin-provider] ${op} ${provider} failed: ${detail}`);
}

async function stripeBalance() {
    const res = await axios.get('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${secret('stripe')}` },
        timeout: TIMEOUT_MS,
    });
    return (res.data?.available || []).map((b) => ({ currency: String(b.currency).toUpperCase(), availableMinor: Number(b.amount) || 0 }));
}

async function paystackBalance() {
    const res = await axios.get('https://api.paystack.co/balance', {
        headers: { Authorization: `Bearer ${secret('paystack')}` },
        timeout: TIMEOUT_MS,
    });
    return (res.data?.data || []).map((b) => ({ currency: String(b.currency).toUpperCase(), availableMinor: Number(b.balance) || 0 }));
}

async function flutterwaveBalance() {
    const res = await axios.get('https://api.flutterwave.com/v3/balances', {
        headers: { Authorization: `Bearer ${secret('flutterwave')}` },
        timeout: TIMEOUT_MS,
    });
    return (res.data?.data || [])
        .filter((b) => Number(b.available_balance) > 0 || b.currency === 'USD' || b.currency === 'NGN')
        .map((b) => ({ currency: String(b.currency).toUpperCase(), availableMinor: Math.round(Number(b.available_balance || 0) * 100) }));
}

const BALANCE_READERS = { stripe: stripeBalance, paystack: paystackBalance, flutterwave: flutterwaveBalance };

async function getGateways({ fresh = false } = {}) {
    if (!fresh && balanceCache.value && Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value;
    const results = await Promise.all(Object.values(GATEWAYS).map(async (gw) => {
        const base = {
            id: gw.id,
            name: gw.name,
            supported: gw.supported !== false,
            configured: isConfigured(gw.id),
            payout: payoutDestination(gw.id),
            balances: [],
            error: null,
        };
        if (!base.configured || !BALANCE_READERS[gw.id]) return base;
        try {
            base.balances = await BALANCE_READERS[gw.id]();
        } catch (error) {
            logProviderFailure('balance', gw.id, error);
            base.error = 'Balance unavailable';
        }
        return base;
    }));
    balanceCache = { at: Date.now(), value: results };
    return results;
}

function clearBalanceCache() {
    balanceCache = { at: 0, value: null };
}

/**
 * Refund a captured charge. Returns { providerRefundId, status } where status
 * is 'processed' or 'pending' (provider confirms asynchronously via webhook).
 */
async function refundCharge({ provider, chargeId, amountMinor, currency, reason }) {
    if (!isConfigured(provider)) throw providerError(`${GATEWAYS[provider]?.name || provider} is not configured`, 409, 'PROVIDER_NOT_CONFIGURED');
    if (!chargeId) throw providerError('This transaction has no provider charge reference to refund', 409, 'NO_CHARGE_REFERENCE');
    try {
        if (provider === 'stripe') {
            const params = new URLSearchParams();
            if (String(chargeId).startsWith('pi_')) params.set('payment_intent', chargeId);
            else params.set('charge', chargeId);
            params.set('amount', String(amountMinor));
            params.set('reason', 'requested_by_customer');
            if (reason) params.set('metadata[admin_reason]', String(reason).slice(0, 400));
            const res = await axios.post('https://api.stripe.com/v1/refunds', params.toString(), {
                headers: { Authorization: `Bearer ${secret('stripe')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: TIMEOUT_MS,
            });
            return { providerRefundId: res.data?.id || null, status: res.data?.status === 'succeeded' ? 'processed' : 'pending' };
        }
        if (provider === 'paystack') {
            const res = await axios.post('https://api.paystack.co/refund', {
                transaction: chargeId,
                amount: amountMinor,
                currency,
                merchant_note: reason ? String(reason).slice(0, 400) : undefined,
            }, { headers: { Authorization: `Bearer ${secret('paystack')}` }, timeout: TIMEOUT_MS });
            const data = res.data?.data || {};
            return { providerRefundId: data.id != null ? String(data.id) : null, status: data.status === 'processed' ? 'processed' : 'pending' };
        }
        if (provider === 'flutterwave') {
            const res = await axios.post(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(chargeId)}/refund`, {
                amount: amountMinor / 100,
                comments: reason ? String(reason).slice(0, 400) : undefined,
            }, { headers: { Authorization: `Bearer ${secret('flutterwave')}` }, timeout: TIMEOUT_MS });
            const data = res.data?.data || {};
            return { providerRefundId: data.id != null ? String(data.id) : null, status: data.status === 'completed' ? 'processed' : 'pending' };
        }
    } catch (error) {
        logProviderFailure('refund', provider, error);
        const providerMessage = error?.response?.data?.message || error?.response?.data?.error?.message;
        throw providerError(providerMessage ? `Provider rejected the refund: ${String(providerMessage).slice(0, 160)}` : 'The provider could not process this refund. Please try again.', 502, 'REFUND_FAILED');
    }
    throw providerError('Refunds are not supported for this provider', 400, 'UNSUPPORTED_PROVIDER');
}

/** Pay out from a gateway balance to the configured settlement destination. */
async function createPayout({ provider, amountMinor, currency, reference }) {
    const destination = payoutDestination(provider);
    if (!isConfigured(provider)) throw providerError(`${GATEWAYS[provider]?.name || provider} is not configured`, 409, 'PROVIDER_NOT_CONFIGURED');
    if (!destination.configured) throw providerError('No settlement account is configured for this gateway', 409, 'PAYOUT_DESTINATION_MISSING');
    try {
        if (provider === 'stripe') {
            const params = new URLSearchParams({ amount: String(amountMinor), currency: currency.toLowerCase(), description: reference });
            const res = await axios.post('https://api.stripe.com/v1/payouts', params.toString(), {
                headers: {
                    Authorization: `Bearer ${secret('stripe')}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Idempotency-Key': reference,
                },
                timeout: TIMEOUT_MS,
            });
            return { providerTransferId: res.data?.id || null, status: res.data?.status === 'paid' ? 'completed' : 'processing' };
        }
        if (provider === 'paystack') {
            const res = await axios.post('https://api.paystack.co/transfer', {
                source: 'balance',
                amount: amountMinor,
                currency,
                recipient: destination.recipient,
                reference: reference.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                reason: `BuildrsHQ withdrawal ${reference}`,
            }, { headers: { Authorization: `Bearer ${secret('paystack')}` }, timeout: TIMEOUT_MS });
            const data = res.data?.data || {};
            return { providerTransferId: data.transfer_code || null, status: data.status === 'success' ? 'completed' : 'processing' };
        }
        if (provider === 'flutterwave') {
            const res = await axios.post('https://api.flutterwave.com/v3/transfers', {
                account_bank: destination.bank,
                account_number: destination.account,
                amount: amountMinor / 100,
                currency,
                reference,
                narration: `BuildrsHQ withdrawal ${reference}`,
            }, { headers: { Authorization: `Bearer ${secret('flutterwave')}` }, timeout: TIMEOUT_MS });
            const data = res.data?.data || {};
            return { providerTransferId: data.id != null ? String(data.id) : null, status: data.status === 'SUCCESSFUL' ? 'completed' : 'processing' };
        }
    } catch (error) {
        logProviderFailure('payout', provider, error);
        const providerMessage = error?.response?.data?.message || error?.response?.data?.error?.message;
        throw providerError(providerMessage ? `Provider rejected the withdrawal: ${String(providerMessage).slice(0, 160)}` : 'The provider could not process this withdrawal. Please try again.', 502, 'PAYOUT_FAILED');
    }
    throw providerError('Withdrawals are not supported for this provider', 400, 'UNSUPPORTED_PROVIDER');
}

module.exports = {
    GATEWAYS,
    isConfigured,
    payoutDestination,
    getGateways,
    clearBalanceCache,
    refundCharge,
    createPayout,
    providerError,
};

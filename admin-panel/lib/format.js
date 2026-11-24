const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
export const MONTH_LABELS = MONTHS;

export function money(minor, currency = 'USD', { decimals } = {}) {
  if (minor === null || minor === undefined || Number.isNaN(Number(minor))) return '—';
  const major = Number(minor) / 100;
  const digits = decimals ?? 2;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${currency}`;
  }
}

/** Whole-unit money for big KPI numbers ($84,254). */
export function moneyWhole(minor, currency = 'USD') {
  return money(minor, currency, { decimals: 0 });
}

export function number(n) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

export function compact(n) {
  if (n >= 1000) return `${Math.round((n / 1000) * 10) / 10}k`.replace('.0k', 'k');
  return String(n);
}

export function pct(n, digits = 1) {
  if (n === null || n === undefined) return '—';
  return `${Number(n).toFixed(digits).replace(/\.0$/, '')}%`;
}

export function date(value) {
  if (!value) return '—';
  const d = new Date(value);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function time(value) {
  if (!value) return '—';
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dateTime(value) {
  if (!value) return '—';
  return `${shortDate(value)}, ${time(value)}`;
}

export function relative(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return date(value);
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function interval(value) {
  return { monthly: 'Monthly', yearly: 'Annual', annual: 'Annual', custom: 'Custom', trial: 'Trial' }[value] || 'Monthly';
}

export function providerName(id) {
  return { stripe: 'Stripe', paystack: 'Paystack', flutterwave: 'Flutterwave', paypal: 'PayPal', manual: 'Manual' }[id] || id || '—';
}

export function roleLabel(role) {
  return role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : '';
}

/** Parse "1,234.56" into integer minor units, or null. */
export function toMinor(text) {
  const clean = String(text || '').replace(/[,\s$]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export function idempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

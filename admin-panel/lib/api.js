/**
 * Admin API client. All calls are same-origin (/api/...) and proxied to the
 * root Express backend by next.config.js. The admin session token lives in
 * sessionStorage (cleared when the browser tab closes).
 */
const TOKEN_KEY = 'buildrs_admin_token';

export function getToken() {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(message, status, code, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const CREDENTIAL_CODES = ['INVALID_CREDENTIALS', 'CHALLENGE_INVALID', 'INVALID_CODE'];
function isCredentialError(code, message) {
  return CREDENTIAL_CODES.includes(code) || /current password is incorrect/i.test(message || '');
}

const listeners = new Set();
/** Subscribe to session expiry (401 from an admin endpoint). */
export function onSessionExpired(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function qs(params) {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
}

export async function request(path, { method = 'GET', body, params, form, signal, credentialCheck = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${path}${qs(params)}`, { method, headers, body: payload, signal, cache: 'no-store' });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || data?.success === false) {
    const message = data?.message || data?.error || `Request failed (${res.status})`;
    const code = data?.code || null;
    const sessionGone = res.status === 401 || code === 'ADMIN_SESSION_EXPIRED' || code === 'NOT_PLATFORM_ADMIN'
      || (res.status === 403 && /token|account is no longer active/i.test(message));
    // credentialCheck: the endpoint answers 401 for a wrong *current password*,
    // which is a form error, not an expired session.
    if (sessionGone && token && !path.startsWith('/api/admin/auth/') && !(credentialCheck && isCredentialError(code, message))) {
      setToken(null);
      listeners.forEach((fn) => fn({ message, code }));
    }
    throw new ApiError(message, res.status, code, data);
  }
  return data;
}

const get = (path, params, opts) => request(path, { params, ...opts }).then((r) => r.data);
const post = (path, body) => request(path, { method: 'POST', body }).then((r) => r.data);
// Endpoints that verify a password/code: their 401s are form errors.
const verify = (path, body) => request(path, { method: 'POST', body, credentialCheck: true }).then((r) => r.data);

export const adminApi = {
  // Auth
  login: (email, password) => post('/api/admin/auth/login', { email, password }),
  verify2fa: (challengeToken, code) => post('/api/admin/auth/verify-2fa', { challengeToken, code }),
  resend2fa: (challengeToken) => post('/api/admin/auth/resend-2fa', { challengeToken }),
  logout: () => post('/api/admin/auth/logout', {}),
  me: () => get('/api/admin/me'),
  requestEmailChange: (email, currentPassword) => verify('/api/admin/me/email/request', { email, currentPassword }),
  confirmEmailChange: (challengeToken, code) => verify('/api/admin/me/email/confirm', { challengeToken, code }),
  totpSetup: () => post('/api/admin/me/2fa/totp/setup', {}),
  totpConfirm: (code) => verify('/api/admin/me/2fa/totp/confirm', { code }),
  totpDisable: (code) => verify('/api/admin/me/2fa/totp/disable', { code }),
  // Own profile (shared user endpoints)
  updateProfile: (fullName) => request('/api/auth/update-profile', { method: 'PUT', body: { fullName } }),
  uploadPhoto: (file) => {
    const form = new FormData();
    form.append('profilePhoto', file);
    return request('/api/auth/upload-photo', { method: 'POST', form });
  },
  changePassword: (currentPassword, newPassword) => request('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword }, credentialCheck: true }),

  overview: (params, opts) => get('/api/admin/overview', params, opts),

  usersSummary: () => get('/api/admin/users/summary'),
  users: (params, opts) => get('/api/admin/users', params, opts),
  user: (id) => get(`/api/admin/users/${id}`),
  suspendUser: (id, reason) => post(`/api/admin/users/${id}/suspend`, { reason }),
  reinstateUser: (id) => post(`/api/admin/users/${id}/reinstate`, {}),
  signOutUser: (id) => post(`/api/admin/users/${id}/sign-out`, {}),

  financeSummary: () => get('/api/admin/finance/summary'),
  revenue: (year) => get('/api/admin/finance/revenue', { year }),
  gateways: (fresh) => get('/api/admin/finance/gateways', { fresh: fresh ? 1 : undefined }),
  transactions: (params, opts) => get('/api/admin/finance/transactions', params, opts),
  transaction: (id) => get(`/api/admin/finance/transactions/${id}`),
  invoice: (id) => get(`/api/admin/finance/transactions/${id}/invoice`),
  refund: (id, amountMinor, reason) => post(`/api/admin/finance/transactions/${id}/refund`, { amountMinor, reason }),
  withdrawals: (params) => get('/api/admin/finance/withdrawals', params),
  withdraw: (body) => post('/api/admin/finance/withdrawals', body),

  billingSummary: () => get('/api/admin/billing/summary'),
  performance: (months) => get('/api/admin/billing/performance', { months }),
  byPlan: () => get('/api/admin/billing/by-plan'),
  subscribers: (params, opts) => get('/api/admin/billing/subscribers', params, opts),
  subscriber: (id) => get(`/api/admin/billing/subscribers/${id}`),
  plans: (params, opts) => get('/api/admin/billing/plans', params, opts),

  disputesSummary: () => get('/api/admin/disputes/summary'),
  disputes: (params, opts) => get('/api/admin/disputes', params, opts),
  dispute: (id) => get(`/api/admin/disputes/${id}`),
  reviewDispute: (id) => post(`/api/admin/disputes/${id}/review`, {}),
  replyDispute: (id, message) => post(`/api/admin/disputes/${id}/reply`, { message }),
  updateDispute: (id, body) => request(`/api/admin/disputes/${id}`, { method: 'PATCH', body }).then((r) => r.data),
  disputeStatus: (id, status, note) => post(`/api/admin/disputes/${id}/status`, { status, note }),
  refundDispute: (id, body) => post(`/api/admin/disputes/${id}/refund`, body),
  attachmentUrl: (id, index) => `/api/admin/disputes/${id}/attachments/${index}`,

  insights: () => get('/api/admin/insights'),

  settings: () => get('/api/admin/settings'),
  saveGeneral: (body) => request('/api/admin/settings/general', { method: 'PUT', body }).then((r) => r.data),
  saveSecurity: (body) => request('/api/admin/settings/security', { method: 'PUT', body }).then((r) => r.data),
  aiModels: () => get('/api/admin/settings/ai-models'),

  notifications: (params) => get('/api/admin/notifications', params),
  unreadCount: () => get('/api/admin/notifications/unread-count'),
  markRead: (id) => post(`/api/admin/notifications/${id}/read`, {}),
  markAllRead: () => post('/api/admin/notifications/read-all', {}),
};

/** Download an authenticated file (attachments) without exposing the token in a URL. */
export async function downloadAuthenticated(path, filename) {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let message = 'Download failed';
    try { message = (await res.json()).message || message; } catch { /* binary */ }
    throw new ApiError(message, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

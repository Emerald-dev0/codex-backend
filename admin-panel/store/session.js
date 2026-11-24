import { create } from 'zustand';
import { adminApi, getToken, setToken } from '../lib/api';

/** Signed-in admin + session policy (from GET /api/admin/me). */
const useSession = create((set, get) => ({
  status: 'idle', // idle | loading | ready | anonymous
  admin: null,
  session: null,
  platform: null,
  twoFactor: null,
  expiredMessage: '',

  async load() {
    if (!getToken()) {
      set({ status: 'anonymous', admin: null });
      return null;
    }
    set({ status: 'loading' });
    try {
      const data = await adminApi.me();
      set({ status: 'ready', ...data });
      return data;
    } catch (error) {
      if (error.status === 401 || error.status === 403) setToken(null);
      set({ status: 'anonymous', admin: null, expiredMessage: error.status ? error.message : '' });
      return null;
    }
  },

  signIn(token, admin) {
    setToken(token);
    set({ admin, status: 'loading', expiredMessage: '' });
    return get().load();
  },

  patchAdmin(patch) {
    set({ admin: { ...get().admin, ...patch } });
  },

  async signOut() {
    try { await adminApi.logout(); } catch { /* session may already be gone */ }
    setToken(null);
    set({ status: 'anonymous', admin: null, session: null });
  },

  expire(message) {
    setToken(null);
    set({ status: 'anonymous', admin: null, expiredMessage: message || 'Your session has expired. Please sign in again.' });
  },
}));

export default useSession;

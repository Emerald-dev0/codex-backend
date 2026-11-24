import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell, CreditCard, LayoutGrid, LineChart, LogOut, Menu, Scale, Search, Settings, Users, Wallet, X,
} from 'lucide-react';
import useSession from '../store/session';
import { adminApi, onSessionExpired } from '../lib/api';
import { roleLabel, money } from '../lib/format';
import { Avatar, GradientAvatar, Modal, Spinner, cx } from './ui';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutGrid },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/finance', label: 'Finance', icon: Wallet },
  { href: '/billing', label: 'Billing Plans', icon: CreditCard },
  { href: '/disputes', label: 'Dispute', icon: Scale },
  { href: '/insights', label: 'Insights', icon: LineChart },
  { href: '/notifications', label: 'Notification', icon: Bell },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BrandMark() {
  return (
    <span className="flex items-center gap-3">
      <span
        className="block h-[58px] w-[88px] shrink-0 rounded-md"
        style={{ backgroundImage: 'url(/buildrs.png)', backgroundSize: '190%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
        aria-hidden="true"
      />
      <span className="text-[20px] font-semibold tracking-tight text-white">
        Buildrs<span className="text-figma-accent">HQ</span>
      </span>
    </span>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({ users: [], transactions: [] });
  const box = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults({ users: [], transactions: [] }); return undefined; }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const [u, tx] = await Promise.all([
          adminApi.users({ q: term, limit: 4 }, { signal: ctrl.signal }),
          adminApi.transactions({ q: term, limit: 4 }, { signal: ctrl.signal }),
        ]);
        setResults({ users: u.users, transactions: tx.transactions });
      } catch (error) {
        if (error.name !== 'AbortError') setResults({ users: [], transactions: [] });
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = (href) => { setOpen(false); setQ(''); router.push(href); };
  const has = results.users.length || results.transactions.length;

  return (
    <div ref={box} className="relative w-full max-w-[430px]">
      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(`/users?q=${encodeURIComponent(q.trim())}`); }}
        role="search"
      >
        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute left-5 h-5 w-5 text-figma-text-soft" />
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search"
            aria-label="Search users and transactions"
            className="h-[46px] w-full rounded-full border border-[#1f4c78] bg-[#1d263b] pl-[50px] pr-4 text-[16px] text-white placeholder:text-figma-text-soft focus:border-figma-accent/70 focus:outline-none"
            maxLength={100}
          />
        </label>
      </form>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#121926] shadow-2xl">
          {loading && !has && <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-figma-text-muted"><Spinner /> Searching…</div>}
          {!loading && !has && <div className="px-4 py-3 text-[13px] text-figma-text-muted">No users or transactions match “{q.trim()}”.</div>}
          {results.users.length > 0 && (
            <div className="py-1">
              <p className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-wider text-figma-text-faint">Users</p>
              {results.users.map((u) => (
                <button key={u.id} type="button" onClick={() => go(`/users/${u.id}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5">
                  <Avatar name={u.name || u.email} src={u.profilePicture} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-white">{u.name || u.email}</span>
                    <span className="block truncate text-[12px] text-figma-text-muted">{u.email}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {results.transactions.length > 0 && (
            <div className="border-t border-white/5 py-1">
              <p className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-wider text-figma-text-faint">Transactions</p>
              {results.transactions.map((t) => (
                <button key={t.id} type="button" onClick={() => go(`/finance/transactions/${t.id}`)} className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-white/5">
                  <span className="min-w-0">
                    <span className="block text-[14px] text-white">{t.reference}</span>
                    <span className="block truncate text-[12px] text-figma-text-muted">{t.customer.name}</span>
                  </span>
                  <span className="text-[13px] text-figma-text-soft">{money(t.amountMinor, t.currency)}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => go(`/users?q=${encodeURIComponent(q.trim())}`)} className="block w-full border-t border-white/5 px-4 py-2.5 text-left text-[13px] text-figma-accent hover:bg-white/5">
            See all users matching “{q.trim()}” →
          </button>
        </div>
      )}
    </div>
  );
}

export function LogoutModal({ open, onClose }) {
  const router = useRouter();
  const { admin, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    onClose();
    router.replace('/login');
  };
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      width="max-w-[484px]"
      icon={<LogOut className="h-6 w-6" />}
      title={<span className="text-[26px]">Log out of BuildrsHQ?</span>}
    >
      <p className="-mt-3 text-[15px] leading-relaxed text-figma-text-soft">
        You’re about to end your admin session. You’ll need to sign in again to manage the platform.
      </p>
      {admin && (
        <div className="mt-6 flex items-center gap-3 rounded-lg bg-[#0a0d15] px-4 py-4">
          <Avatar name={admin.fullName || admin.email} src={admin.profilePicture} size={32} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-white">{admin.fullName || admin.email}</p>
            <p className="truncate text-[13px] text-figma-text-soft">{admin.email} · {roleLabel(admin.role)}</p>
          </div>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="btn-secondary w-[116px] text-[14px]" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary w-[132px] text-[14px]" onClick={confirm} disabled={busy}>
          {busy ? <Spinner /> : 'Log out'}
        </button>
      </div>
    </Modal>
  );
}

function SidebarContent({ pathname, onNavigate, onLogout, admin }) {
  return (
    <div className="flex h-full flex-col">
      <p className="px-4 pb-2 pt-12 text-[14px] text-figma-text-soft">Manage Platform</p>
      <nav className="flex flex-col gap-[13px] px-4" aria-label="Admin navigation">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex h-12 items-center gap-3 rounded-lg px-4 text-[18px] transition-colors',
                active ? 'bg-[#0f2a33] text-figma-accent' : 'text-white hover:bg-white/5'
              )}
            >
              <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
        <button type="button" onClick={onLogout} className="flex h-12 items-center gap-3 rounded-lg px-4 text-left text-[18px] text-white hover:bg-white/5">
          <LogOut className="h-[22px] w-[22px]" strokeWidth={1.8} />
          Logout
        </button>
      </nav>
      {admin && (
        <Link href="/settings?tab=account" onClick={onNavigate} className="mt-auto flex items-center gap-4 px-7 pb-8 pt-6 hover:opacity-90">
          <GradientAvatar name={admin.fullName || admin.email} src={admin.profilePicture} size={56} />
          <span className="min-w-0">
            <span className="block truncate text-[20px] font-semibold text-white">{admin.fullName || admin.email}</span>
            <span className="block text-[14px] text-white/90">{roleLabel(admin.role)}</span>
          </span>
        </Link>
      )}
    </div>
  );
}

/**
 * Authenticated admin layout. Redirects to /login when there is no valid
 * admin session; listens for mid-session expiry (idle timeout, revocation).
 */
export default function Shell({ title, children }) {
  const router = useRouter();
  const { status, admin, load, expire } = useSession();
  const [drawer, setDrawer] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => { if (status === 'idle') load(); }, [status, load]);
  useEffect(() => {
    if (status === 'anonymous') {
      const next = router.asPath && router.asPath !== '/' ? `?next=${encodeURIComponent(router.asPath)}` : '';
      router.replace(`/login${next}`);
    }
  }, [status, router]);
  useEffect(() => onSessionExpired(({ message }) => expire(message)), [expire]);

  const refreshUnread = useCallback(async () => {
    try { setUnread((await adminApi.unreadCount()).count); } catch { /* badge is best-effort */ }
  }, []);
  useEffect(() => {
    if (status !== 'ready') return undefined;
    refreshUnread();
    const t = setInterval(refreshUnread, 60000);
    const onChange = () => refreshUnread();
    window.addEventListener('admin:notifications-changed', onChange);
    return () => { clearInterval(t); window.removeEventListener('admin:notifications-changed', onChange); };
  }, [status, refreshUnread]);
  useEffect(() => { setDrawer(false); }, [router.asPath]);

  if (status !== 'ready' || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-figma-bg">
        <Spinner className="h-6 w-6 text-figma-accent" />
      </div>
    );
  }

  return (
    <>
      <Head><title>{title ? `${title} · BuildrsHQ Admin` : 'BuildrsHQ Admin'}</title></Head>
      <div className="min-h-screen bg-figma-bg">
        <header className="sticky top-0 z-30 flex h-[72px] items-center gap-4 border-b border-white/10 bg-figma-bg px-4 lg:h-[96px] lg:px-5">
          <button type="button" className="rounded-md p-2 text-white hover:bg-white/5 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Menu className="h-6 w-6" />
          </button>
          <Link href="/" className="hidden shrink-0 sm:block lg:w-[237px]"><BrandMark /></Link>
          <div className="min-w-0 flex-1 lg:pl-[35px]"><GlobalSearch /></div>
          <div className="flex shrink-0 items-center gap-4 lg:gap-7 lg:pr-[60px]">
            <Link href="/notifications" className="relative inline-flex h-14 w-14 items-center justify-center rounded-full border border-[#1f4c78] bg-[#1d263b] text-white hover:border-figma-accent/60" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
              <Bell className="h-6 w-6" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#ec1414] px-1 text-[12px] font-medium text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
            <Link href="/settings?tab=account" aria-label="Your account" className="hidden sm:block">
              <GradientAvatar name={admin.fullName || admin.email} src={admin.profilePicture} size={56} />
            </Link>
          </div>
        </header>

        <aside className="fixed bottom-0 left-0 top-[96px] z-20 hidden w-[242px] overflow-y-auto bg-[#0f131c] lg:block" style={{ boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.03)' }}>
          <SidebarContent pathname={router.pathname} admin={admin} onLogout={() => setLogoutOpen(true)} />
        </aside>

        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} aria-hidden="true" />
            <aside className="absolute bottom-0 left-0 top-0 w-[272px] overflow-y-auto bg-[#0f131c] shadow-2xl">
              <div className="flex items-center justify-between px-4 pt-4">
                <BrandMark />
                <button type="button" onClick={() => setDrawer(false)} className="rounded p-1 text-white hover:bg-white/5" aria-label="Close navigation"><X className="h-5 w-5" /></button>
              </div>
              <SidebarContent pathname={router.pathname} admin={admin} onNavigate={() => setDrawer(false)} onLogout={() => { setDrawer(false); setLogoutOpen(true); }} />
            </aside>
          </div>
        )}

        <main className="bg-[#111520] px-4 pb-16 pt-8 sm:px-6 lg:ml-[242px] lg:min-h-[calc(100vh-96px)] lg:px-6 lg:pt-9">
          <div className="mx-auto max-w-[1142px]">{children}</div>
        </main>
      </div>
      <LogoutModal open={logoutOpen} onClose={() => setLogoutOpen(false)} />
    </>
  );
}

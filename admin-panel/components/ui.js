import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Loader2, Search, X, AlertTriangle, RefreshCw } from 'lucide-react';
import { initials } from '../lib/format';

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <Loader2 className={cx('animate-spin', className)} aria-hidden="true" />;
}

/** "PLATFORM ADMINISTRATION" header, or a back-arrow header for detail pages. */
export function PageHeader({ title, subtitle, actions, back }) {
  const router = useRouter();
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className={cx('flex min-w-0', back && 'items-start gap-5')}>
        {back && (
          <button
            type="button"
            onClick={() => (typeof back === 'string' ? router.push(back) : router.back())}
            className="mt-2 rounded-md p-1 text-white hover:bg-white/5"
            aria-label="Go back"
          >
            <ArrowLeft className="h-7 w-7" />
          </button>
        )}
        <div className="min-w-0">
          {!back && <p className="eyebrow mb-3">Platform Administration</p>}
          <h1 className="text-[28px] font-semibold leading-tight text-white sm:text-[32px]">{title}</h1>
          {subtitle && <p className="mt-3 text-[15px] text-figma-text-soft/90">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3 sm:mt-5">{actions}</div>}
    </div>
  );
}

export function Card({ className = '', children, ...rest }) {
  return <section className={cx('card p-5', className)} {...rest}>{children}</section>;
}

export function CardTitle({ title, subtitle, right, className = '' }) {
  return (
    <div className={cx('mb-5 flex items-start justify-between gap-4', className)}>
      <div>
        <h2 className="text-[20px] font-medium text-white">{title}</h2>
        {subtitle && <p className="mt-2 text-[14px] text-figma-text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** Delta line under a stat value: tone = up | warn | muted | down. */
export function Delta({ value, label, tone = 'up', arrow = true }) {
  const color = { up: 'text-[#56e5a9]', warn: 'text-figma-warning', down: 'text-[#ec8f8f]', muted: 'text-figma-text-muted' }[tone];
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-figma-text-muted">
      {value !== null && value !== undefined && value !== '' && (
        <span className={cx('flex items-center gap-1 text-[12px]', color)}>
          {arrow && tone === 'up' && <ArrowUpRight className="h-3 w-3" />}
          {value}
        </span>
      )}
      <span>{label}</span>
    </p>
  );
}

export function StatCard({ label, value, delta, href, loading }) {
  const router = useRouter();
  const clickable = Boolean(href);
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? () => router.push(href) : undefined}
      className={cx('card relative w-full p-[18px] text-left', clickable && 'transition-colors hover:border-figma-accent/40')}
    >
      <p className="pr-6 text-[14px] text-figma-text-soft">{label}</p>
      {clickable && <ArrowUpRight className="absolute right-4 top-4 h-3.5 w-3.5 text-figma-text-soft" aria-hidden="true" />}
      {loading ? (
        <>
          <div className="skeleton mt-3 h-8 w-32" />
          <div className="skeleton mt-3 h-3 w-24" />
        </>
      ) : (
        <>
          <p className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-white">{value}</p>
          {delta}
        </>
      )}
    </Tag>
  );
}

const PILL_TONES = {
  success: 'bg-[#0f2a22] text-[#56e5a9]',
  warning: 'bg-[#2a2210] text-figma-warning',
  danger: 'bg-[#2a1214] text-[#ff6b6b]',
  info: 'bg-[#10222f] text-figma-accent',
  muted: 'bg-white/5 text-figma-text-muted',
  review: 'bg-[#2a2210] text-figma-warning',
};

export function Pill({ tone = 'muted', dot = false, children, size = 'md' }) {
  return (
    <span className={cx(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded font-medium',
      size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-2 py-0.5 text-[14px]',
      PILL_TONES[tone]
    )}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_MAP = {
  successful: ['success', 'Successful'],
  pending: ['warning', 'Pending'],
  failed: ['danger', 'Failed'],
  refunded: ['muted', 'Refunded'],
  partially_refunded: ['info', 'Partially refunded'],
  active: ['success', 'Active'],
  trial: ['info', 'Trial'],
  past_due: ['warning', 'Past due'],
  expired: ['warning', 'Expired'],
  cancelled: ['warning', 'Expired'],
  suspended: ['danger', 'Suspended'],
  unverified: ['warning', 'Unverified'],
  processing: ['warning', 'Processing'],
  completed: ['success', 'Completed'],
  open: ['info', 'Open'],
  in_review: ['review', 'In review'],
  resolved: ['success', 'Resolved'],
  paid: ['success', 'Paid'],
  new_account: ['info', 'New account'],
  needs_review: ['warning', 'Needs review'],
  draft: ['muted', 'Draft'],
  archived: ['muted', 'Archived'],
};

export function StatusPill({ status, dot, size }) {
  const [tone, label] = STATUS_MAP[status] || ['muted', status || '—'];
  return <Pill tone={tone} dot={dot} size={size}>{label}</Pill>;
}

export function Avatar({ name, src, size = 32, className = '' }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)) };
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={style} onError={() => setBroken(true)} className={cx('shrink-0 rounded-full object-cover', className)} />;
  }
  return (
    <span style={style} className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-[#10303a] font-semibold text-figma-accent', className)}>
      {initials(name)}
    </span>
  );
}

export function GradientAvatar({ name, size = 56, src }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" onError={() => setBroken(true)} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover ring-1 ring-white/20" />;
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#68f7ff] to-[#a4edf0] font-bold text-[#0b2a33] ring-1 ring-white/30"
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[#0f2a33] text-figma-accent">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <p className="text-[17px] font-semibold text-white">{title}</p>
      {message && <p className="mt-2 max-w-md text-[14px] text-figma-text-muted">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, compact }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-14')}>
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#2a1214] text-[#ff6b6b]">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <p className="text-[15px] font-medium text-white">Something went wrong</p>
      <p className="mt-1 max-w-md text-[13px] text-figma-text-muted">{message || 'We could not load this data.'}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary btn-sm mt-4">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cx('skeleton', className)} />;
}

export function SearchInput({ value, onChange, placeholder, className = '' }) {
  return (
    <label className={cx('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-3 h-4 w-4 text-figma-text-soft" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-white/15 bg-transparent pl-9 pr-3 text-[13px] text-white placeholder:text-figma-text-soft focus:border-figma-accent/60 focus:outline-none"
        maxLength={100}
      />
    </label>
  );
}

/** Pill-button dropdown used for "All status", "All plans", etc. */
export function FilterSelect({ value, onChange, options, placeholder, className = '', align = 'right', large }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={cx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx(
          'inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-white/15 bg-[#151c2b] px-4 text-white hover:bg-[#1d263b]',
          large ? 'text-[16px]' : 'text-[14px] font-semibold'
        )}
      >
        {current && current.value !== '' ? current.label : placeholder}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <ul
          role="listbox"
          className={cx('absolute z-30 mt-2 min-w-[180px] overflow-hidden rounded-lg border border-white/10 bg-[#121926] py-1 shadow-xl', align === 'right' ? 'right-0' : 'left-0')}
        >
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[14px] text-figma-text-soft hover:bg-white/5 hover:text-white"
              >
                {o.label}
                {o.value === value && <Check className="h-3.5 w-3.5 text-figma-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function pageList(page, totalPages) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, 2, 3, totalPages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export function Pagination({ page, totalPages, total, limit, noun = 'results', onPage, label }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[13px] text-figma-text-soft">{label || `Showing ${from}–${to} of ${total.toLocaleString()} ${noun}`}</p>
      <div className="flex items-center gap-2 text-[13px]">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-2 py-1 text-figma-text-soft hover:text-white disabled:opacity-40">
          Previous
        </button>
        {pageList(page, totalPages).map((p, i) => (p === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-figma-text-muted">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cx('min-w-[24px] rounded px-1.5 py-1', p === page ? 'bg-[#10303a] text-figma-accent' : 'text-figma-text-soft hover:text-white')}
          >
            {p}
          </button>
        )))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="ml-1 h-10 rounded-lg border border-white/15 bg-[#151c2b] px-4 font-semibold text-white hover:bg-[#1d263b] disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-[22px] w-[34px] shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-figma-accent' : 'bg-[#1d263b]'
      )}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full transition-transform', checked ? 'translate-x-[15px] bg-[#04161a] ring-2 ring-[#04161a]' : 'translate-x-[3px] bg-[#59687a]')} />
    </button>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 'max-w-[780px]', icon }) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => panel.current?.focus(), 0);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#05080d]/75 px-4 py-8 backdrop-blur-[1px] sm:py-24" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx('relative w-full rounded-xl border border-white/15 bg-[#121926] p-6 shadow-2xl outline-none sm:p-7', width)}
      >
        {onClose && (
          <button type="button" onClick={onClose} className="absolute right-6 top-6 rounded p-1 text-white/80 hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        )}
        {icon && <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[#10303a] text-figma-accent">{icon}</span>}
        {title && <h2 className="pr-10 text-[26px] font-semibold text-white sm:text-[30px]">{title}</h2>}
        {subtitle && <p className="mt-2 text-[15px] text-figma-text-soft">{subtitle}</p>}
        <div className={title ? 'mt-6' : ''}>{children}</div>
        {footer && <div className="mt-8">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, error, hint, children, className = '' }) {
  return (
    <div className={className}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? <p className="mt-1.5 text-[12px] text-[#ff6b6b]">{error}</p> : hint ? <p className="mt-1.5 text-[12px] text-figma-text-muted">{hint}</p> : null}
    </div>
  );
}

export function InlineAlert({ tone = 'danger', children }) {
  const tones = {
    danger: 'border-[#ec1414]/40 bg-[#2a1214]/60 text-[#ff9b9b]',
    warning: 'border-figma-warning/40 bg-[#2a2210]/60 text-figma-warning',
    info: 'border-figma-accent/30 bg-[#0f2a33]/60 text-figma-accent-soft',
    success: 'border-[#56e5a9]/30 bg-[#0f2a22]/60 text-[#56e5a9]',
  };
  return <div className={cx('rounded-lg border px-3 py-2.5 text-[13px]', tones[tone])} role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>;
}

/** Table wrapper with the design's raised header row; scrolls horizontally on small screens. */
export function Table({ columns, children, minWidth = 900 }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full border-separate border-spacing-0" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.key || c.label}
                className={cx('th bg-[#1d263b]', i === 0 && 'rounded-l-md', i === columns.length - 1 && 'rounded-r-md', c.className)}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr>td]:border-b [&>tr>td]:border-white/10">{children}</tbody>
      </table>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }) {
  return Array.from({ length: rows }).map((_, r) => (
    <tr key={r}>
      {Array.from({ length: cols }).map((__, c) => (
        <td key={c} className="td"><Skeleton className={cx('h-4', c === 1 ? 'w-40' : 'w-20')} /></td>
      ))}
    </tr>
  ));
}

export function DetailItem({ label, value, className = '' }) {
  return (
    <div className={className}>
      <p className="text-[15px] text-figma-text-muted">{label}</p>
      <p className="mt-2 text-[16px] text-white">{value ?? '—'}</p>
    </div>
  );
}

import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Bell, CheckCheck, CreditCard, RotateCcw, Scale, Settings2, UserPlus, Wallet } from 'lucide-react';
import Shell from '../components/Shell';
import { Card, EmptyState, ErrorState, FilterSelect, PageHeader, Pagination, Skeleton, Spinner, cx } from '../components/ui';
import { adminApi } from '../lib/api';
import useAsync from '../lib/useAsync';
import { dateTime, number, relative } from '../lib/format';
import { toast } from '../store/toast';

const TYPE_META = {
  dispute: { icon: Scale, label: 'Disputes' },
  payment: { icon: CreditCard, label: 'Payments' },
  refund: { icon: RotateCcw, label: 'Refunds' },
  withdrawal: { icon: Wallet, label: 'Withdrawals' },
  user: { icon: UserPlus, label: 'Users' },
  system: { icon: Settings2, label: 'System' },
};
const SEVERITY = {
  info: 'bg-[#10303a] text-figma-accent',
  success: 'bg-[#0f2a22] text-[#56e5a9]',
  warning: 'bg-[#2a2210] text-figma-warning',
  critical: 'bg-[#2a1214] text-[#ff6b6b]',
};
const FILTERS = [{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }];
const LIMIT = 20;

const announce = () => window.dispatchEvent(new Event('admin:notifications-changed'));

export default function NotificationsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState('all');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [markingAll, setMarkingAll] = useState(false);
  const { data, error, loading, reload, setData } = useAsync(() => adminApi.notifications({ filter, type: type || undefined, page, limit: LIMIT }), [filter, type, page]);
  useEffect(() => { setPage(1); }, [filter, type]);

  const open = async (n) => {
    if (!n.read) {
      setData((d) => d && ({ ...d, unread: Math.max(0, d.unread - 1), notifications: d.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }));
      adminApi.markRead(n.id).then(announce).catch(() => { /* best-effort; the item stays unread on reload */ });
    }
    if (n.link && n.link.startsWith('/')) router.push(n.link);
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      const res = await adminApi.markAllRead();
      announce();
      toast.success(res.updated ? `Marked ${number(res.updated)} notification${res.updated === 1 ? '' : 's'} as read` : 'Everything is already read');
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMarkingAll(false);
    }
  };

  const filtered = filter !== 'all' || type;
  return (
    <Shell title="Notification">
      <PageHeader
        title="Notification"
        subtitle="Stay on top of disputes, payments, and account activity across the platform."
        actions={(
          <button type="button" className="btn-secondary" onClick={markAll} disabled={markingAll || !data || data.unread === 0}>
            {markingAll ? <Spinner /> : <CheckCheck className="h-4 w-4" />} Mark all as read
          </button>
        )}
      />

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/15">
          <div className="flex gap-6" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cx('-mb-px border-b-2 pb-3 text-[16px]', filter === f.id ? 'border-figma-accent font-medium text-figma-accent' : 'border-transparent text-figma-text-soft hover:text-white')}
              >
                {f.label}{f.id === 'unread' && data ? ` ${number(data.unread)}` : ''}
              </button>
            ))}
          </div>
          <div className="pb-3">
            <FilterSelect
              value={type}
              onChange={setType}
              placeholder="All types"
              options={[{ value: '', label: 'All types' }, ...Object.entries(TYPE_META).map(([value, m]) => ({ value, label: m.label }))]}
            />
          </div>
        </div>

        {error && !data ? <ErrorState message={error.message} onRetry={reload} /> : !data ? (
          <ul className="divide-y divide-white/10">{[0, 1, 2, 3, 4].map((i) => <li key={i} className="flex gap-4 py-5"><Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></div></li>)}</ul>
        ) : data.notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={filtered ? 'Nothing here' : 'No notifications yet'}
            message={filtered ? (filter === 'unread' ? 'You’re all caught up.' : 'No notifications match this filter.') : 'New disputes, payments, refunds and sign-ups will show up here.'}
          />
        ) : (
          <ul className={cx('divide-y divide-white/10', loading && 'opacity-60')}>
            {data.notifications.map((n) => {
              const meta = TYPE_META[n.type] || TYPE_META.system;
              const Icon = meta.icon;
              const clickable = Boolean(n.link) || !n.read;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    disabled={!clickable}
                    className={cx('flex w-full items-start gap-4 px-2 py-5 text-left transition-colors', clickable && 'hover:bg-white/[0.03]', !clickable && 'cursor-default')}
                  >
                    <span className={cx('mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full', SEVERITY[n.severity] || SEVERITY.info)}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-4">
                        <span className={cx('text-[16px]', n.read ? 'text-figma-text-soft' : 'font-medium text-white')}>{n.title}</span>
                        <span className="shrink-0 text-[12px] text-figma-text-faint" title={dateTime(n.createdAt)}>{relative(n.createdAt)}</span>
                      </span>
                      {n.message && <span className="mt-1 block text-[14px] text-figma-text-muted">{n.message}</span>}
                      {n.link && <span className="mt-2 block text-[13px] text-figma-accent">View details →</span>}
                    </span>
                    {!n.read && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-figma-accent" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {data && data.total > LIMIT && <Pagination {...data} noun="notifications" onPage={setPage} />}
      </Card>
    </Shell>
  );
}

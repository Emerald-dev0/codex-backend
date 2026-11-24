import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { ShieldCheck, Users as UsersIcon } from 'lucide-react';
import Shell from '../../components/Shell';
import {
  Avatar, Card, CardTitle, Delta, EmptyState, ErrorState, FilterSelect, PageHeader, Pagination, Pill, SearchInput, StatCard, StatusPill, Table, TableSkeleton,
} from '../../components/ui';
import { adminApi } from '../../lib/api';
import useAsync, { useDebounced } from '../../lib/useAsync';
import { date, number, pct, relative, roleLabel } from '../../lib/format';
import { PLAN_OPTIONS } from '../../lib/plans';

const LIMIT = 10;

export default function UsersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim());

  // Accept ?q= from the global search.
  useEffect(() => {
    if (router.isReady && typeof router.query.q === 'string') setQ(router.query.q);
  }, [router.isReady, router.query.q]);
  useEffect(() => { setPage(1); }, [term, status, plan, sort]);

  const summary = useAsync(() => adminApi.usersSummary(), []);
  const list = useAsync(
    () => adminApi.users({ q: term, status, plan, sort, page, limit: LIMIT }),
    [term, status, plan, sort, page]
  );
  const s = summary.data;
  const filtered = Boolean(term || status || plan);

  return (
    <Shell title="Users">
      <PageHeader title="Users" subtitle="Find accounts, review their plans and activity, and manage access." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard loading={!s} label="Total users" value={s && number(s.totalUsers.count)} delta={s && <Delta label={s.totalUsers.count ? 'All registered accounts' : 'No users yet'} />} />
        <StatCard
          loading={!s}
          label="New users"
          value={s && number(s.newUsers.count)}
          delta={s && (s.newUsers.changePct !== null
            ? <Delta value={pct(s.newUsers.changePct)} label="vs. previous 30 days" tone={s.newUsers.changePct >= 0 ? 'up' : 'down'} />
            : <Delta label="Last 30 days" />)}
        />
        <StatCard loading={!s} label="Active this week" value={s && number(s.activeThisWeek.count)} delta={s && <Delta label="Signed-in users, last 7 days" />} />
        <StatCard
          loading={!s}
          label="Suspended"
          value={s && number(s.suspended.count)}
          delta={s && <Delta value={s.unverified.count ? `${number(s.unverified.count)} unverified` : ''} label={s.unverified.count ? 'awaiting email verification' : s.suspended.count ? 'Access revoked by an admin' : 'No suspended accounts'} tone="warn" arrow={false} />}
        />
      </div>
      {summary.error && <p className="mt-3 text-[13px] text-[#ff8a8a]">Could not load user metrics. <button type="button" className="link" onClick={summary.reload}>Retry</button></p>}

      <Card className="mt-6">
        <CardTitle title="All users" subtitle="Every account on the platform" />
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, email or company" className="w-full lg:max-w-[340px]" />
          <div className="flex flex-wrap gap-3">
            <FilterSelect value={plan} onChange={setPlan} placeholder="All plans" options={[{ value: '', label: 'All plans' }, ...PLAN_OPTIONS]} />
            <FilterSelect
              value={status}
              onChange={setStatus}
              placeholder="All status"
              options={[{ value: '', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'unverified', label: 'Unverified' }, { value: 'suspended', label: 'Suspended' }]}
            />
            <FilterSelect
              value={sort}
              onChange={setSort}
              placeholder="Newest"
              options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'name', label: 'Name (A–Z)' }, { value: 'last_login', label: 'Last sign-in' }]}
            />
          </div>
        </div>

        {list.error && !list.data ? <ErrorState message={list.error.message} onRetry={list.reload} /> : (
          <>
            <Table columns={[{ label: 'User' }, { label: 'Plan' }, { label: 'Status' }, { label: 'Joined' }, { label: 'Last sign-in' }, { label: 'Action' }]}>
              {!list.data ? <TableSkeleton rows={6} cols={6} /> : list.data.users.length === 0 ? (
                <tr><td colSpan={6}>
                  <EmptyState
                    icon={UsersIcon}
                    title={filtered ? 'No users match your filters' : 'No users yet'}
                    message={filtered ? 'Try a different search or clear the filters.' : 'Accounts will appear here as people sign up.'}
                    action={filtered && <button type="button" className="btn-secondary btn-sm" onClick={() => { setQ(''); setStatus(''); setPlan(''); }}>Clear filters</button>}
                  />
                </td></tr>
              ) : list.data.users.map((u) => (
                <tr key={u.id} className={list.loading ? 'opacity-60' : 'hover:bg-white/[0.02]'}>
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name || u.email} src={u.profilePicture} size={32} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-[15px] font-medium text-white">
                          {u.name || '—'}
                          {u.platformRole && <span title={roleLabel(u.platformRole)}><ShieldCheck className="h-3.5 w-3.5 text-figma-accent" /></span>}
                        </p>
                        <p className="truncate text-[13px] text-figma-text-muted">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    {u.planLabel}
                    {u.subscriptionStatus === 'trial' && <span className="ml-2"><Pill tone="info" size="sm">Trial</Pill></span>}
                  </td>
                  <td className="td"><StatusPill status={u.status} /></td>
                  <td className="td whitespace-nowrap text-figma-text-soft">{date(u.createdAt)}</td>
                  <td className="td whitespace-nowrap text-figma-text-soft">{u.lastLogin ? relative(u.lastLogin) : 'Never'}</td>
                  <td className="td"><Link href={`/users/${u.id}`} className="link whitespace-nowrap">View details</Link></td>
                </tr>
              ))}
            </Table>
            {list.data && <Pagination {...list.data} noun="users" onPage={setPage} />}
          </>
        )}
      </Card>
    </Shell>
  );
}

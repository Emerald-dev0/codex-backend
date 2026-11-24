import { useState } from 'react';
import { Layers } from 'lucide-react';
import Shell from '../../components/Shell';
import { Card, CardTitle, Delta, EmptyState, ErrorState, FilterSelect, PageHeader, SearchInput, StatCard, StatusPill, Table, TableSkeleton } from '../../components/ui';
import { adminApi } from '../../lib/api';
import useAsync, { useDebounced } from '../../lib/useAsync';
import { money, moneyWhole, number } from '../../lib/format';

function Price({ minor, currency, per }) {
  if (minor === null || minor === undefined) return <><p className="text-white">Custom</p><p className="text-[14px] text-figma-text-soft">Contact sales</p></>;
  return <><p className="text-white">{moneyWhole(minor, currency)}</p><p className="text-[14px] text-figma-text-soft">{currency} / {per}</p></>;
}

export default function ManagePlans() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [cycle, setCycle] = useState('');
  const term = useDebounced(q.trim(), 200);
  const { data, error, loading, reload } = useAsync(() => adminApi.plans({ q: term, status, cycle }), [term, status, cycle]);
  const st = data?.stats;

  return (
    <Shell title="Manage Plans">
      <PageHeader back="/billing" title="Manage Plans" subtitle="Manage your subscription pricing" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard loading={!st} label="Total plans" value={st && number(st.total)} delta={<Delta label="Across your plan catalog" />} />
        <StatCard loading={!st} label="Active plans" value={st && number(st.active)} delta={<Delta label="Available for subscriptions" />} />
        <StatCard loading={!st} label="Draft plans" value={st && number(st.draft)} delta={<Delta label="Not yet published" />} />
        <StatCard loading={!st} label="Archived plans" value={st && number(st.archived)} delta={<Delta label="Closed to new subscriptions" />} />
      </div>

      <Card className="mt-6">
        <CardTitle title="All plans" subtitle="View pricing, billing cycles and availability for every plan in your catalog." />
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput value={q} onChange={setQ} placeholder="Search by plan name or identifier" className="w-full lg:max-w-[324px]" />
          <div className="flex flex-wrap gap-3">
            <FilterSelect value={status} onChange={setStatus} placeholder="All status" options={[{ value: '', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }]} />
            <FilterSelect value={cycle} onChange={setCycle} placeholder="All billing cycles" options={[{ value: '', label: 'All billing cycles' }, { value: 'free', label: 'Free' }, { value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }, { value: 'custom', label: 'Custom' }]} />
          </div>
        </div>
        {error && !data ? <ErrorState message={error.message} onRetry={reload} /> : (
          <Table columns={[{ label: 'Plan', width: '26%' }, { label: 'Monthly' }, { label: 'Annual' }, { label: 'Subscribers' }, { label: 'Status' }, { label: 'Amount generated' }]}>
            {!data ? <TableSkeleton rows={6} cols={6} /> : data.plans.length === 0 ? (
              <tr><td colSpan={6}><EmptyState icon={Layers} title="No plans match" message="Try a different search or filter." /></td></tr>
            ) : data.plans.map((p) => (
              <tr key={p.id} className={loading ? 'opacity-60' : ''}>
                <td className="td py-5"><p className="text-white">{p.name}</p><p className="mt-1 max-w-[240px] text-[14px] text-figma-text-soft">{p.description}</p></td>
                <td className="td"><Price minor={p.monthlyPriceMinor} currency={p.currency} per="month" /></td>
                <td className="td"><Price minor={p.annualPriceMinor} currency={p.currency} per="year" /></td>
                <td className="td">{number(p.subscribers)}</td>
                <td className="td"><StatusPill status={p.status} dot /></td>
                <td className="td">{money(p.amountGeneratedMinor, p.currency, { decimals: 0 })}</td>
              </tr>
            ))}
          </Table>
        )}
        {data && <p className="mt-4 text-[12px] text-figma-text-faint">Plan pricing and limits are defined by the billing configuration (models/Subscription.js) and shared with checkout, so changes are made there to keep checkout and the admin view in sync.</p>}
      </Card>
    </Shell>
  );
}

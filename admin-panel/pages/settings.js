import { useRouter } from 'next/router';
import Shell from '../components/Shell';
import { Card, ErrorState, PageHeader, Skeleton, cx } from '../components/ui';
import GeneralTab from '../components/settings/GeneralTab';
import AccountTab from '../components/settings/AccountTab';
import SecurityTab from '../components/settings/SecurityTab';
import AiModelsTab from '../components/settings/AiModelsTab';
import { adminApi } from '../lib/api';
import useAsync from '../lib/useAsync';
import useSession from '../store/session';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'security', label: 'Security' },
  { id: 'ai-models', label: 'AI Models' },
];

export default function SettingsPage() {
  const router = useRouter();
  const admin = useSession((s) => s.admin);
  const tab = TABS.some((t) => t.id === router.query.tab) ? router.query.tab : 'general';
  const needsView = tab === 'general' || tab === 'security';
  const { data: view, error, reload, setData } = useAsync(() => adminApi.settings(), [], { enabled: needsView });
  const canEdit = admin?.role === 'super_admin';

  const go = (id) => router.replace({ pathname: '/settings', query: id === 'general' ? {} : { tab: id } }, undefined, { shallow: true, scroll: false });

  let body;
  if (tab === 'account') body = <AccountTab />;
  else if (tab === 'ai-models') body = <AiModelsTab />;
  else if (error && !view) body = <Card><ErrorState message={error.message} onRetry={reload} /></Card>;
  else if (!view) body = <div className="space-y-5"><Skeleton className="h-[270px] w-full" /><Skeleton className="h-[330px] w-full" /></div>;
  else if (tab === 'general') body = <GeneralTab view={view} onSaved={setData} canEdit={canEdit} />;
  else body = <SecurityTab view={view} onSaved={setData} canEdit={canEdit} />;

  return (
    <Shell title="Settings">
      <PageHeader title="Settings" subtitle="Configure your platform, security policies, and admin preferences." />
      <div className="mb-8 flex gap-6 overflow-x-auto border-b border-white/15" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => go(t.id)}
            className={cx('-mb-px shrink-0 border-b-2 pb-3 text-[18px]', tab === t.id ? 'border-figma-accent font-medium text-figma-accent' : 'border-transparent text-figma-text-soft hover:text-white')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {body}
    </Shell>
  );
}

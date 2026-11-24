import { Bot } from 'lucide-react';
import { Card, EmptyState, ErrorState, InlineAlert, Pill, Table, TableSkeleton } from '../ui';
import { adminApi } from '../../lib/api';
import useAsync from '../../lib/useAsync';
import { number, pct, relative } from '../../lib/format';

/**
 * Read-only view of the AI models the product routes to (configured in code
 * and server env, see utils/llmProvider), with 30-day usage.
 */
export default function AiModelsTab() {
  const { data, error, reload, loading } = useAsync(() => adminApi.aiModels(), []);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-medium text-white">AI Models</h2>
          <p className="mt-2 text-[14px] text-figma-text-muted">Models available to AI agents and their usage over the last 30 days</p>
        </div>
        {data && <p className="text-[14px] text-figma-text-soft">{number(data.totalRunsLast30)} runs · 30 days</p>}
      </div>
      {data && !data.gatewayConfigured && (
        <div className="mt-4"><InlineAlert tone="warning">No model gateway key is configured on the server, so AI agents can’t run. Set the provider API key in the backend environment.</InlineAlert></div>
      )}
      <p className="mt-4 text-[12px] text-figma-text-faint">Model routing is configured on the server; changes require a deploy.</p>
      <div className="mt-5">
        {error && !data ? <ErrorState message={error.message} onRetry={reload} /> : (
          <Table minWidth={820} columns={[
            { label: 'Model' }, { label: 'Provider' }, { label: 'Role' }, { label: 'Status' }, { label: 'Runs (30d)' }, { label: 'Failure rate' }, { label: 'Last used' },
          ]}>
            {loading && !data ? <TableSkeleton rows={5} cols={7} /> : data.models.length === 0 ? (
              <tr><td colSpan={7}><EmptyState icon={Bot} title="No AI models configured" message="Models will appear here once a provider is configured on the server." /></td></tr>
            ) : data.models.map((m) => (
              <tr key={m.model}>
                <td className="td">
                  <p className="text-white">{m.name}</p>
                  <p className="font-mono text-[12px] text-figma-text-faint">{m.model}</p>
                </td>
                <td className="td capitalize">{m.provider}<span className="block text-[12px] normal-case text-figma-text-faint">via {m.gateway}</span></td>
                <td className="td capitalize">{m.role}</td>
                <td className="td"><Pill tone={m.available ? 'success' : 'muted'} size="sm">{m.available ? 'Available' : 'Unavailable'}</Pill></td>
                <td className="td">{number(m.runsLast30)}</td>
                <td className="td">{m.runsLast30 ? <span className={m.failureRate > 10 ? 'text-[#ff6b6b]' : ''}>{pct(m.failureRate)}</span> : '—'}</td>
                <td className="td text-figma-text-soft">{m.lastUsedAt ? relative(m.lastUsedAt) : 'Never'}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}

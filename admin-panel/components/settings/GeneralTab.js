import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Card, Field, InlineAlert, Pill, Spinner, Toggle } from '../ui';
import { adminApi } from '../../lib/api';
import { toast } from '../../store/toast';

const REGISTRATION_ROWS = [
  { key: 'allowRegistrations', title: 'Allow new registrations', text: 'New users can create individual or business accounts.' },
  { key: 'requireEmailVerification', title: 'Require email verification', text: 'Users must verify their email before creating a workspace.' },
  { key: 'allowBusinessAccounts', title: 'Allow business account creation', text: 'Enable company workspaces, team seats, and business billing.' },
  { key: 'maintenanceMode', title: 'Maintenance mode', text: 'Restrict platform access while performing scheduled maintenance.' },
];

function toForm(settings) {
  return {
    general: { ...settings.general },
    registration: { ...settings.registration },
    enforceAdmin2FA: settings.security.enforceAdmin2FA,
  };
}

export default function GeneralTab({ view, onSaved, canEdit }) {
  const initial = useMemo(() => toForm(view.settings), [view]);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setForm(initial); setErrors({}); setError(''); }, [initial]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const sec = view.settings.security;
  const setGeneral = (k, v) => { setForm((f) => ({ ...f, general: { ...f.general, [k]: v } })); setErrors((e) => ({ ...e, [k]: undefined })); };
  const setReg = (k, v) => setForm((f) => ({ ...f, registration: { ...f.registration, [k]: v } }));

  const validate = () => {
    const e = {};
    const g = form.general;
    if (!g.platformName.trim()) e.platformName = 'Platform name is required';
    if (!/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(g.platformUrl.trim())) e.platformUrl = 'Enter a valid domain, e.g. app.buildrshq.com';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.supportEmail.trim())) e.supportEmail = 'Enter a valid email address';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.billingEmail.trim())) e.billingEmail = 'Enter a valid email address';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setError('');
    try {
      const next = await adminApi.saveGeneral({
        general: Object.fromEntries(Object.entries(form.general).map(([k, v]) => [k, String(v).trim()])),
        registration: form.registration,
        security: { enforceAdmin2FA: form.enforceAdmin2FA },
      });
      onSaved(next);
      toast.success('Settings saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const protectedPosture = sec.enforceAdmin2FA && sec.minPasswordLength >= 10;
  return (
    <form onSubmit={save} noValidate>
      {!canEdit && <div className="mb-5"><InlineAlert tone="info">Only a super admin can change platform settings. You can view them here.</InlineAlert></div>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_388px]">
        <Card>
          <h2 className="text-[20px] font-medium text-white">Platform details</h2>
          <p className="mt-2 text-[14px] text-figma-text-muted">Your platform identity and primary contact information</p>
          <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
            {[
              ['platformName', 'Platform name', 'text', 80],
              ['platformUrl', 'Platform URL', 'text', 200],
              ['supportEmail', 'Support email', 'email', 200],
              ['billingEmail', 'Billing email', 'email', 200],
            ].map(([key, label, type, max]) => (
              <Field key={key} label={label} error={errors[key]}>
                <input
                  className="input h-10 bg-transparent"
                  type={type}
                  value={form.general[key]}
                  maxLength={max}
                  disabled={!canEdit}
                  onChange={(e) => setGeneral(key, e.target.value)}
                  aria-invalid={Boolean(errors[key])}
                />
              </Field>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-medium text-white">Security posture</h2>
            <Link href="/settings?tab=security" className="link inline-flex items-center gap-1 text-[14px] font-normal">Manage <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {protectedPosture ? <ShieldCheck className="h-5 w-5 text-[#56e5a9]" /> : <ShieldAlert className="h-5 w-5 text-figma-warning" />}
            <Pill tone={protectedPosture ? 'success' : 'warning'} size="sm">{protectedPosture ? 'Protected' : 'Needs attention'}</Pill>
          </div>
          <div className="mt-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-[14px] font-medium text-white">Enforce admin 2FA</p>
              <p className="mt-1 text-[12px] text-figma-text-soft">Required for all {view.adminCount} administrator{view.adminCount === 1 ? '' : 's'}.</p>
            </div>
            <Toggle checked={form.enforceAdmin2FA} onChange={(v) => setForm((f) => ({ ...f, enforceAdmin2FA: v }))} disabled={!canEdit} label="Enforce admin 2FA" />
          </div>
          <dl className="mt-5 space-y-3 text-[14px]">
            <div className="flex justify-between"><dt className="text-figma-text-muted">Session timeout</dt><dd className="text-white">{sec.sessionTimeoutMinutes} minutes</dd></div>
            <div className="flex justify-between"><dt className="text-figma-text-muted">Password minimum</dt><dd className="text-white">{sec.minPasswordLength} characters</dd></div>
            <div className="flex justify-between"><dt className="text-figma-text-muted">Special Characters</dt><dd className="text-white">{sec.requireSpecialChars ? 'Required' : 'Optional'}</dd></div>
          </dl>
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="text-[20px] font-medium text-white">Account &amp; registration</h2>
        <p className="mt-2 text-[14px] text-figma-text-muted">Control how users join and access {view.settings.general.platformName}</p>
        <ul className="mt-6 space-y-5">
          {REGISTRATION_ROWS.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-6">
              <div>
                <p className="text-[16px] text-white">{row.title}</p>
                <p className="mt-1 text-[12px] text-figma-text-soft">{row.text}</p>
              </div>
              <Toggle checked={Boolean(form.registration[row.key])} onChange={(v) => setReg(row.key, v)} disabled={!canEdit} label={row.title} />
            </li>
          ))}
        </ul>
        {form.registration.maintenanceMode && !initial.registration.maintenanceMode && (
          <div className="mt-5"><InlineAlert tone="warning">Maintenance mode blocks the product API for every user until you turn it off. The admin panel stays available.</InlineAlert></div>
        )}
      </Card>

      {error && <div className="mt-5"><InlineAlert>{error}</InlineAlert></div>}
      {canEdit && (
        <div className="mt-12 flex justify-end gap-4">
          <button type="button" className="btn-secondary w-[122px] text-[16px]" onClick={() => { setForm(initial); setErrors({}); setError(''); }} disabled={!dirty || saving}>Cancel</button>
          <button type="submit" className="btn-primary w-[176px] text-[16px]" disabled={!dirty || saving}>{saving ? <Spinner /> : 'Save Changes'}</button>
        </div>
      )}
    </form>
  );
}

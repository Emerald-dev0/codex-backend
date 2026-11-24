import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Card, Field, InlineAlert, Modal, Pill, Spinner, Toggle, cx } from '../ui';
import { adminApi } from '../../lib/api';
import useSession from '../../store/session';
import { toast } from '../../store/toast';

const METHOD_LABELS = { sms: 'SMS', authenticator: 'Authenticator App', email: 'Email' };
const TIMEOUTS = [15, 30, 60, 120, 240, 480];

function SectionHead({ title, subtitle }) {
  return (
    <div className="border-b border-white/10 px-4 py-4">
      <h2 className="text-[20px] font-semibold text-white">{title}</h2>
      <p className="mt-2 text-[15px] text-figma-text-faint">{subtitle}</p>
    </div>
  );
}

function Row({ title, text, children }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-white/15 bg-black px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[16px] text-white">{title}</p>
        <p className="mt-1.5 text-[12px] text-figma-text-soft">{text}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete, autoFocus, invalid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        className="input h-12 bg-black pr-12 text-[16px]"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={invalid}
      />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-white/80 hover:text-white" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
      </button>
    </div>
  );
}

function policyErrors(pw, policy) {
  const problems = [];
  if (pw.length < Math.max(8, policy.minPasswordLength)) problems.push(`at least ${Math.max(8, policy.minPasswordLength)} characters`);
  if (policy.requireNumbers && !/\d/.test(pw)) problems.push('a number');
  if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(pw)) problems.push('a special character');
  return problems;
}

function PasswordCard({ policy }) {
  const { admin, expire } = useSession();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isSocial = admin.authProvider && admin.authProvider !== 'local';

  const reset = () => { setOpen(false); setForm({ current: '', next: '', confirm: '' }); setErrors({}); setError(''); };
  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.current) errs.current = 'Enter your current password';
    const problems = policyErrors(form.next, policy);
    if (problems.length) errs.next = `Use ${problems.join(', ')}`;
    else if (form.next === form.current) errs.next = 'Choose a password you haven’t just used';
    if (form.confirm !== form.next) errs.confirm = 'Passwords don’t match';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError('');
    try {
      await adminApi.changePassword(form.current, form.next);
      toast.success('Password changed. Sign in with your new password.');
      // The backend revokes every session issued under the old password.
      expire('Password changed. Please sign in with your new password.');
    } catch (err) {
      if (/current password/i.test(err.message)) setErrors({ current: err.message });
      else setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Card className="p-0">
      <SectionHead title="Password" subtitle="Manage your password settings" />
      <div className="px-4 pb-9 pt-10">
        {isSocial ? (
          <InlineAlert tone="info">You sign in with Google, so there’s no BuildrsHQ password to manage.</InlineAlert>
        ) : !open ? (
          <>
            <span className="label tracking-wide">Password</span>
            <div className="flex h-12 items-center rounded-lg border border-white/15 bg-black px-4 text-[22px] tracking-[0.35em] text-white" aria-label="Password hidden">
              ********
            </div>
            <div className="mt-[70px] flex justify-end gap-8">
              <button type="button" className="btn-secondary w-[122px] text-[16px]" disabled>Cancel</button>
              <button type="button" className="btn-primary w-[176px] text-[16px]" onClick={() => setOpen(true)}>New Password</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <Field label="Current password" error={errors.current}>
              <PasswordInput value={form.current} onChange={(v) => setForm({ ...form, current: v })} autoComplete="current-password" autoFocus invalid={Boolean(errors.current)} />
            </Field>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="New password" error={errors.next} hint={`At least ${Math.max(8, policy.minPasswordLength)} characters${policy.requireNumbers ? ', a number' : ''}${policy.requireSpecialChars ? ', a special character' : ''}.`}>
                <PasswordInput value={form.next} onChange={(v) => setForm({ ...form, next: v })} autoComplete="new-password" invalid={Boolean(errors.next)} />
              </Field>
              <Field label="Confirm new password" error={errors.confirm}>
                <PasswordInput value={form.confirm} onChange={(v) => setForm({ ...form, confirm: v })} autoComplete="new-password" invalid={Boolean(errors.confirm)} />
              </Field>
            </div>
            <p className="text-[12px] text-figma-text-muted">Changing your password signs you out everywhere, including this session.</p>
            {error && <InlineAlert>{error}</InlineAlert>}
            <div className="flex justify-end gap-8 pt-6">
              <button type="button" className="btn-secondary w-[122px] text-[16px]" onClick={reset} disabled={busy}>Cancel</button>
              <button type="submit" className="btn-primary w-[176px] text-[16px]" disabled={busy}>{busy ? <Spinner /> : 'Update Password'}</button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

function AuthenticatorModal({ open, mode, onClose, onDone }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setCode('');
    setError('');
    setSetup(null);
    if (mode === 'enable') {
      setBusy(true);
      adminApi.totpSetup().then(setSetup).catch((err) => setError(err.message)).finally(() => setBusy(false));
    }
  }, [open, mode]);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from your app'); return; }
    setBusy(true);
    setError('');
    try {
      const res = mode === 'enable' ? await adminApi.totpConfirm(code) : await adminApi.totpDisable(code);
      onDone(res.totpEnabled);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} width="max-w-[560px]" icon={<KeyRound className="h-6 w-6" />}
      title={<span className="text-[24px]">{mode === 'enable' ? 'Set up authenticator app' : 'Turn off authenticator app'}</span>}
      subtitle={mode === 'enable' ? 'Add BuildrsHQ to Google Authenticator, 1Password, Authy or any TOTP app.' : 'Enter a current code from your authenticator app to confirm.'}>
      <form onSubmit={submit} noValidate className="space-y-5">
        {mode === 'enable' && (
          !setup ? (busy ? <div className="flex justify-center py-6"><Spinner className="h-6 w-6 text-figma-accent" /></div> : null) : (
            <div className="space-y-3 rounded-lg bg-[#0a0d15] p-4 text-[13px]">
              <p className="text-figma-text-soft">1. In your app, choose <span className="text-white">Enter a setup key</span> and paste:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-black px-3 py-2 font-mono text-[14px] tracking-wider text-figma-accent">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                <button type="button" className="btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.success('Setup key copied'))} aria-label="Copy setup key"><Copy className="h-4 w-4" /></button>
              </div>
              <p className="text-figma-text-soft">On this device you can also <a className="link" href={setup.otpauthUri}>open it in your authenticator app</a>.</p>
              <p className="text-figma-text-soft">2. Enter the 6-digit code your app shows.</p>
            </div>
          )
        )}
        <Field label="Code">
          <input className="input h-12 tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} disabled={mode === 'enable' && !setup} />
        </Field>
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={mode === 'enable' ? 'btn-primary min-w-[140px]' : 'btn-danger min-w-[140px]'} disabled={busy || (mode === 'enable' && !setup)}>
            {busy && (mode !== 'enable' || setup) ? <Spinner /> : mode === 'enable' ? 'Verify & turn on' : 'Turn off'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MyTwoFactorCard({ allowedMethods }) {
  const { twoFactor, load } = useSession();
  const [modal, setModal] = useState(null);
  const enabled = Boolean(twoFactor?.totpEnabled);
  const authenticatorAllowed = allowedMethods.includes('authenticator');
  const emailAllowed = allowedMethods.includes('email');
  return (
    <Card className="p-0">
      <SectionHead title="Your two-factor authentication" subtitle="How you confirm it’s you when signing in to the admin panel" />
      <div className="space-y-4 px-4 pb-8 pt-6">
        <Row title="Authenticator App" text={enabled ? 'Codes come from your authenticator app.' : 'Use a TOTP app instead of email codes.'}>
          <div className="flex items-center gap-3">
            <Pill tone={enabled ? 'success' : 'muted'} size="sm">{enabled ? 'On' : 'Off'}</Pill>
            {enabled ? (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setModal('disable')}>Turn off</button>
            ) : (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setModal('enable')} disabled={!authenticatorAllowed} title={!authenticatorAllowed ? 'Enable the Authenticator App method above first' : undefined}>Set up</button>
            )}
          </div>
        </Row>
        <Row title="Email codes" text={emailAllowed ? 'A 6-digit code is sent to your email when an authenticator isn’t set up.' : 'Email codes are turned off for this platform.'}>
          <Pill tone={emailAllowed ? 'success' : 'muted'} size="sm">{emailAllowed ? 'Available' : 'Off'}</Pill>
        </Row>
        {twoFactor?.enforced && !enabled && !emailAllowed && (
          <InlineAlert tone="warning">Admin 2FA is enforced but no method you can use is enabled. Set up an authenticator app so you aren’t locked out.</InlineAlert>
        )}
      </div>
      <AuthenticatorModal
        open={Boolean(modal)}
        mode={modal}
        onClose={() => setModal(null)}
        onDone={async (on) => { setModal(null); await load(); toast.success(on ? 'Authenticator app turned on' : 'Authenticator app turned off'); }}
      />
    </Card>
  );
}

function toForm(s) {
  return {
    requireUser2FA: s.requireUser2FA,
    twoFactorMethods: [...s.twoFactorMethods],
    minPasswordLength: s.minPasswordLength,
    requireSpecialChars: s.requireSpecialChars,
    requireNumbers: s.requireNumbers,
    sessionTimeoutMinutes: s.sessionTimeoutMinutes,
  };
}

export default function SecurityTab({ view, onSaved, canEdit }) {
  const initial = useMemo(() => toForm(view.settings.security), [view]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setForm(initial); setError(''); }, [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const capabilities = view.capabilities.twoFactorMethods;

  const toggleMethod = (id) => setForm((f) => ({
    ...f,
    twoFactorMethods: f.twoFactorMethods.includes(id) ? f.twoFactorMethods.filter((m) => m !== id) : [...f.twoFactorMethods, id],
  }));
  const stepLength = (delta) => setForm((f) => ({ ...f, minPasswordLength: Math.min(64, Math.max(8, Number(f.minPasswordLength) + delta)) }));

  const save = async (e) => {
    e.preventDefault();
    if (form.requireUser2FA && form.twoFactorMethods.length === 0) { setError('Choose at least one 2FA method when 2FA is required'); return; }
    if (form.twoFactorMethods.length === 0) { setError('Keep at least one 2FA method available'); return; }
    setSaving(true);
    setError('');
    try {
      onSaved(await adminApi.saveSecurity({ ...form, minPasswordLength: Number(form.minPasswordLength) }));
      toast.success('Security settings saved');
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-8">
      <PasswordCard policy={view.settings.security} />

      <Card className="p-0">
        <SectionHead title="Security Settings" subtitle="Manage platform security setting" />
        <form onSubmit={save} noValidate className="space-y-6 px-5 pb-6 pt-6">
          {!canEdit && <InlineAlert tone="info">Only a super admin can change platform security settings.</InlineAlert>}
          <Row title="Two-Factor Authentication" text="Require all users to use 2FA for login">
            <Toggle checked={form.requireUser2FA} onChange={(v) => setForm({ ...form, requireUser2FA: v })} disabled={!canEdit} label="Require 2FA for all users" />
          </Row>
          <Row title="Available 2FA Method" text="Choose preferred 2FA Method">
            <div className="flex flex-wrap gap-4">
              {capabilities.map(({ id, available }) => {
                const on = form.twoFactorMethods.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    disabled={!canEdit || (!available && !on)}
                    title={!available ? 'No SMS provider is configured' : undefined}
                    onClick={() => toggleMethod(id)}
                    className={cx(
                      'h-10 rounded-lg border px-4 text-[18px] transition-colors disabled:cursor-not-allowed',
                      on ? 'border-[#1f4c78] bg-[#0f1a26] text-figma-accent' : 'border-transparent bg-[#0f131c] text-figma-text-ghost hover:text-figma-text-muted',
                      !available && 'opacity-50'
                    )}
                  >
                    {METHOD_LABELS[id] || id}
                  </button>
                );
              })}
            </div>
          </Row>
          {capabilities.some((c) => !c.available) && <p className="-mt-3 text-[12px] text-figma-text-faint">SMS needs an SMS provider configured on the server before it can be offered.</p>}
          <Row title="Minimum Password Length" text="Password figure">
            <div className="flex items-center gap-3">
              <input
                className="h-10 w-12 rounded-lg bg-[#0f131c] text-center text-[18px] text-white focus:outline-none focus:ring-1 focus:ring-figma-accent/50 disabled:opacity-60"
                inputMode="numeric"
                aria-label="Minimum password length"
                value={form.minPasswordLength}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, minPasswordLength: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                onBlur={() => stepLength(0)}
              />
              <div className="flex flex-col">
                <button type="button" className="text-white disabled:opacity-40" onClick={() => stepLength(1)} disabled={!canEdit || form.minPasswordLength >= 64} aria-label="Increase"><ChevronUp className="h-4 w-4 fill-current" /></button>
                <button type="button" className="text-white disabled:opacity-40" onClick={() => stepLength(-1)} disabled={!canEdit || form.minPasswordLength <= 8} aria-label="Decrease"><ChevronDown className="h-4 w-4 fill-current" /></button>
              </div>
            </div>
          </Row>
          <Row title="Require Special Characters" text="Password must contain special characters (“£$%&)">
            <Toggle checked={form.requireSpecialChars} onChange={(v) => setForm({ ...form, requireSpecialChars: v })} disabled={!canEdit} label="Require special characters" />
          </Row>
          <Row title="Require Numerical Figures" text="Password must contain at least one number">
            <Toggle checked={form.requireNumbers} onChange={(v) => setForm({ ...form, requireNumbers: v })} disabled={!canEdit} label="Require numbers" />
          </Row>
          <Row title="Admin Session Timeout" text="Sign administrators out after this much inactivity">
            <select className="input h-10 w-[150px] bg-[#0f131c]" value={form.sessionTimeoutMinutes} disabled={!canEdit} onChange={(e) => setForm({ ...form, sessionTimeoutMinutes: Number(e.target.value) })} aria-label="Admin session timeout">
              {[...new Set([...TIMEOUTS, form.sessionTimeoutMinutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}</option>
              ))}
            </select>
          </Row>
          {error && <InlineAlert>{error}</InlineAlert>}
          {canEdit && (
            <div className="flex justify-end gap-8 pt-6">
              <button type="button" className="btn-secondary w-[122px] text-[16px]" onClick={() => { setForm(initial); setError(''); }} disabled={!dirty || saving}>Cancel</button>
              <button type="submit" className="btn-primary w-[176px] text-[16px]" disabled={!dirty || saving}>{saving ? <Spinner /> : 'Save Changes'}</button>
            </div>
          )}
        </form>
      </Card>

      <MyTwoFactorCard allowedMethods={view.settings.security.twoFactorMethods} />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { User as UserIcon } from 'lucide-react';
import { Card, Field, InlineAlert, Modal, Spinner } from '../ui';
import { adminApi } from '../../lib/api';
import useSession from '../../store/session';
import { toast } from '../../store/toast';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitName(full = '') {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

/** Email change: confirm with the current password, then a code sent to the new address. */
function EmailChangeModal({ open, email, onClose, onDone, isSocial }) {
  const [step, setStep] = useState('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) { setStep('password'); setPassword(''); setCode(''); setChallenge(null); setError(''); }
  }, [open]);

  const request = async (e) => {
    e?.preventDefault();
    if (!isSocial && !password) { setError('Enter your current password'); return; }
    setBusy(true);
    setError('');
    try {
      const data = await adminApi.requestEmailChange(email, password);
      setChallenge(data);
      setStep('code');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const confirm = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code'); return; }
    setBusy(true);
    setError('');
    try {
      const data = await adminApi.confirmEmailChange(challenge.challengeToken, code.trim());
      onDone(data.admin);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} width="max-w-[520px]" title={<span className="text-[24px]">Change email address</span>}
      subtitle={step === 'password' ? `Confirm it’s you to change your sign-in email to ${email}.` : `We sent a 6-digit code to ${challenge?.destination || email}.`}>
      {step === 'password' ? (
        <form onSubmit={request} noValidate>
          {!isSocial && (
            <Field label="Current password">
              <input className="input h-12" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
          )}
          {error && <div className="mt-3"><InlineAlert>{error}</InlineAlert></div>}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary min-w-[140px]" disabled={busy}>{busy ? <Spinner /> : 'Send code'}</button>
          </div>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate>
          <Field label="Verification code">
            <input className="input h-12 tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
          {error && <div className="mt-3"><InlineAlert>{error}</InlineAlert></div>}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button type="button" className="link text-[13px]" onClick={() => request()} disabled={busy}>Resend code</button>
            <div className="flex gap-3">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn-primary min-w-[140px]" disabled={busy}>{busy ? <Spinner /> : 'Confirm email'}</button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function AccountTab() {
  const { admin, patchAdmin } = useSession();
  const initial = { ...splitName(admin.fullName), email: admin.email };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [emailModal, setEmailModal] = useState(false);
  const fileRef = useRef(null);
  const isSocial = admin.authProvider && admin.authProvider !== 'local';

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setForm({ ...splitName(admin.fullName), email: admin.email }); }, [admin.fullName, admin.email]);

  const fullName = `${form.first.trim()} ${form.last.trim()}`.trim();
  const nameChanged = fullName !== (admin.fullName || '').trim();
  const emailChanged = form.email.trim().toLowerCase() !== admin.email.toLowerCase();
  const dirty = nameChanged || emailChanged;

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.first.trim()) errs.first = 'First name is required';
    if (fullName.length > 100) errs.last = 'Name must be 100 characters or fewer';
    if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email address';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setError('');
    if (nameChanged) {
      setSaving(true);
      try {
        const res = await adminApi.updateProfile(fullName);
        patchAdmin({ fullName: res.user?.fullName || fullName });
        if (!emailChanged) toast.success('Profile updated');
      } catch (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    if (emailChanged) setEmailModal(true);
  };

  const upload = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { toast.error('Choose a JPEG, PNG, GIF or WebP image'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Images must be 5 MB or smaller'); return; }
    setUploading(true);
    try {
      const res = await adminApi.uploadPhoto(file);
      patchAdmin({ profilePicture: res.profilePicture });
      toast.success('Profile picture updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Card className="p-0">
      <div className="border-b border-white/10 px-4 py-4">
        <h2 className="text-[20px] font-semibold text-white">Profile</h2>
        <p className="mt-2 text-[15px] text-figma-text-faint">Manage your profile settings</p>
      </div>
      <form onSubmit={save} noValidate className="px-4 pb-9 pt-10">
        <div className="flex flex-col gap-4 rounded-lg border border-white/15 bg-black px-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:pr-8">
          <div className="flex min-w-0 items-center gap-6">
            {admin.profilePicture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={admin.profilePicture} alt="" className="h-[90px] w-[90px] shrink-0 rounded-full object-cover" />
            ) : (
              <span className="inline-flex h-[90px] w-[90px] shrink-0 items-center justify-center rounded-full bg-[#1d263b]"><UserIcon className="h-11 w-11 fill-black text-black" /></span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[20px] text-white">{admin.fullName || 'Your name'}</p>
              <p className="mt-1 truncate text-[16px] text-white">{admin.email}</p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          <button type="button" className="btn h-11 border border-[#1f4c78] bg-[#0f1a26] text-[18px] text-figma-accent hover:bg-[#13202f]" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : 'Update Profile Pic'}
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <Field label={<span className="tracking-wide">First Name</span>} error={errors.first}>
            <input className="input h-12 bg-black text-[18px]" value={form.first} maxLength={60} autoComplete="given-name" onChange={(e) => setForm({ ...form, first: e.target.value })} />
          </Field>
          <Field label={<span className="tracking-wide">Last Name</span>} error={errors.last}>
            <input className="input h-12 bg-black text-[18px]" value={form.last} maxLength={60} autoComplete="family-name" onChange={(e) => setForm({ ...form, last: e.target.value })} />
          </Field>
          <Field label={<span className="tracking-wide">Email Address</span>} error={errors.email} hint={isSocial ? 'Your email comes from your Google sign-in and can’t be changed here.' : emailChanged ? 'We’ll send a verification code to the new address.' : undefined} className="sm:col-span-2">
            <input className="input h-12 bg-black text-[18px]" type="email" value={form.email} autoComplete="email" disabled={isSocial} title={isSocial ? 'Your email comes from your Google sign-in' : undefined} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
        {error && <div className="mt-5"><InlineAlert>{error}</InlineAlert></div>}
        <div className="mt-16 flex justify-end gap-8">
          <button type="button" className="btn-secondary w-[122px] text-[16px]" disabled={!dirty || saving} onClick={() => { setForm(initial); setErrors({}); setError(''); }}>Cancel</button>
          <button type="submit" className="btn-primary w-[176px] text-[16px]" disabled={!dirty || saving}>{saving ? <Spinner /> : 'Save Changes'}</button>
        </div>
      </form>
      <EmailChangeModal
        open={emailModal}
        email={form.email.trim().toLowerCase()}
        isSocial={isSocial}
        onClose={() => setEmailModal(false)}
        onDone={(updated) => { patchAdmin(updated); setEmailModal(false); toast.success('Email address updated'); }}
      />
    </Card>
  );
}

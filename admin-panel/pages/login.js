import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { adminApi, getToken } from '../lib/api';
import useSession from '../store/session';
import { BrandMark } from '../components/Shell';
import { Field, InlineAlert, Spinner } from '../components/ui';
import { toast } from '../store/toast';

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

export default function Login() {
  const router = useRouter();
  const { status, load, signIn, expiredMessage } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (status === 'idle' && getToken()) load(); }, [status, load]);
  useEffect(() => { if (status === 'ready') router.replace(safeNext(router.query.next)); }, [status, router]);

  const finish = async (data) => {
    const me = await signIn(data.token, data.admin);
    if (!me) { setError('Signed in, but your admin session could not be loaded. Please try again.'); return; }
    router.replace(safeNext(router.query.next));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Enter your email and password'); return; }
    setBusy(true);
    try {
      const data = await adminApi.login(email.trim(), password);
      if (data.requires2FA) {
        setChallenge(data);
        setCode('');
      } else {
        await finish(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code'); return; }
    setBusy(true);
    try {
      await finish(await adminApi.verify2fa(challenge.challengeToken, code));
    } catch (err) {
      setError(err.message);
      if (err.code === 'CHALLENGE_INVALID') setChallenge(null);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    try {
      const r = await adminApi.resend2fa(challenge.challengeToken);
      toast.success(`A new code was sent to ${r.destination}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <Head><title>Sign in · BuildrsHQ Admin</title></Head>
      <div className="flex min-h-screen flex-col bg-figma-bg">
        <header className="flex h-[96px] items-center border-b border-white/10 px-5"><BrandMark /></header>
        <main className="flex flex-1 items-start justify-center px-4 py-16 sm:py-24">
          <div className="w-full max-w-[460px]">
            <p className="eyebrow mb-3">Platform Administration</p>
            <h1 className="text-[32px] font-semibold text-white">{challenge ? 'Verify it’s you' : 'Admin sign in'}</h1>
            <p className="mt-3 text-[15px] text-figma-text-soft">
              {challenge
                ? (challenge.method === 'authenticator'
                  ? 'Enter the 6-digit code from your authenticator app.'
                  : `We sent a 6-digit code to ${challenge.destination}.`)
                : 'Sign in with your BuildrsHQ staff account to manage the platform.'}
            </p>

            <div className="card mt-8 p-6">
              {expiredMessage && !error && !challenge && <div className="mb-5"><InlineAlert tone="warning">{expiredMessage}</InlineAlert></div>}
              {error && <div className="mb-5"><InlineAlert>{error}</InlineAlert></div>}
              {!challenge ? (
                <form onSubmit={submit} noValidate className="space-y-5">
                  <Field label="Email Address">
                    <input className="input h-12" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoFocus />
                  </Field>
                  <Field label="Password">
                    <div className="relative">
                      <input className="input h-12 pr-11" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
                      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white" aria-label={show ? 'Hide password' : 'Show password'}>
                        {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </Field>
                  <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
                </form>
              ) : (
                <form onSubmit={verify} noValidate className="space-y-5">
                  <Field label="Verification code">
                    <input
                      className="input h-12 text-center text-[22px] tracking-[0.5em]"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      autoFocus
                      aria-label="6-digit verification code"
                    />
                  </Field>
                  <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : 'Verify and continue'}</button>
                  <div className="flex items-center justify-between text-[13px]">
                    <button type="button" className="text-figma-text-soft hover:text-white" onClick={() => { setChallenge(null); setError(''); }}>← Back to sign in</button>
                    {challenge.method === 'email' && <button type="button" className="link" onClick={resend}>Resend code</button>}
                  </div>
                </form>
              )}
            </div>
            <p className="mt-6 flex items-center gap-2 text-[12px] text-figma-text-faint">
              <ShieldCheck className="h-4 w-4" /> Admin sessions end after a period of inactivity. Access is restricted to platform staff.
            </p>
          </div>
        </main>
      </div>
    </>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckIcon } from '../components/Icons';
import { InstallCard } from '../components/Install';
import { BackButton } from '../components/ui';
import { SERVER_MODE, errorMessage, signIn, signUp } from '../lib/store';

export function Welcome() {
  return (
    <main className="screen green">
      <div className="spacer stack center" style={{ justifyContent: 'center', gap: 20 }}>
        <div
          style={{ width: 88, height: 88, borderRadius: 26, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <CheckIcon size={44} color="#15803D" width={2.2} />
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>Kazikwanza</h1>
        <p style={{ fontSize: 18, lineHeight: 1.5, color: '#DCFCE7' }}>
          Do the work first.
          <br />
          Then scroll.
        </p>
      </div>
      <InstallCard />
      <div className="actions" style={{ gap: 12 }}>
        <Link to="/signup" className="btn btn-white">
          Get started
        </Link>
        <Link to="/signin" className="link-btn white">
          I already have an account
        </Link>
      </div>
    </main>
  );
}

export function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Use at least 6 characters for your password');
      return;
    }
    setBusy(true);
    try {
      await signUp({ name, email, password });
      navigate('/onboarding/mode', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="screen" onSubmit={submit} noValidate>
      <BackButton fallback="/welcome" />
      <h1 className="h1">Create your account</h1>
      <div className="stack" style={{ gap: 16 }}>
        <div className="field">
          <label className="label" htmlFor="name">
            Name
          </label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="email">
            Email or phone
          </label>
          <input
            id="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="spacer" />
      <div className="actions-12">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Create account
        </button>
        <span className="note">
          {SERVER_MODE ? 'Your verifier and family see your tasks on their own phones.' : 'Your account and tasks are stored on this phone.'}
        </span>
      </div>
    </form>
  );
}

export function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn({ email, password });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="screen" onSubmit={submit} noValidate>
      <BackButton fallback="/welcome" />
      <h1 className="h1">Welcome back</h1>
      <div className="stack" style={{ gap: 16 }}>
        <div className="field">
          <label className="label" htmlFor="signin-email">
            Email or phone
          </label>
          <input
            id="signin-email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="signin-password">
            Password
          </label>
          <input
            id="signin-password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="spacer" />
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Sign in
        </button>
        <Link to="/signup" className="link-btn">
          Create an account instead
        </Link>
      </div>
    </form>
  );
}

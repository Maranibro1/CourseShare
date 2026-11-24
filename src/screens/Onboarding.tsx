import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckIcon, ShieldIcon } from '../components/Icons';
import { BackButton, StepHeader } from '../components/ui';
import { AppList } from '../components/AppList';
import { setDeviceOwner } from '../lib/device';
import { appLink } from '../lib/install';
import { isContactOf, isValidPersonContact } from '../lib/logic';
import { KaziLock, isNativeAndroid, useLockStatus } from '../lib/native';
import { formatClock, formatClockShort } from '../lib/time';
import { act, toast, useAccount } from '../lib/store';
import type { Mode } from '../lib/types';

const MODES: { id: Mode; title: string; body: string }[] = [
  { id: 'personal', title: 'For myself', body: 'Earn scrolls by finishing your own tasks.' },
  { id: 'parent', title: 'As a parent', body: 'Set tasks for your child and approve their work.' },
  { id: 'child', title: 'As a child', body: 'Join your family with a code from your parent.' },
];

export function ChooseMode() {
  const me = useAccount();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(me.mode);

  async function next() {
    if (mode === 'child') {
      // The child becomes "child" mode once a parent's code links them.
      if ((await act('updateProfile', { patch: { mode: 'personal' } })).ok) navigate('/join');
      return;
    }
    if (mode === 'parent') {
      // Parents manage their child's phone; nothing is locked on their own until they choose to.
      const patch = { mode: 'parent', onboarded: true, lockedApps: [], verifier: null };
      if ((await act('updateProfile', { patch })).ok) navigate('/family/link', { replace: true });
      return;
    }
    if ((await act('updateProfile', { patch: { mode: 'personal' } })).ok) navigate('/onboarding/permissions');
  }

  return (
    <main className="screen">
      <StepHeader step={1} of={4} fallback="/signup" />
      <h1 className="h1">How will you use Kazikwanza?</h1>
      <div className="stack-12" role="radiogroup" aria-label="Mode">
        {MODES.map((m) => (
          <label key={m.id} className={`choice${mode === m.id ? ' selected' : ''}`}>
            <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
            <div className="stack-4">
              <span className="strong">{m.title}</span>
              <span className="muted" style={{ fontSize: 14 }}>
                {m.body}
              </span>
            </div>
          </label>
        ))}
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={next}>
        Continue
      </button>
    </main>
  );
}

type Step = 'usage' | 'accessibility';

/** The phone setting each permission lives in, and what to tap there. */
const STEPS: { key: Step; title: string; why: string; how: string }[] = [
  {
    key: 'usage',
    title: 'Usage access',
    why: 'Lets Kazikwanza see which app is open, so it can lock it.',
    how: 'Find Kazikwanza in the list and switch on “Permit usage access”, then come back.',
  },
  {
    key: 'accessibility',
    title: 'App lock',
    why: 'Counts each swipe in your scrolling apps and times games.',
    how: 'Tap “Installed apps” (or “Downloaded apps”), then “Kazikwanza app lock”, switch it on and tap Allow. Then come back.',
  },
];

/**
 * One button turns on everything the phone lock needs. On Android it opens
 * each settings page in turn, moving on by itself as each one is switched
 * on, then carries on with setup. Elsewhere it's a single tap.
 */
export function Permissions() {
  const me = useAccount();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const forChild = params.get('for') === 'child';
  const phone = useLockStatus();
  const [started, setStarted] = useState(false);
  const [tries, setTries] = useState<Record<Step, number>>({ usage: 0, accessibility: 0 });
  const [saving, setSaving] = useState(false);
  const finished = useRef(false);
  const usage = isNativeAndroid ? !!phone?.usage : false;
  const accessibility = isNativeAndroid ? !!phone?.accessibility : false;
  const on: Record<Step, boolean> = { usage, accessibility };
  const current = STEPS.find((x) => !on[x.key]) ?? null;

  async function finish(permissions: { usage: boolean; accessibility: boolean }) {
    if (finished.current) return;
    finished.current = true;
    setSaving(true);
    const patch = forChild ? { permissions, onboarded: true } : { permissions };
    const { ok } = await act('updateProfile', { patch });
    setSaving(false);
    if (!ok) {
      finished.current = false;
      return;
    }
    // This phone now enforces this account's rules.
    setDeviceOwner(me.id);
    navigate(forChild ? '/child' : '/onboarding/apps', { replace: forChild });
  }

  function openStep(step: Step) {
    setTries((t) => ({ ...t, [step]: t[step] + 1 }));
    const open = step === 'usage' ? KaziLock.openUsageAccessSettings() : KaziLock.openAccessibilitySettings();
    open.catch(() => toast('Open your phone’s Settings and allow Kazikwanza there.'));
  }

  function turnOn() {
    if (!isNativeAndroid) {
      // Nothing to switch on outside the Android app; the web version keeps time itself.
      void finish({ usage: true, accessibility: true });
      return;
    }
    setStarted(true);
    if (current) openStep(current.key);
    else void finish({ usage, accessibility });
  }

  // Coming back from Settings: open the next page by itself, and carry on once everything is on.
  const lastSeen = useRef<string>('');
  useEffect(() => {
    if (!isNativeAndroid || !started || !phone) return;
    const key = `${usage}-${accessibility}`;
    if (key === lastSeen.current) return;
    const before = lastSeen.current;
    lastSeen.current = key;
    if (usage && accessibility) {
      void finish({ usage, accessibility });
    } else if (before && current && tries[current.key] === 0) {
      openStep(current.key);
    }
  }, [phone, started, usage, accessibility]); // eslint-disable-line react-hooks/exhaustive-deps

  const restricted = isNativeAndroid && current?.key === 'accessibility' && tries.accessibility > 0;

  return (
    <main className="screen">
      {forChild ? <BackButton fallback="/join" /> : <StepHeader step={2} of={4} fallback="/onboarding/mode" />}
      <div className="stack-8">
        <h1 className="h1">Turn on the app lock</h1>
        <p className="lead">
          {isNativeAndroid
            ? 'One tap. Kazikwanza opens each setting for you; switch it on, come back, and it carries on by itself.'
            : 'Kazikwanza locks your apps and counts your scrolls. On Android, the app asks your phone for two settings at this step.'}
        </p>
      </div>
      <ol className="perm-steps">
        {STEPS.map((x, i) => {
          const done = on[x.key];
          const active = isNativeAndroid && started && current?.key === x.key;
          return (
            <li key={x.key} className={`perm-step${done ? ' done' : ''}${active ? ' active' : ''}`}>
              <span className="perm-num" aria-hidden="true">
                {done ? <CheckIcon size={14} color="#fff" width={3} /> : i + 1}
              </span>
              <div className="stack-4" style={{ flexGrow: 1 }}>
                <span className="strong">
                  {x.title}
                  {done && <span className="green-text"> · On</span>}
                </span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {active ? x.how : x.why}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {restricted && (
        <div className="redo-note" role="status">
          <strong>Switch greyed out, or a “Restricted setting” message?</strong> Android blocks this for apps installed from a file. Tap{' '}
          <strong>Open App info</strong> below, then the <strong>⋮</strong> menu at the top right, and choose <strong>Allow restricted settings</strong>. Come back
          and tap the green button again.
          <button className="btn btn-secondary" style={{ marginTop: 10, height: 44 }} onClick={() => KaziLock.openAppInfo().catch(() => undefined)}>
            Open App info
          </button>
        </div>
      )}
      <div className="info">
        <ShieldIcon size={20} color="#15803D" />
        <span>We never read your messages, posts or what you watch. We only count scrolls and time.</span>
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={turnOn} disabled={saving}>
        {saving ? 'Saving…' : !isNativeAndroid || !current ? 'Turn on app lock' : started ? `Open ${current.title} settings` : 'Turn on app lock'}
      </button>
    </main>
  );
}

export function PickApps() {
  const me = useAccount();
  const navigate = useNavigate();
  const [locked, setLocked] = useState<string[]>(me.lockedApps);
  const n = locked.length;
  return (
    <main className="screen gap-20">
      <StepHeader step={3} of={4} fallback="/onboarding/permissions" />
      <h1 className="h1">Which apps should be locked?</h1>
      <AppList
        owner={{ phoneApps: me.phoneApps, lockedApps: locked }}
        isOn={(id) => locked.includes(id)}
        onToggle={(a, on) => setLocked(on ? [...locked, a.id] : locked.filter((x) => x !== a.id))}
        control="check"
      />
      <div className="spacer" />
      <button
        className="btn btn-primary"
        disabled={n === 0}
        onClick={async () => {
          if ((await act('updateProfile', { patch: { lockedApps: locked } })).ok) navigate('/onboarding/unlock');
        }}
      >
        {n === 0 ? 'Pick at least 1 app' : `Lock ${n} app${n === 1 ? '' : 's'}`}
      </button>
    </main>
  );
}

const PRESET_TIMES = ['12:00', '13:00', '17:00', '20:00'];

export function UnlockTimePicker({
  time,
  onTime,
  noFree,
  onNoFree,
}: {
  time: string;
  onTime: (t: string) => void;
  noFree: boolean;
  onNoFree: (v: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        /* fall through to focus */
      }
    }
    el.focus();
  };
  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        disabled={noFree}
        aria-label="Choose another time"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 140,
          borderRadius: 20,
          background: '#F0FDF4',
          border: 'none',
          opacity: noFree ? 0.45 : 1,
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1.5, color: '#15803D' }}>{noFree ? 'Off' : formatClock(time)}</span>
        {!noFree && <span className="small">Tap to pick another time</span>}
        <input
          ref={inputRef}
          type="time"
          value={time}
          onChange={(e) => e.target.value && onTime(e.target.value)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
      </button>
      <div className="option-grid">
        {PRESET_TIMES.map((t) => (
          <button
            key={t}
            type="button"
            className={`option small-text${!noFree && time === t ? ' selected' : ''}`}
            onClick={() => onTime(t)}
            disabled={noFree}
            aria-pressed={!noFree && time === t}
          >
            {formatClockShort(t)}
          </button>
        ))}
      </div>
      <label className="row" style={{ minHeight: 56, borderTop: '1px solid #E4E4E7', borderBottom: '1px solid #E4E4E7', cursor: 'pointer' }}>
        <span>No free unlock, only earn scrolls</span>
        <input type="checkbox" className="check" checked={noFree} onChange={(e) => onNoFree(e.target.checked)} />
      </label>
    </>
  );
}

export function UnlockTime() {
  const me = useAccount();
  const navigate = useNavigate();
  const [time, setTime] = useState(me.unlockTime ?? '13:00');
  const [noFree, setNoFree] = useState(me.unlockTime === null);
  return (
    <main className="screen">
      <StepHeader step={4} of={4} fallback="/onboarding/apps" />
      <div className="stack-8">
        <h1 className="h1">When should apps unlock anyway?</h1>
        <p className="lead">Even if your tasks aren't done, your apps open at this time each day.</p>
      </div>
      <UnlockTimePicker time={time} onTime={setTime} noFree={noFree} onNoFree={setNoFree} />
      <div className="spacer" />
      <button
        className="btn btn-primary"
        onClick={async () => {
          if ((await act('updateProfile', { patch: { unlockTime: noFree ? null : time } })).ok) navigate('/onboarding/verifier');
        }}
      >
        Continue
      </button>
    </main>
  );
}

const RELATIONS = ['Friend', 'Sister', 'Brother', 'Parent', 'Partner', 'Other'];

export function AddVerifier({ editing = false }: { editing?: boolean }) {
  const me = useAccount();
  const navigate = useNavigate();
  const [contact, setContact] = useState(me.verifier?.contact ?? '');
  const [relation, setRelation] = useState(me.verifier?.relation ?? 'Friend');
  const [error, setError] = useState('');
  const done = () => navigate(editing ? '/settings' : '/home', { replace: true });

  async function invite() {
    setError('');
    if (!isValidPersonContact(contact)) {
      setError('Enter their @username, email or phone number');
      return;
    }
    if (isContactOf(me, contact)) {
      setError('Pick someone else. You can’t check your own work.');
      return;
    }
    const { ok } = await act('updateProfile', { patch: { verifier: { contact: contact.trim(), relation }, onboarded: true } });
    if (!ok) return;
    const where = appLink();
    const byUsername = contact.trim().startsWith('@');
    const text = `${me.name} added you as their Kazikwanza verifier. Get Kazikwanza${where ? ` at ${where}` : ''} and sign up with ${contact.trim()} to check their tasks and message them.`;
    // Someone picked by @username is already on Kazikwanza; anyone else gets an invite to share.
    if (navigator.share && !byUsername) {
      try {
        await navigator.share({ title: 'Kazikwanza', text });
      } catch {
        /* The person closed the share sheet; the verifier is still saved. */
      }
    }
    toast(`${contact.trim()} is now your verifier`);
    done();
  }

  return (
    <main className="screen">
      <BackButton fallback={editing ? '/settings' : '/onboarding/unlock'} />
      <div className="stack-8">
        <h1 className="h1">Who will check your work?</h1>
        <p className="lead">Add a friend or family member by their @username. They'll approve photos of your finished tasks in the app.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="contact">
          Their @username, email or phone
        </label>
        <input
          id="contact"
          className="input"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          inputMode="email"
          autoCapitalize="none"
          placeholder="@emma or emma@example.com"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="field">
        <span className="label">They are your</span>
        <div className="chips">
          {RELATIONS.map((r) => (
            <button key={r} type="button" className={`chip${relation === r ? ' selected' : ''}`} aria-pressed={relation === r} onClick={() => setRelation(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="spacer" />
      <div className="actions">
        <button className="btn btn-primary" onClick={invite}>
          {editing && me.verifier ? 'Save verifier' : 'Send invite'}
        </button>
        {editing ? (
          me.verifier && (
            <button
              className="link-btn danger"
              onClick={async () => {
                if (!(await act('updateProfile', { patch: { verifier: null } })).ok) return;
                toast('Verifier removed. New tasks will use questions.');
                done();
              }}
            >
              Remove verifier
            </button>
          )
        ) : (
          <button
            className="link-btn"
            onClick={async () => {
              if ((await act('updateProfile', { patch: { onboarded: true } })).ok) done();
            }}
          >
            Skip, I'll use questions for now
          </button>
        )}
      </div>
    </main>
  );
}

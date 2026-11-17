import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckIcon, ShieldIcon } from '../components/Icons';
import { BackButton, StepHeader } from '../components/ui';
import { SCROLL_APPS, TIME_APPS } from '../lib/apps';
import { setDeviceOwner } from '../lib/device';
import { appLink } from '../lib/install';
import { isValidContact, normalizeContact } from '../lib/logic';
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

export function Permissions() {
  const me = useAccount();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const forChild = params.get('for') === 'child';
  const phone = useLockStatus();
  // In the Android app these are the phone's real settings; on the web they are a walkthrough, saved on Continue.
  const [walkthrough, setWalkthrough] = useState(me.permissions);
  const { usage, accessibility } = isNativeAndroid ? phone ?? { usage: false, accessibility: false } : walkthrough;

  function allow(key: 'usage' | 'accessibility') {
    if (isNativeAndroid) {
      const open = key === 'usage' ? KaziLock.openUsageAccessSettings() : KaziLock.openAccessibilitySettings();
      open.catch(() => toast('Open Settings and allow Kazikwanza there.'));
      return;
    }
    setWalkthrough((w) => ({ ...w, [key]: true }));
  }

  async function next() {
    const patch = forChild ? { permissions: { usage, accessibility }, onboarded: true } : { permissions: { usage, accessibility } };
    if (!(await act('updateProfile', { patch })).ok) return;
    // This phone now enforces this account's rules.
    setDeviceOwner(me.id);
    navigate(forChild ? '/child' : '/onboarding/apps', { replace: forChild });
  }

  const item = (key: 'usage' | 'accessibility', title: string, body: string, on: boolean) => (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, borderRadius: 14 }}>
      <div className="stack-4" style={{ flexGrow: 1 }}>
        <span className="strong">{title}</span>
        <span className="muted" style={{ fontSize: 14 }}>
          {body}
        </span>
      </div>
      {on ? (
        <span className="strong green-text" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14 }}>
          <CheckIcon size={16} color="#15803D" width={3} />
          On
        </span>
      ) : (
        <button
          className="btn btn-primary"
          style={{ height: 40, width: 'auto', borderRadius: 10, fontSize: 14 }}
          onClick={() => allow(key)}
          aria-label={`Allow ${title}`}
        >
          Allow
        </button>
      )}
    </div>
  );

  return (
    <main className="screen">
      {forChild ? <BackButton fallback="/join" /> : <StepHeader step={2} of={4} fallback="/onboarding/mode" />}
      <div className="stack-8">
        <h1 className="h1">Allow access</h1>
        <p className="lead">Kazikwanza needs two permissions to lock apps and count your scrolls.</p>
      </div>
      <div className="stack-12">
        {item('usage', 'Usage access', 'See which app is open so we can lock it.', usage)}
        {item('accessibility', 'Accessibility', 'Count each scroll in your social apps.', accessibility)}
      </div>
      <div className="info">
        <ShieldIcon size={20} color="#15803D" />
        <span>We never read your messages, posts or what you watch. We only count scrolls.</span>
      </div>
      {isNativeAndroid && !accessibility && (
        <p className="small">
          In Settings, open <strong>Installed apps</strong> (or <strong>Downloaded apps</strong>), tap <strong>Kazikwanza app lock</strong> and turn it on. If
          Android says the setting is restricted, open Kazikwanza's App info, tap ⋮ and choose <strong>Allow restricted settings</strong> first.
        </p>
      )}
      <div className="spacer" />
      <button className="btn btn-primary" onClick={next} disabled={!usage || !accessibility}>
        Continue
      </button>
    </main>
  );
}

export function AppChecklist({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const group = (title: string, hint: string, apps: typeof SCROLL_APPS) => (
    <div className="stack">
      <span className="eyebrow">{title}</span>
      <span className="small" style={{ padding: '2px 0 4px' }}>
        {hint}
      </span>
      {apps.map((a) => (
        <label key={a.id} className="row" style={{ cursor: 'pointer', minHeight: 48 }}>
          <span>{a.name}</span>
          <input type="checkbox" className="check" checked={value.includes(a.id)} onChange={() => toggle(a.id)} />
        </label>
      ))}
    </div>
  );
  return (
    <>
      {group('Scrolling apps', 'Unlocked with scrolls. Each swipe uses 1.', SCROLL_APPS)}
      {group('Other apps', 'Unlocked with screen time. Counted in minutes.', TIME_APPS)}
    </>
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
      <AppChecklist value={locked} onChange={setLocked} />
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
    if (!isValidContact(contact)) {
      setError('Enter a valid email or phone number');
      return;
    }
    if (normalizeContact(contact) === normalizeContact(me.email)) {
      setError('Pick someone else. You can’t check your own work.');
      return;
    }
    const { ok } = await act('updateProfile', { patch: { verifier: { contact: contact.trim(), relation }, onboarded: true } });
    if (!ok) return;
    const where = appLink();
    const text = `${me.name} added you as their Kazikwanza verifier. Get Kazikwanza${where ? ` at ${where}` : ''} and sign up with ${contact.trim()} to check their tasks and message them.`;
    if (navigator.share) {
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
        <p className="lead">Add a friend or family member. They'll approve photos of your finished tasks.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="contact">
          Their email or phone
        </label>
        <input
          id="contact"
          className="input"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          inputMode="email"
          autoCapitalize="none"
          placeholder="emma@example.com"
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

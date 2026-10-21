import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LockIcon, TimerIcon } from '../components/Icons';
import { BackButton, useBack } from '../components/ui';
import { APPS, getApp, type LockableApp } from '../lib/apps';
import {
  EMERGENCY_MINUTES,
  EMERGENCY_PER_WEEK,
  EMERGENCY_SCROLLS,
  EMERGENCY_WAIT_SECONDS,
  accessFor,
  askForTime,
  closeSession,
  emergencyLeft,
  emergencyUnlock,
  newId,
  minutesLeft,
  remainingSeconds,
  rewardLabel,
  spendScroll,
  startSession,
  todaysTasks,
} from '../lib/logic';
import { run, toast, useAccount, useData, useNow, useStore } from '../lib/store';
import { formatClock, formatMinSec } from '../lib/time';
import type { Account } from '../lib/types';
import { homePath } from './Tasks';

function statusText(me: Account, app: LockableApp, now: number): string {
  const access = accessFor(me, app.id, now);
  if (access === 'not-locked') return 'Not locked';
  if (access === 'free') return 'Free now';
  if (access === 'locked') return 'Locked';
  return app.kind === 'scrolls' ? `${me.scrolls} scrolls` : `${minutesLeft(me, now)} min`;
}

export function Launcher() {
  const me = useAccount();
  const now = useNow(1000);
  const navigate = useNavigate();
  return (
    <main className="screen">
      <BackButton fallback={homePath(me)} />
      <div className="stack-8">
        <h1 className="h1">Your apps</h1>
        <p className="lead">Open an app the way you would on your phone. Each swipe to a new post uses 1 scroll; games use screen time.</p>
      </div>
      <div className="launcher">
        {APPS.map((a) => {
          const access = accessFor(me, a.id, now);
          return (
            <button key={a.id} onClick={() => navigate(access === 'locked' ? `/locked/${a.id}` : `/app/${a.id}`)} aria-label={`Open ${a.name}`}>
              <span className="app-icon" style={{ background: a.color }}>
                {a.name.charAt(0)}
                {access === 'locked' && (
                  <span className="lock">
                    <LockIcon size={13} color="#15803D" width={2.4} />
                  </span>
                )}
              </span>
              <span>{a.name}</span>
              <span className="app-status">{statusText(me, a, now)}</span>
            </button>
          );
        })}
      </div>
    </main>
  );
}

/* ───────── Simulated feed for scrolling apps ───────── */

const EMOJI = ['🎧', '⚽', '🍲', '🐐', '🌍', '🎨', '📚', '🦁', '🌅', '🎮', '🏃', '🎤', '🍌', '🚌', '🌧️', '😂'];
const CAPTIONS = [
  'Wait for it…',
  'Nairobi traffic at 7am be like',
  'This recipe changed my life',
  'POV: you said "just one more video"',
  'Top 5 goals of the week',
  'Rate my setup 1–10',
  'Nobody talks about this trick',
  'Part 2 because you asked',
  'Sunset at the Ngong hills',
  'Day 34 of learning guitar',
  'The ending though',
  'Duet this if you agree',
];

function post(i: number, seed: number) {
  const n = (i * 7919 + seed) % 9973;
  const hue = (n * 37) % 360;
  return {
    emoji: EMOJI[n % EMOJI.length],
    caption: CAPTIONS[(n >> 2) % CAPTIONS.length],
    handle: `@user${(n % 900) + 100}`,
    bg: `linear-gradient(160deg, hsl(${hue} 55% 32%), hsl(${(hue + 50) % 360} 60% 14%))`,
  };
}

function Feed({ app }: { app: LockableApp }) {
  const me = useAccount();
  const navigate = useNavigate();
  const now = useNow(1000);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(0);
  const sessionKey = useRef(newId('l'));
  const seed = useMemo(() => app.id.length * 101 + Math.floor(Math.random() * 1000), [app.id]);
  const [count, setCount] = useState(8);
  const access = accessFor(me, app.id, now);
  const close = useBack('/apps');

  function onScroll() {
    const el = ref.current;
    if (!el || el.clientHeight === 0) return;
    const index = Math.round(el.scrollTop / el.clientHeight);
    if (index + 4 > count) setCount(index + 8);
    while (seen.current < index) {
      const store = useStore.getState();
      const me0 = store.data.sessionId ? store.data.accounts[store.data.sessionId] : null;
      if (!me0) return;
      const { data, result } = spendScroll(store.data, me0.id, app.id, sessionKey.current, Date.now());
      if (result === 'locked') {
        navigate(`/locked/${app.id}`, { replace: true });
        return;
      }
      seen.current += 1;
      if (data !== store.data) run(() => data);
    }
  }

  let meter = 'Not locked';
  if (access === 'free') meter = 'Free until midnight';
  else if (access === 'balance' || access === 'locked') meter = `${me.scrolls} scroll${me.scrolls === 1 ? '' : 's'} left`;

  return (
    <div className="with-nav" style={{ background: '#000' }}>
      <div className="app-bar">
        <button className="close-app" onClick={close}>
          Close
        </button>
        <strong>{app.name}</strong>
        <span className="scroll-meter" data-testid="scroll-meter">
          {meter}
        </span>
      </div>
      <div className="feed" ref={ref} onScroll={onScroll} data-testid="feed">
        {Array.from({ length: count }, (_, i) => {
          const p = post(i, seed);
          return (
            <section className="post" key={i} style={{ background: p.bg }} aria-label={`Post ${i + 1}`}>
              <div className="post-emoji" aria-hidden="true">
                {p.emoji}
              </div>
              <h3>{p.handle}</h3>
              <p>{p.caption}</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── Simulated timed app ───────── */

function TimedApp({ app }: { app: LockableApp }) {
  const me = useAccount();
  const navigate = useNavigate();
  const now = useNow(250);
  const session = me.session?.appId === app.id ? me.session : null;
  const remaining = remainingSeconds(me, now);

  useEffect(() => {
    if (!session) {
      if (!run((d, t) => startSession(d, me.id, app.id, t))) navigate(`/locked/${app.id}`, { replace: true });
    }
    // Start once per visit; the session survives leaving the screen, like a real app in the background.
  }, []);

  useEffect(() => {
    if (session && !session.free && remaining <= 0) {
      run((d) => closeSession(d, me.id, session.startedAt + d.accounts[me.id].screenSeconds * 1000));
      navigate(`/locked/${app.id}`, { replace: true });
    }
  }, [session, remaining, me.id, app.id, navigate]);

  return (
    <main className="screen centered" style={{ background: app.color, color: '#fff' }}>
      <div className="stack-12 center">
        <span style={{ fontSize: 15, opacity: 0.85 }}>{session?.free ? 'Free time, not counted' : 'Screen time left'}</span>
        <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }} data-testid="timer">
          {session?.free ? '∞' : formatMinSec(remaining)}
        </span>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{app.name} is open</span>
        <p style={{ opacity: 0.85, lineHeight: 1.5 }}>
          The timer runs while {app.name} is open, even if you leave this screen. Close it to stop the clock.
        </p>
      </div>
      <div className="spacer" />
      <button
        className="btn btn-white"
        onClick={() => {
          run((d, t) => closeSession(d, me.id, t));
          navigate(homePath(me), { replace: true });
        }}
      >
        Close {app.name}
      </button>
    </main>
  );
}

export function AppView() {
  const { appId = '' } = useParams();
  const me = useAccount();
  const app = getApp(appId);
  const navigate = useNavigate();
  const lockedAtOpen = useRef(app ? accessFor(me, app.id, Date.now()) === 'locked' && me.session?.appId !== app.id : false);

  useEffect(() => {
    if (lockedAtOpen.current) navigate(`/locked/${appId}`, { replace: true });
  }, [appId, navigate]);

  if (!app) {
    return (
      <main className="screen">
        <BackButton fallback="/apps" />
        <h1 className="h1">App not found</h1>
      </main>
    );
  }
  if (lockedAtOpen.current) return null;
  return app.kind === 'scrolls' ? <Feed app={app} /> : <TimedApp app={app} />;
}

/* ───────── Locked ───────── */

export function Locked() {
  const { appId = '' } = useParams();
  const me = useAccount();
  const data = useData();
  const now = useNow(1000);
  const navigate = useNavigate();
  const app = getApp(appId);
  if (!app) return null;

  const access = accessFor(me, app.id, now);
  const parent = me.parentId ? data.accounts[me.parentId] : null;
  const open = todaysTasks(data, me.id, now).filter((t) => t.status === 'todo' || t.status === 'redo');
  const suggested = [...open.filter((t) => t.reward.kind === app.kind), ...open.filter((t) => t.reward.kind !== app.kind)].slice(0, 3);
  const left = emergencyLeft(me, now);
  const askOpen = data.timeRequests.some((r) => r.childId === me.id && r.status === 'open');

  const wait = me.unlockTime ? `, or wait until ${formatClock(me.unlockTime)}` : '';
  let body: string;
  if (parent) body = `Finish a task from ${parent.name} to earn ${app.kind === 'scrolls' ? 'scrolls' : 'minutes'}${wait}.`;
  else if (app.kind === 'scrolls') body = `You're out of scrolls. Finish a task to earn more${wait}.`;
  else body = `Your screen time is used up. Finish a task to earn more minutes${wait}.`;

  return (
    <main className="screen centered">
      <div className="stack center" style={{ gap: 16 }}>
        <div className="icon-badge">
          {app.kind === 'scrolls' ? <LockIcon size={32} color="#15803D" /> : <TimerIcon size={32} color="#15803D" />}
        </div>
        <h1 className="h1">{access === 'locked' ? `${app.name} is locked` : `${app.name} is open`}</h1>
        <p className="lead">{access === 'locked' ? body : 'You have enough to open it now.'}</p>
      </div>
      {access === 'locked' &&
        (suggested.length > 0 ? (
          <div className="box">
            {suggested.map((t) => (
              <Link key={t.id} to={`/task/${t.id}`} className="row row-btn" style={{ minHeight: 52 }}>
                <span>{t.title}</span>
                <span className="strong">{rewardLabel(t.reward.kind, t.reward.amount)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">{parent ? `No tasks from ${parent.name} yet.` : 'No tasks left. Add one and choose what it’s worth.'}</div>
        ))}
      <div className="spacer" />
      <div className="actions" style={{ gap: parent ? 10 : 16 }}>
        {access === 'locked' ? (
          <Link to={homePath(me)} className="btn btn-primary">
            See my tasks
          </Link>
        ) : (
          <Link to={`/app/${app.id}`} className="btn btn-primary" replace>
            Open {app.name}
          </Link>
        )}
        {access === 'locked' &&
          (parent ? (
            <button
              className="btn btn-secondary"
              disabled={askOpen}
              onClick={() => {
                if (run((d, t) => askForTime(d, me.id, app.id, t))) toast(`Asked ${parent.name} for more time`);
              }}
            >
              {askOpen ? `Waiting for ${parent.name}…` : `Ask ${parent.name} for more time`}
            </button>
          ) : left > 0 ? (
            <Link to={`/emergency/${app.id}`} className="link-btn muted">
              Emergency unlock
            </Link>
          ) : (
            <span className="note">No emergency unlocks left this week</span>
          ))}
        {access !== 'locked' && (
          <button className="link-btn muted" onClick={() => navigate(homePath(me))}>
            Back to tasks
          </button>
        )}
      </div>
    </main>
  );
}

export function Emergency() {
  const { appId = '' } = useParams();
  const me = useAccount();
  const navigate = useNavigate();
  const app = getApp(appId);
  const [startedAt] = useState(() => Date.now());
  const now = useNow(200);
  if (!app) return null;

  const left = emergencyLeft(me, now);
  const secondsLeft = Math.max(0, EMERGENCY_WAIT_SECONDS - (now - startedAt) / 1000);
  const ready = secondsLeft <= 0;
  const progress = 1 - secondsLeft / EMERGENCY_WAIT_SECONDS;
  const r = 90;
  const c = 2 * Math.PI * r;
  const grant = app.kind === 'scrolls' ? `${EMERGENCY_SCROLLS} scrolls` : `${EMERGENCY_MINUTES} minutes`;

  return (
    <main className="screen centered">
      <div className="stack-12 center">
        <h1 className="h1">Emergency unlock</h1>
        <p className="lead">
          Take a breath. If you still need it, {app.name} will open with {grant}.
        </p>
      </div>
      <div className="ring" role="timer" aria-label={`${Math.ceil(secondsLeft)} seconds left`}>
        <svg width="200" height="200" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r={r} fill="none" stroke="#DCFCE7" strokeWidth="10" />
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="#15803D"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - progress)}
          />
        </svg>
        <b>{formatMinSec(secondsLeft)}</b>
        <span className="muted" style={{ fontSize: 14 }}>
          {ready ? 'ready' : 'seconds left'}
        </span>
      </div>
      <span className="muted" style={{ textAlign: 'center', fontSize: 15 }}>
        {left} of {EMERGENCY_PER_WEEK} emergency unlocks left this week
      </span>
      <div className="spacer" />
      <div className="actions">
        <button
          className="btn btn-primary"
          disabled={!ready || left === 0}
          onClick={() => {
            if (run((d, t) => emergencyUnlock(d, me.id, app.id, t))) navigate(`/app/${app.id}`, { replace: true });
          }}
        >
          {ready ? `Unlock ${app.name}` : `Unlock in ${Math.ceil(secondsLeft)}s`}
        </button>
        <Link to={homePath(me)} className="link-btn strong" replace>
          Never mind, back to tasks
        </Link>
      </div>
    </main>
  );
}

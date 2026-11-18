import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppIcon } from '../components/AppList';
import { LockIcon, TimerIcon } from '../components/Icons';
import { BackButton, useBack } from '../components/ui';
import { APPS, appFor, lockedAppsOf, usesMinutes, usesScrolls, type LockableApp } from '../lib/apps';
import {
  EMERGENCY_MINUTES,
  EMERGENCY_PER_WEEK,
  EMERGENCY_SCROLLS,
  EMERGENCY_WAIT_SECONDS,
  accessFor,
  emergencyLeft,
  newId,
  minutesLeft,
  remainingSeconds,
  rewardLabel,
  todaysTasks,
} from '../lib/logic';
import { act, toast, useAccount, useData, useNow } from '../lib/store';
import { KaziLock, isNativeAndroid, pumpNative } from '../lib/native';
import { formatClock, formatMinSec } from '../lib/time';
import type { Account } from '../lib/types';
import { homePath } from './Tasks';

function statusText(me: Account, app: LockableApp, now: number): string {
  const access = accessFor(me, app.id, now);
  if (access === 'not-locked') return 'Not locked';
  if (access === 'free') return 'Free now';
  if (access === 'locked') return 'Locked';
  if (app.kind === 'mixed') return `${me.scrolls} · ${minutesLeft(me, now)} min`;
  return app.kind === 'scrolls' ? `${me.scrolls} scrolls` : `${minutesLeft(me, now)} min`;
}

/**
 * Opens an app the person has access to: the real app inside the Android
 * build (the lock service takes over there), or the built-in demo on the web.
 * Returns false when the real app isn't installed.
 */
async function launch(app: LockableApp, navigate: (to: string, opts?: { replace?: boolean }) => void, replace = false) {
  if (!isNativeAndroid) {
    navigate(`/app/${app.id}`, { replace });
    return true;
  }
  const { opened } = await KaziLock.openApp({ packages: app.packages }).catch(() => ({ opened: false }));
  if (!opened) toast(`${app.name} isn't installed on this phone`);
  return opened;
}

export function Launcher() {
  const me = useAccount();
  const now = useNow(1000);
  const navigate = useNavigate();

  async function open(app: LockableApp, access: ReturnType<typeof accessFor>) {
    if (access === 'locked') {
      navigate(`/locked/${app.id}`);
      return;
    }
    await launch(app, navigate);
  }

  return (
    <main className="screen">
      <BackButton fallback={homePath(me)} />
      <div className="stack-8">
        <h1 className="h1">Your apps</h1>
        <p className="lead">
          {isNativeAndroid
            ? 'Open an app from here or from your home screen. Each swipe to a new post uses 1 scroll; games, YouTube videos and apps you limit use screen time.'
            : 'Open an app the way you would on your phone. Each swipe to a new post uses 1 scroll; games and YouTube videos use screen time.'}
        </p>
      </div>
      <div className="launcher">
        {[...APPS, ...lockedAppsOf(me).filter((a) => a.found)].map((a) => {
          const access = accessFor(me, a.id, now);
          return (
            <button key={a.id} onClick={() => open(a, access)} aria-label={`Open ${a.name}`}>
              <AppIcon app={a} locked={access === 'locked'} />
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

function Feed({ app, onClose }: { app: LockableApp; onClose?: () => void }) {
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

  // Swipes are charged one at a time, in order, even if the server is slow to answer.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lockedOut = useRef(false);

  function onScroll() {
    const el = ref.current;
    if (!el || el.clientHeight === 0) return;
    const index = Math.round(el.scrollTop / el.clientHeight);
    if (index + 4 > count) setCount(index + 8);
    while (seen.current < index) {
      seen.current += 1;
      queue.current = queue.current.then(async () => {
        if (lockedOut.current) return;
        const { ok, result } = await act('spendScroll', { appId: app.id, sessionKey: sessionKey.current });
        if (ok && result === 'locked') {
          lockedOut.current = true;
          navigate(`/locked/${app.id}${app.kind === 'mixed' ? '?part=scrolls' : ''}`, { replace: true });
        }
      });
    }
  }

  let meter = 'Not locked';
  if (access === 'free') meter = 'Free until midnight';
  else if (access === 'balance' || access === 'locked') meter = `${me.scrolls} scroll${me.scrolls === 1 ? '' : 's'} left`;

  return (
    <div className="with-nav" style={{ background: '#000' }}>
      <div className="app-bar">
        <button className="close-app" onClick={onClose ?? close}>
          {onClose ? 'Back' : 'Close'}
        </button>
        <strong>{app.kind === 'mixed' ? `${app.name} Shorts` : app.name}</strong>
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

function TimedApp({ app, onClose }: { app: LockableApp; onClose?: () => void }) {
  const me = useAccount();
  const navigate = useNavigate();
  const now = useNow(250);
  const part = app.kind === 'mixed' ? '?part=minutes' : '';
  const what = app.kind === 'mixed' ? `A ${app.name} video` : app.name;
  const session = me.session?.appId === app.id ? me.session : null;
  const remaining = remainingSeconds(me, now);

  useEffect(() => {
    if (!session) {
      void act('startSession', { appId: app.id }).then(({ ok }) => {
        if (!ok) navigate(`/locked/${app.id}${part}`, { replace: true });
      });
    }
    // Start once per visit; the session survives leaving the screen, like a real app in the background.
  }, []);

  const closing = useRef(false);
  useEffect(() => {
    if (session && !session.free && remaining <= 0 && !closing.current) {
      closing.current = true;
      void act('closeSession', { at: session.startedAt + me.screenSeconds * 1000 }).then(() =>
        navigate(`/locked/${app.id}${part}`, { replace: true }),
      );
    }
  }, [session, remaining, me.screenSeconds, app.id, navigate, part]);

  return (
    <main className="screen centered" style={{ background: app.color, color: '#fff' }}>
      <div className="stack-12 center">
        <span style={{ fontSize: 15, opacity: 0.85 }}>{session?.free ? 'Free time, not counted' : 'Screen time left'}</span>
        <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }} data-testid="timer">
          {session?.free ? '∞' : formatMinSec(remaining)}
        </span>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{what} is {app.kind === 'mixed' ? 'playing' : 'open'}</span>
        <p style={{ opacity: 0.85, lineHeight: 1.5 }}>
          {app.kind === 'mixed'
            ? 'Videos use screen time while they play. Stop the video to stop the clock.'
            : `The timer runs while ${app.name} is open, even if you leave this screen. Close it to stop the clock.`}
        </p>
      </div>
      <div className="spacer" />
      <button
        className="btn btn-white"
        onClick={async () => {
          await act('closeSession');
          if (onClose) onClose();
          else navigate(homePath(me), { replace: true });
        }}
      >
        {app.kind === 'mixed' ? 'Stop the video' : `Close ${app.name}`}
      </button>
    </main>
  );
}

export function AppView() {
  const { appId = '' } = useParams();
  const me = useAccount();
  const app = appFor(me, appId);
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
  if (app.kind === 'mixed') return <MixedApp app={app} />;
  return app.kind === 'scrolls' ? <Feed app={app} /> : <TimedApp app={app} />;
}

/**
 * The web demo of YouTube: the home feed is free, Shorts spend scrolls and a
 * regular video spends screen time, the same split the phone's lock service makes.
 */
function MixedApp({ app }: { app: LockableApp }) {
  const me = useAccount();
  const now = useNow(1000);
  const close = useBack('/apps');
  const [part, setPart] = useState<'home' | 'shorts' | 'video'>(me.session?.appId === app.id ? 'video' : 'home');
  if (part === 'shorts') return <Feed app={app} onClose={() => setPart('home')} />;
  if (part === 'video') return <TimedApp app={app} onClose={() => setPart('home')} />;
  const free = accessFor(me, app.id, now) === 'free';
  return (
    <main className="screen" style={{ background: '#0F0F0F', color: '#fff' }}>
      <div className="app-bar" style={{ position: 'static', padding: 0 }}>
        <button className="close-app" onClick={close}>
          Close
        </button>
        <strong>{app.name}</strong>
        <span className="scroll-meter" data-testid="mixed-meter">
          {free ? 'Free until midnight' : `${me.scrolls} scrolls · ${minutesLeft(me, now)} min`}
        </span>
      </div>
      <p style={{ opacity: 0.85, lineHeight: 1.5 }}>Browsing is free. Shorts use 1 scroll per swipe; regular videos use screen time while they play.</p>
      <div className="stack-12">
        <button className="btn btn-white" onClick={() => setPart('shorts')}>
          Watch Shorts
        </button>
        <button className="btn btn-white" onClick={() => setPart('video')}>
          Watch a video
        </button>
      </div>
    </main>
  );
}

/* ───────── Locked ───────── */

export function Locked() {
  const { appId = '' } = useParams();
  const [search] = useSearchParams();
  const me = useAccount();
  const data = useData();
  const now = useNow(1000);
  const navigate = useNavigate();
  const app = appFor(me, appId);
  if (!app) return null;

  // For YouTube, which part ran out: Shorts (scrolls) or videos (screen time).
  const partParam = search.get('part');
  const part = app.kind === 'mixed' && (partParam === 'scrolls' || partParam === 'minutes') ? partParam : null;
  const kind = part ?? (app.kind === 'mixed' ? null : app.kind);
  const appAccess = accessFor(me, app.id, now);
  let access = appAccess;
  if (part && appAccess === 'balance') {
    const enough = part === 'scrolls' ? me.scrolls > 0 : remainingSeconds(me, now) > 0;
    if (!enough) access = 'locked';
  }
  const label = part === 'scrolls' ? `${app.name} Shorts` : part === 'minutes' ? `${app.name} videos` : app.name;
  const plural = part !== null;

  const parent = me.parentId ? data.accounts[me.parentId] : null;
  const open = todaysTasks(data, me.id, now).filter((t) => t.status === 'todo' || t.status === 'redo');
  const suggested = (kind ? [...open.filter((t) => t.reward.kind === kind), ...open.filter((t) => t.reward.kind !== kind)] : open).slice(0, 3);
  const left = emergencyLeft(me, now);
  const askOpen = data.timeRequests.some((r) => r.childId === me.id && r.status === 'open');

  const wait = me.unlockTime ? `, or wait until ${formatClock(me.unlockTime)}` : '';
  const earn = kind === 'scrolls' ? 'scrolls' : kind === 'minutes' ? 'minutes' : 'scrolls or minutes';
  let body: string;
  if (parent) body = `Finish a task from ${parent.name} to earn ${earn}${wait}.`;
  else if (kind === 'scrolls') body = `You're out of scrolls. Finish a task to earn more${wait}.`;
  else if (kind === 'minutes') body = `Your screen time is used up. Finish a task to earn more minutes${wait}.`;
  else body = `You're out of scrolls and screen time. Finish a task to earn more${wait}.`;
  // YouTube itself still opens when only one part ran out.
  if (part === 'scrolls' && appAccess === 'balance') body += ' Regular videos still play on your screen time.';
  if (part === 'minutes' && appAccess === 'balance') body += ' Shorts still work with your scrolls.';

  return (
    <main className="screen centered">
      <div className="stack center" style={{ gap: 16 }}>
        <div className="icon-badge">
          {kind === 'minutes' ? <TimerIcon size={32} color="#15803D" /> : <LockIcon size={32} color="#15803D" />}
        </div>
        <h1 className="h1">{access === 'locked' ? `${label} ${plural ? 'are' : 'is'} locked` : `${app.name} is open`}</h1>
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
          <>
            <Link to={homePath(me)} className="btn btn-primary">
              See my tasks
            </Link>
            {part && appAccess === 'balance' && (
              <button className="btn btn-secondary" onClick={() => void launch(app, navigate, true)}>
                {part === 'scrolls' ? `Watch videos on ${app.name}` : `Open ${app.name}`}
              </button>
            )}
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => void launch(app, navigate, true)}>
            Open {app.name}
          </button>
        )}
        {access === 'locked' &&
          (parent ? (
            <button
              className="btn btn-secondary"
              disabled={askOpen}
              onClick={async () => {
                if ((await act('askForTime', { appId: app.id })).ok) toast(`Asked ${parent.name} for more time`);
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
  const app = appFor(me, appId);
  const [startedAt] = useState(() => Date.now());
  const now = useNow(200);
  if (!app) return null;

  const left = emergencyLeft(me, now);
  const secondsLeft = Math.max(0, EMERGENCY_WAIT_SECONDS - (now - startedAt) / 1000);
  const ready = secondsLeft <= 0;
  const progress = 1 - secondsLeft / EMERGENCY_WAIT_SECONDS;
  const r = 90;
  const c = 2 * Math.PI * r;
  const grant = [usesScrolls(app) && `${EMERGENCY_SCROLLS} scrolls`, usesMinutes(app) && `${EMERGENCY_MINUTES} minutes`].filter(Boolean).join(' and ');

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
          onClick={async () => {
            if ((await act('emergencyUnlock', { appId: app.id })).ok) {
              // Hand the new balance to the phone before the real app opens.
              void pumpNative().then(() => launch(app, navigate, true));
            }
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

import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BackButton, NavScreen } from '../components/ui';
import { TIME_APPS, getApp } from '../lib/apps';
import { minutesUsedToday, minutesLeft, notificationsFor, remainingSeconds, rewardLabel, weekStats } from '../lib/logic';
import { act, useAccount, useData, useNow } from '../lib/store';
import { formatMinSec, timeAgo } from '../lib/time';
import { homePath } from './Tasks';

export function Wallet() {
  const me = useAccount();
  const data = useData();
  const now = useNow(1000);
  const stats = weekStats(data, me.id, now);
  const minutes = minutesLeft(me, now);
  // Phone lines under 30 seconds round to 0 min; leave them out of the list.
  const history = me.ledger.filter((l) => l.amount !== 0).slice(0, 25);

  return (
    <NavScreen>
      <h1 className="h1-lg">Wallet</h1>
      <div className="card-green">
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="stack-6">
            <span className="sub">Scrolls</span>
            <span className="huge-number">{me.scrolls}</span>
            <span className="sub" style={{ fontSize: 12 }}>
              1 swipe = 1 scroll
            </span>
          </div>
          <Link to="/screen-time" className="stack-6" style={{ color: '#fff', textDecoration: 'none' }}>
            <span className="sub">Screen time</span>
            <span className="huge-number">
              {minutes}
              <small> min</small>
            </span>
            <span className="sub" style={{ fontSize: 12 }}>
              Games and other apps
            </span>
          </Link>
        </div>
      </div>
      <div className="stack-10">
        <h2 className="h2">This week</h2>
        <div className="grid-2">
          <div className="stat">
            <b>{stats.scrollsEarned}</b>
            <span className="small">Scrolls earned</span>
          </div>
          <div className="stat">
            <b>{stats.scrollsUsed}</b>
            <span className="small">Scrolls used</span>
          </div>
          <div className="stat">
            <b>{stats.tasksDone}</b>
            <span className="small">Tasks done</span>
          </div>
          <div className="stat">
            <b>
              {stats.streak} day{stats.streak === 1 ? '' : 's'}
            </b>
            <span className="small">Streak</span>
          </div>
        </div>
      </div>
      <div className="stack">
        <h2 className="h2" style={{ marginBottom: 4 }}>
          History
        </h2>
        {history.length === 0 ? (
          <div className="empty-state">Finish a task to earn your first scrolls.</div>
        ) : (
          history.map((l) => (
            <div className="row" key={l.id}>
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span>{l.label}</span>
                <span className="small">{timeAgo(l.at, now)}</span>
              </div>
              <span className="strong" style={{ color: l.amount > 0 ? '#15803D' : '#52525B', whiteSpace: 'nowrap' }}>
                {rewardLabel(l.unit, l.amount)}
              </span>
            </div>
          ))
        )}
      </div>
    </NavScreen>
  );
}

export function ScreenTime() {
  const me = useAccount();
  const now = useNow(1000);
  const remaining = remainingSeconds(me, now);
  const used = minutesUsedToday(me, now);
  const session = me.session;
  const app = session ? getApp(session.appId) : undefined;

  return (
    <main className="screen">
      <BackButton fallback={homePath(me)} />
      <h1 className="h1-lg">Screen time</h1>
      <div className="card-green">
        <span className="sub">Time left today</span>
        <span style={{ fontSize: 52, fontWeight: 700, lineHeight: 1, letterSpacing: -1 }}>
          {minutesLeft(me, now)}
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: 0 }}> min</span>
        </span>
        <span className="sub">Earned from tasks. Used by games and other non-scrolling apps.</span>
      </div>
      {session && app && (
        <Link to={`/app/${app.id}`} className="timer-pill">
          <div className="live-dot" />
          <div className="stack" style={{ gap: 2, flexGrow: 1 }}>
            <span className="strong">{app.name} is open</span>
            <span className="small">{session.free ? 'Free time, not counted' : 'Timer running'}</span>
          </div>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#15803D' }}>{session.free ? '∞' : formatMinSec(remaining)}</span>
        </Link>
      )}
      <div className="stack">
        <h2 className="h2" style={{ marginBottom: 4 }}>
          Used today
        </h2>
        {TIME_APPS.filter((a) => me.lockedApps.includes(a.id)).map((a) => (
          <div className="row" key={a.id}>
            <span>{a.name}</span>
            <span className="muted">{used[a.id] ?? 0} min</span>
          </div>
        ))}
        {TIME_APPS.every((a) => !me.lockedApps.includes(a.id)) && <div className="empty-state">No timed apps are locked.</div>}
      </div>
      <div className="spacer" />
      {me.mode === 'child' ? (
        <Link to="/child" className="btn btn-secondary">
          Finish a task to earn more time
        </Link>
      ) : (
        <Link to="/task/new" className="btn btn-secondary">
          Add a task to earn more time
        </Link>
      )}
    </main>
  );
}

export function Notifications() {
  const me = useAccount();
  const data = useData();
  const now = useNow(30_000);
  const navigate = useNavigate();
  const items = notificationsFor(data, me.id);

  // Leave the unread dots visible while the list is open; clear them on the way out.
  useEffect(() => () => void act('markNotificationsRead'), [me.id]);

  return (
    <main className="screen gap-20">
      <BackButton fallback={homePath(me)} />
      <h1 className="h1-lg">Notifications</h1>
      {items.length === 0 ? (
        <div className="empty-state">Nothing yet. Approvals, reminders and streaks show up here.</div>
      ) : (
        <div className="stack">
          {items.map((n) => {
            const content = (
              <>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: n.read ? 'transparent' : '#15803D', marginTop: 7, flexShrink: 0 }} />
                <div className="stack-4" style={{ flexGrow: 1 }}>
                  <span className={n.read ? undefined : 'medium'}>{n.text}</span>
                  <span className="small">{timeAgo(n.at, now)}</span>
                </div>
              </>
            );
            const style = { display: 'flex', gap: 12, padding: '14px 0', borderBottom: '1px solid #E4E4E7' } as const;
            return n.link ? (
              <button key={n.id} className="row-btn" style={{ ...style, textAlign: 'left' }} onClick={() => navigate(n.link!)}>
                {content}
              </button>
            ) : (
              <div key={n.id} style={style}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

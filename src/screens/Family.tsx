import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ChevronIcon, GridIcon, PlusIcon } from '../components/Icons';
import { Avatar, BackButton, HeaderActions, NavScreen, Sheet, StoredPhoto, useBack } from '../components/ui';
import { appFor, lockedAppsOf, usesMinutes } from '../lib/apps';
import { AppList } from '../components/AppList';
import {
  LINK_CODE_TTL_MS,
  activeLinkCode,
  childrenOf,
  dailyCompletions,
  minutesLeft,
  minutesUsedToday,
  requestsFor,
  rewardLabel,
  shortGift,
  timeGift,
  todaysTasks,
  weekStats,
} from '../lib/logic';
import { act, toast, useAccount, useData, useNow } from '../lib/store';
import { formatClock, timeAgo } from '../lib/time';
import type { Account, Repeat, RewardKind } from '../lib/types';
import { unlockLine, useUnseenReward, TaskRow } from './Home';
import { UnlockTimePicker } from './Onboarding';
import { approve, RedoSheet } from './Requests';
import { MissingTask, RewardPicker, useTask } from './Tasks';

/* ───────── Parent home ───────── */

export function ParentHome() {
  const me = useAccount();
  const data = useData();
  const now = useNow(5000);
  const kids = childrenOf(data, me.id);
  const pending = requestsFor(data, me.id).filter((t) => t.verifierId === me.id);
  const asks = data.timeRequests.filter((r) => r.parentId === me.id && r.status === 'open');

  return (
    <NavScreen
      fab={
        kids.length > 0 && (
          <Link to={`/family/task/new?child=${kids[0].id}`} className="fab" aria-label={`Add task for ${kids[0].name}`}>
            <PlusIcon size={24} color="#fff" />
          </Link>
        )
      }
    >
      {me.mode === 'parent' ? (
        <>
          <div className="topbar">
            <h1 className="h1-lg">Family</h1>
            <HeaderActions me={me} />
          </div>
          <Link to="/family/link" className="link-btn strong" style={{ alignSelf: 'flex-start', marginTop: -16 }}>
            + Link a child
          </Link>
        </>
      ) : (
        <div className="topbar">
          <h1 className="h1-lg">Family</h1>
          <Link to="/family/link" className="link-btn strong">
            + Link a child
          </Link>
        </div>
      )}

      <Link
        to="/home"
        className="card"
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', textDecoration: 'none', color: '#18181B', borderRadius: 14 }}
      >
        <span className="stack" style={{ flexGrow: 1, gap: 2 }}>
          <span>Your own tasks and apps</span>
          <span className="small">
            {me.scrolls} scrolls · {minutesLeft(me, now)} min · lock your own apps in Settings
          </span>
        </span>
        <ChevronIcon size={18} color="#52525B" />
      </Link>

      {kids.length === 0 && (
        <div className="stack-12">
          <div className="empty-state">
            Link your child's phone to set their tasks, choose which apps are locked, and approve their photos.
          </div>
          <Link to="/family/link" className="btn btn-primary">
            Link a child
          </Link>
        </div>
      )}

      {kids.map((kid) => {
        const tasks = todaysTasks(data, kid.id, now);
        const done = tasks.filter((t) => t.status === 'done').length;
        return (
          <div key={kid.id} className="card-tint" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, borderRadius: 20 }}>
            <Avatar name={kid.name} solid size={48} />
            <div className="stack" style={{ flexGrow: 1, gap: 2, minWidth: 0 }}>
              <span className="strong" style={{ fontSize: 17 }}>
                {kid.name}
              </span>
              <Link to={`/family/child/${kid.id}`} style={{ fontSize: 14, textDecoration: 'none' }}>
                {done} of {tasks.length} tasks done · {kid.scrolls} scrolls · {minutesLeft(kid, now)} min · Open account
              </Link>
            </div>
            <div className="stack" style={{ alignItems: 'flex-end' }}>
              <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{kid.scrolls}</span>
              <span className="small" style={{ whiteSpace: 'nowrap' }}>scrolls · {minutesLeft(kid, now)} min</span>
            </div>
          </div>
        );
      })}

      {asks.map((r) => {
        const kid = data.accounts[r.childId];
        return (
          <div key={r.id} className="card stack-12">
            <span>
              <strong>{kid?.name}</strong> asked for more time{appFor(kid, r.appId) ? ` on ${appFor(kid, r.appId)!.name}` : ''}.
            </span>
            <div className="grid-2">
              <button className="btn btn-secondary" style={{ height: 44, fontSize: 15 }} onClick={() => void act('answerTimeRequest', { requestId: r.id, grant: false })}>
                Not now
              </button>
              <button
                className="btn btn-primary"
                style={{ height: 44, fontSize: 15 }}
                onClick={async () => {
                  if ((await act('answerTimeRequest', { requestId: r.id, grant: true })).ok) toast(`Sent to ${kid?.name}`);
                }}
              >
                Give {shortGift(timeGift(appFor(kid, r.appId)))}
              </button>
            </div>
          </div>
        );
      })}

      {pending.length > 0 && (
        <div className="stack-8">
          <h2 className="h2">Needs approval</h2>
          {pending.map((t) => (
            <Link
              key={t.id}
              to={`/family/approve/${t.id}`}
              className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: '10px 14px', borderRadius: 14, textDecoration: 'none', color: '#18181B' }}
            >
              <div style={{ width: 8, height: 8, borderRadius: 4, background: '#15803D', flexShrink: 0 }} />
              <div className="stack" style={{ flexGrow: 1, gap: 2 }}>
                <span className="medium">{t.title}</span>
                <span className="small">Photo from {data.accounts[t.ownerId]?.name}</span>
              </div>
              <span className="strong">{rewardLabel(t.reward.kind, t.reward.amount)}</span>
              <ChevronIcon size={18} color="#52525B" />
            </Link>
          ))}
        </div>
      )}

      {kids.map((kid) => {
        const tasks = todaysTasks(data, kid.id, now);
        return (
          <div key={kid.id} className="stack">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 className="h2">{kid.name}'s tasks</h2>
              {kids.length > 1 && (
                <Link to={`/family/task/new?child=${kid.id}`} className="link-btn strong" style={{ fontSize: 14 }}>
                  + Add
                </Link>
              )}
            </div>
            {tasks.length === 0 ? (
              <div className="empty-state">No tasks for {kid.name} yet. Tap + to add one.</div>
            ) : (
              tasks.map((t) => (
                <Link key={t.id} to={`/task/${t.id}`} className="row row-btn">
                  <span className={t.status === 'done' ? 'strike' : undefined}>{t.title}</span>
                  {t.status === 'done' ? (
                    <span className="muted" style={{ fontSize: 14 }}>
                      Done
                    </span>
                  ) : t.status === 'pending' ? (
                    <span className="amber" style={{ fontSize: 14 }}>
                      Waiting
                    </span>
                  ) : t.status === 'redo' ? (
                    <span style={{ fontSize: 14, color: '#B91C1C' }}>Redo</span>
                  ) : (
                    <span className="muted" style={{ fontSize: 14 }}>
                      {rewardLabel(t.reward.kind, t.reward.amount)}
                    </span>
                  )}
                </Link>
              ))
            )}
          </div>
        );
      })}
    </NavScreen>
  );
}

/* ───────── Link a child ───────── */

export function LinkChild() {
  const me = useAccount();
  const data = useData();
  const now = useNow(1000);
  const navigate = useNavigate();
  const code = activeLinkCode(data, me.id, now);
  const [qr, setQr] = useState('');
  const startKids = useRef(childrenOf(data, me.id).length);
  const kids = childrenOf(data, me.id);

  useEffect(() => {
    if (!code) void act('createLinkCode');
  }, [code, me.id]);

  useEffect(() => {
    if (!code) return;
    QRCode.toString(`KAZIKWANZA:${code.code}`, { type: 'svg', margin: 0, color: { dark: '#166534', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [code?.code]);

  useEffect(() => {
    if (kids.length > startKids.current) {
      toast(`${kids[kids.length - 1].name} joined your family`);
      navigate('/family', { replace: true });
    }
  }, [kids, navigate]);

  async function share() {
    if (!code) return;
    const text = `Join my family on Kazikwanza: open the app, choose "As a child" and enter ${code.code}. The code works for 10 minutes.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Kazikwanza family code', text });
        return;
      } catch {
        /* closed the share sheet */
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(code.code);
      toast('Code copied');
    } catch {
      toast(`Your code is ${code.code}`);
    }
  }

  const ttl = LINK_CODE_TTL_MS / 60_000;
  const minutesLeft = code ? Math.min(ttl, Math.max(1, Math.ceil((code.expiresAt - now) / 60_000))) : ttl;

  return (
    <main className="screen">
      <BackButton fallback="/family" />
      <div className="stack-8">
        <h1 className="h1">Link your child's phone</h1>
        <p className="lead">On their phone, install Kazikwanza, choose "As a child" and enter this code.</p>
      </div>
      <div className="code-grid" aria-label={code ? `Code ${code.code.split('').join(' ')}` : 'Making a code'} data-testid="link-code" data-code={code?.code}>
        {(code?.code ?? '      ').split('').map((ch, i) => (
          <span key={i} className="code-cell" aria-hidden="true">
            {ch}
          </span>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 14, textAlign: 'center' }}>
        Code expires in {minutesLeft} minute{minutesLeft === 1 ? '' : 's'}
      </span>
      <div className="stack-10 center" style={{ alignSelf: 'center' }}>
        <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code with the family code" role="img" />
        <span className="muted" style={{ fontSize: 14 }}>
          Or scan this with their phone
        </span>
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={share}>
        Share code
      </button>
    </main>
  );
}

/* ───────── New task for a child ───────── */

export function ChildTaskForm() {
  const me = useAccount();
  const data = useData();
  const navigate = useNavigate();
  const back = useBack('/family');
  const [params] = useSearchParams();
  const kids = childrenOf(data, me.id);
  const [childId, setChildId] = useState(params.get('child') ?? kids[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RewardKind>('minutes');
  const [amount, setAmount] = useState(30);
  const [due, setDue] = useState('18:00');
  const [daily, setDaily] = useState(true);
  const child = data.accounts[childId];

  if (!child || child.parentId !== me.id) {
    return (
      <main className="screen">
        <BackButton fallback="/family" />
        <h1 className="h1">Link a child first</h1>
        <div className="spacer" />
        <Link to="/family/link" className="btn btn-primary">
          Link a child
        </Link>
      </main>
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const repeat: Repeat = daily ? 'daily' : 'never';
    if ((await act('addChildTask', { childId, input: { title, rewardKind: kind, amount, repeat, dueTime: due } })).ok) {
      toast(`Sent to ${child.name}`);
      navigate('/family', { replace: true });
    }
  }

  return (
    <form className="screen gap-28" onSubmit={save}>
      <div className="topbar">
        <button type="button" className="link-btn" style={{ fontSize: 16 }} onClick={back}>
          Cancel
        </button>
        <span className="topbar-title">Task for {child.name}</span>
        <div style={{ width: 52 }} />
      </div>
      {kids.length > 1 && (
        <div className="chips">
          {kids.map((k) => (
            <button key={k.id} type="button" className={`chip${k.id === childId ? ' selected' : ''}`} onClick={() => setChildId(k.id)}>
              {k.name}
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="child-task">
          Task
        </label>
        <input id="child-task" className="input" value={title} maxLength={80} placeholder="e.g. Clean your room" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <RewardPicker kind={kind} amount={amount} onKind={setKind} onAmount={setAmount} />
      <div className="stack">
        <label className="row" style={{ cursor: 'pointer' }}>
          <span>Due</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="muted">
            Today, before
            <input
              type="time"
              value={due}
              onChange={(e) => e.target.value && setDue(e.target.value)}
              aria-label="Due time"
              style={{ border: 'none', color: '#52525B', background: 'transparent', fontSize: 16, padding: 0 }}
            />
          </span>
        </label>
        <div className="row">
          <span>Proof</span>
          <span className="value">Photo</span>
        </div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <span>Repeat every day</span>
          <input type="checkbox" className="check" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
        </label>
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" type="submit" disabled={!title.trim() || amount < 1}>
        Send to {child.name}
      </button>
    </form>
  );
}

/* ───────── Approve a child's photo ───────── */

export function ApproveProof() {
  const data = useData();
  const task = useTask();
  const navigate = useNavigate();
  const [redo, setRedo] = useState(false);
  if (!task) return <MissingTask />;
  const kid = data.accounts[task.ownerId];
  const reviewed = task.status !== 'pending';

  return (
    <main className="screen">
      <BackButton fallback="/family" />
      <div className="stack-6">
        <h1 className="h1-sm">{task.title}</h1>
        <span className="muted" style={{ fontSize: 15 }}>
          {kid?.name} sent a photo · {rewardLabel(task.reward.kind, task.reward.amount).replace('+', '')} {task.reward.kind === 'scrolls' ? 'scrolls' : 'screen time'}
        </span>
      </div>
      {reviewed ? (
        <div className="empty-state">{task.status === 'done' ? 'You approved this.' : 'This isn’t waiting for approval any more.'}</div>
      ) : (
        <StoredPhoto taskId={task.id} height={360} label={`${kid?.name}'s photo of ${task.title}`} />
      )}
      <div className="spacer" />
      {!reviewed && (
        <div className="grid-2" style={{ gap: 12 }}>
          <button className="btn btn-secondary" onClick={() => setRedo(true)}>
            Redo
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (await approve(task)) navigate('/family', { replace: true });
            }}
          >
            Approve
          </button>
        </div>
      )}
      {redo && <RedoSheet key={task.id} task={task} onClose={() => setRedo(false)} onDone={() => navigate('/family', { replace: true })} />}
    </main>
  );
}

/* ───────── Child's week & rules ───────── */

function useChild(): Account | undefined {
  const { childId = '' } = useParams();
  const me = useAccount();
  const data = useData();
  const kid = data.accounts[childId];
  return kid && kid.parentId === me.id ? kid : undefined;
}

const GIVE_PRESETS = { scrolls: [10, 20, 50, 100], minutes: [5, 15, 30, 60] } as const;

/** Sheet where a parent gives or takes away scrolls or screen time. */
function AdjustSheet({ kid, mode, onClose }: { kid: Account; mode: 'give' | 'take' | null; onClose: () => void }) {
  const [kind, setKind] = useState<RewardKind>('scrolls');
  const [amount, setAmount] = useState<number>(GIVE_PRESETS.scrolls[1]);
  if (!mode) return null;
  const give = mode === 'give';
  const unit = kind === 'scrolls' ? 'scrolls' : 'min';
  return (
    <Sheet open onClose={onClose} title={give ? `Give ${kid.name}…` : `Take from ${kid.name}…`}>
      <div className="segmented">
        {(['scrolls', 'minutes'] as const).map((k) => (
          <button
            key={k}
            className={kind === k ? 'selected' : undefined}
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setAmount(GIVE_PRESETS[k][1]);
            }}
          >
            {k === 'scrolls' ? 'Scrolls' : 'Screen time'}
          </button>
        ))}
      </div>
      <div className="chips">
        {GIVE_PRESETS[kind].map((n) => (
          <button key={n} className={`chip${amount === n ? ' selected' : ''}`} aria-pressed={amount === n} onClick={() => setAmount(n)}>
            {n} {unit}
          </button>
        ))}
      </div>
      <button
        className="btn btn-primary"
        onClick={async () => {
          if ((await act('adjustChildBalance', { childId: kid.id, kind, amount: give ? amount : -amount })).ok) {
            toast(give ? `Gave ${kid.name} ${amount} ${unit}` : `Took ${amount} ${unit} from ${kid.name}`);
            onClose();
          }
        }}
      >
        {give ? `Give ${amount} ${unit}` : `Take away ${amount} ${unit}`}
      </button>
    </Sheet>
  );
}

/**
 * A parent's view of their child's account, the way the child sees their own:
 * balances (which the parent can top up or take away), today's tasks, screen
 * time used per app, the history, the week, and the rules.
 */
export function ChildWeek() {
  const data = useData();
  const me = useAccount();
  const kid = useChild();
  const now = useNow(5_000);
  const [adjust, setAdjust] = useState<'give' | 'take' | null>(null);
  if (!kid) return <MissingChild />;
  const stats = weekStats(data, kid.id, now);
  const days = dailyCompletions(data, kid.id, now);
  const max = Math.max(1, ...days.map((d) => d.count));
  const locked = lockedAppsOf(kid)
    .map((a) => a.name)
    .join(', ');
  const tasks = todaysTasks(data, kid.id, now);
  const used = minutesUsedToday(kid, now);
  const timed = lockedAppsOf(kid).filter(usesMinutes);
  const history = kid.ledger.slice(0, 15);

  return (
    <main className="screen">
      <BackButton fallback="/family" />
      <div className="topbar">
        <h1 className="h1">{kid.name}'s account</h1>
        <Link to={`/messages/${kid.id}`} className="link-btn strong">
          Message
        </Link>
      </div>

      <div className="card-green">
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="stack-6">
            <span className="sub">Scrolls</span>
            <span className="huge-number" data-testid="child-scrolls">
              {kid.scrolls}
            </span>
          </div>
          <div className="stack-6">
            <span className="sub">Screen time</span>
            <span className="huge-number" data-testid="child-minutes">
              {minutesLeft(kid, now)}
              <small> min</small>
            </span>
          </div>
        </div>
        <span className="sub" style={{ fontSize: 13 }}>
          {unlockLine(kid, now).replace('All apps unlock', 'Apps unlock')}
        </span>
      </div>
      <div className="grid-2">
        <button className="btn btn-primary" style={{ height: 48, borderRadius: 12, fontSize: 15 }} onClick={() => setAdjust('give')}>
          Give
        </button>
        <button className="btn btn-secondary" style={{ height: 48, borderRadius: 12, fontSize: 15 }} onClick={() => setAdjust('take')}>
          Take away
        </button>
      </div>

      <div className="stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 4 }}>
          <h2 className="h2">Today's tasks</h2>
          <Link to={`/family/task/new?child=${kid.id}`} className="link-btn strong" style={{ fontSize: 14, height: 'auto' }}>
            + Add task
          </Link>
        </div>
        {tasks.length === 0 ? (
          <div className="empty-state">No tasks today. Add one so {kid.name} can earn scrolls or screen time.</div>
        ) : (
          tasks.map((t) => (
            <div className="row" key={t.id}>
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span>{t.title}</span>
                <span className="small">
                  {t.status === 'done' ? 'Done' : t.status === 'pending' ? 'Waiting for you' : t.status === 'redo' ? 'Redo' : 'Not done yet'} ·{' '}
                  {rewardLabel(t.reward.kind, t.reward.amount)}
                  {t.reward.kind === 'scrolls' ? ' scrolls' : ''}
                </span>
              </div>
              {t.status === 'pending' && t.verifierId === me.id ? (
                <Link to={`/family/approve/${t.id}`} className="link-btn strong" style={{ fontSize: 14 }}>
                  Check
                </Link>
              ) : (
                <button
                  className="link-btn danger"
                  style={{ fontSize: 14 }}
                  aria-label={`Delete ${t.title}`}
                  onClick={async () => {
                    if (window.confirm(`Delete "${t.title}"?`) && (await act('deleteTask', { taskId: t.id })).ok) toast('Task deleted');
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="stack">
        <h2 className="h2" style={{ marginBottom: 4 }}>
          Screen time used today
        </h2>
        {timed.length === 0 ? (
          <div className="empty-state">No timed apps are locked.</div>
        ) : (
          timed.map((a) => (
            <div className="row" key={a.id}>
              <span>{a.name}</span>
              <span className="muted">{used[a.id] ?? 0} min</span>
            </div>
          ))
        )}
      </div>

      <div className="stack-12">
        <h2 className="h2">This week</h2>
        <div className="grid-3">
          <div className="stat">
            <b>{stats.tasksDone}</b>
            <span className="small">Tasks done</span>
          </div>
          <div className="stat">
            <b>{stats.scrollsEarned}</b>
            <span className="small">Scrolls earned</span>
          </div>
          <div className="stat">
            <b>{stats.scrollsUsed}</b>
            <span className="small">Scrolls used</span>
          </div>
        </div>
        <div className="bars" role="img" aria-label={days.map((d) => `${d.label}: ${d.count}`).join(', ')}>
          {days.map((d, i) => (
            <div key={i} className={i === days.length - 1 ? 'today' : undefined} style={{ height: `${(d.count / max) * 100}%` }} title={`${d.count} done`} />
          ))}
        </div>
        <div className="bar-labels">
          {days.map((d, i) => (
            <span key={i}>{d.label}</span>
          ))}
        </div>
      </div>

      <div className="stack">
        <h2 className="h2" style={{ marginBottom: 4 }}>
          History
        </h2>
        {history.length === 0 ? (
          <div className="empty-state">Nothing yet.</div>
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

      <div className="stack">
        <h2 className="h2" style={{ marginBottom: 4 }}>
          {kid.name}'s rules
        </h2>
        <div className="row">
          <span style={{ whiteSpace: 'nowrap' }}>Locked apps</span>
          <span className="value">{locked || 'None'}</span>
        </div>
        <div className="row">
          <span>Unlock time</span>
          <span className="value">{kid.unlockTime ? formatClock(kid.unlockTime) : 'Off'}</span>
        </div>
      </div>
      <Link to={`/family/child/${kid.id}/rules`} className="btn btn-secondary">
        Edit {kid.name}'s rules
      </Link>
      <AdjustSheet key={adjust ?? 'none'} kid={kid} mode={adjust} onClose={() => setAdjust(null)} />
    </main>
  );
}

function MissingChild() {
  return (
    <main className="screen">
      <BackButton fallback="/family" />
      <h1 className="h1">Child not found</h1>
      <p className="lead">They may have been unlinked.</p>
    </main>
  );
}

export function ChildRules() {
  const kid = useChild();
  const navigate = useNavigate();
  const [locked, setLocked] = useState<string[]>(kid?.lockedApps ?? []);
  const [time, setTime] = useState(kid?.unlockTime ?? '18:00');
  const [noFree, setNoFree] = useState(kid ? kid.unlockTime === null : false);
  const [confirm, setConfirm] = useState(false);
  if (!kid) return <MissingChild />;

  return (
    <main className="screen gap-20">
      <BackButton fallback={`/family/child/${kid.id}`} />
      <h1 className="h1">{kid.name}'s rules</h1>
      <AppList
        owner={{ phoneApps: kid.phoneApps, lockedApps: locked }}
        isOn={(id) => locked.includes(id)}
        onToggle={(a, on) => setLocked(on ? [...locked, a.id] : locked.filter((x) => x !== a.id))}
        control="check"
        whose={`${kid.name}'s`}
      />
      <div className="stack-12">
        <span className="eyebrow">Free unlock time</span>
        <UnlockTimePicker time={time} onTime={setTime} noFree={noFree} onNoFree={setNoFree} />
      </div>
      <div className="spacer" />
      <div className="actions">
        <button
          className="btn btn-primary"
          onClick={async () => {
            if ((await act('setChildRules', { childId: kid.id, rules: { lockedApps: locked, unlockTime: noFree ? null : time } })).ok) {
              toast(`${kid.name}'s rules saved`);
              navigate(`/family/child/${kid.id}`, { replace: true });
            }
          }}
        >
          Save rules
        </button>
        <button className="link-btn danger" onClick={() => setConfirm(true)}>
          Unlink {kid.name}
        </button>
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={`Unlink ${kid.name}?`}>
        <p className="lead">You'll stop seeing their tasks and they can change their own settings again.</p>
        <button
          className="btn btn-primary"
          style={{ background: '#B91C1C' }}
          onClick={async () => {
            if ((await act('unlinkChild', { childId: kid.id })).ok) navigate('/family', { replace: true });
          }}
        >
          Unlink
        </button>
        <button className="btn btn-secondary" onClick={() => setConfirm(false)}>
          Cancel
        </button>
      </Sheet>
    </main>
  );
}

/* ───────── Child side ───────── */

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser can’t scan QR codes. Type the code instead.');
      return;
    }
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const detector = new Ctor({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        timer = window.setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          try {
            const found = await detector.detect(video.current);
            const match = found.map((f) => /^KAZIKWANZA:([A-Z0-9]{6})$/.exec(f.rawValue)).find(Boolean);
            if (match) onCodeRef.current(match[1]);
          } catch {
            /* keep trying */
          }
        }, 400);
      })
      .catch(() => setError('Camera access was blocked. Type the code instead.'));
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Sheet open onClose={onClose} title="Scan your parent's code">
      {error ? (
        <p className="lead">{error}</p>
      ) : (
        <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 16, background: '#000', aspectRatio: '1', objectFit: 'cover' }} />
      )}
      <button className="btn btn-secondary" onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}

export function JoinFamily() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function join(value = code) {
    if ((await act('joinFamily', { code: value })).ok) navigate('/onboarding/permissions?for=child', { replace: true });
  }

  return (
    <main className="screen">
      <BackButton fallback="/onboarding/mode" />
      <div className="stack-8">
        <h1 className="h1">Join your family</h1>
        <p className="lead">Ask your parent for the 6-character code on their phone.</p>
      </div>
      <div className="code-input" onClick={() => inputRef.current?.focus()}>
        <div className="code-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <span
              key={i}
              className={`code-cell${code[i] ? ' filled' : ''}${i === code.length ? ' cursor' : ''}`}
              aria-hidden="true"
            >
              {code[i] ?? ''}
            </span>
          ))}
        </div>
        <input
          ref={inputRef}
          value={code}
          aria-label="Family code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoFocus
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && join()}
        />
      </div>
      <button type="button" className="link-btn strong" style={{ alignSelf: 'center' }} onClick={() => setScan(true)}>
        Scan QR code instead
      </button>
      <div className="spacer" />
      <button className="btn btn-primary" disabled={code.length !== 6} onClick={() => join()}>
        Join
      </button>
      {scan && (
        <QrScanner
          onClose={() => setScan(false)}
          onCode={(c) => {
            setScan(false);
            setCode(c);
            join(c);
          }}
        />
      )}
    </main>
  );
}

export function ChildHome() {
  const me = useAccount();
  const data = useData();
  const now = useNow(1000);
  useUnseenReward(me);
  const parent = me.parentId ? data.accounts[me.parentId] : null;
  const tasks = todaysTasks(data, me.id, now);

  return (
    <main className="screen top">
      <div className="topbar" style={{ alignItems: 'flex-end' }}>
        <div className="stack-4">
          <span className="muted" style={{ fontSize: 15 }}>
            Hi {me.name}
          </span>
          <h1 className="h1-lg">My tasks</h1>
        </div>
        <HeaderActions me={me} showVerify={false} />
      </div>
      <div className="card-tint" style={{ borderRadius: 20, padding: 20, gap: 8 }}>
        <div className="grid-2">
          <div className="stack-6">
            <span className="muted" style={{ fontSize: 14 }}>
              Scrolls
            </span>
            <span className="huge-number" data-testid="scroll-balance">
              {me.scrolls}
            </span>
          </div>
          <Link to="/screen-time" className="stack-6" style={{ color: '#18181B', textDecoration: 'none' }}>
            <span className="muted" style={{ fontSize: 14 }}>
              Screen time
            </span>
            <span className="huge-number">
              {minutesLeft(me, now)}
              <small> min</small>
            </span>
          </Link>
        </div>
        <span className="muted" style={{ fontSize: 14 }}>
          {unlockLine(me, now).replace('All apps unlock', 'Apps unlock')}
        </span>
      </div>
      <Link to="/apps" className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', textDecoration: 'none', color: '#18181B', borderRadius: 14 }}>
        <GridIcon size={20} color="#15803D" />
        <span style={{ flexGrow: 1 }}>Open your apps</span>
        <ChevronIcon size={18} color="#52525B" />
      </Link>
      <div className="stack">
        <h2 className="h2" style={{ marginBottom: 4 }}>
          From {parent?.name ?? 'your parent'}
        </h2>
        {tasks.length === 0 ? (
          <div className="empty-state">No tasks from {parent?.name ?? 'your parent'} yet. They'll show up here.</div>
        ) : (
          tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              data={data}
              href={`/task/${t.id}`}
              action={
                t.status === 'todo' || t.status === 'redo' ? (
                  <Link to={`/task/${t.id}/photo`} className="link-btn strong" style={{ fontSize: 14 }}>
                    {t.status === 'redo' ? 'Send again' : 'Send photo'}
                  </Link>
                ) : t.status === 'pending' ? (
                  <span className="task-reward">{rewardLabel(t.reward.kind, t.reward.amount)}</span>
                ) : (
                  <span className="task-reward done">{rewardLabel(t.reward.kind, t.reward.amount)}</span>
                )
              }
            />
          ))
        )}
      </div>
    </main>
  );
}

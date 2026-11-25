import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppIcon } from '../components/AppList';
import { BackButton, Sheet, StoredPhoto } from '../components/ui';
import { appsFor } from '../lib/apps';
import { BACKGROUNDS, setLockPhoto, useLockBackground, useLockPhoto } from '../lib/backgrounds';
import { compressImage } from '../lib/photos';
import { FOCUS_PRESETS, MAX_FOCUS_MINUTES, activeSchedules, describeSchedule, restrictionLabel, scheduleEndsAt } from '../lib/blocks';
import { REVIEW_DAYS, canReview, newId, rewardLabel, selfCheckedHistory } from '../lib/logic';
import { act, toast, useAccount, useData, useNow } from '../lib/store';
import { DAY, dayLabel, formatTimeOfDay } from '../lib/time';
import type { Account, BlockSchedule } from '../lib/types';
import { DEFAULT_CHEERS } from '../lib/cheers';

/* ───────── Lock screen messages ───────── */

const PRESET_MESSAGES = [
  ...DEFAULT_CHEERS,
  'Small steps every day add up.',
  'You are stronger than the scroll.',
  'Finish it, then enjoy it.',
  'Your goals are worth more than one more video.',
  'Proud of you for pausing.',
  'Discipline today, freedom tomorrow.',
  'Go make something real.',
];

/** Pick encouraging lines for the lock screen, or write your own. One is shown each time an app is locked. */
export function LockMessages() {
  const me = useAccount();
  const chosen = me.lockMessages ?? [];
  const [custom, setCustom] = useState('');

  const save = async (next: string[]) => {
    await act('updateProfile', { patch: { lockMessages: next } });
  };
  const toggle = (m: string) => void save(chosen.includes(m) ? chosen.filter((x) => x !== m) : [...chosen, m]);
  const mine = chosen.filter((m) => !PRESET_MESSAGES.includes(m));

  return (
    <main className="screen">
      <BackButton fallback="/profile" />
      <div className="stack-8">
        <h1 className="h1">Lock screen messages</h1>
        <p className="lead">When an app is locked, Kazikwanza shows one of these to keep you going. Pick some, or write your own.</p>
      </div>
      <div className="stack">
        <span className="eyebrow">Your own</span>
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            const text = custom.trim();
            if (!text) return;
            if (chosen.length >= 20) {
              toast('You can keep up to 20 messages');
              return;
            }
            void save([...chosen.filter((x) => x !== text), text]);
            setCustom('');
          }}
        >
          <input className="input" aria-label="Your own message" placeholder="e.g. Mum believes in you" maxLength={120} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!custom.trim()} style={{ width: 'auto', padding: '0 18px' }}>
            Add
          </button>
        </form>
        {mine.map((m) => (
          <div className="row" key={m}>
            <span>“{m}”</span>
            <button className="link-btn danger" style={{ fontSize: 14 }} onClick={() => toggle(m)} aria-label={`Remove ${m}`}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="stack">
        <span className="eyebrow">Ideas</span>
        {PRESET_MESSAGES.map((m) => (
          <label key={m} className="row" style={{ cursor: 'pointer' }}>
            <span>“{m}”</span>
            <input type="checkbox" className="check" checked={chosen.includes(m)} onChange={() => toggle(m)} aria-label={m} />
          </label>
        ))}
      </div>
    </main>
  );
}

/* ───────── Blocked times and focus timer ───────── */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
}

/** Ticks apps to block, with a search box once the list gets long. */
function AppChecks({ owner, value, onChange }: { owner: Account; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const all = appsFor(owner);
  const shown = q.trim() ? all.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())) : all;
  return (
    <div className="stack">
      {all.length > 12 && <input className="input" type="search" aria-label="Search apps" placeholder="Search apps" value={q} onChange={(e) => setQ(e.target.value)} />}
      {shown.map((a) => (
        <label key={a.id} className="row app-row" style={{ cursor: 'pointer' }}>
          <AppIcon app={a} size={30} />
          <span className="app-row-body">
            <span>{a.name}</span>
          </span>
          <input
            type="checkbox"
            className="check"
            aria-label={`Block ${a.name}`}
            checked={value.includes(a.id)}
            onChange={() => onChange(value.includes(a.id) ? value.filter((x) => x !== a.id) : [...value, a.id])}
          />
        </label>
      ))}
    </div>
  );
}

function BlockSheet({ owner, block, onClose, onSave }: { owner: Account; block: BlockSchedule | null; onClose: () => void; onSave: (b: BlockSchedule) => void }) {
  const [name, setName] = useState(block?.name ?? 'Bedtime');
  const [start, setStart] = useState(block?.start ?? '21:00');
  const [end, setEnd] = useState(block?.end ?? '07:00');
  const [days, setDays] = useState<number[]>(block?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [apps, setApps] = useState<string[]>(block?.apps ?? owner.lockedApps);
  const [mode, setMode] = useState<'block' | 'minutes' | 'scrolls'>(block?.limit?.kind ?? 'block');
  const [amount, setAmount] = useState<number>(block?.limit?.amount ?? 30);
  return (
    <Sheet open onClose={onClose} title={block ? 'Change restriction' : 'New restriction'}>
      <div className="field">
        <label className="label" htmlFor="block-name">
          Name
        </label>
        <input id="block-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="block-start">
            From
          </label>
          <input id="block-start" className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="block-end">
            Until
          </label>
          <input id="block-end" className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="chips" role="group" aria-label="Days">
        {DAYS.map((d, i) => (
          <button
            key={d}
            type="button"
            className={`chip${days.includes(i) ? ' selected' : ''}`}
            aria-pressed={days.includes(i)}
            onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}
          >
            {d}
          </button>
        ))}
      </div>
      <span className="eyebrow">Restriction</span>
      <div className="segmented" role="group" aria-label="Restriction">
        {(
          [
            ['block', 'Block completely'],
            ['minutes', 'Limit minutes'],
            ['scrolls', 'Limit scrolls'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" className={mode === m ? 'selected' : undefined} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {mode !== 'block' && (
        <div className="field">
          <label className="label" htmlFor="limit-amount">
            {mode === 'minutes' ? 'Minutes allowed in total during this time' : 'Swipes allowed in total during this time'}
          </label>
          <input
            id="limit-amount"
            className="input"
            type="number"
            min={1}
            max={mode === 'minutes' ? 600 : 1000}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Math.round(Number(e.target.value) || 1)))}
          />
        </div>
      )}
      <span className="eyebrow">{mode === 'block' ? 'Apps that can’t be opened at all' : 'Apps that share this limit'}</span>
      <AppChecks owner={owner} value={apps} onChange={setApps} />
      <button
        className="btn btn-primary"
        onClick={() =>
          onSave({
            id: block?.id ?? newId('b'),
            name: name.trim() || 'Restriction',
            start,
            end,
            days,
            apps,
            ...(mode === 'block' ? {} : { limit: { kind: mode, amount } }),
          })
        }
        disabled={apps.length === 0 || days.length === 0 || start === end}
      >
        Save restriction
      </button>
    </Sheet>
  );
}

/** The day's restrictions at a glance, for the home screen, with a link to set them up. */
export function RestrictionsCard({ owner }: { owner: Account }) {
  const now = useNow(30_000);
  const blocks = owner.blocks ?? [];
  return (
    <div className="card stack-8" data-testid="restrictions-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="strong">Restrictions</span>
        <Link to="/settings/blocks" className="link-btn strong" style={{ fontSize: 14, height: 'auto' }}>
          {blocks.length ? 'Change' : 'Set up'}
        </Link>
      </div>
      {blocks.length === 0 ? (
        <span className="small">Block or limit apps from one time of day to another, like “Bedtime, 9 PM to 7 AM”.</span>
      ) : (
        blocks.map((b) => {
          const ends = scheduleEndsAt(b, now);
          return (
            <span key={b.id} className="small">
              <strong>{b.name}</strong> · {describeSchedule(b)} · {restrictionLabel(b)}
              {ends !== null && <span className="amber"> · On until {formatTimeOfDay(ends)}</span>}
            </span>
          );
        })
      )}
    </div>
  );
}

/**
 * A countdown that blocks the chosen apps from now: shows the time left while
 * it runs, and lets you pick the length (presets or any number of minutes)
 * and the apps. Used on the home screen and the restrictions page.
 */
export function FocusTimerCard({ owner, childId }: { owner: Account; childId?: string }) {
  const now = useNow(1000);
  const [focusApps, setFocusApps] = useState<string[]>(owner.focus?.apps ?? owner.lockedApps);
  const [minutes, setMinutes] = useState(60);
  const [confirm, setConfirm] = useState(false);
  const focus = owner.focus && owner.focus.until > now ? owner.focus : null;
  const extra = childId ? { childId } : {};
  const names = appsFor(owner)
    .filter((a) => focus?.apps.includes(a.id))
    .map((a) => a.name)
    .join(', ');
  return (
    <div className="card stack-12" data-testid="focus-card">
      <span className="strong">Focus timer</span>
      {focus ? (
        <>
          <span className="big-number" data-testid="focus-countdown" style={{ fontSize: 34 }}>
            {countdown(focus.until - now)}
          </span>
          <span className="small">
            {names} blocked until {formatTimeOfDay(focus.until)}. It can’t be stopped early.
          </span>
        </>
      ) : (
        <span className="small">Block apps for a set time, starting now.</span>
      )}
      <div className="chips" role="group" aria-label="Focus length">
        {FOCUS_PRESETS.map((m) => (
          <button key={m} type="button" className={`chip${minutes === m ? ' selected' : ''}`} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
            {m < 60 ? `${m} min` : `${m / 60} h`}
          </button>
        ))}
        <input
          className="input"
          style={{ width: 110, height: 40 }}
          type="number"
          min={1}
          max={MAX_FOCUS_MINUTES}
          aria-label="Minutes"
          value={minutes}
          onChange={(e) => setMinutes(Math.max(1, Math.min(MAX_FOCUS_MINUTES, Math.round(Number(e.target.value) || 1))))}
        />
      </div>
      <button className="btn btn-primary" onClick={() => setConfirm(true)}>
        {focus ? `Add ${minutes} min` : `Start ${minutes}-minute focus timer`}
      </button>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={`Block apps for ${minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`}?`}>
        <span className="small">Pick the apps. Once it starts, the timer can’t be stopped early.</span>
        <AppChecks owner={owner} value={focusApps} onChange={setFocusApps} />
        <button
          className="btn btn-primary"
          disabled={focusApps.length === 0}
          onClick={async () => {
            if ((await act('startFocus', { apps: focusApps, minutes, ...extra })).ok) {
              toast('Focus timer started');
              setConfirm(false);
            }
          }}
        >
          Start now
        </button>
      </Sheet>
    </div>
  );
}

/**
 * Daily blocked times and a focus timer, for yourself or (from a parent's
 * phone) for a child. Blocked apps can't be opened at all, even with scrolls
 * or during the free unlock.
 */
export function Blocks() {
  const me = useAccount();
  const data = useData();
  const now = useNow(1000);
  const { childId } = useParams();
  const owner = childId ? data.accounts[childId] : me;
  const [editing, setEditing] = useState<BlockSchedule | 'new' | null>(null);
  if (!owner || (childId && owner.parentId !== me.id)) {
    return (
      <main className="screen">
        <BackButton fallback="/family" />
        <h1 className="h1">Child not found</h1>
      </main>
    );
  }
  const forChild = !!childId;
  const whose = forChild ? `${owner.name}'s` : 'Your';
  // A linked child can start a focus timer, but their parent sets their blocked times.
  const canEdit = forChild || !(me.mode === 'child' && me.parentId);
  const blocks = owner.blocks ?? [];
  const activeIds = new Set(activeSchedules(owner, now).map((b) => b.id));
  const extra = childId ? { childId } : {};
  const appNames = (ids: string[]) =>
    appsFor(owner)
      .filter((a) => ids.includes(a.id))
      .map((a) => a.name)
      .join(', ');

  async function saveBlocks(next: BlockSchedule[]) {
    if ((await act('setBlocks', { blocks: next, ...extra })).ok) {
      toast('Blocked times saved');
      setEditing(null);
    }
  }

  return (
    <main className="screen">
      <BackButton fallback={forChild ? `/family/child/${childId}` : '/profile'} />
      <div className="stack-8">
        <h1 className="h1">{forChild ? `${owner.name}'s restrictions` : 'Restrictions and timer'}</h1>
        <p className="lead">From one time of day to another, block apps completely or limit how much they can be used. Restrictions apply even with scrolls or after the unlock time.</p>
      </div>

      <FocusTimerCard owner={owner} childId={childId} />

      <div className="stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 4 }}>
          <h2 className="h2">{whose} daily restrictions</h2>
          {canEdit && blocks.length < 10 && (
            <button className="link-btn strong" style={{ fontSize: 14, height: 'auto' }} onClick={() => setEditing('new')}>
              + Add
            </button>
          )}
        </div>
        {blocks.length === 0 && (
          <div className="empty-state">No restrictions yet. Add one, like “Bedtime, 9 PM to 7 AM, blocked” or “After school, 3 to 6 PM, 30 minutes”.</div>
        )}
        {blocks.map((b) => {
          const on = activeIds.has(b.id);
          const ends = on ? scheduleEndsAt(b, now) : null;
          const locked = on && !forChild;
          return (
            <div className="row" key={b.id} style={{ alignItems: 'flex-start', paddingTop: 10, paddingBottom: 10 }}>
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span className="strong">
                  {b.name}
                  {on && <span className="amber"> · On until {formatTimeOfDay(ends!)}</span>}
                </span>
                <span className="small">{describeSchedule(b)}</span>
                <span className="small">{restrictionLabel(b)}</span>
                <span className="small">{appNames(b.apps)}</span>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 12 }}>
                  <button className="link-btn strong" style={{ fontSize: 14 }} disabled={locked} onClick={() => setEditing(b)} aria-label={`Change ${b.name}`}>
                    Change
                  </button>
                  <button
                    className="link-btn danger"
                    style={{ fontSize: 14 }}
                    disabled={locked}
                    aria-label={`Delete ${b.name}`}
                    onClick={() => void saveBlocks(blocks.filter((x) => x.id !== b.id))}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!canEdit && <span className="small">Your parent sets your restrictions.</span>}
      </div>

      {editing && (
        <BlockSheet
          owner={owner}
          block={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(b) => void saveBlocks(editing === 'new' ? [...blocks, b] : blocks.map((x) => (x.id === b.id ? b : x)))}
        />
      )}
    </main>
  );
}

/* ───────── Lock screen background ───────── */

/** Pick the lock screen's background: a preset, or your own photo (kept on this phone). */
export function LockBackground() {
  const me = useAccount();
  const own = useLockPhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const current = me.lockBackground ?? 'plain';
  const preview = useLockBackground(current);

  const choose = (id: string) => void act('updateProfile', { patch: { lockBackground: id } });

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const url = await compressImage(file, 900, 0.7);
      if (!setLockPhoto(url)) {
        toast('Not enough space on this phone for that photo');
        return;
      }
      choose('photo');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that photo');
    }
  }

  return (
    <main className="screen">
      <BackButton fallback="/profile" />
      <div className="stack-8">
        <h1 className="h1">Lock screen background</h1>
        <p className="lead">Shown behind your encouragement when an app is locked.</p>
      </div>
      <div className={`lock-preview${preview.dark ? ' on-dark' : ''}`} style={preview.style} data-testid="lock-preview">
        <span className="h1" style={{ fontSize: 20 }}>
          TikTok is locked
        </span>
        <span className="cheer" style={{ fontSize: 15 }}>
          “{me.lockMessages?.[0] ?? 'Do the work first. Then scroll.'}”
        </span>
      </div>
      <div className="bg-grid">
        {BACKGROUNDS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`bg-swatch${current === b.id ? ' selected' : ''}`}
            style={{ background: b.css, color: b.dark ? '#fff' : 'var(--ink)' }}
            aria-pressed={current === b.id}
            onClick={() => choose(b.id)}
          >
            {b.name}
          </button>
        ))}
        <button
          type="button"
          className={`bg-swatch${current === 'photo' ? ' selected' : ''}`}
          style={own ? { background: `url(${own}) center / cover`, color: '#fff' } : undefined}
          aria-pressed={current === 'photo'}
          onClick={() => (own ? choose('photo') : fileRef.current?.click())}
        >
          {own ? 'Your photo' : '+ Your photo'}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="sr-only" data-testid="background-input" />
      {own && (
        <button className="link-btn strong" style={{ alignSelf: 'flex-start' }} onClick={() => fileRef.current?.click()}>
          Choose a different photo
        </button>
      )}
      <span className="small">Your photo stays on this phone only.</span>
    </main>
  );
}

/* ───────── Task history and friends' reviews ───────── */

/**
 * Self-checked tasks with the photo and answers given. Your own, or (when
 * they let you) those of someone whose work you check, who you can disallow.
 */
export function TaskHistory() {
  const me = useAccount();
  const data = useData();
  const now = useNow(60_000);
  const { personId } = useParams();
  const ownerId = personId ?? me.id;
  const owner = data.accounts[ownerId];
  const reviewing = ownerId !== me.id;
  const [target, setTarget] = useState<{ taskId: string; proofId: string; title: string } | null>(null);
  const [reason, setReason] = useState('');
  if (!owner || (reviewing && !canReview(data, me.id, ownerId))) {
    return (
      <main className="screen">
        <BackButton fallback="/requests" />
        <h1 className="h1">Task history</h1>
        <div className="empty-state">{owner ? `${owner.name} hasn’t turned on reviews of their self-checked tasks.` : 'Person not found.'}</div>
      </main>
    );
  }
  const items = selfCheckedHistory(data, ownerId);

  return (
    <main className="screen">
      <BackButton fallback={reviewing ? '/requests' : '/profile'} />
      <div className="stack-8">
        <h1 className="h1">{reviewing ? `${owner.name}'s task history` : 'Your task history'}</h1>
        <p className="lead">
          {reviewing
            ? `Tasks ${owner.name} checked by themselves, with their photo and answers. If one doesn’t hold up, disallow it and the reward is taken back.`
            : owner.letFriendsReview
              ? 'Tasks you checked by yourself. The person who checks your work can see these and disallow one.'
              : 'Tasks you checked by yourself, with your photo and answers.'}
        </p>
      </div>
      {items.length === 0 && <div className="empty-state">No self-checked tasks yet.</div>}
      {items.map(({ task, proof }) => {
        const latest = task.proofs?.[0]?.id === proof.id;
        const canStill = reviewing && !proof.disallowed && now - proof.at <= REVIEW_DAYS * DAY;
        return (
          <div key={proof.id} className="card stack-12" data-testid="history-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="strong">{task.title}</span>
                <span className="small">{dayLabel(proof.at, now)}</span>
              </div>
              <span className="strong" style={{ color: proof.disallowed ? '#B91C1C' : '#15803D', whiteSpace: 'nowrap' }}>
                {proof.disallowed ? 'Disallowed' : rewardLabel(proof.reward.kind, proof.reward.amount)}
              </span>
            </div>
            {proof.disallowed && (
              <div className="redo-note">
                {data.accounts[proof.disallowed.by]?.name ?? 'Their verifier'} disallowed this{proof.disallowed.reason ? `: ${proof.disallowed.reason}` : '.'}
              </div>
            )}
            {proof.photo && latest && <StoredPhoto taskId={task.id} height={160} label={`Photo of ${task.title}`} />}
            {proof.answers.map((x, i) => (
              <div key={i} className="stack-4">
                <span className="small">{x.q}</span>
                <span>{x.a}</span>
              </div>
            ))}
            {canStill && (
              <button
                className="btn btn-secondary"
                style={{ height: 44 }}
                onClick={() => {
                  setReason('');
                  setTarget({ taskId: task.id, proofId: proof.id, title: task.title });
                }}
              >
                Disallow
              </button>
            )}
          </div>
        );
      })}
      <Sheet open={!!target} onClose={() => setTarget(null)} title={`Disallow “${target?.title ?? ''}”?`}>
        <span className="small">The reward is taken back and {owner.name} is told why.</span>
        <input className="input" aria-label="Why" placeholder="e.g. That photo is from last week" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button
          className="btn btn-primary"
          onClick={async () => {
            if (target && (await act('disallowProof', { taskId: target.taskId, proofId: target.proofId, reason })).ok) {
              toast('Disallowed');
              setTarget(null);
            }
          }}
        >
          Disallow
        </button>
      </Sheet>
    </main>
  );
}

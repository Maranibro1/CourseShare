import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppIcon } from '../components/AppList';
import { BackButton, Sheet } from '../components/ui';
import { appsFor } from '../lib/apps';
import { FOCUS_PRESETS, MAX_FOCUS_MINUTES, activeSchedules, describeSchedule, scheduleEndsAt } from '../lib/blocks';
import { newId } from '../lib/logic';
import { act, toast, useAccount, useData, useNow } from '../lib/store';
import { formatTimeOfDay } from '../lib/time';
import type { Account, BlockSchedule } from '../lib/types';
import { DEFAULT_CHEERS } from './Apps';

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
  return (
    <Sheet open onClose={onClose} title={block ? 'Change blocked time' : 'New blocked time'}>
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
      <span className="eyebrow">Apps that can’t be opened at all</span>
      <AppChecks owner={owner} value={apps} onChange={setApps} />
      <button
        className="btn btn-primary"
        onClick={() => onSave({ id: block?.id ?? newId('b'), name: name.trim() || 'Blocked time', start, end, days, apps })}
        disabled={apps.length === 0 || days.length === 0 || start === end}
      >
        Save blocked time
      </button>
    </Sheet>
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
  const [focusApps, setFocusApps] = useState<string[]>(owner?.lockedApps ?? []);
  const [minutes, setMinutes] = useState(60);
  const [confirm, setConfirm] = useState(false);
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
  const focus = owner.focus && owner.focus.until > now ? owner.focus : null;
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
        <h1 className="h1">{forChild ? `${owner.name}'s blocked times` : 'Blocked times'}</h1>
        <p className="lead">Blocked apps can’t be opened at all, even with scrolls or after the unlock time.</p>
      </div>

      <div className="card stack-12">
        <span className="strong">Focus timer</span>
        {focus ? (
          <>
            <span className="big-number" data-testid="focus-countdown" style={{ fontSize: 34 }}>
              {countdown(focus.until - now)}
            </span>
            <span className="small">
              {appNames(focus.apps)} blocked until {formatTimeOfDay(focus.until)}. It can’t be stopped early.
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
            onChange={(e) => setMinutes(Math.max(1, Math.min(MAX_FOCUS_MINUTES, Number(e.target.value) || 1)))}
          />
        </div>
        <button className="btn btn-primary" onClick={() => setConfirm(true)} disabled={focusApps.length === 0}>
          {focus ? `Add ${minutes} min` : `Start ${minutes}-minute focus timer`}
        </button>
      </div>

      <div className="stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 4 }}>
          <h2 className="h2">{whose} daily blocked times</h2>
          {canEdit && blocks.length < 10 && (
            <button className="link-btn strong" style={{ fontSize: 14, height: 'auto' }} onClick={() => setEditing('new')}>
              + Add
            </button>
          )}
        </div>
        {blocks.length === 0 && <div className="empty-state">No blocked times yet. Add one, like “Bedtime, 9 PM to 7 AM”.</div>}
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
        {!canEdit && <span className="small">Your parent sets your blocked times.</span>}
      </div>

      {editing && (
        <BlockSheet
          owner={owner}
          block={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(b) => void saveBlocks(editing === 'new' ? [...blocks, b] : blocks.map((x) => (x.id === b.id ? b : x)))}
        />
      )}
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
    </main>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatIcon } from '../components/Icons';
import { Avatar, BackButton, Sheet, StoredPhoto } from '../components/ui';
import { contactsOf, requestsFor, reviewedBy, rewardLabel } from '../lib/logic';
import { deletePhoto } from '../lib/photos';
import { act, toast, useAccount, useData, useNow } from '../lib/store';
import { timeAgo } from '../lib/time';
import type { Task } from '../lib/types';
import { homePath } from './Tasks';

const REDO_REASONS = ['The photo was too blurry', 'The task isn’t finished yet', 'This photo doesn’t show the task'];

/** Sheet that asks why a photo needs redoing, then sends it back. */
export function RedoSheet({ task, onClose, onDone }: { task: Task | null; onClose: () => void; onDone?: () => void }) {
  const [reason, setReason] = useState(REDO_REASONS[0]);
  const [custom, setCustom] = useState('');
  if (!task) return null;
  return (
    <Sheet open onClose={onClose} title={`Ask to redo “${task.title}”`}>
      <div className="chips" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {[...REDO_REASONS, 'Something else'].map((r) => (
          <label key={r} className={`radio-row${reason === r ? ' selected' : ''}`}>
            <input type="radio" name="redo" checked={reason === r} onChange={() => setReason(r)} />
            <span>{r}</span>
          </label>
        ))}
      </div>
      {reason === 'Something else' && (
        <input className="input" placeholder="Tell them what to fix" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Reason" autoFocus />
      )}
      <button
        className="btn btn-primary"
        onClick={async () => {
          const why = reason === 'Something else' ? custom : reason;
          if ((await act('requestRedo', { taskId: task.id, reason: why })).ok) {
            void deletePhoto(task.id);
            toast('Sent back to redo');
            onClose();
            onDone?.();
          }
        }}
      >
        Send back
      </button>
    </Sheet>
  );
}

export async function approve(task: Task): Promise<boolean> {
  const { ok } = await act('approveTask', { taskId: task.id });
  if (ok) toast(`Approved. ${rewardLabel(task.reward.kind, task.reward.amount)} ${task.reward.kind === 'scrolls' ? 'scrolls' : 'screen time'} sent.`);
  return ok;
}

export function Requests() {
  const me = useAccount();
  const data = useData();
  const now = useNow(30_000);
  const [redo, setRedo] = useState<Task | null>(null);
  const pending = requestsFor(data, me.id);
  const earlier = reviewedBy(data, me.id, 8);
  const people = contactsOf(data, me.id).filter((c) => c.id && (c.checksWith || c.roles.includes('Your child')));

  return (
    <main className="screen top">
      <BackButton fallback={homePath(me)} />
      <div className="stack-4">
        <h1 className="h1-lg">People I verify for</h1>
        <span className="muted" style={{ fontSize: 15 }}>
          Check their photos and message them about their tasks.
        </span>
      </div>
      {people.length === 0 ? (
        <div className="empty-state">
          No one yet. When someone adds <strong>{me.email}</strong> as their verifier, they show up here with their photos.
        </div>
      ) : (
        <div className="stack">
          {people.map((p) => {
            const waiting = pending.filter((t) => t.ownerId === p.id).length;
            return (
              <div key={p.id} className="contact-row">
                <Avatar name={p.name} solid size={44} />
                <div className="contact-body">
                  <span className="strong">{p.name}</span>
                  <span className="small">{waiting ? `${waiting} photo${waiting === 1 ? '' : 's'} to check` : p.roles.join(' · ')}</span>
                </div>
                <Link to={`/messages/${p.id}`} className="icon-circle sm" aria-label={`Message ${p.name}`}>
                  <ChatIcon size={20} />
                </Link>
              </div>
            );
          })}
        </div>
      )}
      {pending.length > 0 && <h2 className="h2">Photos to check</h2>}
      {pending.map((t) => {
        const owner = data.accounts[t.ownerId];
        return (
          <div key={t.id} className="card stack-12" style={{ gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={owner?.name ?? '?'} solid size={40} />
              <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
                <span className="strong">{owner?.name}</span>
                <span className="small">
                  {t.title} · {t.submittedAt ? timeAgo(t.submittedAt, now).toLowerCase() : ''}
                </span>
              </div>
              <span className="strong">{rewardLabel(t.reward.kind, t.reward.amount)}</span>
              <Link to={`/messages/${t.ownerId}`} className="icon-circle sm" aria-label={`Message ${owner?.name ?? 'them'}`}>
                <ChatIcon size={20} />
              </Link>
            </div>
            <StoredPhoto taskId={t.id} height={200} label={`${owner?.name}'s photo of ${t.title}`} />
            <div className="grid-2">
              <button className="btn btn-secondary" style={{ height: 48, borderRadius: 12, fontSize: 15 }} onClick={() => setRedo(t)}>
                Ask to redo
              </button>
              <button className="btn btn-primary" style={{ height: 48, borderRadius: 12, fontSize: 15 }} onClick={() => void approve(t)}>
                Approve
              </button>
            </div>
          </div>
        );
      })}
      {earlier.length > 0 && (
        <div className="stack">
          <h2 className="h2" style={{ marginBottom: 4 }}>
            Earlier
          </h2>
          {earlier.map((t) => (
            <div className="row" key={t.id}>
              <span>
                {data.accounts[t.ownerId]?.name} · {t.title}
              </span>
              {t.status === 'redo' ? (
                <span className="muted" style={{ fontSize: 14 }}>
                  Asked to redo
                </span>
              ) : (
                <span className="strong green-text" style={{ fontSize: 14 }}>
                  Approved
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <RedoSheet key={redo?.id} task={redo} onClose={() => setRedo(null)} />
    </main>
  );
}

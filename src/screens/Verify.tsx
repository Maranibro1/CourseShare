import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CameraIcon, ChevronIcon, ProveIcon } from '../components/Icons';
import { NavScreen } from '../components/ui';
import { QUESTIONS_FALLBACK_MS, approverName, canFallBackToQuestions, requestsFor, rewardLabel, todaysTasks } from '../lib/logic';
import { act, toast, useAccount, useData, useNow } from '../lib/store';
import { formatHoursMinutes } from '../lib/time';
import type { Task } from '../lib/types';
import { PhotoCheckCard, RedoSheet } from './Requests';

function ProveRow({ task }: { task: Task }) {
  const data = useData();
  const now = useNow(30_000);
  const who = approverName(data, task);
  const reward = rewardLabel(task.reward.kind, task.reward.amount);

  if (task.status === 'pending') {
    const fallback = canFallBackToQuestions(task, now);
    const wait = task.submittedAt ? QUESTIONS_FALLBACK_MS - (now - task.submittedAt) : 0;
    return (
      <div className="prove-row">
        <div className="tick waiting" />
        <div className="task-body">
          <span>{task.title}</span>
          <span className="amber" style={{ fontSize: 13 }}>
            Waiting for {who}
            {!task.verifierId && !fallback && wait > 0 ? ` · questions in ${formatHoursMinutes(wait)}` : ''}
          </span>
        </div>
        {fallback ? (
          <Link to={`/task/${task.id}/questions`} className="link-btn strong" style={{ fontSize: 14 }}>
            Answer instead
          </Link>
        ) : (
          <button
            className="link-btn strong"
            style={{ fontSize: 14 }}
            onClick={async () => {
              if ((await act('remindApprover', { taskId: task.id })).ok) toast(`Reminder sent to ${who}`);
            }}
          >
            Remind
          </button>
        )}
      </div>
    );
  }

  const photo = task.verify === 'photo';
  return (
    <Link to={`/task/${task.id}/${photo ? 'photo' : 'questions'}`} className="prove-row" aria-label={`Prove ${task.title}`}>
      <div className="prove-icon">{photo ? <CameraIcon size={20} color="#15803D" /> : <ProveIcon size={20} color="#15803D" />}</div>
      <div className="task-body">
        <span>{task.title}</span>
        <span className="small" style={task.status === 'redo' ? { color: '#B91C1C' } : undefined}>
          {task.status === 'redo'
            ? `Redo${task.redoReason ? `: ${task.redoReason}` : ''}`
            : photo
              ? `Send a photo to ${who}`
              : 'Answer 3 questions'}
        </span>
      </div>
      <span className="task-reward">{reward}</span>
      <ChevronIcon size={18} color="#52525B" />
    </Link>
  );
}

/**
 * The Verify tab: everything about proving work in one place. Your own tasks
 * waiting for proof (photo or questions), the ones waiting for your verifier,
 * and photos other people sent you to check.
 */
export function Verify() {
  const me = useAccount();
  const data = useData();
  const now = useNow(30_000);
  const [redo, setRedo] = useState<Task | null>(null);
  const mine = todaysTasks(data, me.id, now).filter((t) => t.status !== 'done');
  const toProve = mine.filter((t) => t.status === 'todo' || t.status === 'redo');
  const waiting = mine.filter((t) => t.status === 'pending');
  const toCheck = requestsFor(data, me.id);

  return (
    <NavScreen>
      <div className="stack-4">
        <h1 className="h1-lg">Verify</h1>
        <span className="muted" style={{ fontSize: 15 }}>
          Prove your finished tasks and check other people&apos;s.
        </span>
      </div>

      <div className="stack">
        <h2 className="h2" style={{ marginBottom: 4 }}>
          Prove your tasks
        </h2>
        {toProve.length === 0 && waiting.length === 0 ? (
          <div className="empty-state">
            Nothing to prove right now. <Link to="/task/new">Add a task</Link> and choose what it&apos;s worth.
          </div>
        ) : (
          <>
            {[...toProve].sort((a, b) => Number(b.status === 'redo') - Number(a.status === 'redo')).map((t) => (
              <ProveRow key={t.id} task={t} />
            ))}
            {waiting.map((t) => (
              <ProveRow key={t.id} task={t} />
            ))}
          </>
        )}
      </div>

      <div className="stack-12">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="h2">Check others&apos; work</h2>
          <Link to="/requests" className="link-btn strong" style={{ fontSize: 14, height: 'auto' }}>
            People I verify for
          </Link>
        </div>
        {toCheck.length === 0 ? (
          <div className="empty-state">No photos waiting. When someone sends you one, it shows up here.</div>
        ) : (
          toCheck.map((t) => <PhotoCheckCard key={t.id} task={t} onRedo={setRedo} />)
        )}
      </div>
      <RedoSheet key={redo?.id} task={redo} onClose={() => setRedo(null)} />
    </NavScreen>
  );
}

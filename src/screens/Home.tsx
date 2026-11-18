import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckIcon, ChevronIcon, GridIcon, PlusIcon } from '../components/Icons';
import { HeaderActions, NavScreen } from '../components/ui';
import { lockedNames } from '../lib/apps';
import { approverName, freeUnlockActive, minutesLeft, rewardLabel, todaysTasks } from '../lib/logic';
import { useAccount, useData, useNow } from '../lib/store';
import { formatClock, greeting } from '../lib/time';
import type { Account, AppData, Task } from '../lib/types';

export function unlockLine(me: Account, now: number): string {
  if (me.lockedApps.length === 0) return 'No apps are locked';
  if (!me.unlockTime) return 'No free unlock. Earn every scroll.';
  if (freeUnlockActive(me, now)) return 'All apps are unlocked until midnight';
  return `All apps unlock at ${formatClock(me.unlockTime)}`;
}

/** Sends the owner to the celebration screen for any approval they haven't seen yet. */
export function useUnseenReward(me: Account) {
  const data = useData();
  const navigate = useNavigate();
  const unseen = Object.values(data.tasks).find((t) => t.ownerId === me.id && t.status === 'done' && !t.rewardSeen && t.approvedBy);
  useEffect(() => {
    if (unseen) navigate(`/earned/${unseen.id}`);
  }, [unseen, navigate]);
}

export function TaskRow({ task, data, href, action }: { task: Task; data: AppData; href?: string; action?: React.ReactNode }) {
  const reward = rewardLabel(task.reward.kind, task.reward.amount);
  const done = task.status === 'done';
  let sub: React.ReactNode = null;
  if (task.status === 'pending') {
    sub = <span className="amber" style={{ fontSize: 13 }}>{task.verifierId ? `Waiting for ${approverName(data, task)}` : 'Waiting for approval'}</span>;
  } else if (task.status === 'redo') {
    sub = (
      <span style={{ fontSize: 13, color: '#B91C1C' }}>
        Redo{task.redoReason ? `: ${task.redoReason}` : ''}
      </span>
    );
  } else if (task.dueTime && !done) {
    sub = <span className="small">Due before {formatClock(task.dueTime)}</span>;
  }
  const body = (
    <>
      {done ? (
        <div className="tick">
          <CheckIcon size={14} color="#fff" width={3} />
        </div>
      ) : (
        <div className={task.status === 'pending' ? 'tick waiting' : 'tick empty'} />
      )}
      <div className="task-body">
        <span className={done ? 'strike' : undefined}>{task.title}</span>
        {sub}
      </div>
      {action ?? <span className={done ? 'task-reward done' : 'task-reward'}>{reward}</span>}
    </>
  );
  if (href && !action) {
    return (
      <Link to={href} className="task">
        {body}
      </Link>
    );
  }
  return <div className="task">{body}</div>;
}

export function Home() {
  const me = useAccount();
  const data = useData();
  const now = useNow(1000);
  useUnseenReward(me);

  const tasks = todaysTasks(data, me.id, now);
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const scrollApps = lockedNames(me, 'scrolls');
  const timeApps = lockedNames(me, 'minutes');
  const minutes = minutesLeft(me, now);

  return (
    <NavScreen
      fab={
        <Link to="/task/new" className="fab" aria-label="Add task">
          <PlusIcon size={24} color="#fff" />
        </Link>
      }
    >
      <div className="topbar" style={{ alignItems: 'flex-end' }}>
        <div className="stack-4">
          <span className="muted" style={{ fontSize: 15 }}>
            {greeting(now)}, {me.name}
          </span>
          <h1 className="h1-lg">Today</h1>
        </div>
        <HeaderActions me={me} />
      </div>

      <div className="stack-10">
        <div className="grid-2">
          <Link to="/wallet" className="card-tint">
            <span className="muted" style={{ fontSize: 14 }}>
              Scrolls
            </span>
            <span className="big-number" data-testid="scroll-balance">
              {me.scrolls}
            </span>
            <span className="small" style={{ fontSize: 12 }}>
              {scrollApps || 'No scrolling apps locked'}
            </span>
          </Link>
          <Link to="/screen-time" className="card-tint">
            <span className="muted" style={{ fontSize: 14 }}>
              Screen time
            </span>
            <span className="big-number" data-testid="minutes-balance">
              {minutes}
              <small> min</small>
            </span>
            <span className="small" style={{ fontSize: 12 }}>
              {timeApps ? `${timeApps.split(', ').slice(0, 2).join(', ')}${timeApps.split(', ').length > 2 ? ' and more' : ''}` : 'No timed apps locked'}
            </span>
          </Link>
        </div>
        <span className="muted" style={{ fontSize: 14 }}>
          {unlockLine(me, now)}
        </span>
      </div>

      <Link to="/apps" className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', textDecoration: 'none', color: '#18181B', borderRadius: 14 }}>
        <GridIcon size={20} color="#15803D" />
        <span style={{ flexGrow: 1 }}>Open your apps</span>
        <ChevronIcon size={18} color="#52525B" />
      </Link>

      <div className="stack-4">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8 }}>
          <h2 className="h2">Tasks</h2>
          {tasks.length > 0 && (
            <span className="muted" style={{ fontSize: 14 }}>
              {doneCount} of {tasks.length} done
            </span>
          )}
        </div>
        {tasks.length === 0 ? (
          <div className="empty-state">
            No tasks yet. Tap <strong>+</strong> to add what you need to get done today and choose what each one is worth.
          </div>
        ) : (
          <div className="stack">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} data={data} href={`/task/${t.id}`} />
            ))}
          </div>
        )}
      </div>
    </NavScreen>
  );
}

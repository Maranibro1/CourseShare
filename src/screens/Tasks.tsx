import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CameraIcon, CheckIcon, SendIcon } from '../components/Icons';
import { BackButton, Row, Sheet, StoredPhoto, Thumb, useBack } from '../components/ui';
import {
  MAX_REWARD,
  QUESTIONS_FALLBACK_MS,
  approverFor,
  approverName,
  canFallBackToQuestions,
  findAccountByContact,
  minutesLeft,
  rewardLabel,
  rewardWords,
  streakDays,
} from '../lib/logic';
import { compressImage, deletePhoto, savePhoto } from '../lib/photos';
import { MIN_ANSWER_LENGTH, questionsFor } from '../lib/questions';
import { SERVER_MODE, act, claudeVerdict, errorMessage, toast, useAccount, useClaudeOn, useData, useNow } from '../lib/store';
import { dayLabel, formatAdded, formatClock, formatHoursMinutes, timeAgo } from '../lib/time';
import type { Account, Repeat, RewardKind, Task, VerifyMethod } from '../lib/types';

export const homePath = (me: Account) => (me.mode === 'child' ? '/child' : '/home');

const REPEAT_LABEL: Record<Repeat, string> = { never: 'Never', daily: 'Every day', weekdays: 'Every weekday' };
const STATUS_LABEL: Record<Task['status'], string> = {
  todo: 'Not started',
  pending: 'Waiting for approval',
  redo: 'Asked to redo',
  done: 'Done',
};

export function useTask(): Task | undefined {
  const { id } = useParams();
  const data = useData();
  return id ? data.tasks[id] : undefined;
}

export function MissingTask() {
  const me = useAccount();
  return (
    <main className="screen">
      <BackButton fallback={homePath(me)} />
      <h1 className="h1">Task not found</h1>
      <p className="lead">It may have been deleted.</p>
      <div className="spacer" />
      <Link to={homePath(me)} className="btn btn-primary">
        Back to tasks
      </Link>
    </main>
  );
}

/* ───────── Reward picker (shared with family tasks) ───────── */

const PRESETS: Record<RewardKind, number[]> = { scrolls: [20, 50, 100], minutes: [10, 20, 30] };

export function RewardPicker({
  kind,
  amount,
  onKind,
  onAmount,
}: {
  kind: RewardKind;
  amount: number;
  onKind: (k: RewardKind) => void;
  onAmount: (n: number) => void;
}) {
  const presets = PRESETS[kind];
  const [other, setOther] = useState(!presets.includes(amount));
  const [otherText, setOtherText] = useState(presets.includes(amount) ? '' : String(amount));

  const switchKind = (k: RewardKind) => {
    if (k === kind) return;
    onKind(k);
    setOther(false);
    setOtherText('');
    onAmount(PRESETS[k][PRESETS[k].length - 1]);
  };

  return (
    <div className="field">
      <span className="label">Reward</span>
      <div className="segmented">
        <button type="button" className={kind === 'scrolls' ? 'selected' : undefined} aria-pressed={kind === 'scrolls'} onClick={() => switchKind('scrolls')}>
          Scrolls
        </button>
        <button type="button" className={kind === 'minutes' ? 'selected' : undefined} aria-pressed={kind === 'minutes'} onClick={() => switchKind('minutes')}>
          Screen time
        </button>
      </div>
      <span className="small">
        {kind === 'scrolls'
          ? 'Scrolls unlock TikTok, Instagram, Facebook, YouTube and X. Screen time (minutes) unlocks games and other apps.'
          : 'Minutes of screen time for games and other apps.'}
      </span>
      <div className="option-grid">
        {presets.map((p, i) => (
          <button
            key={p}
            type="button"
            className={`option${!other && amount === p ? ' selected' : ''}`}
            aria-pressed={!other && amount === p}
            onClick={() => {
              setOther(false);
              onAmount(p);
            }}
          >
            {kind === 'minutes' && i === presets.length - 1 ? `${p} min` : p}
          </button>
        ))}
        <button
          type="button"
          className={`option${other ? ' selected' : ''}`}
          aria-pressed={other}
          onClick={() => {
            setOther(true);
            onAmount(Number(otherText) || 0);
          }}
        >
          Other
        </button>
      </div>
      {other && (
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_REWARD[kind]}
          aria-label={kind === 'scrolls' ? 'Number of scrolls' : 'Number of minutes'}
          placeholder={kind === 'scrolls' ? `Scrolls (up to ${MAX_REWARD.scrolls})` : `Minutes (up to ${MAX_REWARD.minutes})`}
          value={otherText}
          autoFocus
          onChange={(e) => {
            setOtherText(e.target.value);
            onAmount(Math.floor(Number(e.target.value)) || 0);
          }}
        />
      )}
    </div>
  );
}

export function RepeatPicker({ value, onChange }: { value: Repeat; onChange: (r: Repeat) => void }) {
  return (
    <div className="field">
      <span className="label">Repeats</span>
      <div className="chips">
        {(['never', 'daily', 'weekdays'] as Repeat[]).map((r) => (
          <button key={r} type="button" className={`chip${value === r ? ' selected' : ''}`} aria-pressed={value === r} onClick={() => onChange(r)}>
            {REPEAT_LABEL[r]}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────── Add / edit ───────── */

export function TaskForm() {
  const me = useAccount();
  const data = useData();
  const existing = useTask();
  const { id } = useParams();
  const navigate = useNavigate();
  const back = useBack('/home');
  const editing = !!id;

  const verifierName = me.verifier ? findAccountByContact(data, me.verifier.contact)?.name ?? me.verifier.contact : null;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [kind, setKind] = useState<RewardKind>(existing?.reward.kind ?? 'scrolls');
  const [amount, setAmount] = useState(existing?.reward.amount ?? 50);
  const [verify, setVerify] = useState<VerifyMethod>(existing?.verify ?? (me.verifier ? 'photo' : 'questions'));
  const [repeat, setRepeat] = useState<Repeat>(existing?.repeat ?? 'never');
  const [saving, setSaving] = useState(false);
  const claudeOn = useClaudeOn();

  if (editing && !existing) return <MissingTask />;

  async function save() {
    if (saving) return;
    const input = { title, rewardKind: kind, amount, verify, repeat };
    setSaving(true);
    try {
      if (editing && existing) {
        if ((await act('editTask', { taskId: existing.id, input })).ok) {
          toast('Task updated');
          back();
        }
      } else if ((await act('addTask', { input })).ok) {
        navigate('/home', { replace: true });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="screen gap-28">
      <div className="topbar">
        <button type="button" className="link-btn" style={{ fontSize: 16 }} onClick={back}>
          Cancel
        </button>
        <span className="topbar-title">{editing ? 'Edit task' : 'New task'}</span>
        <div style={{ width: 52 }} />
      </div>
      <div className="field">
        <label className="label" htmlFor="task-name">
          Task
        </label>
        <input
          id="task-name"
          className="input"
          value={title}
          maxLength={80}
          placeholder="e.g. Revise chapter 3"
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={!editing}
        />
      </div>
      <RewardPicker kind={kind} amount={amount} onKind={setKind} onAmount={setAmount} />
      <div className="field">
        <span className="label">How to verify</span>
        <label className={`radio-row${verify === 'photo' ? ' selected' : ''}${!me.verifier ? ' disabled' : ''}`}>
          <input type="radio" name="verify" checked={verify === 'photo'} disabled={!me.verifier} onChange={() => setVerify('photo')} />
          <span style={{ flexGrow: 1 }}>{me.verifier ? `Send a photo to ${verifierName}` : 'Send a photo (add a verifier first)'}</span>
          {!me.verifier && (
            <Link to="/settings/verifier" className="strong" style={{ fontSize: 14, textDecoration: 'none' }}>
              Add
            </Link>
          )}
        </label>
        {(claudeOn || verify === 'claude') && (
          <label className={`radio-row${verify === 'claude' ? ' selected' : ''}`}>
            <input type="radio" name="verify" checked={verify === 'claude'} onChange={() => setVerify('claude')} />
            <span style={{ flexGrow: 1 }}>Send a photo to Claude (checked straight away)</span>
          </label>
        )}
        <label className={`radio-row${verify === 'questions' ? ' selected' : ''}`}>
          <input type="radio" name="verify" checked={verify === 'questions'} onChange={() => setVerify('questions')} />
          <span style={{ flexGrow: 1 }}>{claudeOn ? 'Answer a few questions (Claude reads them)' : 'Answer a few questions'}</span>
        </label>
      </div>
      <RepeatPicker value={repeat} onChange={setRepeat} />
      <div className="spacer" />
      <button className="btn btn-primary" onClick={save} disabled={!title.trim() || amount < 1}>
        {editing ? 'Save changes' : 'Add task'}
      </button>
    </main>
  );
}

/* ───────── Detail ───────── */

export function TaskDetail() {
  const me = useAccount();
  const data = useData();
  const task = useTask();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  if (!task) return <MissingTask />;

  const mine = task.createdBy === me.id;
  const isOwner = task.ownerId === me.id;
  const verifyWith = task.verify === 'questions' ? 'Questions' : task.verify === 'claude' ? 'Photo checked by Claude' : `Photo to ${approverName(data, task)}`;
  const startVerify = task.verify === 'questions' ? `/task/${task.id}/questions` : `/task/${task.id}/photo`;

  return (
    <main className="screen">
      <div className="topbar">
        <BackButton fallback={homePath(me)} />
        {mine && task.status !== 'pending' && (
          <Link to={`/task/${task.id}/edit`} className="link-btn strong">
            Edit
          </Link>
        )}
      </div>
      <div className="stack-12">
        <span className={`pill${task.status === 'redo' ? ' red' : task.status === 'pending' ? ' amber' : ''}`}>
          {rewardLabel(task.reward.kind, task.reward.amount)} {task.reward.kind === 'scrolls' ? 'scrolls' : 'screen time'}
        </span>
        <h1 className="h1">{task.title}</h1>
      </div>
      {task.status === 'redo' && (
        <div className="info" style={{ background: '#FEF2F2', color: '#991B1B' }}>
          <span>
            {approverName(data, task)} asked you to redo this{task.redoReason ? `: ${task.redoReason}` : '.'} Send a new photo when it's ready.
          </span>
        </div>
      )}
      <div className="stack">
        <Row label="Status" value={STATUS_LABEL[task.status]} strong />
        <Row label="Verify with" value={verifyWith} strong />
        <Row label="Added" value={formatAdded(task.addedAt)} strong />
        {task.dueTime && <Row label="Due" value={`Before ${formatClock(task.dueTime)}`} strong />}
        <Row label="Repeats" value={REPEAT_LABEL[task.repeat]} strong />
        {task.completions.length > 0 && <Row label="Times completed" value={task.completions.length} strong />}
      </div>
      {task.proofs?.[0] && (
        <div className="stack-12" data-testid="proof">
          <h2 className="h2">{isOwner ? 'Your proof' : 'Their proof'}</h2>
          <span className="small">{dayLabel(task.proofs[0].at)}</span>
          {task.proofs[0].disallowed && (
            <div className="redo-note">
              Disallowed{task.proofs[0].disallowed.reason ? `: ${task.proofs[0].disallowed.reason}` : ''}
            </div>
          )}
          {task.proofs[0].photo && <StoredPhoto taskId={task.id} height={180} label={`Photo of ${task.title}`} />}
          {task.proofs[0].answers.map((x, i) => (
            <div key={i} className="stack-4">
              <span className="small">{x.q}</span>
              <span>{x.a}</span>
            </div>
          ))}
        </div>
      )}
      <div className="spacer" />
      <div className="actions">
        {isOwner && (task.status === 'todo' || task.status === 'redo') && (
          <Link to={startVerify} className="btn btn-primary">
            {task.status === 'redo' ? 'Send a new photo' : "I'm done, verify it"}
          </Link>
        )}
        {isOwner && task.status === 'pending' && (
          <Link to={`/task/${task.id}/waiting`} className="btn btn-secondary">
            See approval status
          </Link>
        )}
        {task.status === 'done' && (
          <button className="btn btn-primary" disabled>
            Done · {rewardWords(task.reward.kind, task.reward.amount)} earned
          </button>
        )}
        {mine && (
          <button className="link-btn danger" onClick={() => setConfirm(true)}>
            Delete task
          </button>
        )}
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={`Delete “${task.title}”?`}>
        <p className="lead">Scrolls you already earned from it stay in your wallet.</p>
        <button
          className="btn btn-primary"
          style={{ background: '#B91C1C' }}
          onClick={async () => {
            if ((await act('deleteTask', { taskId: task.id })).ok) {
              void deletePhoto(task.id);
              toast('Task deleted');
              navigate(task.verifierId ? '/family' : homePath(me), { replace: true });
            }
          }}
        >
          Delete task
        </button>
        <button className="btn btn-secondary" onClick={() => setConfirm(false)}>
          Keep it
        </button>
      </Sheet>
    </main>
  );
}

/* ───────── Photo proof ───────── */

export function VerifyPhoto() {
  const me = useAccount();
  const data = useData();
  const task = useTask();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!task) return <MissingTask />;
  const who = approverName(data, task);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that photo');
    }
  }

  async function send() {
    if (!photo || !task) return;
    setBusy(true);
    try {
      await savePhoto(task.id, photo);
    } catch (err) {
      setBusy(false);
      toast(SERVER_MODE ? errorMessage(err) : 'Could not save the photo on this phone. Free up some space and try again.');
      return;
    }
    const { ok, result } = await act('submitPhoto', { taskId: task.id });
    setBusy(false);
    if (!ok) return;
    const verdict = claudeVerdict(result);
    if (!verdict) navigate(`/task/${task.id}/waiting`, { replace: true });
    else if (verdict.approve) navigate(`/earned/${task.id}`, { replace: true });
    else setPhoto(null); // Claude's reason now shows above; take a new photo.
  }

  const canSend = task.ownerId === me.id && (task.status === 'todo' || task.status === 'redo');
  const byClaude = task.verify === 'claude';

  return (
    <main className="screen">
      <BackButton fallback={`/task/${task.id}`} />
      <div className="stack-6">
        <h1 className="h1-sm">{task.title}</h1>
        <span className="muted" style={{ fontSize: 15 }}>
          {photo ? 'Looks good? Tap the photo to retake it.' : 'Take a photo of your finished work'}
        </span>
      </div>
      {task.status === 'redo' && task.redoReason && (
        <div className="redo-note" role="status">
          <strong>{who} says:</strong> {task.redoReason}
        </div>
      )}
      <button type="button" className="photo-drop" onClick={() => fileRef.current?.click()} aria-label={photo ? 'Retake photo' : 'Take photo'}>
        {photo ? (
          <img src={photo} alt={`Proof for ${task.title}`} />
        ) : (
          <>
            <CameraIcon size={36} color="#52525B" />
            <span className="muted" style={{ fontSize: 14 }}>
              Tap to take a photo
            </span>
          </>
        )}
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pick} className="sr-only" data-testid="photo-input" />
      <div className="row" style={{ borderBottom: '1px solid #E4E4E7' }}>
        <span className="muted">{byClaude ? 'Checked by' : 'Send to'}</span>
        <span className="strong">{who}</span>
      </div>
      <div className="spacer" />
      <div className="actions-12">
        <button className="btn btn-primary" onClick={send} disabled={!photo || busy || !canSend}>
          {busy ? (byClaude ? 'Claude is checking…' : 'Sending…') : byClaude ? 'Check with Claude' : 'Send for approval'}
        </button>
        {byClaude ? (
          <span className="note">Claude looks at the photo and answers in a few seconds. The photo is deleted straight after.</span>
        ) : (
          !task.verifierId && <span className="note">If {who} doesn't reply in 3 hours, you can answer questions instead.</span>
        )}
      </div>
    </main>
  );
}

export function Waiting() {
  const me = useAccount();
  const data = useData();
  const task = useTask();
  const now = useNow(1000);
  const navigate = useNavigate();

  useEffect(() => {
    if (task?.status === 'done' && !task.rewardSeen) navigate(`/earned/${task.id}`, { replace: true });
  }, [task, navigate]);

  if (!task) return <MissingTask />;
  const who = approverName(data, task);
  const approver = approverFor(data, task);
  const sinceSent = task.submittedAt ? now - task.submittedAt : 0;
  const fallbackIn = QUESTIONS_FALLBACK_MS - sinceSent;
  const canFallback = canFallBackToQuestions(task, now);

  if (task.status === 'redo') {
    return (
      <main className="screen centered">
        <div className="stack-12 center">
          <h1 className="h1-sm">{who} asked you to redo this</h1>
          <p className="lead">{task.redoReason ?? 'Take another photo when the task is finished.'}</p>
        </div>
        <div className="spacer" />
        <Link to={`/task/${task.id}/photo`} className="btn btn-primary" replace>
          Send a new photo
        </Link>
      </main>
    );
  }

  return (
    <main className="screen celebrate">
      <div className="stack-12 center">
        <div className="icon-badge sm">
          <SendIcon size={30} color="#15803D" />
        </div>
        <h1 className="h1-sm">Sent to {who}</h1>
        <p className="lead">
          You'll get {rewardWords(task.reward.kind, task.reward.amount)} as soon as {who} approves your {task.title.toLowerCase()}.
        </p>
      </div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14 }}>
        <Thumb taskId={task.id} />
        <div className="stack" style={{ gap: 2, flexGrow: 1 }}>
          <span className="medium">{task.title}</span>
          <span className="small">{task.submittedAt ? `Sent ${timeAgo(task.submittedAt, now).toLowerCase()}` : ''}</span>
        </div>
      </div>
      <div className="spacer" />
      <div className="stack-10">
        <Link to={homePath(me)} className="btn btn-primary">
          Back to tasks
        </Link>
        <button
          className="btn btn-secondary"
          onClick={async () => {
            if ((await act('remindApprover', { taskId: task.id })).ok) toast(`Reminder sent to ${who}`);
          }}
        >
          Remind {who}
        </button>
        {approver && (
          <Link to={`/messages/${approver.id}`} className="btn btn-secondary">
            Message {who}
          </Link>
        )}
        {!task.verifierId &&
          (canFallback ? (
            <Link to={`/task/${task.id}/questions`} className="link-btn strong" style={{ alignSelf: 'center' }}>
              Answer questions instead
            </Link>
          ) : (
            <span className="note">Answer questions instead in {formatHoursMinutes(fallbackIn)}</span>
          ))}
      </div>
    </main>
  );
}

/* ───────── Questions ───────── */

export function Questions() {
  const task = useTask();
  const navigate = useNavigate();
  const back = useBack(task ? `/task/${task.id}` : '/home');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [claudeNote, setClaudeNote] = useState<string | null>(null);
  const [honest, setHonest] = useState(false);
  const [sending, setSending] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!task) return <MissingTask />;
  // Answering instead of waiting for a verifier: the photo was already sent.
  const needsPhoto = task.status !== 'pending' && !photoSaved;

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that photo');
    }
  }

  async function usePhoto() {
    if (!photo || !task) return;
    setSending(true);
    try {
      await savePhoto(task.id, photo);
      setPhotoSaved(true);
    } catch (err) {
      toast(SERVER_MODE ? errorMessage(err) : 'Could not save the photo on this phone. Free up some space and try again.');
    } finally {
      setSending(false);
    }
  }

  if (needsPhoto) {
    return (
      <main className="screen">
        <BackButton fallback={`/task/${task.id}`} />
        <div className="stack-6">
          <span className="muted" style={{ fontSize: 14 }}>
            {task.title}
          </span>
          <h1 className="h1-sm">First, a photo of what you did</h1>
          <span className="muted" style={{ fontSize: 15 }}>
            Then answer 3 quick questions. Your photo and answers are kept with the task.
          </span>
        </div>
        <button type="button" className="photo-drop" onClick={() => fileRef.current?.click()} aria-label={photo ? 'Retake photo' : 'Take photo'}>
          {photo ? (
            <img src={photo} alt={`Proof for ${task.title}`} />
          ) : (
            <>
              <CameraIcon size={36} color="#52525B" />
              <span className="muted" style={{ fontSize: 14 }}>
                Tap to take a photo
              </span>
            </>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pick} className="sr-only" data-testid="photo-input" />
        <div className="spacer" />
        <button className="btn btn-primary" onClick={usePhoto} disabled={!photo || sending}>
          {sending ? 'Saving…' : 'Next: the questions'}
        </button>
      </main>
    );
  }

  const questions = questionsFor(task.title);
  const total = questions.length;
  const answer = answers[step] ?? '';
  const last = step === total - 1;
  const enough = answer.trim().length >= MIN_ANSWER_LENGTH;

  async function next() {
    if (!task || sending) return;
    if (!last) {
      setStep(step + 1);
      return;
    }
    setSending(true);
    const { ok, result } = await act('completeWithQuestions', { taskId: task.id, answers });
    setSending(false);
    if (!ok) return;
    const verdict = claudeVerdict(result);
    if (verdict && !verdict.approve) {
      // Claude wants more detail: go back to the first answer with its note.
      setClaudeNote(verdict.reason);
      setStep(0);
      return;
    }
    navigate(`/earned/${task.id}`, { replace: true });
  }

  return (
    <main className="screen">
      <div className="progress">
        <button type="button" className="back" aria-label="Back" onClick={() => (step > 0 ? setStep(step - 1) : back())}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#18181B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${((step + 1) / total) * 100}%` }} />
        </div>
        <span className="muted" style={{ fontSize: 14 }}>
          {step + 1} of {total}
        </span>
      </div>
      <div className="stack-8">
        <span className="muted" style={{ fontSize: 14 }}>
          {task.title}
        </span>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.25 }}>{questions[step]}</h1>
      </div>
      {claudeNote && (
        <div className="redo-note" role="status">
          <strong>Claude says:</strong> {claudeNote}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="answer">
          Your answer
        </label>
        <textarea
          id="answer"
          key={step}
          className="textarea"
          value={answer}
          autoFocus
          onChange={(e) => setAnswers(answers.map((a, i) => (i === step ? e.target.value : a)))}
        />
        {!enough && answer.length > 0 && <span className="small">Write a little more, at least a short sentence.</span>}
      </div>
      <div className="spacer" />
      {last && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, cursor: 'pointer' }}>
          <input type="checkbox" className="check-sm" checked={honest} onChange={(e) => setHonest(e.target.checked)} />I honestly completed this task
        </label>
      )}
      <button className="btn btn-primary" onClick={next} disabled={!enough || (last && !honest)}>
        {last ? 'Finish' : 'Next'}
      </button>
    </main>
  );
}

/* ───────── Earned ───────── */

export function Earned() {
  const me = useAccount();
  const data = useData();
  const task = useTask();
  const now = useNow(5000);
  const navigate = useNavigate();

  useEffect(() => {
    if (task && !task.rewardSeen) void act('markRewardSeen', { taskId: task.id });
    if (task?.approvedBy) void deletePhoto(task.id);
  }, [task]);

  if (!task || task.completions.length === 0) return <MissingTask />;
  const approver = task.approvedBy ? data.accounts[task.approvedBy] : null;
  const streak = streakDays(data, me.id, now);
  const minutes = minutesLeft(me, now);

  return (
    <main className="screen celebrate">
      <div className="stack-12 center">
        <div className="icon-badge sm">
          <CheckIcon size={30} color="#15803D" width={2.6} />
        </div>
        <span style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1.5, color: '#15803D', lineHeight: 1.1 }}>
          {rewardLabel(task.reward.kind, task.reward.amount)}
        </span>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{task.reward.kind === 'scrolls' ? 'scrolls earned' : 'of screen time earned'}</span>
        <span className="muted" style={{ fontSize: 15 }}>
          {approver
            ? `${approver.name} approved your ${task.title.toLowerCase()}.`
            : task.verify === 'claude'
              ? `Claude approved your ${task.title.toLowerCase()}.`
              : `You verified “${task.title}” on your honour.`}
        </span>
      </div>
      <div className="box">
        <div className="row">
          <span className="muted">Scrolls left</span>
          <span className="strong">{me.scrolls}</span>
        </div>
        <div className="row">
          <span className="muted">Screen time left</span>
          <span className="strong">{minutes} min</span>
        </div>
        <div className="row">
          <span className="muted">Streak</span>
          <span className="strong">
            {streak} day{streak === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div className="spacer" />
      <div className="actions">
        <button className="btn btn-primary" onClick={() => navigate(homePath(me), { replace: true })}>
          Done
        </button>
        <Link to="/apps" className="link-btn" replace>
          Open your apps
        </Link>
      </div>
    </main>
  );
}

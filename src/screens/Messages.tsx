import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SendIcon } from '../components/Icons';
import { Avatar, BackButton } from '../components/ui';
import { appLink } from '../lib/install';
import { MESSAGE_MAX_LENGTH, contactsOf, requestsFor, threadBetween, type Contact } from '../lib/logic';
import { SERVER_MODE, act, toast, useAccount, useData, useNow } from '../lib/store';
import { dayLabel, formatTimeOfDay, timeAgo } from '../lib/time';
import type { Message } from '../lib/types';
import { homePath } from './Tasks';

/** Shares an invite with a verifier who hasn't joined yet. */
export async function inviteVerifier(myName: string, contact: string) {
  const where = appLink();
  const text = `${myName} added you as their Kazikwanza verifier. Get Kazikwanza${where ? ` at ${where}` : ''} and sign up with ${contact} to check their tasks and message them.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Kazikwanza', text });
      return;
    } catch {
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Invite copied. Paste it in WhatsApp or SMS.');
  } catch {
    toast(text);
  }
}

export function Messages() {
  const me = useAccount();
  const data = useData();
  const now = useNow(30_000);
  const contacts = contactsOf(data, me.id);
  const last = (c: Contact): Message | undefined => (c.id ? threadBetween(data, me.id, c.id).at(-1) : undefined);
  // People with the newest messages first.
  const sorted = [...contacts].sort((a, b) => (last(b)?.at ?? 0) - (last(a)?.at ?? 0));

  return (
    <main className="screen gap-20">
      <BackButton fallback={homePath(me)} />
      <h1 className="h1-lg">Messages</h1>
      {sorted.length === 0 ? (
        <div className="stack-12">
          <div className="empty-state">
            {me.mode === 'child'
              ? 'Once you join your family, you can message your parent here.'
              : 'Message your verifier, the people whose work you check, and your family here. Add a verifier or link your child to start.'}
          </div>
          {me.mode !== 'child' && (
            <Link to="/settings/verifier" className="btn btn-secondary">
              Add a verifier
            </Link>
          )}
        </div>
      ) : (
        <div className="stack">
          {sorted.map((c) => {
            if (!c.id) {
              return (
                <div key={c.contact} className="contact-row">
                  <Avatar name={c.name} size={44} />
                  <div className="contact-body">
                    <span className="strong">{c.name}</span>
                    <span className="small">{c.roles.join(' · ')}</span>
                  </div>
                  <button className="link-btn strong" style={{ fontSize: 14 }} onClick={() => void inviteVerifier(me.name, c.contact)}>
                    Invite
                  </button>
                </div>
              );
            }
            const m = last(c);
            const unread = data.messages.filter((x) => x.from === c.id && x.to === me.id && !x.read).length;
            return (
              <Link key={c.id} to={`/messages/${c.id}`} className="contact-row" aria-label={`${c.name}${unread ? `, ${unread} unread` : ''}`}>
                <Avatar name={c.name} solid size={44} />
                <div className="contact-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="strong">{c.name}</span>
                    {m && <span className="small">{timeAgo(m.at, now)}</span>}
                  </div>
                  <span className={unread ? 'contact-preview unread' : 'contact-preview'}>
                    {m ? `${m.from === me.id ? 'You: ' : ''}${m.text}` : c.roles.join(' · ')}
                  </span>
                </div>
                {unread > 0 && <span className="count-pill">{unread}</span>}
              </Link>
            );
          })}
        </div>
      )}
      {!SERVER_MODE && sorted.length > 0 && (
        <p className="small">Messages stay on this phone. Use the online version of Kazikwanza to message people on their own phones.</p>
      )}
    </main>
  );
}

export function Chat() {
  const { id = '' } = useParams();
  const me = useAccount();
  const data = useData();
  const now = useNow(30_000);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const contact = contactsOf(data, me.id).find((c) => c.id === id);
  const thread = threadBetween(data, me.id, id);
  const unreadFromThem = thread.some((m) => m.from === id && !m.read);
  const toCheck = requestsFor(data, me.id).filter((t) => t.ownerId === id).length;

  useEffect(() => {
    if (contact && unreadFromThem) void act('markThreadRead', { withId: id });
  }, [contact, unreadFromThem, id]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length]);

  if (!contact) {
    return (
      <main className="screen">
        <BackButton fallback="/messages" />
        <h1 className="h1">Can't message this person</h1>
        <p className="lead">You can message your verifier, the people whose work you check, your parent and your children.</p>
      </main>
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const { ok } = await act('sendMessage', { to: id, text: body });
    setSending(false);
    if (ok) setText('');
  }

  // Show the day when it changes between messages.
  let lastDay = '';

  return (
    <div className="chat">
      <div className="chat-head">
        <BackButton fallback="/messages" />
        <Avatar name={contact.name} solid size={40} />
        <div className="contact-body">
          <span className="strong">{contact.name}</span>
          <span className="small">{contact.roles.join(' · ')}</span>
        </div>
      </div>
      {toCheck > 0 && (
        <Link to="/requests" className="chat-banner">
          {toCheck} photo{toCheck === 1 ? '' : 's'} from {contact.name} to check →
        </Link>
      )}
      <div className="chat-list" ref={listRef} aria-live="polite">
        {thread.length === 0 && <p className="chat-empty">Say hi to {contact.name}. Messages are only seen by the two of you.</p>}
        {thread.map((m) => {
          const day = dayLabel(m.at, now);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.from === me.id;
          return (
            <div key={m.id} className="stack">
              {showDay && <span className="chat-day">{dayLabel(m.at, now)}</span>}
              <div className={mine ? 'bubble mine' : 'bubble'}>
                <span>{m.text}</span>
                <span className="bubble-time">
                  {formatTimeOfDay(m.at)}
                  {mine && m.read ? ' · Seen' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <form className="composer" onSubmit={send}>
        <textarea
          className="composer-input"
          value={text}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={`Message ${contact.name}`}
          aria-label={`Message ${contact.name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="composer-send" type="submit" disabled={!text.trim() || sending} aria-label="Send">
          <SendIcon size={20} color="#fff" />
        </button>
      </form>
    </div>
  );
}

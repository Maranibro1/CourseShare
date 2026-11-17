import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { notificationsFor, requestsFor, unreadMessages } from '../lib/logic';
import { loadPhoto } from '../lib/photos';
import { useData, useStore } from '../lib/store';
import type { Account } from '../lib/types';
import { BackIcon, BellIcon, CameraIcon, ChatIcon, FamilyIcon, ListIcon, SettingsIcon, VerifyIcon, WalletIcon } from './Icons';

/** Goes back in history when there is somewhere to go, otherwise to `fallback`. */
export function useBack(fallback: string) {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

export function BackButton({ fallback, to }: { fallback?: string; to?: string }) {
  const back = useBack(fallback ?? '/');
  const navigate = useNavigate();
  return (
    <button type="button" className="back" aria-label="Back" onClick={() => (to ? navigate(to) : back())}>
      <BackIcon color="#18181B" />
    </button>
  );
}

export function StepHeader({ step, of, fallback }: { step: number; of: number; fallback: string }) {
  return (
    <div className="progress">
      <BackButton fallback={fallback} />
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={step}>
        <div className="progress-fill" style={{ width: `${(step / of) * 100}%` }} />
      </div>
      <span className="muted" style={{ fontSize: 14 }}>
        {step} of {of}
      </span>
    </div>
  );
}

export function Toggle({
  on,
  label,
  onChange,
  disabled,
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="toggle" aria-label={label} aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="row">
      <span className={strong ? 'muted' : undefined}>{label}</span>
      <span className={strong ? 'value strong' : 'value'}>{value}</span>
    </div>
  );
}

export function BottomNav() {
  return (
    <nav className="nav" aria-label="Main">
      <NavLink to="/home" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        <ListIcon />
        Today
      </NavLink>
      <NavLink to="/wallet" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        <WalletIcon />
        Wallet
      </NavLink>
      <NavLink to="/family" end={false} className={({ isActive }) => (isActive ? 'active' : undefined)}>
        <FamilyIcon />
        Family
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        <SettingsIcon />
        Settings
      </NavLink>
    </nav>
  );
}

export function NavScreen({ children, fab }: { children: ReactNode; fab?: ReactNode }) {
  return (
    <div className="with-nav">
      <main className="screen top">{children}</main>
      {fab}
      <BottomNav />
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  const clear = useStore((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(clear, 3200);
    return () => window.clearTimeout(id);
  }, [toast, clear]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={toast.id} onClick={clear}>
      {toast.text}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2 className="h2">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Loads a proof photo: undefined while loading, null when there is none. */
function usePhoto(taskId: string): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let url: string | undefined;
    loadPhoto(taskId)
      .then((p) => {
        url = p;
        if (alive) setSrc(p ?? null);
        else if (p?.startsWith('blob:')) URL.revokeObjectURL(p);
      })
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
      // Photos downloaded from the server are held in memory until the screen closes.
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [taskId]);
  return src;
}

/** Shows a stored proof photo, or the camera placeholder when there is none. */
export function StoredPhoto({ taskId, height, label }: { taskId: string; height: number; label: string }) {
  const src = usePhoto(taskId);
  return (
    <div className="photo-frame" style={{ height, flexDirection: 'column', gap: 10 }}>
      {src ? (
        <img src={src} alt={label} />
      ) : (
        <>
          <CameraIcon size={36} color="#52525B" />
          <span className="muted" style={{ fontSize: 14 }}>
            {src === undefined ? 'Loading photo…' : 'Photo not on this device'}
          </span>
        </>
      )}
    </div>
  );
}

export function Thumb({ taskId }: { taskId: string }) {
  const src = usePhoto(taskId);
  return <div className="thumb">{src && <img src={src} alt="" />}</div>;
}

export function Avatar({ name, solid, size = 44, to }: { name: string; solid?: boolean; size?: number; to?: string }) {
  const style = { width: size, height: size, borderRadius: size / 2, fontSize: size >= 64 ? size * 0.4 : undefined };
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  if (to) {
    return (
      <Link to={to} className={solid ? 'avatar solid' : 'avatar'} style={style} aria-label="Profile">
        {initial}
      </Link>
    );
  }
  return (
    <div className={solid ? 'avatar solid' : 'avatar'} style={style} aria-hidden="true">
      {initial}
    </div>
  );
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="count-badge">{count > 9 ? '9+' : count}</span>;
}

/**
 * The round buttons at the top of the home screens: people I check, messages,
 * notifications and profile, each showing how many things are waiting.
 */
export function HeaderActions({ me, showVerify = true }: { me: Account; showVerify?: boolean }) {
  const data = useData();
  const toCheck = requestsFor(data, me.id).filter((t) => !t.verifierId).length;
  const unread = unreadMessages(data, me.id);
  const unseen = notificationsFor(data, me.id).some((n) => !n.read);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return (
    <div className="header-actions">
      {showVerify && (
        <Link to="/requests" className="icon-circle sm" aria-label={toCheck ? `People I verify for, ${plural(toCheck, 'photo')} to check` : 'People I verify for'}>
          <VerifyIcon size={20} />
          <CountBadge count={toCheck} />
        </Link>
      )}
      <Link to="/messages" className="icon-circle sm" aria-label={unread ? `Messages, ${plural(unread, 'unread message')}` : 'Messages'}>
        <ChatIcon size={20} />
        <CountBadge count={unread} />
      </Link>
      <Link to="/notifications" className="icon-circle sm" aria-label={unseen ? 'Notifications, unread' : 'Notifications'}>
        <BellIcon size={20} />
        {unseen && <span className="badge-dot" />}
      </Link>
      <Avatar name={me.name} to="/profile" size={40} />
    </div>
  );
}

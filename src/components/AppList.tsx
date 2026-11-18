import { useState } from 'react';
import { APPS, SCROLL_APPS, TIME_APPS, appsFor, costLabel, type LockableApp } from '../lib/apps';
import { isNativeAndroid, usePhoneAppIcons } from '../lib/native';
import type { Account } from '../lib/types';
import { LockIcon } from './Icons';
import { Toggle } from './ui';

/** The app's real icon when this phone has it, otherwise its first letter on its colour. */
export function AppIcon({ app, size = 56, locked }: { app: LockableApp; size?: number; locked?: boolean }) {
  const icons = usePhoneAppIcons();
  const icon = app.found ? icons.get(app.packages[0]) : undefined;
  return (
    <span
      className="app-icon"
      style={{ width: size, height: size, borderRadius: size * 0.29, fontSize: size * 0.36, background: icon ? 'transparent' : app.color }}
      aria-hidden="true"
    >
      {icon ? <img src={icon} alt="" width={size} height={size} /> : app.name.charAt(0)}
      {locked && (
        <span className="lock">
          <LockIcon size={13} color="#15803D" width={2.4} />
        </span>
      )}
    </span>
  );
}

/** Lists past this length get a search box. */
const SEARCH_FROM = 12;

/**
 * Every app that can be locked, in three groups: scrolling apps, Kazikwanza's
 * games and video apps, and every other app found on the person's phone.
 * `owner` is whose phone it is (yourself, or your child).
 */
export function AppList({
  owner,
  isOn,
  onToggle,
  control = 'toggle',
  whose = 'your',
}: {
  owner: Pick<Account, 'phoneApps' | 'lockedApps'>;
  isOn: (id: string) => boolean;
  onToggle: (app: LockableApp, on: boolean) => void;
  control?: 'toggle' | 'check';
  /** "your" or a child's name with "'s", for the empty-list hint. */
  whose?: string;
}) {
  const [query, setQuery] = useState('');
  const listed = new Set(APPS.map((a) => a.id));
  const found = appsFor(owner).filter((a) => !listed.has(a.id));
  const q = query.trim().toLowerCase();
  const shown = q ? found.filter((a) => a.name.toLowerCase().includes(q) || a.packages[0].includes(q)) : found;

  const row = (a: LockableApp) => {
    const on = isOn(a.id);
    const body = (
      <>
        <AppIcon app={a} size={34} />
        <span className="app-row-body">
          <span>{a.name}</span>
          <span className="small">{costLabel(a)}</span>
        </span>
      </>
    );
    return control === 'toggle' ? (
      <div className="row app-row" key={a.id}>
        {body}
        <Toggle on={on} label={`Lock ${a.name}`} onChange={(next) => onToggle(a, next)} />
      </div>
    ) : (
      <label key={a.id} className="row app-row" style={{ cursor: 'pointer' }}>
        {body}
        <input type="checkbox" className="check" checked={on} onChange={() => onToggle(a, !on)} aria-label={`Lock ${a.name}`} />
      </label>
    );
  };

  const group = (title: string, hint: string, apps: LockableApp[]) => (
    <div className="stack">
      <span className="eyebrow">{title}</span>
      <span className="small" style={{ padding: '2px 0 4px' }}>
        {hint}
      </span>
      {apps.map(row)}
    </div>
  );

  let foundHint = `Every other app on ${whose} phone. Give any of them a screen-time limit.`;
  if (found.length === 0) {
    foundHint =
      whose === 'your'
        ? isNativeAndroid
          ? 'Looking for the apps on this phone…'
          : 'Open Kazikwanza on your Android phone and the apps on it show up here, so you can limit any of them.'
        : `When ${whose.replace(/'s$/, '')} opens Kazikwanza on their Android phone, its apps show up here so you can limit any of them.`;
  }

  return (
    <>
      {group('Scrolling apps', 'Unlocked with scrolls. Each swipe to a new post uses 1.', SCROLL_APPS)}
      {group('Games and more', 'Unlocked with screen time, counted in minutes.', TIME_APPS)}
      <div className="stack">
        <span className="eyebrow">Apps on {whose} phone</span>
        <span className="small" style={{ padding: '2px 0 4px' }}>
          {foundHint}
        </span>
        {found.length > SEARCH_FROM && (
          <input
            className="input"
            type="search"
            placeholder={`Search ${found.length} apps`}
            aria-label="Search apps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 6 }}
          />
        )}
        {shown.map(row)}
        {q && shown.length === 0 && <span className="small">No app called “{query.trim()}”.</span>}
      </div>
    </>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronIcon } from '../components/Icons';
import { InstallCard } from '../components/Install';
import { Avatar, BackButton, NavScreen, Sheet, Toggle } from '../components/ui';
import { AppList } from '../components/AppList';
import { setDeviceOwner, useDeviceOwner } from '../lib/device';
import { findAccountByContact, freeUnlockActive, requestsFor } from '../lib/logic';
import { KaziLock, isNativeAndroid, pumpNative, useLockStatus } from '../lib/native';
import { act, signOut, toast, useAccount, useData } from '../lib/store';
import { clockToday, formatClock } from '../lib/time';
import type { LockableApp } from '../lib/apps';
import { UnlockTimePicker } from './Onboarding';

export function Settings() {
  const me = useAccount();
  const data = useData();
  const navigate = useNavigate();
  const [timeSheet, setTimeSheet] = useState(false);
  const [time, setTime] = useState(me.unlockTime ?? '13:00');
  const [noFree, setNoFree] = useState(me.unlockTime === null);
  const verifierName = me.verifier ? findAccountByContact(data, me.verifier.contact)?.name ?? me.verifier.contact : 'None';

  const phone = useLockStatus();
  const owner = useDeviceOwner();
  const ownerIsMe = owner === me.id;
  const ownerName = owner ? data.accounts[owner]?.name : undefined;
  let phoneLockLabel = 'Checking…';
  if (phone) phoneLockLabel = !phone.accessibility ? 'Off' : ownerIsMe ? 'On' : `On for ${ownerName ?? 'someone else'}`;

  function phoneLock() {
    if (!ownerIsMe) {
      setDeviceOwner(me.id);
      void pumpNative();
      toast('This phone now follows your rules');
    }
    if (!phone?.accessibility) KaziLock.openAccessibilitySettings().catch(() => toast('Open Settings > Accessibility to turn it on.'));
  }

  const lockedHours = () => me.unlockTime !== null && !freeUnlockActive(me, Date.now());

  async function saveTime() {
    // Moving the unlock time to a moment that has already passed would open everything now.
    if (!noFree && !freeUnlockActive(me, Date.now()) && clockToday(time) <= Date.now()) {
      toast('Pick a time later than now. You can choose an earlier time while your apps are unlocked.');
      return;
    }
    if (!(await act('updateProfile', { patch: { unlockTime: noFree ? null : time } })).ok) return;
    setTimeSheet(false);
    toast(noFree ? 'Free unlock turned off' : `Apps will unlock at ${formatClock(time)}`);
  }

  function toggleApp(app: LockableApp, on: boolean) {
    // Unlocking an app is the easy way out, so only allow it outside locked hours.
    if (!on && lockedHours()) {
      toast(`You can unlock ${app.name} for good after ${formatClock(me.unlockTime!)}, or earn scrolls now.`);
      return;
    }
    const next = on ? [...me.lockedApps, app.id] : me.lockedApps.filter((x) => x !== app.id);
    void act('updateProfile', { patch: { lockedApps: next } });
  }

  return (
    <NavScreen>
      <div className="topbar">
        <h1 className="h1-lg">Settings</h1>
        <Link to="/profile" className="link-btn strong">
          Profile
        </Link>
      </div>
      <div className="segmented">
        <button className="selected" aria-pressed="true">
          Personal
        </button>
        <button onClick={() => navigate('/family')}>Family</button>
      </div>
      <AppList owner={me} isOn={(id) => me.lockedApps.includes(id)} onToggle={toggleApp} />
      <div className="stack">
        <span className="eyebrow" style={{ paddingBottom: 4 }}>
          Rules
        </span>
        <button
          className="row row-btn"
          onClick={() => {
            setTime(me.unlockTime ?? '13:00');
            setNoFree(me.unlockTime === null);
            setTimeSheet(true);
          }}
        >
          <span>Unlock time</span>
          <span className="value">{me.unlockTime ? formatClock(me.unlockTime) : 'Off'}</span>
        </button>
        <button className="row row-btn" onClick={() => navigate('/settings/verifier')}>
          <span>Verifier</span>
          <span className="value">{verifierName}</span>
        </button>
        {isNativeAndroid && (
          <button className="row row-btn" onClick={phoneLock}>
            <span>Phone lock</span>
            <span className="value">{phoneLockLabel}</span>
          </button>
        )}
      </div>
      <Sheet open={timeSheet} onClose={() => setTimeSheet(false)} title="Unlock time">
        <UnlockTimePicker time={time} onTime={setTime} noFree={noFree} onNoFree={setNoFree} />
        <button className="btn btn-primary" onClick={saveTime}>
          Save
        </button>
      </Sheet>
    </NavScreen>
  );
}

const MODE_LABEL = { personal: 'Personal', parent: 'Parent', child: 'Child' } as const;

export function Profile() {
  const me = useAccount();
  const data = useData();
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  const [nameSheet, setNameSheet] = useState(false);
  const [newName, setNewName] = useState(me.username ?? '');
  const requests = requestsFor(data, me.id).filter((t) => !t.verifierId).length;
  const parent = me.parentId ? data.accounts[me.parentId] : null;
  const verifierName = me.verifier ? findAccountByContact(data, me.verifier.contact)?.name ?? me.verifier.contact : 'None';

  return (
    <main className="screen">
      <BackButton fallback={me.mode === 'child' ? '/child' : '/settings'} />
      <div className="stack-8 center">
        <Avatar name={me.name} solid size={80} />
        <span style={{ fontSize: 22, fontWeight: 700 }}>{me.name}</span>
        <span className="muted" style={{ fontSize: 15 }}>
          {me.username ? `@${me.username} · ` : ''}
          {me.email}
        </span>
      </div>
      <div className="stack">
        <button className="row row-btn" onClick={() => setNameSheet(true)}>
          <span>Username</span>
          <span className="value">{me.username ? `@${me.username}` : 'Pick one'}</span>
        </button>
        <Link to="/settings/messages" className="row row-btn">
          <span>Lock screen messages</span>
          <span className="value">{me.lockMessages?.length ? `${me.lockMessages.length} chosen` : 'Pick some'}</span>
        </Link>
        <Link to="/history" className="row row-btn">
          <span>My task history</span>
          <ChevronIcon size={18} color="#52525B" />
        </Link>
        {me.verifier && !me.parentId && (
          <div className="row">
            <span>Let {verifierName} review my self-checked tasks</span>
            <Toggle
              on={!!me.letFriendsReview}
              label="Let my verifier review my self-checked tasks"
              onChange={(on) => void act('updateProfile', { patch: { letFriendsReview: on } })}
            />
          </div>
        )}
        <Link to="/settings/background" className="row row-btn">
          <span>Lock screen background</span>
          <span className="value">{me.lockBackground === 'photo' ? 'Your photo' : (me.lockBackground ?? 'plain').replace(/^./, (c) => c.toUpperCase())}</span>
        </Link>
        <Link to="/settings/blocks" className="row row-btn">
          <span>Restrictions and focus timer</span>
          <span className="value">{me.blocks?.length ? `${me.blocks.length} set` : 'None'}</span>
        </Link>
        <div className="row">
          <span>Mode</span>
          <span className="value">{MODE_LABEL[me.mode]}</span>
        </div>
        {parent ? (
          <div className="row">
            <span>Parent</span>
            <span className="value">{parent.name}</span>
          </div>
        ) : (
          <Link to="/settings/verifier" className="row row-btn">
            <span>Verifiers</span>
            <span className="value">{verifierName}</span>
          </Link>
        )}
        {me.mode !== 'child' && (
          <Link to="/requests" className="row row-btn">
            <span>People I verify for</span>
            <span className="strong green-text">{requests === 0 ? 'No requests' : `${requests} request${requests === 1 ? '' : 's'}`}</span>
          </Link>
        )}
        <div className="row">
          <span>Notifications</span>
          <Toggle
            on={me.notificationsOn}
            label="Notifications"
            onChange={(on) => void act('updateProfile', { patch: { notificationsOn: on } })}
          />
        </div>
        <div className="row">
          <span>Language</span>
          <span className="value">English</span>
        </div>
        <button className="row row-btn" onClick={() => setHelp(true)}>
          <span>Help and feedback</span>
          <ChevronIcon size={18} color="#52525B" />
        </button>
      </div>
      <InstallCard tone="white" />
      <div className="spacer" />
      <button
        className="btn btn-danger"
        onClick={async () => {
          await signOut();
          navigate('/welcome', { replace: true });
        }}
      >
        Sign out
      </button>
      <Sheet open={nameSheet} onClose={() => setNameSheet(false)} title="Your username">
        <div className="input-at">
          <span aria-hidden="true">@</span>
          <input
            className="input"
            aria-label="New username"
            value={newName}
            maxLength={20}
            autoCapitalize="none"
            onChange={(e) => setNewName(e.target.value.replace(/^@/, '').toLowerCase())}
          />
        </div>
        <span className="small">People type this to pick you as their verifier. 3–20 letters, numbers, dots or underscores.</span>
        <button
          className="btn btn-primary"
          onClick={async () => {
            if ((await act('updateProfile', { patch: { username: newName } })).ok) {
              toast(`You're @${newName}`);
              setNameSheet(false);
            }
          }}
        >
          Save
        </button>
      </Sheet>
      <Sheet open={help} onClose={() => setHelp(false)} title="How Kazikwanza works">
        <div className="stack-12 lead" style={{ fontSize: 15 }}>
          <p>
            <strong>Earn first.</strong> Locked apps open when you have scrolls (TikTok, Instagram, Facebook, YouTube and Shorts, X) or screen time (games and
            other apps). Each swipe to a new post uses 1 scroll.
          </p>
          <p>
            <strong>Prove it.</strong> Send a photo to your verifier, or answer a few questions on your honour. If your verifier doesn't reply
            in 3 hours you can switch to questions.
          </p>
          <p>
            <strong>Fair fallback.</strong> At your unlock time everything opens until midnight. Emergency unlock gives you 10 scrolls or 5
            minutes after a 1 minute wait, 3 times a week.
          </p>
          <p>
            <strong>Verifiers on this phone.</strong> Your verifier signs in on this device (or another tab) with the email you added to see
            and approve your photos.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => setHelp(false)}>
          Got it
        </button>
      </Sheet>
    </main>
  );
}


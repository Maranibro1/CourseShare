import { useState } from 'react';
import { APK_URL, devicePlatform, isNativeApp, isStandalone, useInstallPrompt } from '../lib/install';
import { AddSquareIcon, DownloadIcon, ShareIcon } from './Icons';
import { Sheet } from './ui';

type Guide = 'ios' | 'android-apk' | 'browser' | null;

/** Whether there is anything to offer: not inside the Android app, and not already installed. */
export function canOfferInstall(): boolean {
  return !isNativeApp() && !isStandalone();
}

/**
 * "Get Kazikwanza on your phone": the best install option for this device.
 * - Android: download the app (it can lock TikTok and the rest), or add the web app to the home screen.
 * - iPhone: Add to Home Screen steps (iPhone doesn't let apps lock other apps).
 * - Computer: install if the browser offers it, plus the Android download.
 */
export function InstallCard({ tone = 'green' }: { tone?: 'green' | 'white' }) {
  const { canPrompt, installed, prompt } = useInstallPrompt();
  const [guide, setGuide] = useState<Guide>(null);
  if (!canOfferInstall() || installed) return null;
  const platform = devicePlatform();

  async function addToHomeScreen() {
    if (canPrompt) {
      await prompt();
      return;
    }
    setGuide(platform === 'ios' ? 'ios' : 'browser');
  }

  const primary = tone === 'green' ? 'btn btn-white' : 'btn btn-primary';
  const secondary = tone === 'green' ? 'btn install-ghost' : 'btn btn-secondary';

  return (
    <div className={tone === 'green' ? 'install-card' : 'install-card light'}>
      <div className="stack-4">
        <span className="strong">Get Kazikwanza on your phone</span>
        <span className="install-sub">
          {platform === 'ios'
            ? 'Add it to your Home Screen to open it like an app.'
            : 'The Android app locks TikTok, Instagram, Facebook, X and YouTube until you’ve earned your scrolls.'}
        </span>
      </div>
      {platform !== 'ios' && APK_URL && (
        <a className={primary} href={APK_URL} onClick={() => setGuide('android-apk')} download="kazikwanza.apk">
          <DownloadIcon size={20} />
          <span style={{ marginLeft: 8 }}>Download for Android</span>
        </a>
      )}
      <button type="button" className={platform === 'ios' || !APK_URL ? primary : secondary} onClick={() => void addToHomeScreen()}>
        <AddSquareIcon size={20} />
        <span style={{ marginLeft: 8 }}>{canPrompt ? 'Install app' : 'Add to Home Screen'}</span>
      </button>
      <InstallGuide guide={guide} onClose={() => setGuide(null)} />
    </div>
  );
}

export function InstallGuide({ guide, onClose }: { guide: Guide; onClose: () => void }) {
  if (guide === 'ios') {
    return (
      <Sheet open onClose={onClose} title="Add Kazikwanza to your Home Screen">
        <ol className="steps">
          <li>
            Open this page in <strong>Safari</strong>.
          </li>
          <li>
            Tap the Share button <ShareIcon size={18} /> at the bottom of the screen.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
          <li>Open Kazikwanza from your Home Screen.</li>
        </ol>
        <p className="small">On iPhone, Apple doesn&apos;t let any app count swipes inside TikTok or Instagram, so Kazikwanza can&apos;t lock them there.</p>
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </Sheet>
    );
  }
  if (guide === 'android-apk') {
    return (
      <Sheet open onClose={onClose} title="Installing the Android app">
        <ol className="steps">
          <li>When the download finishes, tap it to open <strong>kazikwanza.apk</strong>.</li>
          <li>
            If Android asks, allow your browser to <strong>install unknown apps</strong>, then tap <strong>Install</strong>.
          </li>
          <li>
            Open Kazikwanza, sign in, and on <strong>Allow access</strong> switch on Usage access and the Kazikwanza app lock.
          </li>
          <li>
            If the app lock switch is greyed out, open <strong>Settings → Apps → Kazikwanza</strong>, tap <strong>⋮ → Allow restricted settings</strong> and
            try again.
          </li>
        </ol>
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </Sheet>
    );
  }
  if (guide === 'browser') {
    return (
      <Sheet open onClose={onClose} title="Add Kazikwanza to your phone">
        <ol className="steps">
          <li>
            Open this page in <strong>Chrome</strong> on your phone.
          </li>
          <li>
            Tap the <strong>⋮</strong> menu, then <strong>Add to Home screen</strong> (or <strong>Install app</strong>).
          </li>
          <li>Open Kazikwanza from your home screen.</li>
        </ol>
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </Sheet>
    );
  }
  return null;
}

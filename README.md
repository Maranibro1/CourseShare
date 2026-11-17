# Kazikwanza

*Do the work first. Then scroll.* (Kazikwanza is Swahili for "work first".)

Kazikwanza locks your social apps and makes you earn your scrolling. You finish the tasks on your own to-do list, get them verified, and earn **scrolls** (TikTok, Instagram, YouTube, X) or **screen time** in minutes (games, Netflix and other apps). At the unlock time you pick, everything opens anyway.

This repository is the working app, built from the Kazikwanza design file and covering all 31 screens. It runs as an installable web app (PWA) and as an Android app that locks the real apps on the phone (see *Android app* below).

## What works

- **Accounts and onboarding.** Sign up or sign in, choose a mode (for myself, as a parent, as a child), grant permissions, pick which apps to lock, set the daily unlock time (or turn free unlock off), and add a verifier.
- **Tasks.** Add, edit, delete and repeat tasks (never, every day, every weekday). You set each task's reward in scrolls or minutes, up to 500 scrolls or 240 minutes.
- **Verification**
  - *Photo:* take a photo with the camera. It is compressed and sent to your verifier, who approves it or asks for a redo with a reason. If they haven't replied after 3 hours, you can answer questions instead.
  - *Questions:* three recall questions picked to match the task (reading, studying, exercise, chores, work, or general ones), plus an honesty pledge.
- **Wallet.** Shows your scroll and screen-time balances, this week's totals, your streak and your history.
- **Locked apps.** On Android the real apps are locked (see below). On the web, a built-in demo shows the same rules:
  - Scrolling apps open a swipe feed. Each swipe to a new post costs 1 scroll, and the app locks at 0.
  - Timed apps run a live countdown that keeps going in the background until you close them.
  - The locked screen lists the tasks you have left.
- **Emergency unlock.** After a 60-second wait you get 10 scrolls or 5 minutes. You can do this 3 times a week. Children can't use it; they ask their parent for more time instead.
- **Family mode**
  - The parent shares a 6-character code (also shown as a QR code) that expires after 10 minutes. The child joins by typing the code or scanning the QR code.
  - The parent sets the child's tasks, locked apps and unlock time, approves photos, sees the child's week, and answers requests for more time.
- **Notifications.** You're notified about approvals, redo requests, reminders, low scrolls, the daily unlock and streaks.
- **Offline.** A service worker caches the app so it opens without a connection.

## How it's built

- React 18, TypeScript, Vite, React Router (hash routes) and Zustand.
- All rules live in `src/lib/logic.ts` as pure functions with unit tests. The screens only call them.
- Data is stored on the device: app state in `localStorage` and proof photos in IndexedDB. Photos are deleted once a task is reviewed.
- Several accounts can share one device, and open tabs stay in sync. To try verification, sign in as the verifier in another tab, or sign out and back in as them.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm test           # unit tests (logic)
npm run test:e2e   # end-to-end tests in Chromium (Playwright)
```

## Android app: real locks, scroll counting and screen time

The `android/` folder wraps the same app with [Capacitor](https://capacitorjs.com) and adds a native lock service (`android/app/src/main/java/app/kazikwanza/`):

| File | What it does |
| --- | --- |
| `KaziAccessibilityService.java` | Sees which app is in front and counts each swipe up or down in TikTok, Instagram, Facebook, YouTube (including Shorts) or X as 1 scroll. It times Minecraft, Netflix and Snapchat against screen time. When the balance runs out it sends the phone home and opens Kazikwanza's lock screen. It never reads what is on screen. |
| `LockStore.java` | Holds the rules and balances the phone enforces, plus a numbered log of usage, so nothing is counted twice or lost if the app is closed. |
| `KaziLockPlugin.java` | The bridge to the web app. It checks the two permissions, opens the right Settings pages, receives rules and balances, hands over usage, and opens real apps. |
| `src/lib/native.ts` | The app side: it pulls usage into the wallet every few seconds and on resume, and pushes rule changes straight away. |

### Build the APK

Install Node 18+ and Android Studio (or JDK 17 and the Android SDK), then:

```bash
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug      # APK at android/app/build/outputs/apk/debug/app-debug.apk
```

Or open the `android/` folder in Android Studio and press Run. Once the code is on GitHub, the workflow in `.github/workflows/android.yml` builds the APK on every push. Download it from the run's **Artifacts**.

### Set it up on the phone

1. Install the APK, sign up and choose **For myself**, or **As a child** on a child's phone.
2. On **Allow access**:
   - Tap **Allow** next to *Usage access* and switch Kazikwanza on.
   - Tap **Allow** next to *Accessibility*, open **Kazikwanza app lock** and switch it on.
   - On Android 13 and newer, a sideloaded app's accessibility switch is greyed out at first. Open **Settings → Apps → Kazikwanza**, tap **⋮ → Allow restricted settings**, then try again.
3. Pick the apps to lock. Kazikwanza now enforces them on that phone.
4. **Settings → Phone lock** shows whether the lock is on. Tap it to fix it if it gets switched off.

### Things to know

- Scroll counting works by spotting swipe gestures, so a fast flick can occasionally count as 1 swipe or 2. The gap that separates one swipe from the next is `GESTURE_GAP_MS` in the service. Tune it after testing on real phones, as the concept doc suggests.
- iPhone is not supported. Apple doesn't let one app see swipes inside another.

## Limits of this version

- The lock service has been compiled and its storage unit-tested against the Android 14 framework, but it has not been tried on a real phone yet. Test on a few devices before giving it to users.
- **Verifiers and parents on other phones need a server.** Today, accounts, photos and approvals live on one device. Syncing across phones needs a small backend with accounts and photo storage.
- Swahili translation and Google sign-in are not included yet.

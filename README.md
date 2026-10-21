# Kazikwanza

*Do the work first. Then scroll.* (Kazikwanza is Swahili for "work first".)

Kazikwanza locks your social apps and makes you earn your scrolling. You finish the tasks on your own to-do list, get them verified, and earn **scrolls** (TikTok, Instagram, YouTube, X) or **screen time** in minutes (games, Netflix and other apps). At the unlock time you pick, everything opens anyway.

This repository is the working app: an installable web app (PWA) built from the Kazikwanza design file. It covers all 31 screens in the design.

## What works

- **Accounts and onboarding.** Sign up or sign in, choose a mode (for myself, as a parent, as a child), grant permissions, pick which apps to lock, set the daily unlock time (or turn free unlock off), and add a verifier.
- **Tasks.** Add, edit, delete and repeat tasks (never, every day, every weekday). You set each task's reward in scrolls or minutes, up to 500 scrolls or 240 minutes.
- **Verification**
  - *Photo:* take a photo with the camera. It is compressed and sent to your verifier, who approves it or asks for a redo with a reason. If they haven't replied after 3 hours, you can answer questions instead.
  - *Questions:* three recall questions picked to match the task (reading, studying, exercise, chores, work, or general ones), plus an honesty pledge.
- **Wallet.** Shows your scroll and screen-time balances, this week's totals, your streak and your history.
- **Locked apps (simulated).** Open your apps from the launcher:
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

## Limits of this version

These are the open points from the concept document:

- **Real app locking and scroll counting need a native Android app.** That app would use Usage Access and an AccessibilityService. A web app cannot see or block other apps, so here the lock screens, feed and timers run inside Kazikwanza itself. The rules engine in `src/lib/logic.ts` is written so it can be reused by a native build.
- **Verifiers and parents on other phones need a server.** Today, accounts, photos and approvals live on one device. Syncing across phones needs a small backend with accounts and photo storage.
- Swahili translation and Google sign-in are not included yet.

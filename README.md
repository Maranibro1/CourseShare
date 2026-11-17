# Kazikwanza

*Do the work first. Then scroll.* (Kazikwanza is Swahili for "work first".)

Kazikwanza locks your social apps and makes you earn your scrolling. You finish the tasks on your own to-do list, get them verified, and earn **scrolls** for TikTok, Instagram, Facebook, YouTube (including Shorts) and X, or **screen time** in minutes for games and other apps. At the unlock time you pick, everything opens anyway.

The app comes in three pieces, all in this repository:

| Piece | What it is |
| --- | --- |
| **Android app** (`android/`) | Locks the real apps on the phone, counts every swipe, and times games. |
| **Web app** (`src/`) | All the screens. It runs inside the Android app, and on its own as an installable web app on any phone. |
| **Sync server** (`server/`) | Shares accounts, tasks, photos and messages between phones, so your verifier or parent can check your work on their own phone. |

## Features

- **Accounts and setup.**
  - Sign up and choose a mode: for myself, as a parent, or as a child.
  - Grant the phone permissions, pick which apps to lock, set the daily unlock time, and add a verifier.
- **Tasks.** You set each task's reward in scrolls or minutes. Tasks can repeat every day or every weekday.
- **Verification.**
  - *Photo:* the photo goes to your verifier's phone, and they approve it or ask for a redo.
  - *Questions:* answer three recall questions on your honour.
  - If your verifier hasn't replied after 3 hours, you can answer questions instead.
- **People I verify for.** The icon at the top of the home screen shows a badge with the number of photos waiting for you.
- **Messages.**
  - Chat with your verifier, the people you check, your parent or your children.
  - Unread counts and "Seen" receipts update live.
  - Nobody else can message you.
- **Wallet.** Balances, this week's totals, your streak and history. Swipes and game time from the phone show up here.
- **Emergency unlock.** After a 1-minute wait you get 10 scrolls or 5 minutes, 3 times a week. Children ask their parent for more time instead.
- **Family mode.**
  - The parent links a child with a 6-character code or a QR code.
  - The parent sets the child's tasks, locked apps and unlock time, approves photos, and sees the child's week.
- **Get the app.** The welcome screen offers the Android download, an *Install app* button on Android and computers, and Add to Home Screen steps on iPhone.

## How the phone lock works

`KaziAccessibilityService` is an Android accessibility service. It only looks at *which* app is on screen and *whether* a list moved; it never reads posts or messages.

- **Swipes.** Each swipe up or down in a locked scrolling app costs 1 scroll. Sideways swipes (story trays, photo carousels) and the moment an app restores its scroll position on opening are free.
- **Locking.** With no scrolls left, the phone goes to the home screen and Kazikwanza's lock screen opens.
- **Screen time.** Games and other locked apps use screen time while they're on screen. The clock stops when the screen turns off.
- **Free time.** From the unlock time until midnight, nothing is charged.
- **Syncing.** Usage is kept in a numbered log on the phone (`LockStore`) until the app has added it to the wallet, so nothing is lost or counted twice, even offline.

## Download and install

- **Android app:** every build on the main branch is published at
  **https://github.com/Maranibro1/CourseShare/releases/download/android-latest/kazikwanza.apk**
  1. Open the link on the phone and install the file. Android will ask you to allow installs from your browser.
  2. Open Kazikwanza, sign up, and on **Allow access** switch on *Usage access* and the *Kazikwanza app lock*.
  3. On Android 13 and newer, the app-lock switch is greyed out for apps installed from a file. Open **Settings → Apps → Kazikwanza → ⋮ → Allow restricted settings**, then switch it on.
- **iPhone, or any phone without the APK:** open the website and use **Add to Home Screen**. Apple doesn't let any app see swipes inside other apps, so the iPhone version can't lock TikTok or Instagram.

## Hosting the server (so messages and verifiers work across phones)

The server is one small Node service that also serves the website. The cheapest set-up is free:

1. **Database.** Create a free Postgres database at [neon.tech](https://neon.tech) and copy its connection string.
2. **Server.** Open https://render.com/deploy?repo=https://github.com/Maranibro1/CourseShare. Render reads `render.yaml`; paste the connection string as `DATABASE_URL`. You get an address like `https://kazikwanza.onrender.com`.
3. **Point the Android app at it.** In GitHub, go to **Settings → Secrets and variables → Actions → Variables**, add `KAZI_SERVER_URL` with that address, and re-run the latest workflow. The next APK will sync with your server.

Render's free plan sleeps after 15 minutes without visitors; the first visit after that takes about a minute.

The `Dockerfile` runs anywhere else too. Without `DATABASE_URL`, data goes to `/data` in the container; mount a volume there to keep it.

| Setting | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Without it, data is stored in `DATA_DIR`. |
| `DATA_DIR` | Folder for the data file and photos (default `data`, `/data` in Docker). |
| `DEFAULT_TIME_ZONE` | Time zone for accounts that haven't sent theirs (default `Africa/Nairobi`). |
| `ALLOWED_ORIGINS` | Extra websites allowed to call the API (comma-separated). The Android app is always allowed. |
| `PORT` | Port to listen on (default 8080). |

**Security.**
- Passwords are hashed with scrypt, and sign-in tokens are stored only as hashes.
- Each phone receives only what its owner may see. Every change is checked against the signed-in person: you can't approve your own photo, and a child can't remove their own locks.
- Photos are deleted once they've been checked.

## Develop

```bash
npm install
npm run dev                        # the app on its own, data on this device: http://localhost:5173
npm test                           # logic, permission, time-zone and server tests
npm run test:e2e                   # browser tests: single-phone and two-phone (through the server)
npm run build && npm run build:server && npm start   # web app + server on http://localhost:8080
```

To build the web app for the server, set `VITE_SYNC=server`. `VITE_API_URL` gives the server's address when the app isn't served by it (the Android app); `VITE_APK_URL` gives the download button's link.

**Android.** Install JDK 17 and the Android SDK, then:

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

## Tests

| What | Where |
| --- | --- |
| Rules, permissions, messaging, time zones | `src/lib/*.test.ts` |
| Server over HTTP (accounts, photos, live updates, persistence) | `server/server.test.ts` |
| Postgres storage | `server/storage.test.ts` (set `KAZI_TEST_DATABASE_URL`) |
| Browser, one phone | `tests/e2e/personal.spec.ts`, `family.spec.ts` |
| Browser, two phones through the server | `tests/e2e/sync.spec.ts` |
| Phone lock storage | `android/app/src/test` |
| Phone lock on an Android emulator | `android/app/src/androidTest` |

The emulator tests install the stand-in apps from `android/standins/`. Each stand-in uses the real package name of TikTok, YouTube, Instagram, Facebook, X or Minecraft, and the same kind of list as that app: a full-screen vertical pager, or a feed with a sideways story tray. The tests then swipe through each one. They run on GitHub on every push (`.github/workflows/android.yml`).

## Limits

- Each social app scrolls slightly differently, so check the swipe count on real phones and tune `GESTURE_GAP_MS` in `KaziAccessibilityService` if needed. Swipes are counted across all of YouTube, not only Shorts.
- Without the signing-key secrets described in the workflow, APKs are signed with a debug key. A cached key keeps updates installable, but add a real key before sharing the app widely.
- Swahili translation and Google sign-in are not included yet.

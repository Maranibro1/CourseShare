# Kazikwanza

*Do the work first. Then scroll.* (Kazikwanza is Swahili for "work first".)

Kazikwanza locks your social apps and makes you earn your scrolling. You finish the tasks on your own to-do list, get them verified, and earn **scrolls** for TikTok, Instagram, Facebook, YouTube Shorts and X, or **screen time** in minutes for YouTube videos, games and any other app on your phone. At the unlock time you pick, everything opens anyway.

The app comes in three pieces, all in this repository:

| Piece | What it is |
| --- | --- |
| **Android app** (`android/`) | Locks the real apps on the phone, counts every swipe, and times games. |
| **Web app** (`src/`) | All the screens. It runs inside the Android app, and on its own as an installable web app on any phone. |
| **Backend** (`supabase/`, `server/`) | Shares accounts, tasks, photos and messages between phones, so your verifier or parent can check your work on their own phone. Runs on Supabase, or as a self-hosted Node server. |

## Features

- **Accounts and setup.**
  - Sign up and choose a mode: for myself, as a parent, or as a child.
  - One **Turn on app lock** button opens each Android setting in turn and carries on by itself once they're on (with help for Android's "restricted setting" block).
  - Grant the phone permissions, pick which apps to lock, set the daily unlock time, and add a verifier.
- **Tasks.** You set each task's reward in scrolls or minutes. Tasks can repeat every day or every weekday.
- **Verification, in the Verify tab.** One tab in the bottom bar (with a badge for anything waiting on you) for all of it:
  - *Prove your tasks:* each of today's tasks opens straight to the camera or the questions. Tasks sent back for a redo come first; tasks waiting on your verifier have a *Remind* button.
  - *Photo:* the photo goes to your verifier's phone, and they approve it or ask for a redo.
  - *Questions:* answer three recall questions. With Claude switched on, Claude reads the answers and asks for more detail when they're too thin.
  - *Claude:* send the photo to Claude instead of a person. It approves straight away or sends it back saying what to fix. Claude runs on the server only, so its key never reaches a phone and nobody can fake its answer; each person gets up to 40 checks a day.
  - If your verifier hasn't replied after 3 hours, you can answer questions instead.
  - *Check others' work:* photos people sent you, with Approve and Ask to redo.
- **Usernames.** Everyone picks an @username at sign-up. Pick your verifier by @username from the Verify tab (or verify your own tasks with a photo and questions), and sign in with your username, email or phone.
- **Proof is kept.** Questions start with a photo of what you did; the photo and your answers are saved with the task, under *Your proof*.
- **Lock screen messages.** Pick encouraging lines, or write your own; one shows each time an app is locked.
- **Blocked times and focus timers.** Block chosen apps completely during a daily window (like 9 PM to 7 AM on school nights), or for a countdown starting now (15 minutes to 12 hours). Blocked apps can't open even with scrolls or after the unlock time. A blocked time can't be removed or loosened while it's on, and a focus timer can't be stopped early. Parents set these for their children. The phone lock enforces them even when Kazikwanza is closed.
- **People I verify for.** The icon at the top of the home screen lists the people who picked you, with a badge for photos waiting.
- **Any app can be limited.** On Android, the app lists every app installed on the phone, so you can give any of them a screen-time limit. A parent sees their child's apps on their own phone. The phone app, Settings and the home screen are never locked, so nobody is cut off from calling for help.
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

`KaziAccessibilityService` is an Android accessibility service. It looks at *which* app is on screen and *whether* a list moved, and inside YouTube only, at the names of the views on screen (to find YouTube's Shorts player and video player). It never reads posts, messages or what you watch.

- **Swipes.** Each swipe up or down in a locked scrolling app costs 1 scroll: TikTok, Facebook, X, and in Instagram both feed posts and Reels. Sideways swipes (story trays, photo carousels) and the moment an app restores its scroll position on opening are free.
- **YouTube.** Swiping through Shorts costs 1 scroll per swipe. A regular video uses screen time while it's on screen. Browsing the home feed (and scrolling a video's comments) is free. YouTube opens while you have either scrolls or screen time; with no scrolls, Shorts lock but videos still play, and the other way round.
- **Locking.** With no scrolls left, the phone goes to the home screen and Kazikwanza's lock screen opens.
- **Screen time.** Games and every other locked app use screen time while they're on screen. The clock stops when the screen turns off.
- **Free time.** From the unlock time until midnight, nothing is charged.
- **Syncing.** Usage is kept in a numbered log on the phone (`LockStore`) until the app has added it to the wallet, so nothing is lost or counted twice, even offline.

## Download and install

- **Android app:** every build on the main branch is published at
  **https://github.com/Maranibro1/CourseShare/releases/download/android-latest/kazikwanza.apk**
  1. Open the link on the phone and install the file. Android will ask you to allow installs from your browser.
  2. Open Kazikwanza, sign up, and on **Allow access** switch on *Usage access* and the *Kazikwanza app lock*.
  3. On Android 13 and newer, the app-lock switch is greyed out for apps installed from a file. Open **Settings → Apps → Kazikwanza → ⋮ → Allow restricted settings**, then switch it on.
- **iPhone, or any phone without the APK:** open the website and use **Add to Home Screen**. Apple doesn't let any app see swipes inside other apps, so the iPhone version can't lock TikTok or Instagram.

## Supabase (so messages and verifiers work across phones)

The backend runs on a free Supabase project: Postgres for accounts and tasks, Storage for proof photos, an Edge Function for the API, and Realtime for live updates.

1. **Create a project** at [supabase.com](https://supabase.com).
2. **Tables.** Open **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. Run it again after updates (it adds new columns, such as usernames, to an existing database). It creates the tables, the two database functions the API uses and the private `kazi-proofs` photo bucket. It's safe to run again after updates.
3. **API.** Open **Edge Functions → Deploy a new function → Via editor**, name it `kazi`, paste all of [`supabase/functions/kazi/index.ts`](supabase/functions/kazi/index.ts) and deploy. Then in the function's **Details**, turn **off** JWT verification ("Verify JWT" or "Enforce JWT verification"; Kazikwanza checks its own sign-in tokens). With the Supabase CLI instead: `supabase functions deploy kazi --no-verify-jwt`.
4. **Claude (optional).** In **Edge Functions → Secrets**, add `ANTHROPIC_API_KEY` with a key from [platform.claude.com](https://platform.claude.com). The "Send a photo to Claude" option then appears in the app, and Claude reads question answers. Without it, everything else works as before.
5. **Live updates.** In **Realtime → Settings**, keep "Allow public access" on. Each account listens on a channel named with a random secret only that account knows, and the channel only ever says "something changed"; the data itself always comes through the API.
6. **Point the apps at it.** In GitHub, go to **Settings → Secrets and variables → Actions → Variables** and add `KAZI_SUPABASE_URL` (the Project URL, like `https://abcd.supabase.co`) and `KAZI_SUPABASE_ANON_KEY` (the anon or publishable key; it's meant to be public). The next APK uses your project.
7. **Website (optional).** In **Settings → Pages**, set Source to **GitHub Actions**. Each push to the main branch then publishes the website at `https://<owner>.github.io/<repo>/`.

How it's kept safe: every table has row-level security on with no policies, and the anon key can't read or call anything directly. Only the `kazi` function, using the service-role key Supabase gives it, touches the data, and it applies the same permission checks as the Node server. Photos sit in a private bucket and are deleted once checked.

## Hosting the Node server instead

The Node server is one small service that also serves the website. A free set-up:

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
| `ANTHROPIC_API_KEY` | Turns on Claude checks of proof photos and answers. |

**Security.**
- Passwords are hashed with PBKDF2-SHA256 (600,000 rounds), and sign-in tokens are stored only as hashes.
- Each phone receives only what its owner may see. Every change is checked against the signed-in person: you can't approve your own photo, and a child can't remove their own locks.
- Photos are deleted once they've been checked.

## Develop

```bash
npm install
npm run dev                        # the app on its own, data on this device: http://localhost:5173
npm test                           # logic, permission, time-zone and server tests
npm run build:supabase             # rebuild supabase/functions/kazi/index.ts after changing server/ or src/lib/
npm run test:e2e                   # browser tests: single-phone and two-phone (through the server)
npm run build && npm run build:server && npm start   # web app + server on http://localhost:8080
```

To build the web app for Supabase, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. For the Node server, set `VITE_SYNC=server`, and `VITE_API_URL` to the server's address when the app isn't served by it (the Android app). `VITE_APK_URL` gives the download button's link.

The API code in `server/core.ts` is shared: `server/node.ts` runs it on Node, and `server/edge.ts` is bundled into the Supabase Edge Function. CI fails if the committed bundle doesn't match the code.

**Android.** Install JDK 17 and the Android SDK, then:

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

## Tests

| What | Where |
| --- | --- |
| Rules, permissions, messaging, time zones | `src/lib/*.test.ts` |
| API over HTTP (accounts, photos, live updates, persistence) | `server/server.test.ts`; also against Postgres (`KAZI_TEST_DATABASE_URL`) and a Supabase function (`KAZI_TEST_API_URL`) |
| Postgres storage, who sees what | `server/repo.test.ts` (set `KAZI_TEST_DATABASE_URL` for Postgres) |
| Browser, one phone | `tests/e2e/personal.spec.ts`, `family.spec.ts` |
| Browser, two phones through the server | `tests/e2e/sync.spec.ts` (also through Supabase with `KAZI_E2E_SUPABASE_URL` and `KAZI_E2E_SUPABASE_KEY`) |
| Phone lock storage | `android/app/src/test` |
| Phone lock on an Android emulator | `android/app/src/androidTest` |

The emulator tests install the stand-in apps from `android/standins/`. Each stand-in uses the real package name of TikTok, YouTube, Instagram, Facebook, X or Minecraft, and the same kind of list as that app: a full-screen vertical pager, or a feed with a sideways story tray. The YouTube stand-in has a home feed with a small Shorts shelf, a Shorts player and a video page, named like YouTube's own views; the Instagram one has a feed and Reels. The tests swipe through each one, and also check the installed-apps list and that the phone app is never locked. They run on GitHub on every push (`.github/workflows/android.yml`).

## Limits

- Each social app scrolls slightly differently, so check the swipe count on real phones and tune `GESTURE_GAP_MS` in `KaziAccessibilityService` if needed.
- YouTube is told apart by the names of its views (`SHORTS_IDS` and `VIDEO_IDS` in `KaziAccessibilityService`). The Shorts names come from current YouTube versions; if a YouTube update renames them, a full-height video is still treated as Shorts and a full-width video playing with sound as a regular video. Check on a real phone after big YouTube updates.
- Without the signing-key secrets described in the workflow, APKs are signed with a debug key. A cached key keeps updates installable, but add a real key before sharing the app widely.
- Swahili translation and Google sign-in are not included yet.

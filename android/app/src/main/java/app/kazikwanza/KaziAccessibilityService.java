package app.kazikwanza;

import android.accessibilityservice.AccessibilityService;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Rect;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Watches which app is in front and enforces the rules in {@link LockStore}:
 *
 * <ul>
 *   <li>Scrolling apps (TikTok, Instagram feed and Reels, Facebook, X) spend 1 scroll per swipe up or down.</li>
 *   <li>YouTube is split: swiping through Shorts spends scrolls, a regular video spends screen time while
 *       it's on screen, and browsing the home feed is free.</li>
 *   <li>Other locked apps spend screen-time seconds while they are on screen.</li>
 *   <li>With nothing left, the app is sent home and Kazikwanza's lock screen opens.</li>
 * </ul>
 *
 * It never reads what people write, watch or post. It uses the package name of
 * the window in front, the fact that a list scrolled, and, inside YouTube
 * only, the names of the views on screen (such as YouTube's Shorts player) to
 * tell Shorts from videos.
 */
public class KaziAccessibilityService extends AccessibilityService {

    /** Scroll events closer together than this belong to one swipe. */
    static final long GESTURE_GAP_MS = 650;
    /** Apps restore their scroll position as they open; that isn't the person swiping. */
    static final long OPEN_GRACE_MS = 800;
    /** Running screen time is written down this often so a crash loses little. */
    private static final long FLUSH_MS = 15_000;
    private static final long TICK_MS = 1_000;
    /** Don't re-open the lock screen in a tight loop. */
    private static final long LOCK_COOLDOWN_MS = 1_500;
    /** Time for the home screen to come up before the lock screen opens over it. */
    private static final long HOME_SETTLE_MS = 400;
    private static final String TAG = "KaziLock";

    /* ───────── Telling YouTube's Shorts from its videos ───────── */

    static final int PART_BROWSE = 0;
    static final int PART_SHORTS = 1;
    static final int PART_VIDEO = 2;

    /**
     * View ids of YouTube's full-screen Shorts player, from current and recent
     * versions of the app. Some of them also appear in the small Shorts shelf
     * on the home feed, so a match only counts when the view fills most of the
     * window ({@link #SHORTS_MIN_COVER}).
     */
    static final Set<String> SHORTS_IDS = new HashSet<>(Arrays.asList(
        "reel_player_page_container",
        "reel_watch_player",
        "reel_watch_fragment_root",
        "reel_recycler",
        "shorts_video_pager",
        "shorts_player",
        "shorts_player_view",
        "reel_player_underlay"
    ));
    static final float SHORTS_MIN_COVER = 0.7f;

    /** View ids of YouTube's regular video player, which sits across the top of the watch page or fills the screen. */
    static final Set<String> VIDEO_IDS = new HashSet<>(Arrays.asList(
        "watch_player",
        "player_fragment_container",
        "watch_while_player"
    ));
    static final float VIDEO_MIN_COVER = 0.15f;
    /** Enough to cover YouTube's view tree; stops a runaway walk. */
    private static final int MAX_NODES = 3_000;

    /** True while Android has the service running. */
    static volatile boolean running;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LockStore store;
    private final Set<String> ignoredPackages = new HashSet<>();
    /** Packages that are never locked: see {@link SafeApps}. */
    private Set<String> safePackages = new HashSet<>();

    private String foreground;
    private String session = "";
    private long lastScrollAt;
    private long foregroundSince;

    /** Start of the stretch of screen time not yet written to the store, or 0 when not timing. */
    private long timingSince;
    private LockStore.LockedApp timingApp;
    private long lastLockAt;

    /** The YouTube-style app in front, while it is, and which part of it is on screen. */
    private LockStore.LockedApp mixedApp;
    /** The app in front while a minutes limit covers it, and since when its time isn't written down. */
    private String limitPkg;
    private long limitSince;
    private int part = PART_BROWSE;
    private long partSince;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            onTick();
            // onTick may have scheduled the next tick already (a video started); keep just one.
            handler.removeCallbacks(this);
            if (timingApp != null || mixedApp != null || limitPkg != null) handler.postDelayed(this, TICK_MS);
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                // Nobody is playing with the screen off; stop the clock.
                stopTiming();
                stopWatching();
                stopLimit();
                foreground = null;
            } else if (Intent.ACTION_USER_PRESENT.equals(intent.getAction())) {
                String pkg = currentPackageFromUsageStats();
                if (pkg != null) onForeground(pkg);
            }
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        store = LockStore.get(this);
        ignoredPackages.add("com.android.systemui");
        ignoredPackages.add("android");
        safePackages = SafeApps.packages(this);
        refreshKeyboards();
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        registerReceiver(screenReceiver, filter);
        // An app may already be open when the service starts.
        String pkg = currentPackageFromUsageStats();
        if (pkg != null) onForeground(pkg);
        running = true;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (store == null || event == null || event.getPackageName() == null) return;
        String pkg = event.getPackageName().toString();
        switch (event.getEventType()) {
            case AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED:
                if (!ignoredPackages.contains(pkg)) onForeground(pkg);
                break;
            case AccessibilityEvent.TYPE_VIEW_SCROLLED:
                if (pkg.equals(foreground) && !isSideways(event) && !isStill(event)) onScroll(pkg);
                break;
            default:
                break;
        }
    }

    @Override
    public void onInterrupt() {
        stopTiming();
    }

    @Override
    public void onDestroy() {
        running = false;
        stopTiming();
        stopWatching();
        try {
            unregisterReceiver(screenReceiver);
        } catch (IllegalArgumentException ignored) {
            // Was never registered.
        }
        super.onDestroy();
    }

    /* ───────── Foreground changes ───────── */

    private void onForeground(String pkg) {
        if (pkg.equals(foreground)) return;
        stopTiming();
        stopWatching();
        stopLimit();
        foreground = pkg;
        foregroundSince = System.currentTimeMillis();
        session = pkg + ":" + foregroundSince;
        lastScrollAt = 0;
        refreshKeyboards();

        long now = System.currentTimeMillis();
        if (lockIfBlocked(pkg, now)) return;
        if (!safePackages.contains(pkg) && store.hasLimit(pkg, LockStore.KIND_MINUTES, now)) {
            limitPkg = pkg;
            limitSince = now;
            handler.removeCallbacks(tick);
            handler.postDelayed(tick, TICK_MS);
        }
        LockStore.LockedApp app = lockedApp(pkg);
        if (app == null) return;
        if (store.freeNow(now)) return;

        if (LockStore.KIND_MIXED.equals(app.kind)) {
            // YouTube opens while either balance is left; each part is checked as it comes on screen.
            if (store.scrollsLeft() <= 0 && store.secondsLeft() <= 0) {
                lock(app, null);
                return;
            }
            mixedApp = app;
            part = PART_BROWSE;
            partSince = now;
            handler.removeCallbacks(tick);
            handler.postDelayed(tick, TICK_MS);
        } else if (LockStore.KIND_SCROLLS.equals(app.kind)) {
            if (store.scrollsLeft() <= 0) lock(app, LockStore.KIND_SCROLLS);
        } else if (store.secondsLeft() <= 0) {
            lock(app, LockStore.KIND_MINUTES);
        } else {
            startTiming(app, now);
        }
    }

    /**
     * One swipe is one scroll. A swipe sends a burst of scroll events while the
     * list moves, so events closer together than {@link #GESTURE_GAP_MS} are
     * the same swipe; how long anyone watches a post never costs anything.
     */
    private void onScroll(String pkg) {
        long now = System.currentTimeMillis();
        // A blocked time may have started while the app was open. (Limits are checked per swipe below,
        // so the tail of the swipe that used up a limit doesn't shut the app.)
        if (lockIfBlocked(pkg, now, false)) return;
        if (now - foregroundSince < OPEN_GRACE_MS) return;
        boolean newGesture = now - lastScrollAt > GESTURE_GAP_MS;
        lastScrollAt = now;
        if (!newGesture) return;
        LockStore.LockedApp app = lockedApp(pkg);
        boolean mixed = app != null && LockStore.KIND_MIXED.equals(app.kind);
        if (mixed) {
            // Scrolling the home feed or a video's comments is free; only Shorts cost scrolls.
            if (mixedApp == null) return;
            setPart(detectPart(), now);
            if (part != PART_SHORTS || now - partSince < OPEN_GRACE_MS) return;
        }
        // A swipe limit in a restriction window counts every swipe, free time or not: a limit of
        // N allows N swipes, and the next one shuts the app (like running out of scrolls).
        if (!safePackages.contains(pkg) && store.hasLimit(pkg, LockStore.KIND_SCROLLS, now)) {
            if (lockIfBlocked(pkg, now, true)) return;
            store.countLimit(pkg, LockStore.KIND_SCROLLS, 1, now);
        }
        if (app == null || (!mixed && !LockStore.KIND_SCROLLS.equals(app.kind))) return;
        if (store.freeNow(now)) return;
        if (store.scrollsLeft() <= 0) {
            lock(app, LockStore.KIND_SCROLLS);
            return;
        }
        store.spend(app, LockStore.KIND_SCROLLS, session, 1, now);
    }

    /** Shuts an app that's in a blocked time or focus timer, or whose limit is used up. Returns true if it did. */
    private boolean lockIfBlocked(String pkg, long now) {
        return lockIfBlocked(pkg, now, true);
    }

    private boolean lockIfBlocked(String pkg, long now, boolean limits) {
        if (pkg == null || safePackages.contains(pkg)) return false;
        String id = store.blockedAppId(pkg, now);
        String kind = KIND_BLOCKED;
        if (id == null && limits) {
            id = store.limitReachedAppId(pkg, now);
            kind = KIND_LIMIT;
        }
        if (id == null) return false;
        stopTiming();
        stopWatching();
        stopLimit();
        lockId(id, kind, false);
        return true;
    }

    /** The rule for a package, or null when it isn't locked (or must never be). */
    private LockStore.LockedApp lockedApp(String pkg) {
        if (pkg == null || safePackages.contains(pkg)) return null;
        return store.appFor(pkg);
    }

    /* ───────── YouTube ───────── */

    /** Moves to another part of a YouTube-style app: starts or stops the clock, or locks. */
    private void setPart(int next, long now) {
        if (mixedApp == null || next == part) return;
        part = next;
        partSince = now;
        if (part != PART_VIDEO) stopTiming();
        if (part == PART_SHORTS && store.scrollsLeft() <= 0) {
            lock(mixedApp, LockStore.KIND_SCROLLS);
        } else if (part == PART_VIDEO) {
            if (store.secondsLeft() <= 0) lock(mixedApp, LockStore.KIND_MINUTES);
            else startTiming(mixedApp, now);
        }
    }

    /** Writes down the last stretch of time in a minutes-limit window and stops counting it. */
    private void stopLimit() {
        if (limitPkg != null && store != null) {
            long now = System.currentTimeMillis();
            store.countLimit(limitPkg, LockStore.KIND_MINUTES, (now - limitSince) / 1000.0, now);
        }
        limitPkg = null;
        limitSince = 0;
    }

    private void stopWatching() {
        mixedApp = null;
        part = PART_BROWSE;
    }

    /** Looks at the views on screen to tell Shorts, a regular video and browsing apart. */
    private int detectPart() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return part;
        List<AccessibilityNodeInfo> seen = new ArrayList<>();
        try {
            if (mixedApp == null || root.getPackageName() == null || !root.getPackageName().toString().equals(foreground)) return part;
            Rect window = new Rect();
            root.getBoundsInScreen(window);
            if (window.height() <= 0 || window.width() <= 0) return part;
            boolean shorts = false;
            boolean video = false;
            boolean tallSurface = false;
            boolean wideSurface = false;
            Rect r = new Rect();
            ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
            queue.add(root);
            while (!queue.isEmpty() && seen.size() < MAX_NODES) {
                AccessibilityNodeInfo node = queue.poll();
                seen.add(node);
                // Everything inside a hidden view is hidden too.
                if (node != root && !node.isVisibleToUser()) continue;
                node.getBoundsInScreen(r);
                if (!r.intersect(window)) continue;
                float cover = r.height() / (float) window.height();
                String name = idName(node.getViewIdResourceName());
                if (name != null) {
                    if (SHORTS_IDS.contains(name) && cover >= SHORTS_MIN_COVER) shorts = true;
                    else if (VIDEO_IDS.contains(name) && cover >= VIDEO_MIN_COVER) video = true;
                }
                CharSequence cls = node.getClassName();
                if (cls != null && (cls.toString().endsWith("SurfaceView") || cls.toString().endsWith("TextureView"))) {
                    boolean portrait = window.height() > window.width();
                    if (portrait && cover >= SHORTS_MIN_COVER) tallSurface = true;
                    else if (r.width() >= window.width() * 0.9f && cover >= VIDEO_MIN_COVER) wideSurface = true;
                }
                for (int i = 0; i < node.getChildCount(); i++) {
                    AccessibilityNodeInfo child = node.getChild(i);
                    if (child != null) queue.add(child);
                }
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) seen.addAll(queue);
            if (shorts) return PART_SHORTS;
            if (video) return PART_VIDEO;
            // If YouTube renames its views: a full-height video in portrait is a Short, and a
            // full-width video playing with sound is a regular video.
            if (tallSurface) return PART_SHORTS;
            if (wideSurface && isMusicPlaying()) return PART_VIDEO;
            return PART_BROWSE;
        } finally {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                if (!seen.contains(root)) root.recycle();
                for (AccessibilityNodeInfo n : seen) n.recycle();
            }
        }
    }

    /** "com.google.android.youtube:id/reel_recycler" → "reel_recycler". */
    static String idName(String resourceName) {
        if (resourceName == null) return null;
        int at = resourceName.indexOf(":id/");
        return at < 0 ? null : resourceName.substring(at + 4);
    }

    private boolean isMusicPlaying() {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        return audio != null && audio.isMusicActive();
    }

    /* ───────── Screen time ───────── */

    private void startTiming(LockStore.LockedApp app, long now) {
        timingApp = app;
        timingSince = now;
        handler.removeCallbacks(tick);
        handler.postDelayed(tick, TICK_MS);
    }

    private void onTick() {
        long now = System.currentTimeMillis();
        if (limitPkg != null) {
            // Minutes in a restriction window count whether or not the app is locked.
            store.countLimit(limitPkg, LockStore.KIND_MINUTES, (now - limitSince) / 1000.0, now);
            limitSince = now;
        }
        if (lockIfBlocked(foreground, now)) return;
        if (store.freeNow(now)) {
            // The unlock time arrived while playing: charge up to now, then stop.
            stopTiming();
            stopWatching();
            return;
        }
        if (mixedApp != null) setPart(detectPart(), now);
        if (timingApp == null) return;
        double running = (now - timingSince) / 1000.0;
        if (store.secondsLeft() - running <= 0) {
            LockStore.LockedApp app = timingApp;
            stopTiming();
            lock(app, LockStore.KIND_MINUTES);
        } else if (now - timingSince >= FLUSH_MS) {
            store.spend(timingApp, LockStore.KIND_MINUTES, session, running, now);
            timingSince = now;
        }
    }

    private void stopTiming() {
        if (mixedApp == null) handler.removeCallbacks(tick);
        if (timingApp != null && store != null) {
            long now = System.currentTimeMillis();
            double used = Math.min((now - timingSince) / 1000.0, store.secondsLeft());
            store.spend(timingApp, LockStore.KIND_MINUTES, session, used, now);
        }
        timingApp = null;
        timingSince = 0;
    }

    /* ───────── Locking ───────── */

    /** {@code kind} says what ran out, for YouTube's lock screen: Shorts (scrolls) or videos (minutes). */
    private void lock(LockStore.LockedApp app, String kind) {
        lockId(app.id, kind, LockStore.KIND_MIXED.equals(app.kind));
    }

    /** Marks a lock caused by a blocked time or focus timer. */
    static final String KIND_BLOCKED = "blocked";
    /** Marks a lock caused by a used-up limit in a restriction window. */
    static final String KIND_LIMIT = "limit";

    private void lockId(String appId, String kind, boolean mixed) {
        long now = System.currentTimeMillis();
        if (now - lastLockAt < LOCK_COOLDOWN_MS) return;
        lastLockAt = now;
        Log.i(TAG, "Locking " + appId + (kind == null ? "" : " (" + kind + ")"));
        stopTiming();
        stopWatching();
        // Leave the locked app first. Going home finishes on its own schedule, so the lock
        // screen opens a moment later; opening both at once can leave the home screen on top.
        performGlobalAction(GLOBAL_ACTION_HOME);
        handler.postDelayed(() -> {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra(MainActivity.EXTRA_LOCKED_APP, appId);
            if (kind != null && (mixed || KIND_BLOCKED.equals(kind) || KIND_LIMIT.equals(kind))) intent.putExtra(MainActivity.EXTRA_LOCKED_KIND, kind);
            startActivity(intent);
        }, HOME_SETTLE_MS);
    }

    /* ───────── Helpers ───────── */

    /**
     * Story trays and photo carousels scroll sideways inside a feed; only
     * moving up or down through posts counts. Android reports how far a list
     * moved from version 9 on (-1 means "not reported").
     */
    static boolean isSideways(AccessibilityEvent event) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false;
        return event.getScrollDeltaY() == 0 && event.getScrollDeltaX() != 0 && event.getScrollDeltaX() != -1;
    }

    /**
     * A list that has just been laid out (a new screen such as Reels opening,
     * more posts loading) reports a scroll of 0 in both directions. Nobody
     * swiped, so it's free. Lists only report this from Android 9 on.
     */
    static boolean isStill(AccessibilityEvent event) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false;
        return event.getScrollDeltaX() == 0 && event.getScrollDeltaY() == 0;
    }

    /** Keyboards open their own windows; they must not count as leaving the app. */
    private void refreshKeyboards() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm == null) return;
        List<InputMethodInfo> list = imm.getEnabledInputMethodList();
        for (InputMethodInfo info : list) ignoredPackages.add(info.getPackageName());
    }

    /** Best guess at the app in front, from Usage Access. Returns null without that permission. */
    private String currentPackageFromUsageStats() {
        UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return null;
        long now = System.currentTimeMillis();
        UsageEvents events = usm.queryEvents(now - 60_000, now);
        if (events == null) return null;
        UsageEvents.Event e = new UsageEvents.Event();
        String last = null;
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            if (isForegroundEvent(e.getEventType()) && !ignoredPackages.contains(e.getPackageName())) {
                last = e.getPackageName();
            }
        }
        return last;
    }

    @SuppressWarnings("deprecation")
    private static boolean isForegroundEvent(int type) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return type == UsageEvents.Event.ACTIVITY_RESUMED;
        return type == UsageEvents.Event.MOVE_TO_FOREGROUND;
    }
}

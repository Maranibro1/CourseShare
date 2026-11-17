package app.kazikwanza;

import android.accessibilityservice.AccessibilityService;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Watches which app is in front and enforces the rules in {@link LockStore}:
 *
 * <ul>
 *   <li>Scrolling apps (TikTok, Instagram, Facebook, YouTube and Shorts, X) spend 1 scroll per swipe up or down.</li>
 *   <li>Other locked apps spend screen-time seconds while they are on screen.</li>
 *   <li>With nothing left, the app is sent home and Kazikwanza's lock screen opens.</li>
 * </ul>
 *
 * It never reads the content of other apps: it only uses the package name of
 * the window in front and the fact that a list scrolled.
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

    /** True while Android has the service running. */
    static volatile boolean running;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LockStore store;
    private final Set<String> ignoredPackages = new HashSet<>();

    private String foreground;
    private String session = "";
    private long lastScrollAt;
    private long foregroundSince;

    /** Start of the stretch of screen time not yet written to the store, or 0 when not timing. */
    private long timingSince;
    private LockStore.LockedApp timingApp;
    private long lastLockAt;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            onTick();
            if (timingApp != null) handler.postDelayed(this, TICK_MS);
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                // Nobody is playing with the screen off; stop the clock.
                stopTiming();
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
                if (pkg.equals(foreground) && !isSideways(event)) onScroll(pkg);
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
        foreground = pkg;
        foregroundSince = System.currentTimeMillis();
        session = pkg + ":" + foregroundSince;
        lastScrollAt = 0;
        refreshKeyboards();

        LockStore.LockedApp app = store.appFor(pkg);
        if (app == null || pkg.equals(getPackageName())) return;
        long now = System.currentTimeMillis();
        if (store.freeNow(now)) return;

        if (LockStore.KIND_SCROLLS.equals(app.kind)) {
            if (store.scrollsLeft() <= 0) lock(app);
        } else if (store.secondsLeft() <= 0) {
            lock(app);
        } else {
            timingApp = app;
            timingSince = now;
            handler.postDelayed(tick, TICK_MS);
        }
    }

    private void onScroll(String pkg) {
        LockStore.LockedApp app = store.appFor(pkg);
        if (app == null || !LockStore.KIND_SCROLLS.equals(app.kind)) return;
        long now = System.currentTimeMillis();
        if (now - foregroundSince < OPEN_GRACE_MS) return;
        boolean newGesture = now - lastScrollAt > GESTURE_GAP_MS;
        lastScrollAt = now;
        if (!newGesture || store.freeNow(now)) return;
        if (store.scrollsLeft() <= 0) {
            lock(app);
            return;
        }
        store.spend(app, session, 1, now);
    }

    /* ───────── Screen time ───────── */

    private void onTick() {
        if (timingApp == null) return;
        long now = System.currentTimeMillis();
        if (store.freeNow(now)) {
            // The unlock time arrived while playing: charge up to now, then stop.
            stopTiming();
            return;
        }
        double running = (now - timingSince) / 1000.0;
        if (store.secondsLeft() - running <= 0) {
            LockStore.LockedApp app = timingApp;
            stopTiming();
            lock(app);
        } else if (now - timingSince >= FLUSH_MS) {
            store.spend(timingApp, session, running, now);
            timingSince = now;
        }
    }

    private void stopTiming() {
        handler.removeCallbacks(tick);
        if (timingApp != null && store != null) {
            long now = System.currentTimeMillis();
            double used = Math.min((now - timingSince) / 1000.0, store.secondsLeft());
            store.spend(timingApp, session, used, now);
        }
        timingApp = null;
        timingSince = 0;
    }

    /* ───────── Locking ───────── */

    private void lock(LockStore.LockedApp app) {
        long now = System.currentTimeMillis();
        if (now - lastLockAt < LOCK_COOLDOWN_MS) return;
        lastLockAt = now;
        performGlobalAction(GLOBAL_ACTION_HOME);
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra(MainActivity.EXTRA_LOCKED_APP, app.id);
        startActivity(intent);
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

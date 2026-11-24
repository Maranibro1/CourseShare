package app.kazikwanza;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Context;
import android.content.Intent;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Configurator;
import androidx.test.uiautomator.Direction;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.io.FileInputStream;
import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Runs the real lock service on a phone (an emulator in CI) against stand-in
 * apps that have the same package names and the same kinds of lists as
 * TikTok, YouTube (home feed, Shorts and videos), Instagram (feed and Reels),
 * Facebook, X and Minecraft.
 */
@RunWith(AndroidJUnit4.class)
public class LockServiceTest {

    private static final String SELF = "app.kazikwanza";
    private static final String TIKTOK = "com.zhiliaoapp.musically";
    private static final String YOUTUBE = "com.google.android.youtube";
    private static final String INSTAGRAM = "com.instagram.android";
    private static final String FACEBOOK = "com.facebook.katana";
    private static final String X = "com.twitter.android";
    private static final String MINECRAFT = "com.mojang.minecraftpe";
    private static final int FLAGS = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES;

    private static UiDevice device;
    private static Context context;
    private LockStore store;

    @BeforeClass
    public static void startService() throws Exception {
        // Without this flag, UiAutomator switches other accessibility services off while it runs.
        Configurator.getInstance().setUiAutomationFlags(FLAGS);
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        device = UiDevice.getInstance(instrumentation);
        context = instrumentation.getTargetContext();
        shell("settings put secure enabled_accessibility_services " + SELF + "/" + SELF + ".KaziAccessibilityService");
        shell("settings put secure accessibility_enabled 1");
        long until = SystemClock.uptimeMillis() + 30_000;
        while (!KaziAccessibilityService.running && SystemClock.uptimeMillis() < until) SystemClock.sleep(200);
        assertTrue("lock service started", KaziAccessibilityService.running);
        assertTrue("reported as on", KaziLockPlugin.isServiceEnabled(context));
    }

    @Before
    public void reset() throws Exception {
        device.pressHome();
        // Longer than the service's pause between two lock screens.
        SystemClock.sleep(2_500);
        store = LockStore.get(context);
    }

    /* ───────── Helpers ───────── */

    private static void shell(String command) throws IOException {
        UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation(FLAGS);
        try (ParcelFileDescriptor pfd = automation.executeShellCommand(command);
             FileInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd)) {
            byte[] buf = new byte[1024];
            while (in.read(buf) != -1) {
                // Drain the output so the command finishes.
            }
        }
    }

    private static JSONObject app(String id, String kind, String pkg) throws JSONException {
        return new JSONObject().put("id", id).put("name", id).put("kind", kind).put("packages", new JSONArray().put(pkg));
    }

    /** Sets the rules and balances, as the app does after each change. */
    private void rules(long scrolls, double seconds, String unlockTime) throws JSONException {
        JSONArray apps = new JSONArray()
            .put(app("tiktok", "scrolls", TIKTOK))
            .put(app("youtube", "mixed", YOUTUBE))
            .put(app("instagram", "scrolls", INSTAGRAM))
            .put(app("facebook", "scrolls", FACEBOOK))
            .put(app("x", "scrolls", X))
            .put(app("minecraft", "minutes", MINECRAFT));
        store.sync(
            new JSONObject()
                .put("enabled", true)
                .put("apps", apps)
                .put("scrolls", scrolls)
                .put("screenSeconds", seconds)
                .put("unlockTime", unlockTime)
                // Acknowledge all earlier usage so each test starts from exactly these balances.
                .put("ackSeq", Long.MAX_VALUE)
        );
    }

    private void open(String pkg) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(pkg);
        assertTrue(pkg + " stand-in is installed", intent != null);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        context.startActivity(intent);
        assertTrue(pkg + " opened", inFront(pkg, 10_000));
        // Past the moment the app restores its scroll position.
        SystemClock.sleep(KaziAccessibilityService.OPEN_GRACE_MS + 700);
    }

    private boolean inFront(String pkg, long timeoutMs) {
        Boolean found = device.wait(Until.hasObject(By.pkg(pkg).depth(0)), timeoutMs);
        return found != null && found;
    }

    /** Taps a tab in the YouTube or Instagram stand-in, then waits for the lock service's next look at the screen. */
    private void tab(String name) {
        UiObject2 t = device.wait(Until.findObject(By.text(name)), 5_000);
        assertTrue(name + " tab shown", t != null);
        t.click();
        // One check of the screen a second, plus the pause after a part of the app opens.
        SystemClock.sleep(2_000);
    }

    /** One swipe up to the next post, then a pause so the next swipe is a new gesture. */
    private void swipeUp() {
        int w = device.getDisplayWidth();
        int h = device.getDisplayHeight();
        device.swipe(w / 2, (int) (h * 0.75), w / 2, (int) (h * 0.30), 20);
        // Long enough for the list to stop moving, plus the gap between gestures.
        SystemClock.sleep(2_500);
    }

    /* ───────── Scrolling apps ───────── */

    @Test
    public void tiktokSpendsOneScrollPerSwipe() throws Exception {
        rules(10, 0, "");
        open(TIKTOK);
        swipeUp();
        swipeUp();
        swipeUp();
        assertEquals(7, store.scrollsLeft());
        assertTrue("still in TikTok", inFront(TIKTOK, 1_000));
    }

    /* ───────── YouTube: Shorts cost scrolls, videos cost screen time, browsing is free ───────── */

    @Test
    public void youtubeHomeFeedIsFree() throws Exception {
        rules(5, 60, "");
        open(YOUTUBE);
        // The home feed scrolls past a small Shorts shelf; neither costs anything.
        swipeUp();
        swipeUp();
        swipeUp();
        assertEquals(5, store.scrollsLeft());
        assertEquals(60, store.secondsLeft(), 0.001);
        assertTrue("still in YouTube", inFront(YOUTUBE, 1_000));
    }

    @Test
    public void youtubeShortsSpendOneScrollPerSwipe() throws Exception {
        rules(5, 60, "");
        open(YOUTUBE);
        tab("Shorts");
        swipeUp();
        swipeUp();
        assertEquals(3, store.scrollsLeft());
        assertEquals("Shorts don't use screen time", 60, store.secondsLeft(), 0.001);
    }

    @Test
    public void youtubeShortsLockWhenScrollsRunOut() throws Exception {
        rules(2, 60, "");
        open(YOUTUBE);
        tab("Shorts");
        swipeUp();
        swipeUp();
        assertEquals(0, store.scrollsLeft());
        swipeUp();
        assertTrue("Kazikwanza's lock screen opened", inFront(SELF, 10_000));
    }

    @Test
    public void youtubeVideosSpendScreenTimeAndCommentsAreFree() throws Exception {
        rules(5, 60, "");
        open(YOUTUBE);
        tab("Video");
        SystemClock.sleep(3_000);
        swipeUp(); // the comments under the video
        device.pressHome();
        SystemClock.sleep(1_500);
        double left = store.secondsLeft();
        // Watched for about 6-7 s: from spotting the player (within 1 s of the tap) until Home.
        assertTrue("charged about 5-9 seconds, left " + left, left > 50 && left < 56);
        assertEquals("videos don't use scrolls", 5, store.scrollsLeft());
    }

    @Test
    public void youtubeVideosLockWhenScreenTimeRunsOut() throws Exception {
        rules(5, 2, "");
        open(YOUTUBE);
        tab("Video");
        assertTrue("Kazikwanza's lock screen opened", inFront(SELF, 15_000));
        assertEquals(0, store.secondsLeft(), 0.001);
        assertEquals(5, store.scrollsLeft());
    }

    @Test
    public void youtubeWithOnlyScreenTimePlaysVideosButLocksShorts() throws Exception {
        rules(0, 60, "");
        open(YOUTUBE);
        assertTrue("YouTube opens", inFront(YOUTUBE, 1_000));
        tab("Video");
        assertTrue("videos play", inFront(YOUTUBE, 1_000));
        tab("Shorts");
        assertTrue("Kazikwanza's lock screen opened for Shorts", inFront(SELF, 10_000));
    }

    @Test
    public void youtubeLocksStraightAwayWithNothingLeft() throws Exception {
        rules(0, 0, "");
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(YOUTUBE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        context.startActivity(intent);
        assertTrue("Kazikwanza's lock screen opened", inFront(SELF, 10_000));
    }

    /* ───────── Instagram: feed posts and Reels both cost scrolls ───────── */

    @Test
    public void instagramCountsFeedPostsAndReels() throws Exception {
        rules(10, 0, "");
        open(INSTAGRAM);
        swipeUp();
        swipeUp();
        assertEquals("feed posts", 8, store.scrollsLeft());
        tab("Reels");
        assertEquals("opening Reels isn't a swipe", 8, store.scrollsLeft());
        swipeUp();
        swipeUp();
        assertEquals("reels", 6, store.scrollsLeft());
    }

    @Test
    public void instagramLocksStraightAwayWithNoScrolls() throws Exception {
        rules(0, 0, "");
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(INSTAGRAM);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        context.startActivity(intent);
        assertTrue("Kazikwanza's lock screen opened", inFront(SELF, 10_000));
    }

    @Test
    public void facebookCountsFeedSwipesButNotTheStoryTray() throws Exception {
        rules(5, 0, "");
        open(FACEBOOK);
        UiObject2 stories = device.wait(Until.findObject(By.desc("stories")), 5_000);
        assertTrue("story tray shown", stories != null);
        stories.swipe(Direction.LEFT, 0.8f);
        SystemClock.sleep(2_500);
        stories.swipe(Direction.LEFT, 0.8f);
        SystemClock.sleep(2_500);
        assertEquals("sideways swipes are free", 5, store.scrollsLeft());
        swipeUp();
        swipeUp();
        assertEquals(3, store.scrollsLeft());
    }

    @Test
    public void xCountsFeedSwipes() throws Exception {
        rules(4, 0, "");
        open(X);
        swipeUp();
        assertEquals(3, store.scrollsLeft());
    }

    @Test
    public void nothingIsChargedAfterTheUnlockTime() throws Exception {
        // 00:00 means the free time started at midnight and runs all day.
        rules(0, 0, "00:00");
        open(TIKTOK);
        swipeUp();
        swipeUp();
        assertTrue("TikTok stays open", inFront(TIKTOK, 1_000));
        assertEquals(0, store.scrollsLeft());
    }

    @Test
    public void otherAppsAreNotCounted() throws Exception {
        rules(5, 0, "");
        Intent settings = new Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(settings);
        SystemClock.sleep(2_500);
        swipeUp();
        assertEquals(5, store.scrollsLeft());
    }

    /* ───────── Every app on the phone ───────── */

    @Test
    public void findsTheAppsOnThePhoneButNeverThePhoneAppOrSettings() throws Exception {
        JSONArray apps = KaziLockPlugin.installedApps(context);
        java.util.Set<String> pkgs = new java.util.HashSet<>();
        for (int i = 0; i < apps.length(); i++) {
            JSONObject a = apps.getJSONObject(i);
            pkgs.add(a.getString("pkg"));
            assertTrue("has a name", !a.getString("name").isEmpty());
        }
        assertTrue("found the stand-in apps", pkgs.contains(TIKTOK) && pkgs.contains(MINECRAFT));
        assertTrue("has icons", apps.getJSONObject(0).optString("icon").startsWith("data:image/png;base64,"));
        String dialer = dialerPackage();
        if (dialer != null) assertTrue("never offers the phone app", !pkgs.contains(dialer));
        assertTrue("never offers Settings", !pkgs.contains("com.android.settings"));
        assertTrue("never offers itself", !pkgs.contains(SELF));
    }

    @Test
    public void thePhoneAppIsNeverLocked() throws Exception {
        String dialer = dialerPackage();
        if (dialer == null) return; // No phone app on this image.
        store.sync(
            new JSONObject()
                .put("enabled", true)
                .put("apps", new JSONArray().put(app("phone", "minutes", dialer)))
                .put("scrolls", 0)
                .put("screenSeconds", 0)
                .put("unlockTime", "")
                .put("ackSeq", Long.MAX_VALUE)
        );
        context.startActivity(new Intent(Intent.ACTION_DIAL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        assertTrue("the phone app opened", inFront(dialer, 10_000));
        SystemClock.sleep(3_000);
        assertTrue("and stayed open", inFront(dialer, 1_000));
    }

    private static String dialerPackage() {
        android.content.pm.ResolveInfo info = context.getPackageManager().resolveActivity(new Intent(Intent.ACTION_DIAL), 0);
        return info == null || info.activityInfo == null || "android".equals(info.activityInfo.packageName) ? null : info.activityInfo.packageName;
    }

    /* ───────── Blocked times and focus timers ───────── */

    private void rulesWithBlock(JSONObject extra) throws JSONException {
        JSONObject r = new JSONObject()
            .put("enabled", true)
            .put("apps", new JSONArray().put(app("tiktok", "scrolls", TIKTOK)))
            .put("scrolls", 100)
            .put("screenSeconds", 600)
            .put("unlockTime", "")
            .put("ackSeq", Long.MAX_VALUE);
        for (java.util.Iterator<String> it = extra.keys(); it.hasNext(); ) {
            String k = it.next();
            r.put(k, extra.get(k));
        }
        store.sync(r);
    }

    private static JSONArray appRefs(String id, String pkg) throws JSONException {
        return new JSONArray().put(new JSONObject().put("id", id).put("packages", new JSONArray().put(pkg)));
    }

    @Test
    public void aFocusTimerShutsAnAppEvenWithScrollsLeft() throws Exception {
        rulesWithBlock(new JSONObject().put("focus", new JSONObject().put("until", System.currentTimeMillis() + 120_000).put("apps", appRefs("tiktok", TIKTOK))));
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(TIKTOK);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        context.startActivity(intent);
        assertTrue("Kazikwanza's lock screen opened", inFront(SELF, 10_000));
        assertEquals("nothing was spent", 100, store.scrollsLeft());
    }

    @Test
    public void aBlockedTimeShutsAnAppThatIsntEvenLocked() throws Exception {
        // All day, every day; Minecraft isn't in the locked apps at all.
        JSONObject allDay = new JSONObject()
            .put("start", "00:00")
            .put("end", "23:59")
            .put("days", new JSONArray().put(0).put(1).put(2).put(3).put(4).put(5).put(6))
            .put("apps", appRefs("minecraft", MINECRAFT));
        rulesWithBlock(new JSONObject().put("blocks", new JSONArray().put(allDay)));
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(MINECRAFT);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        context.startActivity(intent);
        assertTrue("Kazikwanza's lock screen opened", inFront(SELF, 10_000));
    }

    @Test
    public void anEndedFocusTimerBlocksNothing() throws Exception {
        rulesWithBlock(new JSONObject().put("focus", new JSONObject().put("until", System.currentTimeMillis() - 1_000).put("apps", appRefs("tiktok", TIKTOK))));
        open(TIKTOK);
        assertTrue("TikTok stays open", inFront(TIKTOK, 2_000));
    }

    /* ───────── Screen time ───────── */

    @Test
    public void screenTimeIsChargedWhileAGameIsOpen() throws Exception {
        rules(0, 60, "");
        open(MINECRAFT);
        SystemClock.sleep(3_000);
        device.pressHome();
        SystemClock.sleep(1_500);
        double left = store.secondsLeft();
        // Open for about 4.5 s (opening + grace pause + 3 s), give or take event timing.
        assertTrue("charged about 4-7 seconds, left " + left, left > 52 && left < 58);
    }

    @Test
    public void gameLocksWhenScreenTimeRunsOut() throws Exception {
        rules(0, 3, "");
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(MINECRAFT);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        context.startActivity(intent);
        assertTrue(inFront(MINECRAFT, 10_000));
        assertTrue("Kazikwanza's lock screen opened", inFront(SELF, 15_000));
        assertEquals(0, store.secondsLeft(), 0.001);
    }
}

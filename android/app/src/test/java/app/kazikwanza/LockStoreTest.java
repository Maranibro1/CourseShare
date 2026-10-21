package app.kazikwanza;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

public class LockStoreTest {

    /** In-memory SharedPreferences, enough for LockStore's single string key. */
    private static final class MemoryPrefs implements SharedPreferences {

        final Map<String, Object> values = new HashMap<>();

        @Override
        public Map<String, ?> getAll() {
            return values;
        }

        @Override
        public String getString(String key, String def) {
            return values.containsKey(key) ? (String) values.get(key) : def;
        }

        @Override
        public Set<String> getStringSet(String key, Set<String> def) {
            return def;
        }

        @Override
        public int getInt(String key, int def) {
            return def;
        }

        @Override
        public long getLong(String key, long def) {
            return def;
        }

        @Override
        public float getFloat(String key, float def) {
            return def;
        }

        @Override
        public boolean getBoolean(String key, boolean def) {
            return def;
        }

        @Override
        public boolean contains(String key) {
            return values.containsKey(key);
        }

        @Override
        public Editor edit() {
            return new Editor() {
                @Override
                public Editor putString(String key, String value) {
                    values.put(key, value);
                    return this;
                }

                @Override
                public Editor putStringSet(String key, Set<String> value) {
                    return this;
                }

                @Override
                public Editor putInt(String key, int value) {
                    return this;
                }

                @Override
                public Editor putLong(String key, long value) {
                    return this;
                }

                @Override
                public Editor putFloat(String key, float value) {
                    return this;
                }

                @Override
                public Editor putBoolean(String key, boolean value) {
                    return this;
                }

                @Override
                public Editor remove(String key) {
                    values.remove(key);
                    return this;
                }

                @Override
                public Editor clear() {
                    values.clear();
                    return this;
                }

                @Override
                public boolean commit() {
                    return true;
                }

                @Override
                public void apply() {}
            };
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}

        @Override
        public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
    }

    private static final class TestContext extends ContextWrapper {

        final MemoryPrefs prefs = new MemoryPrefs();

        TestContext() {
            super(null);
        }

        @Override
        public SharedPreferences getSharedPreferences(String name, int mode) {
            return prefs;
        }
    }

    private static final long T = 1_000_000L;
    private TestContext context;
    private LockStore store;
    private JSONObject rules;

    @Before
    public void setUp() throws Exception {
        context = new TestContext();
        store = new LockStore(context);
        rules = new JSONObject(
            "{\"enabled\":true,\"scrolls\":5,\"screenSeconds\":120,\"unlockTime\":\"\",\"ackSeq\":0,\"apps\":[" +
            "{\"id\":\"tiktok\",\"name\":\"TikTok\",\"kind\":\"scrolls\",\"packages\":[\"com.zhiliaoapp.musically\",\"com.ss.android.ugc.trill\"]}," +
            "{\"id\":\"minecraft\",\"name\":\"Minecraft\",\"kind\":\"minutes\",\"packages\":[\"com.mojang.minecraftpe\"]}]}"
        );
        store.sync(rules);
    }

    @Test
    public void mapsEveryPackageOfALockedApp() {
        LockStore.LockedApp app = store.appFor("com.ss.android.ugc.trill");
        assertNotNull(app);
        assertEquals("tiktok", app.id);
        assertNull(store.appFor("com.whatsapp"));
    }

    @Test
    public void swipesMergeUntilDrainedAndNeverChangeAfter() throws Exception {
        LockStore.LockedApp tiktok = store.appFor("com.zhiliaoapp.musically");
        store.spend(tiktok, "visit", 1, T);
        store.spend(tiktok, "visit", 1, T + 1);
        store.spend(tiktok, "visit", 1, T + 2);
        assertEquals(2, store.scrollsLeft());

        JSONArray first = store.drain(0);
        assertEquals(1, first.length());
        assertEquals(3.0, first.getJSONObject(0).getDouble("amount"), 0);

        store.spend(tiktok, "visit", 1, T + 3);
        JSONArray second = store.drain(first.getJSONObject(0).getLong("seq"));
        assertEquals(1, second.length());
        assertEquals(2, second.getJSONObject(0).getLong("seq"));
        assertEquals(1, store.scrollsLeft());
    }

    @Test
    public void syncKeepsUsageTheAppHasNotAcknowledged() throws Exception {
        LockStore.LockedApp tiktok = store.appFor("com.zhiliaoapp.musically");
        store.spend(tiktok, "a", 3, T);
        store.drain(0);
        store.spend(tiktok, "a", 1, T + 1);
        // The app applied event 1 (5 - 3 = 2 left) but hasn't seen event 2 yet.
        rules.put("scrolls", 2);
        rules.put("ackSeq", 1);
        store.sync(rules);
        assertEquals(1, store.scrollsLeft());

        rules.put("scrolls", 1);
        rules.put("ackSeq", 2);
        store.sync(rules);
        assertEquals(1, store.scrollsLeft());
        assertEquals(0, store.drain(2).length());
    }

    @Test
    public void ackBeyondRecordedEventsIsClamped() throws Exception {
        rules.put("ackSeq", 99);
        store.sync(rules);
        LockStore.LockedApp tiktok = store.appFor("com.zhiliaoapp.musically");
        store.spend(tiktok, "b", 1, T);
        assertEquals(4, store.scrollsLeft());
    }

    @Test
    public void screenTimeIsChargedInSeconds() {
        LockStore.LockedApp minecraft = store.appFor("com.mojang.minecraftpe");
        store.spend(minecraft, "m", 45.5, T);
        assertEquals(74.5, store.secondsLeft(), 1e-9);
    }

    @Test
    public void freeFromTheUnlockTimeUntilMidnight() throws Exception {
        rules.put("unlockTime", "13:00");
        store.sync(rules);
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 12);
        c.set(Calendar.MINUTE, 59);
        assertFalse(store.freeNow(c.getTimeInMillis()));
        c.set(Calendar.HOUR_OF_DAY, 13);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        assertTrue(store.freeNow(c.getTimeInMillis()));
    }

    @Test
    public void survivesARestart() throws Exception {
        LockStore.LockedApp tiktok = store.appFor("com.zhiliaoapp.musically");
        store.spend(tiktok, "c", 2, T);
        LockStore reloaded = new LockStore(context);
        assertEquals(3, reloaded.scrollsLeft());
        assertNotNull(reloaded.appFor("com.zhiliaoapp.musically"));
    }

    @Test
    public void disabledLocksNothing() throws Exception {
        rules.put("enabled", false);
        store.sync(rules);
        assertNull(store.appFor("com.zhiliaoapp.musically"));
    }
}

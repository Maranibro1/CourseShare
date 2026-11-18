package app.kazikwanza;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The lock rules and balances the phone enforces, shared by the accessibility
 * service and the app.
 *
 * The web app owns the real balances. It pushes them here with {@link #sync},
 * tagged with the last usage event it has applied ({@code ackSeq}). Everything
 * the service spends after that is kept as numbered events until the app
 * drains and acknowledges them, so nothing is counted twice or lost if either
 * side is killed in between.
 */
final class LockStore {

    static final String KIND_SCROLLS = "scrolls";
    static final String KIND_MINUTES = "minutes";
    /** YouTube: swiping through Shorts spends scrolls, watching a regular video spends screen time. */
    static final String KIND_MIXED = "mixed";

    private static final String PREFS = "kazikwanza_lock";
    private static final String KEY_STATE = "state";
    /** Keep the event log bounded even if the app is never opened. */
    private static final int MAX_EVENTS = 500;

    static final class LockedApp {
        final String id;
        final String name;
        final String kind;

        LockedApp(String id, String name, String kind) {
            this.id = id;
            this.name = name;
            this.kind = kind;
        }
    }

    private static LockStore instance;

    static synchronized LockStore get(Context context) {
        if (instance == null) instance = new LockStore(context.getApplicationContext());
        return instance;
    }

    private final SharedPreferences prefs;

    private boolean enabled;
    private final Map<String, LockedApp> byPackage = new HashMap<>();
    private JSONArray appsJson = new JSONArray();
    private long baseScrolls;
    private double baseSeconds;
    private String unlockTime = "";
    private long ackSeq;
    private long nextSeq = 1;
    /** Events with seq at or below this have been handed to the app and must not change. */
    private long drainedSeq;
    private final List<JSONObject> events = new ArrayList<>();

    LockStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        load();
    }

    /* ───────── Rules from the app ───────── */

    synchronized void sync(JSONObject payload) throws JSONException {
        enabled = payload.optBoolean("enabled", false);
        appsJson = payload.optJSONArray("apps");
        if (appsJson == null) appsJson = new JSONArray();
        indexApps();
        baseScrolls = payload.optLong("scrolls", 0);
        baseSeconds = payload.optDouble("screenSeconds", 0);
        unlockTime = payload.optString("unlockTime", "");
        long ack = payload.optLong("ackSeq", 0);
        // The app can only acknowledge what it has seen; ignore anything newer.
        ackSeq = Math.min(ack, nextSeq - 1);
        List<JSONObject> keep = new ArrayList<>();
        for (JSONObject e : events) if (e.getLong("seq") > ackSeq) keep.add(e);
        events.clear();
        events.addAll(keep);
        save();
    }

    /** Usage events newer than {@code after}, oldest first. Marks them as handed over. */
    synchronized JSONArray drain(long after) throws JSONException {
        JSONArray out = new JSONArray();
        for (JSONObject e : events) {
            long seq = e.getLong("seq");
            if (seq > after) out.put(new JSONObject(e.toString()));
            if (seq > drainedSeq) drainedSeq = seq;
        }
        return out;
    }

    /* ───────── Questions from the service ───────── */

    synchronized boolean isEnabled() {
        return enabled;
    }

    synchronized LockedApp appFor(String packageName) {
        if (!enabled || packageName == null) return null;
        return byPackage.get(packageName);
    }

    /** True from today's unlock time until midnight. */
    synchronized boolean freeNow(long now) {
        if (unlockTime == null || unlockTime.isEmpty()) return false;
        String[] parts = unlockTime.split(":");
        if (parts.length != 2) return false;
        try {
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(now);
            c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(parts[0]));
            c.set(Calendar.MINUTE, Integer.parseInt(parts[1]));
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            return now >= c.getTimeInMillis();
        } catch (NumberFormatException e) {
            return false;
        }
    }

    synchronized long scrollsLeft() {
        long used = 0;
        for (JSONObject e : events) if (KIND_SCROLLS.equals(e.optString("kind"))) used += e.optLong("amount");
        return Math.max(0, baseScrolls - used);
    }

    synchronized double secondsLeft() {
        double used = 0;
        for (JSONObject e : events) if (KIND_MINUTES.equals(e.optString("kind"))) used += e.optDouble("amount");
        return Math.max(0, baseSeconds - used);
    }

    /**
     * Records usage: {@code kind} is {@link #KIND_SCROLLS} (swipes) or
     * {@link #KIND_MINUTES} (seconds). Usage of the same kind from the same visit
     * to an app is added to one event while the app hasn't read it yet, so
     * history stays short.
     */
    synchronized void spend(LockedApp app, String kind, String session, double amount, long now) {
        if (amount <= 0 || !(KIND_SCROLLS.equals(kind) || KIND_MINUTES.equals(kind))) return;
        try {
            JSONObject last = events.isEmpty() ? null : events.get(events.size() - 1);
            if (
                last != null &&
                last.getLong("seq") > drainedSeq &&
                session.equals(last.optString("session")) &&
                app.id.equals(last.optString("appId")) &&
                kind.equals(last.optString("kind"))
            ) {
                last.put("amount", last.getDouble("amount") + amount);
                last.put("endAt", now);
            } else {
                JSONObject e = new JSONObject();
                e.put("seq", nextSeq++);
                e.put("appId", app.id);
                e.put("kind", kind);
                e.put("amount", amount);
                e.put("session", session);
                e.put("at", now);
                e.put("endAt", now);
                events.add(e);
                while (events.size() > MAX_EVENTS) events.remove(0);
            }
            save();
        } catch (JSONException ignored) {
            // Values are numbers and strings we built ourselves.
        }
    }

    /* ───────── Persistence ───────── */

    private void indexApps() throws JSONException {
        byPackage.clear();
        for (int i = 0; i < appsJson.length(); i++) {
            JSONObject a = appsJson.getJSONObject(i);
            LockedApp app = new LockedApp(a.getString("id"), a.optString("name", a.getString("id")), a.getString("kind"));
            JSONArray pkgs = a.optJSONArray("packages");
            if (pkgs == null) continue;
            for (int j = 0; j < pkgs.length(); j++) byPackage.put(pkgs.getString(j), app);
        }
    }

    private void load() {
        String raw = prefs.getString(KEY_STATE, null);
        if (raw == null) return;
        try {
            JSONObject s = new JSONObject(raw);
            enabled = s.optBoolean("enabled", false);
            appsJson = s.optJSONArray("apps");
            if (appsJson == null) appsJson = new JSONArray();
            indexApps();
            baseScrolls = s.optLong("baseScrolls", 0);
            baseSeconds = s.optDouble("baseSeconds", 0);
            unlockTime = s.optString("unlockTime", "");
            ackSeq = s.optLong("ackSeq", 0);
            nextSeq = s.optLong("nextSeq", 1);
            drainedSeq = s.optLong("drainedSeq", 0);
            JSONArray ev = s.optJSONArray("events");
            events.clear();
            if (ev != null) for (int i = 0; i < ev.length(); i++) events.add(ev.getJSONObject(i));
        } catch (JSONException e) {
            // A corrupt file means no rules; the app re-sends them on next open.
            enabled = false;
            byPackage.clear();
            events.clear();
        }
    }

    private void save() {
        try {
            JSONObject s = new JSONObject();
            s.put("enabled", enabled);
            s.put("apps", appsJson);
            s.put("baseScrolls", baseScrolls);
            s.put("baseSeconds", baseSeconds);
            s.put("unlockTime", unlockTime);
            s.put("ackSeq", ackSeq);
            s.put("nextSeq", nextSeq);
            s.put("drainedSeq", drainedSeq);
            JSONArray ev = new JSONArray();
            for (JSONObject e : events) ev.put(e);
            s.put("events", ev);
            prefs.edit().putString(KEY_STATE, s.toString()).apply();
        } catch (JSONException ignored) {
            // Only our own numbers and strings go in.
        }
    }
}

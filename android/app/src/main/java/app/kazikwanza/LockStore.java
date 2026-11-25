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
    /** Daily blocked windows and the focus timer, as sent by the app (see nativeRules in logic.ts). */
    private JSONArray blocksJson = new JSONArray();
    private JSONObject focusJson;
    /** Use counted against each restriction window's limit, by "windowId@windowStart". */
    private final Map<String, Double> limitUse = new HashMap<>();
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
        blocksJson = payload.optJSONArray("blocks");
        if (blocksJson == null) blocksJson = new JSONArray();
        focusJson = payload.optJSONObject("focus");
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

    /**
     * The app id that keeps {@code packageName} shut right now (a blocked
     * window or the focus timer), or null. Blocks apply whatever the balance,
     * and during the free unlock too.
     */
    synchronized String blockedAppId(String packageName, long now) {
        if (!enabled || packageName == null) return null;
        try {
            if (focusJson != null && now < focusJson.optLong("until", 0)) {
                String id = idFor(focusJson.optJSONArray("apps"), packageName);
                if (id != null) return id;
            }
            for (int i = 0; i < blocksJson.length(); i++) {
                JSONObject b = blocksJson.getJSONObject(i);
                if (b.has("limit")) continue; // a limit only shuts the app once it's used up
                String id = idFor(b.optJSONArray("apps"), packageName);
                if (id != null && windowOn(b, now)) return id;
            }
        } catch (JSONException ignored) {
            // Our own JSON; a bad entry just doesn't block.
        }
        return null;
    }

    /* ───────── Limits in restriction windows ───────── */

    /** Is there a limit of this kind ("scrolls" or "minutes") on the package right now? */
    synchronized boolean hasLimit(String packageName, String kind, long now) {
        return !activeLimits(packageName, kind, now).isEmpty();
    }

    /**
     * Adds use (swipes, or seconds) to every limit of this kind covering the
     * package right now. Returns true if any limit counted it.
     */
    synchronized boolean countLimit(String packageName, String kind, double amount, long now) {
        if (amount <= 0) return false;
        List<String> keys = activeLimits(packageName, kind, now);
        for (String key : keys) limitUse.put(key, limitUse.containsKey(key) ? limitUse.get(key) + amount : amount);
        if (!keys.isEmpty()) save();
        return !keys.isEmpty();
    }

    /** The app id whose limit in a restriction window is used up right now, or null. */
    synchronized String limitReachedAppId(String packageName, long now) {
        if (!enabled || packageName == null) return null;
        try {
            for (int i = 0; i < blocksJson.length(); i++) {
                JSONObject b = blocksJson.getJSONObject(i);
                JSONObject limit = b.optJSONObject("limit");
                if (limit == null) continue;
                String id = idFor(b.optJSONArray("apps"), packageName);
                long start = windowStart(b, now);
                if (id == null || start < 0) continue;
                Double used = limitUse.get(b.optString("id") + "@" + start);
                double max = limit.optDouble("amount", 0) * (KIND_MINUTES.equals(limit.optString("kind")) ? 60 : 1);
                if (used != null && used >= max) return id;
            }
        } catch (JSONException ignored) {
            // Our own JSON.
        }
        return null;
    }

    /** Counter keys ("windowId@windowStart") of the limits of this kind covering the package now. */
    private List<String> activeLimits(String packageName, String kind, long now) {
        List<String> out = new ArrayList<>();
        if (!enabled || packageName == null) return out;
        try {
            for (int i = 0; i < blocksJson.length(); i++) {
                JSONObject b = blocksJson.getJSONObject(i);
                JSONObject limit = b.optJSONObject("limit");
                if (limit == null || !kind.equals(limit.optString("kind"))) continue;
                if (idFor(b.optJSONArray("apps"), packageName) == null) continue;
                long start = windowStart(b, now);
                if (start >= 0) out.add(b.optString("id") + "@" + start);
            }
        } catch (JSONException ignored) {
            // Our own JSON.
        }
        return out;
    }

    /** When the window that's on at {@code now} started (ms), or -1 when it's off. */
    static long windowStart(JSONObject b, long now) throws JSONException {
        if (!windowOn(b, now)) return -1;
        int start = minutes(b.optString("start", ""));
        int end = minutes(b.optString("end", ""));
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        int t = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        // Over midnight and before the end: it started yesterday evening.
        if (start > end && t < end) c.add(Calendar.DAY_OF_MONTH, -1);
        c.set(Calendar.HOUR_OF_DAY, start / 60);
        c.set(Calendar.MINUTE, start % 60);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static String idFor(JSONArray apps, String packageName) throws JSONException {
        if (apps == null) return null;
        for (int i = 0; i < apps.length(); i++) {
            JSONObject a = apps.getJSONObject(i);
            JSONArray pkgs = a.optJSONArray("packages");
            if (pkgs == null) continue;
            for (int j = 0; j < pkgs.length(); j++) if (packageName.equals(pkgs.getString(j))) return a.getString("id");
        }
        return null;
    }

    /** Is a daily window ("21:00" to "07:00" on the listed days, 0 = Sunday) on at {@code now}? */
    static boolean windowOn(JSONObject b, long now) throws JSONException {
        int start = minutes(b.optString("start", ""));
        int end = minutes(b.optString("end", ""));
        if (start < 0 || end < 0 || start == end) return false;
        JSONArray days = b.optJSONArray("days");
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        int today = c.get(Calendar.DAY_OF_WEEK) - 1;
        int yesterday = (today + 6) % 7;
        int t = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        if (start < end) return has(days, today) && t >= start && t < end;
        // Over midnight: started this evening, or started yesterday evening and runs until this morning.
        return (has(days, today) && t >= start) || (has(days, yesterday) && t < end);
    }

    private static boolean has(JSONArray days, int day) {
        if (days == null) return false;
        for (int i = 0; i < days.length(); i++) if (days.optInt(i, -1) == day) return true;
        return false;
    }

    private static int minutes(String hhmm) {
        String[] parts = hhmm.split(":");
        if (parts.length != 2) return -1;
        try {
            return Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]);
        } catch (NumberFormatException e) {
            return -1;
        }
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
            blocksJson = s.optJSONArray("blocks");
            if (blocksJson == null) blocksJson = new JSONArray();
            focusJson = s.optJSONObject("focus");
            JSONObject use = s.optJSONObject("limitUse");
            limitUse.clear();
            if (use != null) {
                for (java.util.Iterator<String> it = use.keys(); it.hasNext(); ) {
                    String k = it.next();
                    limitUse.put(k, use.optDouble(k, 0));
                }
            }
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
            s.put("blocks", blocksJson);
            if (focusJson != null) s.put("focus", focusJson);
            // Only windows from the last two days matter; drop older counters.
            long cutoff = System.currentTimeMillis() - 2L * 24 * 60 * 60 * 1000;
            JSONObject use = new JSONObject();
            for (Map.Entry<String, Double> e : limitUse.entrySet()) {
                String k = e.getKey();
                long start = Long.parseLong(k.substring(k.lastIndexOf('@') + 1));
                if (start >= cutoff) use.put(k, e.getValue());
            }
            s.put("limitUse", use);
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

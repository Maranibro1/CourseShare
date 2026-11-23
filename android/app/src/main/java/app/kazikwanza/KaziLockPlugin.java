package app.kazikwanza;

import android.app.AppOpsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.util.Base64;
import android.os.Process;
import android.provider.Settings;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;

/** Bridge between the web app and the phone's lock service. */
@CapacitorPlugin(name = "KaziLock")
public class KaziLockPlugin extends Plugin {

    /** Is the lock service switched on, and has Usage Access been granted? */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("accessibility", isServiceEnabled(getContext()));
        out.put("usage", hasUsageAccess(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        openSettings(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS), call);
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        // Some phones reject the package-specific page; fall back to the general list.
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        }
        openSettings(intent, call);
    }

    /** Kazikwanza's App info page, where Android 13+ hides "Allow restricted settings" for apps installed from a file. */
    @PluginMethod
    public void openAppInfo(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        openSettings(intent, call);
    }

    /** Receives the rules and balances the phone should enforce. */
    @PluginMethod
    public void sync(PluginCall call) {
        try {
            LockStore.get(getContext()).sync(call.getData());
            call.resolve();
        } catch (JSONException e) {
            call.reject("Invalid lock rules", e);
        }
    }

    /** Returns usage the phone recorded after event number {@code after}. */
    @PluginMethod
    public void drain(PluginCall call) {
        // getLong() ignores numbers small enough to arrive as Integer, so read the raw JSON.
        long after = call.getData().optLong("after", 0L);
        try {
            JSONArray events = LockStore.get(getContext()).drain(after);
            JSObject out = new JSObject();
            out.put("events", events);
            call.resolve(out);
        } catch (JSONException e) {
            call.reject("Could not read usage", e);
        }
    }

    /** Opens a real installed app by its package names, trying each in turn. */
    @PluginMethod
    public void openApp(PluginCall call) {
        JSArray packages = call.getArray("packages", new JSArray());
        PackageManager pm = getContext().getPackageManager();
        try {
            for (int i = 0; i < packages.length(); i++) {
                Intent launch = pm.getLaunchIntentForPackage(packages.getString(i));
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(launch);
                    JSObject out = new JSObject();
                    out.put("opened", true);
                    call.resolve(out);
                    return;
                }
            }
        } catch (JSONException e) {
            call.reject("Invalid package list", e);
            return;
        }
        JSObject out = new JSObject();
        out.put("opened", false);
        call.resolve(out);
    }

    /** Icon size sent to the app, in pixels. Small enough that a phone full of apps stays quick. */
    private static final int ICON_PX = 72;

    /**
     * Every app with an icon on the home screen, with its name and icon, so any
     * of them can be given a screen-time limit. The phone app, Settings, home
     * screens and Kazikwanza itself are left out: they are never locked.
     * Plugin calls already run off the main thread, so loading icons here is fine.
     */
    @PluginMethod
    public void listApps(PluginCall call) {
        JSObject out = new JSObject();
        out.put("apps", installedApps(getContext()));
        call.resolve(out);
    }

    /** The list behind {@link #listApps}: {@code pkg}, {@code name} and {@code icon} (a PNG data URL) for each app. */
    static JSArray installedApps(Context context) {
        PackageManager pm = context.getPackageManager();
        Set<String> skip = SafeApps.packages(context);
        Set<String> seen = new HashSet<>();
        JSArray apps = new JSArray();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> found = pm.queryIntentActivities(launcher, 0);
        for (ResolveInfo info : found) {
            if (info.activityInfo == null) continue;
            String pkg = info.activityInfo.packageName;
            if (skip.contains(pkg) || !seen.add(pkg)) continue;
            JSObject app = new JSObject();
            app.put("pkg", pkg);
            CharSequence label = info.loadLabel(pm);
            app.put("name", label == null ? pkg : label.toString());
            String icon = iconData(info.loadIcon(pm));
            if (icon != null) app.put("icon", icon);
            apps.put(app);
        }
        return apps;
    }

    private static String iconData(Drawable drawable) {
        if (drawable == null) return null;
        try {
            Bitmap bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            drawable.setBounds(0, 0, ICON_PX, ICON_PX);
            drawable.draw(canvas);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
            bitmap.recycle();
            return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } catch (RuntimeException e) {
            // A broken icon just means the app shows its first letter instead.
            return null;
        }
    }

    /** Called by MainActivity when the lock service brings Kazikwanza to the front. */
    void notifyLocked(String appId, String kind) {
        JSObject data = new JSObject();
        data.put("appId", appId);
        if (kind != null) data.put("kind", kind);
        // Kept until the page adds its listener, so a cold start still shows the lock screen.
        notifyListeners("locked", data, true);
    }

    private void openSettings(Intent intent, PluginCall call) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("This phone has no settings page for that", e);
        }
    }

    static boolean isServiceEnabled(Context context) {
        String enabled = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        ComponentName mine = new ComponentName(context, KaziAccessibilityService.class);
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        for (String s : splitter) {
            ComponentName c = ComponentName.unflattenFromString(s);
            if (mine.equals(c)) return true;
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    static boolean hasUsageAccess(Context context) {
        AppOpsManager ops = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        if (ops == null) return false;
        int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }
}

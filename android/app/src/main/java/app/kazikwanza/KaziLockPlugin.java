package app.kazikwanza;

import android.app.AppOpsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Process;
import android.provider.Settings;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
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

    /** Called by MainActivity when the lock service brings Kazikwanza to the front. */
    void notifyLocked(String appId) {
        JSObject data = new JSObject();
        data.put("appId", appId);
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

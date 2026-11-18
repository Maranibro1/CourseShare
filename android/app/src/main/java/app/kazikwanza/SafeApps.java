package app.kazikwanza;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.telecom.TelecomManager;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Apps that are never offered for locking and never locked, whatever the
 * rules say: Kazikwanza itself (or nobody could get back in to earn time), the
 * phone app (so anyone can always call for help), Settings and the home screen.
 */
final class SafeApps {

    private SafeApps() {}

    static Set<String> packages(Context context) {
        Set<String> out = new HashSet<>();
        out.add(context.getPackageName());
        out.add("com.android.settings");
        out.add("com.android.phone");
        out.add("com.android.emergency");
        out.add("com.android.systemui");
        PackageManager pm = context.getPackageManager();
        addHandlers(pm, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), out);
        addHandlers(pm, new Intent(Intent.ACTION_DIAL), out);
        addHandlers(pm, new Intent(Intent.ACTION_DIAL, Uri.parse("tel:112")), out);
        addHandlers(pm, new Intent(Settings.ACTION_SETTINGS), out);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
            String dialer = telecom == null ? null : telecom.getDefaultDialerPackage();
            if (dialer != null) out.add(dialer);
        }
        return out;
    }

    private static void addHandlers(PackageManager pm, Intent intent, Set<String> out) {
        List<ResolveInfo> list = pm.queryIntentActivities(intent, 0);
        for (ResolveInfo info : list) {
            if (info.activityInfo != null) out.add(info.activityInfo.packageName);
        }
    }
}

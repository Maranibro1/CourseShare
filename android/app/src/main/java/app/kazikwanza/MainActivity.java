package app.kazikwanza;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    static final String EXTRA_LOCKED_APP = "app.kazikwanza.LOCKED_APP";
    /** For YouTube: which part was locked, "scrolls" (Shorts) or "minutes" (videos). */
    static final String EXTRA_LOCKED_KIND = "app.kazikwanza.LOCKED_KIND";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KaziLockPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Also called by BridgeActivity with the launch intent once the bridge is ready. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String appId = intent == null ? null : intent.getStringExtra(EXTRA_LOCKED_APP);
        if (appId == null || getBridge() == null) return;
        String kind = intent.getStringExtra(EXTRA_LOCKED_KIND);
        intent.removeExtra(EXTRA_LOCKED_APP);
        intent.removeExtra(EXTRA_LOCKED_KIND);
        PluginHandle handle = getBridge().getPlugin("KaziLock");
        if (handle != null && handle.getInstance() instanceof KaziLockPlugin) {
            ((KaziLockPlugin) handle.getInstance()).notifyLocked(appId, kind);
        }
    }
}

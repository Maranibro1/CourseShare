package app.kazikwanza;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    static final String EXTRA_LOCKED_APP = "app.kazikwanza.LOCKED_APP";

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
        intent.removeExtra(EXTRA_LOCKED_APP);
        PluginHandle handle = getBridge().getPlugin("KaziLock");
        if (handle != null && handle.getInstance() instanceof KaziLockPlugin) {
            ((KaziLockPlugin) handle.getInstance()).notifyLocked(appId);
        }
    }
}

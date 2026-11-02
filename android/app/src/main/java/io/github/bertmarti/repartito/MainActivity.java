package io.github.bertmarti.repartito;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin propio para «Compartir con Repartito» (antes de crear el puente).
        registerPlugin(ShareInboxPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

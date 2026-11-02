package io.github.bertmarti.repartito;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Recreada tras cerrar Android el proceso: su intent sería el `ACTION_SEND` de entonces, ya entregado (y con
        // el permiso sobre la URI quizá caducado). No se vuelve a recibir.
        if (savedInstanceState != null) setIntent(new Intent(Intent.ACTION_MAIN));
        // Plugin propio para «Compartir con Repartito» (antes de crear el puente).
        registerPlugin(ShareInboxPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

package io.github.bertmarti.repartito;

import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Parcelable;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * «Compartir con Repartito» en la app: recibe el {@code ACTION_SEND} del menú de compartir del sistema (una imagen o
 * un texto) y se lo entrega a la web con {@code take()}.
 *
 * <ul>
 *   <li>Sin permisos: la imagen se lee con el permiso temporal que concede el propio intent sobre esa URI.
 *   <li>No es un lector de archivos: JS no puede pedir ninguna URI; solo recibe lo último que se compartió, una vez.
 *   <li>Solo {@code content://} de otras apps (nunca {@code file://} ni los proveedores de esta app), solo los tipos de
 *       imagen que la web sabe decodificar y como mucho {@link #MAX_IMAGE_BYTES}. La web vuelve a comprobar el tipo
 *       por el contenido y la recomprime antes de guardarla.
 *   <li>Nada se escribe en el registro del sistema (logcat) ni en disco: lo pendiente vive en memoria.
 * </ul>
 *
 * Todo el trabajo va en el hilo de los plugins de Capacitor (el mismo que atiende {@code take()}), así que la lectura
 * termina antes de que se entregue y no bloquea la interfaz.
 */
@CapacitorPlugin(name = "ShareInbox")
public class ShareInboxPlugin extends Plugin {

    /** La foto cruza el puente en base64 (+33 %): por encima de esto no se intenta. */
    static final int MAX_IMAGE_BYTES = 20 * 1024 * 1024;
    /** Un enlace de grupo (1,5 MB de texto) con algo de mensaje alrededor. */
    static final int MAX_TEXT_CHARS = 1_500_000 + 16_384;
    /** Lo mismo que IMAGE_TYPES en src/ui/shareTarget.ts. */
    static final Set<String> IMAGE_TYPES = new HashSet<>(Arrays.asList("image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"));

    /** Lo último que se compartió. Solo se toca en el hilo de los plugins. */
    private JSObject pending = null;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        // Al volver desde «Recientes» Android repite el intent original: ya se entregó.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        final String type = intent.getType();
        final CharSequence text = safeText(intent, Intent.EXTRA_TEXT);
        final CharSequence subject = safeText(intent, Intent.EXTRA_SUBJECT);
        final Uri stream = type != null && type.startsWith("image/") ? safeStream(intent) : null;
        // Que una rotación o una recreación no lo vuelva a entregar.
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        execute(() -> {
            pending = read(text, subject, stream);
            notifyListeners("shared", new JSObject());
        });
    }

    /** Lo pendiente (y lo olvida), o un objeto vacío. */
    @PluginMethod
    public void take(PluginCall call) {
        JSObject out = pending;
        pending = null;
        call.resolve(out != null ? out : new JSObject());
    }

    private JSObject read(CharSequence text, CharSequence subject, Uri stream) {
        JSObject out = new JSObject();
        if (text != null && text.length() > MAX_TEXT_CHARS) return error(out, "size");
        if (subject != null && subject.length() > MAX_TEXT_CHARS) return error(out, "size");
        if (text != null) out.put("text", text.toString());
        if (subject != null) out.put("title", subject.toString());
        if (stream != null) readImage(out, stream);
        return out;
    }

    private void readImage(JSObject out, Uri uri) {
        if (!"content".equals(uri.getScheme())) {
            error(out, "type");
            return;
        }
        // Nunca los proveedores de la propia app (p. ej. su FileProvider con las copias de seguridad).
        String authority = uri.getAuthority();
        String pkg = getContext().getPackageName();
        if (authority == null || authority.equals(pkg) || authority.startsWith(pkg + ".")) {
            error(out, "type");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        String mime;
        try {
            mime = resolver.getType(uri);
        } catch (RuntimeException e) {
            error(out, "read");
            return;
        }
        if (mime == null || !IMAGE_TYPES.contains(mime.toLowerCase(Locale.ROOT))) {
            error(out, "type");
            return;
        }
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) {
                error(out, "read");
                return;
            }
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(chunk)) != -1) {
                total += n;
                if (total > MAX_IMAGE_BYTES) {
                    error(out, "size");
                    return;
                }
                buf.write(chunk, 0, n);
            }
            if (total == 0) {
                error(out, "empty");
                return;
            }
            out.put("image", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
            out.put("mime", mime);
        } catch (IOException | RuntimeException e) {
            error(out, "read");
        }
    }

    private static JSObject error(JSObject out, String code) {
        out.put("error", code);
        return out;
    }

    /** Los extras los pone otra app: cualquier cosa rara se ignora. */
    private static CharSequence safeText(Intent intent, String name) {
        try {
            return intent.getCharSequenceExtra(name);
        } catch (RuntimeException e) {
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private static Uri safeStream(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            return p instanceof Uri ? (Uri) p : null;
        } catch (RuntimeException e) {
            return null;
        }
    }
}

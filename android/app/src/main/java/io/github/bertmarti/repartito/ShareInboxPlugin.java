package io.github.bertmarti.repartito;

import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.content.res.AssetFileDescriptor;
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

/**
 * «Compartir con Repartito» en la app: recibe el {@code ACTION_SEND} del menú de compartir del sistema (una imagen o
 * un texto) y se lo entrega a la web con {@code take()}.
 *
 * <ul>
 *   <li>Sin permisos: la imagen se lee con el permiso temporal que concede el propio intent sobre esa URI.
 *   <li>No es un lector de archivos: JS no puede pedir ninguna URI; solo recibe lo último que se compartió, una vez.
 *   <li>Solo {@code content://} de otras apps (nunca {@code file://}, ni URIs con usuario {@code 0@…}, ni proveedores
 *       de esta app), como mucho {@link #MAX_IMAGE_BYTES} y solo si los primeros bytes son de una imagen admitida (no
 *       se fía del tipo que declara quien la envía). La web lo vuelve a comprobar y la recomprime antes de guardarla.
 *   <li>Nada se escribe en el registro del sistema (logcat) ni en disco: lo pendiente vive en memoria.
 * </ul>
 *
 * Todo el trabajo va en el hilo de los plugins de Capacitor (el mismo que atiende {@code take()}), así que la lectura
 * termina antes de que se entregue y no bloquea la interfaz.
 */
@CapacitorPlugin(name = "ShareInbox")
public class ShareInboxPlugin extends Plugin {

    /**
     * La foto cruza el puente en base64 (+33 %) y en JSON: por encima de esto no se intenta (lo mismo que
     * SHARE_MAX_IMAGE_NATIVE en src/ui/shareTarget.ts). Una foto de móvil suele pesar 2-8 MB.
     */
    static final int MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    /** Un enlace de grupo (1,5 MB de texto) con algo de mensaje alrededor. */
    static final int MAX_TEXT_CHARS = 1_500_000 + 16_384;

    /** Lo último que se compartió. Solo se toca en el hilo de los plugins. */
    private JSObject pending = null;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        // Al volver desde «Recientes» Android repite el intent original: ya se entregó.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        final String type = intent.getType();
        final boolean image = type != null && type.startsWith("image/");
        final CharSequence text = safeText(intent, Intent.EXTRA_TEXT);
        final CharSequence subject = safeText(intent, Intent.EXTRA_SUBJECT);
        final Uri stream = image ? safeStream(intent) : null;
        // Que una rotación no lo vuelva a entregar (la recreación tras cerrar el proceso: ver MainActivity).
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        execute(() -> {
            pending = read(text, subject, image, stream);
            // Retenido: si la web aún no escucha, lo recibe al suscribirse (y `take()` vacío no hace nada).
            notifyListeners("shared", new JSObject(), true);
        });
    }

    /** Lo pendiente (y lo olvida), o un objeto vacío. */
    @PluginMethod
    public void take(PluginCall call) {
        JSObject out = pending;
        pending = null;
        call.resolve(out != null ? out : new JSObject());
    }

    private JSObject read(CharSequence text, CharSequence subject, boolean image, Uri stream) {
        JSObject out = new JSObject();
        if (text != null && text.length() > MAX_TEXT_CHARS) return error(out, "size");
        if (subject != null && subject.length() > MAX_TEXT_CHARS) return error(out, "size");
        if (text != null) out.put("text", text.toString());
        if (subject != null) out.put("title", subject.toString());
        if (stream != null) readImage(out, stream);
        else if (image) error(out, "read");
        return out;
    }

    /** ¿Es una URI de esta misma app? (Su FileProvider expone la caché con las copias de seguridad, A6.) */
    private boolean ownProvider(Uri uri) {
        String authority = uri.getAuthority();
        // `content://0@autoridad/…`: el ContentResolver quita el usuario y resolvería la autoridad igualmente.
        if (authority == null || uri.getUserInfo() != null || authority.indexOf('@') >= 0) return true;
        String pkg = getContext().getPackageName();
        if (authority.equals(pkg) || authority.startsWith(pkg + ".")) return true;
        try {
            ProviderInfo info = getContext().getPackageManager().resolveContentProvider(authority, 0);
            return info != null && pkg.equals(info.packageName);
        } catch (RuntimeException e) {
            return true;
        }
    }

    private void readImage(JSObject out, Uri uri) {
        if (!"content".equals(uri.getScheme()) || ownProvider(uri)) {
            error(out, "type");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        long declared = declaredLength(resolver, uri);
        if (declared > MAX_IMAGE_BYTES) {
            error(out, "size");
            return;
        }
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) {
                error(out, "read");
                return;
            }
            ByteArrayOutputStream buf = new ByteArrayOutputStream(declared > 0 ? (int) declared : 1024 * 1024);
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
            byte[] bytes = buf.toByteArray();
            buf = null;
            String mime = sniffImage(bytes);
            if (mime == null) {
                error(out, "type");
                return;
            }
            out.put("image", Base64.encodeToString(bytes, Base64.NO_WRAP));
            out.put("mime", mime);
        } catch (OutOfMemoryError e) {
            // Un móvil con poca memoria: mejor avisar que cerrar la app.
            out.remove("image");
            error(out, "size");
        } catch (IOException | RuntimeException e) {
            error(out, "read");
        }
    }

    /** Tamaño que anuncia el proveedor (o -1): permite rechazar sin leer y reservar el búfer justo. */
    private static long declaredLength(ContentResolver resolver, Uri uri) {
        try (AssetFileDescriptor fd = resolver.openAssetFileDescriptor(uri, "r")) {
            return fd != null ? fd.getLength() : -1;
        } catch (IOException | RuntimeException e) {
            return -1;
        }
    }

    /** Tipo real por los primeros bytes (igual que `sniffImage` en src/ui/shareTarget.ts y public/sw.js). */
    static String sniffImage(byte[] b) {
        if (startsWith(b, 0, 0xff, 0xd8, 0xff)) return "image/jpeg";
        if (startsWith(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
        if (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a")) return "image/gif";
        if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "image/webp";
        if (ascii(b, 4, "ftypavif") || ascii(b, 4, "ftypavis")) return "image/avif";
        return null;
    }

    private static boolean startsWith(byte[] b, int at, int... xs) {
        if (b.length < at + xs.length) return false;
        for (int i = 0; i < xs.length; i++) if ((b[at + i] & 0xff) != xs[i]) return false;
        return true;
    }

    private static boolean ascii(byte[] b, int at, String s) {
        int[] xs = new int[s.length()];
        for (int i = 0; i < xs.length; i++) xs[i] = s.charAt(i);
        return startsWith(b, at, xs);
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
            // El getter con tipo falla en Android 13 (b/232589966); AndroidX solo lo usa desde Android 14.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            return p instanceof Uri ? (Uri) p : null;
        } catch (RuntimeException e) {
            return null;
        }
    }
}

/**
 * Diferencias de la app de Android (Capacitor) respecto a la web.
 *
 * `NATIVE` es una constante de compilación (`vite build --mode android`): en el build web vale `false`, así que
 * todo lo que cuelga de ella (y los plugins de Capacitor) desaparece del paquete web.
 */
export const NATIVE = import.meta.env.MODE === 'android';

/** Dirección pública de la web. Dentro de la app el origen es `https://localhost`, que no sirve para compartir. */
export const PUBLIC_URL = 'https://bertmarti.github.io/repartito/';

/** Base para los enlaces que se comparten: siempre una dirección que cualquiera pueda abrir. */
export function appUrl(): string {
  return NATIVE ? PUBLIC_URL : location.origin + import.meta.env.BASE_URL;
}

/** ¿Hay un menú de compartir del sistema? (El WebView de Android no trae `navigator.share`.) */
export const canShare = (): boolean => NATIVE || typeof navigator.share === 'function';

/**
 * Abre el menú de compartir del sistema con un texto y, si se pasa, un enlace. Sin `url` no se añade ninguno (los
 * recordatorios de pago no llevan el enlace del grupo).
 */
export async function shareLink(title: string, text: string, url?: string): Promise<void> {
  if (NATIVE) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, text, ...(url ? { url } : {}), dialogTitle: title }).catch(() => undefined);
    return;
  }
  await navigator.share({ title, text, ...(url ? { url } : {}) }).catch(() => undefined);
}

/**
 * En la app no hay descargas: el archivo se escribe en la caché privada de la app y se ofrece con el menú de
 * compartir (guardar en Archivos o Drive, enviarlo por WhatsApp…). Nunca sale sin que la persona lo elija.
 */
export async function saveFileNative(filename: string, text: string): Promise<void> {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const { uri } = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: filename, files: [uri] }).catch(() => undefined);
}

/** Lo que entrega el plugin propio `ShareInbox` (android/app/src/main/java/…/ShareInboxPlugin.java). */
export interface NativeShare {
  /** `EXTRA_SUBJECT` y `EXTRA_TEXT` del `ACTION_SEND`. */
  title?: string;
  text?: string;
  /** La imagen compartida, en base64, ya comprobada (tipo y tamaño) por el plugin. */
  image?: string;
  mime?: string;
  error?: string;
}

interface ShareInboxPlugin {
  /** Lo último que se compartió con la app (y lo olvida), o `{}`. No lee nada más: no es un lector de archivos. */
  take(): Promise<NativeShare>;
  addListener(event: 'shared', fn: () => void): Promise<{ remove: () => Promise<void> }>;
}

let inbox: Promise<{ plugin: ShareInboxPlugin }> | null = null;

/**
 * El plugin (solo en la app; en la web `@capacitor/core` es el sustituto vacío).
 *
 * Va envuelto en un objeto a propósito: el proxy de `registerPlugin` responde a **cualquier** propiedad, también a
 * `then`, así que una promesa que se resuelve con él lo toma por «thenable», llama al método nativo `then` (que no
 * existe) y no se resuelve nunca. Por eso tampoco se puede devolver desde una función `async`: se usa `.plugin`.
 * Pasó en el emulador: ni `take()` ni el aviso `shared` llegaban a la app.
 */
export function shareInbox(): Promise<{ plugin: ShareInboxPlugin }> {
  inbox ??= import('@capacitor/core').then(({ registerPlugin }) => ({ plugin: registerPlugin<ShareInboxPlugin>('ShareInbox') }));
  return inbox;
}

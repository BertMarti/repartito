/**
 * «Compartir con Repartito» (Share Target): lo que llega desde el menú de compartir del móvil.
 *
 * - **Web (PWA instalada)**: el sistema hace un POST `multipart/form-data` a `/repartito/compartir`. Lo atiende el
 *   service worker (`public/sw.js`, nunca llega a GitHub Pages): valida, deja lo recibido en la Cache API
 *   (`repartito-compartido`) y redirige a `/repartito/#compartido`. Aquí se recoge, se borra al momento y se valida
 *   **otra vez** (la Cache API la comparten las demás webs del origen, I7).
 * - **App de Android**: el plugin propio `ShareInbox` (Java, en el repo) lee el `ACTION_SEND` y lo guarda en memoria
 *   hasta que esta capa lo pide con `take()`. Solo entrega lo último que se compartió: no lee otros archivos.
 *
 * Luego, `routeShare` decide: un enlace de grupo (`#g=…`) va a la misma vista previa y fusión que abrir el enlace; una
 * foto (y, si viene, un texto como concepto) abre «Nuevo gasto»; cualquier otra URL se rechaza (nunca se abre).
 * Nada de lo recibido va en la ruta ni en `?consulta`.
 */
import { cleanText, MAX_PAYLOAD_CHARS, payloadKind } from '../core';
import { NATIVE, shareInbox, type NativeShare } from './native';

/** Fragmento con el que el service worker devuelve a la app (fijo: nunca lleva datos). */
export const SHARE_FLAG = '#compartido';
/** Caché temporal donde el service worker deja lo compartido (no empieza por `repartito-shell`/`-assets`). */
export const SHARE_CACHE = 'repartito-compartido';
/** Lo que lleve más de esto esperando se descarta. */
export const SHARE_TTL_MS = 10 * 60_000;
/** Un enlace de grupo cabe holgado (1,5 MB de texto) y, con mensaje alrededor, un poco más. */
export const SHARE_MAX_TEXT = MAX_PAYLOAD_CHARS + 16_384;
/** Igual que al elegir una foto (`PHOTO_MAX_INPUT` en image.ts; un test comprueba que coinciden). */
export const SHARE_MAX_IMAGE = 40 * 1024 * 1024;
/** En la app la foto cruza el puente de Capacitor en base64: tope más bajo (ver ShareInboxPlugin.java). */
export const SHARE_MAX_IMAGE_NATIVE = 15 * 1024 * 1024;
/** Lo que se sabe decodificar en todos los navegadores modernos (sin HEIC). */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const SHARE_ERRORS = ['size', 'type', 'read', 'empty', 'foreign'] as const;
export type ShareProblem = (typeof SHARE_ERRORS)[number];

/** Lo recibido, sin interpretar. */
export interface RawShare {
  texts: string[];
  file: Blob | null;
  /** Fotos de más que no se adjuntan (solo una por gasto). */
  ignored: number;
  error: ShareProblem | null;
}

/** Lo que llega al gasto nuevo: la foto (aún sin comprimir) y un posible concepto. */
export interface SharedDraft {
  file: Blob | null;
  title: string;
}

export type Routed = { kind: 'link'; payload: string } | ({ kind: 'expense' } & SharedDraft) | { kind: 'error'; error: ShareProblem };

/**
 * Tipo real de la imagen por sus primeros bytes (el tipo declarado lo pone quien la envía). `null` si no es uno de los
 * formatos admitidos: SVG, HEIC, HTML o cualquier otra cosa se rechazan.
 */
export function sniffImage(b: Uint8Array): ImageType | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(4, 'ftypavif') || ascii(4, 'ftypavis')) return 'image/avif';
  return null;
}

/** El payload del primer enlace de grupo válido dentro de un texto («Únete: https://…/#g=1.…»), o `null`. */
export function findPayload(text: string): string | null {
  for (const m of text.matchAll(/#g=([A-Za-z0-9_.-]+)/g)) if (payloadKind(m[1]!)) return m[1]!;
  return null;
}

const URL_RE = /\b(?:https?|ftp|file|intent|javascript|data|content):\S*/giu;

/** Concepto a partir de un texto compartido: sin direcciones, sin controles, una línea y como mucho 120 caracteres. */
export function titleFrom(text: string): string {
  return cleanText(text.replace(URL_RE, ' '));
}

/** ¿Hay alguna dirección en lo compartido? (Para explicar por qué no se abre.) */
const hasUrl = (texts: readonly string[]) => texts.some((t) => new RegExp(URL_RE.source, 'iu').test(t));

/** Decide qué hacer con lo recibido. La foto se comprueba por su contenido y sale con el tipo detectado. */
export async function routeShare(raw: RawShare, maxImage = SHARE_MAX_IMAGE): Promise<Routed> {
  if (raw.texts.length > 3 || raw.texts.some((t) => typeof t !== 'string' || t.length > SHARE_MAX_TEXT)) return { kind: 'error', error: 'size' };
  // Un enlace de grupo manda: es lo que la persona quería abrir (lo demás del mensaje no importa).
  for (const t of raw.texts) {
    const payload = findPayload(t);
    if (payload) return { kind: 'link', payload };
  }
  if (raw.error) return { kind: 'error', error: raw.error };
  let file: Blob | null = null;
  if (raw.file) {
    if (raw.file.size === 0) return { kind: 'error', error: 'empty' };
    if (raw.file.size > maxImage) return { kind: 'error', error: 'size' };
    let type: ImageType | null;
    try {
      type = sniffImage(new Uint8Array(await raw.file.slice(0, 16).arrayBuffer()));
    } catch {
      return { kind: 'error', error: 'read' };
    }
    if (!type) return { kind: 'error', error: 'type' };
    file = new Blob([raw.file], { type });
  }
  const title = raw.texts.map(titleFrom).find((t) => t !== '') ?? '';
  if (!file && !title) return { kind: 'error', error: hasUrl(raw.texts) ? 'foreign' : 'empty' };
  return { kind: 'expense', file, title };
}

/* ---------- De dónde se recoge ---------- */

export interface ShareSource {
  /** Lo pendiente (y lo borra), o `null`. */
  take(): Promise<RawShare | null>;
  /** Borra cualquier resto sin leerlo. */
  discard(): Promise<void>;
  /** Avisa si llega algo con la app ya abierta (solo en Android). */
  listen?(fn: () => void): void;
}

const isProblem = (v: unknown): v is ShareProblem => typeof v === 'string' && (SHARE_ERRORS as readonly string[]).includes(v);

/** URLs (solo claves de caché, nunca se piden a la red) donde el service worker deja lo compartido. */
export const shareUrls = (base: string) => ({ meta: new URL('compartir/datos', base).href, file: new URL('compartir/foto', base).href });

/**
 * Lo que dejó el service worker en la Cache API. Se valida todo: otra web del mismo origen podría haber escrito ahí
 * (I7), así que como mucho podría proponer un enlace o una foto, igual que si te enviara un enlace.
 */
export function webShareSource(store: Pick<CacheStorage, 'open' | 'delete'>, base: string, now: () => number = Date.now): ShareSource {
  const urls = shareUrls(base);
  return {
    async take() {
      let meta: unknown;
      let file: Blob | null = null;
      try {
        const cache = await store.open(SHARE_CACHE);
        const m = await cache.match(urls.meta);
        if (!m) return null;
        const text = await m.text();
        if (text.length > SHARE_MAX_TEXT * 3 + 1024) return null;
        meta = JSON.parse(text);
        const f = await cache.match(urls.file);
        if (f) file = await f.blob();
      } catch {
        return null;
      } finally {
        await store.delete(SHARE_CACHE).catch(() => false);
      }
      if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null;
      const o = meta as Record<string, unknown>;
      const at = o.at;
      if (o.v !== 1 || typeof at !== 'number' || !(at <= now() + 60_000 && at >= now() - SHARE_TTL_MS)) return null;
      const texts = Array.isArray(o.texts) && o.texts.length <= 3 && o.texts.every((t) => typeof t === 'string') ? (o.texts as string[]) : null;
      if (!texts) return null;
      const ignored = typeof o.ignored === 'number' && Number.isSafeInteger(o.ignored) && o.ignored >= 0 && o.ignored < 1000 ? o.ignored : 0;
      return { texts, file: o.file === true ? file : null, ignored, error: o.error === null || o.error === undefined ? null : isProblem(o.error) ? o.error : 'read' };
    },
    async discard() {
      await store.delete(SHARE_CACHE).catch(() => false);
    },
  };
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Base64 → bytes, solo si tiene la forma esperada y no pasa de `max` bytes. */
export function base64Bytes(s: string, max: number): Uint8Array | null {
  if (s.length % 4 !== 0 || s.length > Math.ceil(max / 3) * 4 || !B64.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Lo que devuelve el plugin nativo → `RawShare`, comprobando cada campo (es dato de fuera). */
export function fromNative(r: NativeShare | null | undefined): RawShare | null {
  if (!r || typeof r !== 'object') return null;
  const texts = [r.title, r.text].filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  const error = r.error === undefined ? null : isProblem(r.error) ? r.error : 'read';
  let file: Blob | null = null;
  if (typeof r.image === 'string') {
    const bytes = base64Bytes(r.image, SHARE_MAX_IMAGE_NATIVE);
    if (!bytes) return { texts, file: null, ignored: 0, error: 'read' };
    file = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  }
  if (texts.length === 0 && !file && !error) return null;
  return { texts, file, ignored: 0, error };
}

function nativeShareSource(): ShareSource {
  return {
    async take() {
      const plugin = await shareInbox();
      return fromNative(await plugin.take());
    },
    async discard() {
      /* el plugin solo guarda lo último y lo entrega una vez */
    },
    listen(fn) {
      void shareInbox()
        .then((p) => p.addListener('shared', fn))
        .catch(() => undefined);
    },
  };
}

let source: ShareSource | null | undefined;

/** De dónde llegan las comparticiones: el plugin en la app, la Cache API en la web, o nada. */
export function shareSource(): ShareSource | null {
  if (source === undefined) {
    if (NATIVE) source = nativeShareSource();
    else source = typeof caches === 'undefined' ? null : webShareSource(caches, location.origin + import.meta.env.BASE_URL);
  }
  return source;
}

/** Solo para tests. */
export function setShareSource(s: ShareSource | null | undefined): void {
  source = s;
}

export const maxImageMb = (): number => (NATIVE ? SHARE_MAX_IMAGE_NATIVE : SHARE_MAX_IMAGE) / (1024 * 1024);

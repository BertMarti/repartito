/* global self, caches, fetch, URL, Response, crypto, Blob */
/*
 * Service worker de Repartito, escrito a mano.
 *
 * - Solo GET y solo dentro de su ámbito (/repartito/): nunca toca nada de otras rutas ni de otros orígenes.
 *   La única excepción es el POST de «Compartir con Repartito» (share_target del manifest) a /repartito/compartir:
 *   se atiende aquí entero y nunca llega a la red (ver «Compartir con Repartito» más abajo).
 * - Al instalar guarda la app (index.html, manifest, icono) y los archivos con hash que enlaza index.html,
 *   incluidas sus fuentes, para que la app funcione sin conexión desde la primera visita.
 * - Navegación: primero la red (para recibir versiones nuevas) y, sin conexión, la copia guardada.
 * - /assets/ (nombres con hash, inmutables): primero la caché.
 * - Al activar borra las cachés de versiones anteriores.
 * - Integridad: al compilar se inyecta aquí el SHA-256 de cada archivo publicado (INTEGRITY) y una versión
 *   derivada de ellos. Nada se guarda ni se sirve desde la caché si su huella no coincide: otra página del
 *   mismo origen (bertmarti.github.io) podría escribir en la Cache API, pero no colar un script.
 *
 * Los datos de los grupos nunca pasan por aquí: viven en localStorage y en el fragmento # (que no se envía). Lo
 * único que puede llevarlos es un enlace compartido con la app, que se queda en este dispositivo (Cache API) hasta
 * que la página lo recoge y lo borra.
 */
// Ambas constantes las reescribe el build (plugin `sw-integrity` de vite.config.ts).
const VERSION = 'dev';
const INTEGRITY = {};
const SHELL_CACHE = `repartito-shell-${VERSION}`;
const ASSET_CACHE = `repartito-assets-${VERSION}`;
const MAX_ASSETS = 80;
const SCOPE = self.registration.scope; // p. ej. https://bertmarti.github.io/repartito/
const ASSETS_PREFIX = new URL('assets/', SCOPE).href;
const INDEX = new URL('./', SCOPE).href;
const SHELL = [INDEX, new URL('manifest.webmanifest', SCOPE).href, new URL('icon.svg', SCOPE).href];

// «Compartir con Repartito». Los mismos valores que src/ui/shareTarget.ts (un test lo comprueba).
const SHARE_ACTION = new URL('compartir', SCOPE).href;
const SHARE_CACHE = 'repartito-compartido';
const SHARE_META = new URL('compartir/datos', SCOPE).href;
const SHARE_FILE = new URL('compartir/foto', SCOPE).href;
const SHARE_DONE = new URL('./#compartido', SCOPE).href;
const SHARE_MAX_TEXT = 1_500_000 + 16_384;
const SHARE_MAX_IMAGE = 40 * 1024 * 1024;
const SHARE_MAX_BODY = SHARE_MAX_IMAGE + 3 * SHARE_MAX_TEXT + 64 * 1024;
const SHARE_MAX_FILES = 20;

const inScope = (url) => url.startsWith(SCOPE);
const cacheable = (res) => res && res.ok && res.type === 'basic';

/** Huella esperada de una URL del ámbito (ruta relativa a /repartito/; la raíz es index.html). */
function expected(url) {
  const path = new URL(url).pathname.slice(new URL(SCOPE).pathname.length) || 'index.html';
  return Object.prototype.hasOwnProperty.call(INTEGRITY, path) ? INTEGRITY[path] : null;
}

async function sha256(res) {
  const buf = await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** ¿Es esta respuesta exactamente el archivo publicado para `url`? */
async function intact(url, res) {
  const want = expected(url);
  return !!res && want !== null && (await sha256(res)) === want;
}

/** Guarda solo copias íntegras. */
async function putIntact(cache, url, res) {
  if (cacheable(res) && (await intact(url, res))) await cache.put(url, res.clone());
}

/** Lee de la caché solo si lo guardado sigue siendo íntegro (si no, lo borra). */
async function matchIntact(cache, url) {
  const hit = await cache.match(url);
  if (!hit) return null;
  if (await intact(url, hit)) return hit;
  await cache.delete(url);
  return null;
}

/** URLs de /assets/ que aparecen en un texto (index.html o CSS). */
function assetUrls(text, base) {
  const out = new Set();
  const re = /(?:src|href)="([^"]+)"|url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1] || m[2];
    if (!raw || raw.startsWith('data:')) continue;
    const abs = new URL(raw, base).href;
    if (abs.startsWith(ASSETS_PREFIX)) out.add(abs);
  }
  return [...out];
}

async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);
  const indexRes = await fetch(INDEX, { cache: 'reload' });
  if (!cacheable(indexRes)) throw new Error('index.html no disponible');
  const html = await indexRes.clone().text();
  await putIntact(shell, INDEX, indexRes);
  await Promise.all(
    SHELL.slice(1).map(async (url) => {
      const res = await fetch(url, { cache: 'reload' }).catch(() => null);
      await putIntact(shell, url, res);
    }),
  );
  const first = assetUrls(html, INDEX);
  const fonts = [];
  await Promise.all(
    first.map(async (url) => {
      const res = await fetch(url).catch(() => null);
      if (!cacheable(res)) return;
      if (url.endsWith('.css')) {
        // Fuentes latinas que usa la hoja de estilos (las demás se guardan si llegan a pedirse).
        for (const f of assetUrls(await res.clone().text(), url)) if (/latin/.test(f)) fonts.push(f);
      }
      await putIntact(assets, url, res);
    }),
  );
  await Promise.all(
    fonts.map(async (url) => {
      const res = await fetch(url).catch(() => null);
      await putIntact(assets, url, res);
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => /^(repartito|amedias)-/.test(k) && k !== SHELL_CACHE && k !== ASSET_CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

async function fromAssets(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await matchIntact(cache, request.url);
  if (hit) return hit;
  const res = await fetch(request);
  await putIntact(cache, request.url, res);
  trim(cache);
  return res;
}

/** Navegación: la red primero. Solo la propia app (index.html íntegro) se guarda como copia sin conexión. */
async function navigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (new URL(request.url).pathname === new URL(INDEX).pathname) await putIntact(cache, INDEX, res);
    return res;
  } catch {
    return (await matchIntact(cache, INDEX)) || Response.error();
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (SHELL.includes(request.url)) await putIntact(cache, request.url, res);
    return res;
  } catch {
    return (await matchIntact(cache, request.url)) || Response.error();
  }
}

/* ---------- Compartir con Repartito ---------- */

class ShareProblem extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Tipo real de la imagen por sus primeros bytes (igual que `sniffImage` en src/ui/shareTarget.ts). */
function sniffImage(b) {
  const at = (i, ...xs) => xs.every((x, k) => b[i + k] === x);
  const ascii = (i, s) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(4, 'ftypavif') || ascii(4, 'ftypavis')) return 'image/avif';
  return null;
}

/** Del POST a lo que se guarda: textos acotados y, como mucho, una imagen comprobada por su contenido. */
async function parseShare(request) {
  const out = { texts: [], file: null, ignored: 0, error: null };
  const type = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(type)) throw new ShareProblem('read');
  // El cuerpo lo ha montado el navegador con lo que eligió la persona en el menú de compartir: si declara su tamaño y
  // pasa del tope, ni se lee. Después, cada campo y la foto se comprueban uno a uno.
  if (Number(request.headers.get('content-length')) > SHARE_MAX_BODY) throw new ShareProblem('size');
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new ShareProblem('read');
  }
  for (const name of ['title', 'text', 'url']) {
    const v = form.get(name);
    if (typeof v !== 'string' || v.trim() === '') continue;
    if (v.length > SHARE_MAX_TEXT) throw new ShareProblem('size');
    out.texts.push(v);
  }
  // Un campo de archivo vacío (sin nombre ni bytes) es «sin foto», no una foto vacía.
  const files = form.getAll('foto').filter((f) => typeof f !== 'string' && !(f.size === 0 && f.name === ''));
  if (files.length > SHARE_MAX_FILES) {
    out.error = 'size';
    return out;
  }
  const first = files[0];
  if (!first) return out;
  out.ignored = files.length - 1;
  try {
    if (first.size === 0) throw new ShareProblem('empty');
    if (first.size > SHARE_MAX_IMAGE) throw new ShareProblem('size');
    const sniffed = sniffImage(new Uint8Array(await first.slice(0, 16).arrayBuffer()));
    if (!sniffed) throw new ShareProblem('type');
    out.file = new Blob([first], { type: sniffed });
  } catch (e) {
    // Sin la foto, pero con los textos: un enlace de grupo que venga con ella sigue valiendo.
    out.error = e instanceof ShareProblem ? e.code : 'read';
  }
  return out;
}

/**
 * Recibe lo compartido, lo deja en una caché temporal (lo último sustituye a lo anterior; la página lo borra al
 * recogerlo y lo descarta si tiene más de 10 minutos) y vuelve a la app con un fragmento fijo, sin datos. Pase lo que
 * pase, responde aquí: lo compartido nunca va a la red (ni en el cuerpo ni en `?consulta`).
 */
async function receiveShare(request) {
  let parsed;
  try {
    parsed = await parseShare(request);
  } catch (e) {
    parsed = { texts: [], file: null, ignored: 0, error: e instanceof ShareProblem ? e.code : 'read' };
  }
  try {
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    if (parsed.file) await cache.put(SHARE_FILE, new Response(parsed.file, { headers: { 'content-type': parsed.file.type } }));
    const meta = { v: 1, at: Date.now(), texts: parsed.texts, file: !!parsed.file, ignored: parsed.ignored, error: parsed.error };
    await cache.put(SHARE_META, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
  } catch {
    /* sin espacio: la app avisará de que no ha llegado nada */
  }
  return Response.redirect(SHARE_DONE, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method === 'POST' && request.url === SHARE_ACTION) {
    // Solo la navegación que lanza el menú de compartir; cualquier otro POST aquí se corta sin salir a la red.
    event.respondWith(request.mode === 'navigate' ? receiveShare(request) : new Response(null, { status: 405 }));
    return;
  }
  if (request.method !== 'GET' || !inScope(request.url) || request.headers.has('range')) return;
  if (request.mode === 'navigate') event.respondWith(navigation(request));
  else if (request.url.startsWith(ASSETS_PREFIX)) event.respondWith(fromAssets(request));
  else event.respondWith(networkFirst(request));
});

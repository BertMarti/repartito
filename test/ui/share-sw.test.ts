// @vitest-environment node
/**
 * «Compartir con Repartito» en la web: el service worker de verdad (`public/sw.js`) con una Cache API falsa, y la
 * recogida de la página (`webShareSource` + `routeShare`) sobre lo que deja. Node 24 trae Request, Response, FormData
 * y Blob con el análisis de `multipart/form-data` real.
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeGroup, newGroup } from '../../src/core';
import { PHOTO_MAX_INPUT } from '../../src/ui/image';
import { routeShare, SHARE_CACHE, SHARE_MAX_IMAGE, SHARE_MAX_TEXT, SHARE_TTL_MS, shareUrls, webShareSource } from '../../src/ui/shareTarget';

const SCOPE = 'https://bertmarti.github.io/repartito/';
const ACTION = `${SCOPE}compartir`;
const SW = readFileSync('public/sw.js', 'utf8');

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0xff, 0xd9]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

type Entry = Map<string, Response>;
function fakeCaches() {
  const store = new Map<string, Entry>();
  const key = (u: RequestInfo | URL) => (typeof u === 'string' ? u : u instanceof URL ? u.href : u.url);
  const api = {
    store,
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return {
        put: async (u: RequestInfo | URL, r: Response) => void m.set(key(u), r),
        match: async (u: RequestInfo | URL) => m.get(key(u))?.clone(),
        delete: async (u: RequestInfo | URL) => m.delete(key(u)),
        keys: async () => [...m.keys()].map((k) => new Request(k)),
      } as unknown as Cache;
    },
    delete: async (name: string) => store.delete(name),
    keys: async () => [...store.keys()],
    has: async (name: string) => store.has(name),
  };
  return api;
}

let caches: ReturnType<typeof fakeCaches>;
let net: ReturnType<typeof vi.fn>;
let listeners: Record<string, (e: unknown) => void>;

beforeEach(() => {
  caches = fakeCaches();
  net = vi.fn(async () => new Response('red'));
  listeners = {};
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (t: string, fn: (e: unknown) => void) => void (listeners[t] = fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  // El mismo archivo que se publica, sin tocar; solo cambian las globales del service worker.
  const load = runInThisContext(`(function (self, caches, fetch) {\n${SW}\n})`) as (s: unknown, c: unknown, f: unknown) => void;
  load(self, caches, net);
});

/** Lo que haría el navegador al compartir: una navegación POST multipart al `action` del manifest. */
function sharePost(fields: Record<string, string | Blob | Blob[]>, { url = ACTION, mode = 'navigate', destination = 'document' } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x as string | Blob);
  const req = new Request(url, { method: 'POST', body: fd });
  Object.defineProperty(req, 'mode', { value: mode });
  Object.defineProperty(req, 'destination', { value: destination });
  return req;
}

async function dispatch(request: Request): Promise<Response | undefined> {
  let res: Promise<Response> | Response | undefined;
  listeners.fetch!({ request, respondWith: (r: Promise<Response> | Response) => (res = r) });
  return res && (await res);
}

const pickup = (now?: () => number) => webShareSource(caches, SCOPE, now).take();

describe('service worker: POST de compartir', () => {
  it('una foto: se guarda en la caché temporal y vuelve a la app con #compartido, sin nada en ?consulta', async () => {
    const res = await dispatch(sharePost({ foto: new File([JPEG], 'ticket.jpg', { type: 'image/jpeg' }), text: 'Súper del sábado' }));
    expect(res?.status).toBe(303);
    const loc = res!.headers.get('location')!;
    expect(loc).toBe(`${SCOPE}#compartido`);
    expect(new URL(loc).search).toBe('');
    expect(net).not.toHaveBeenCalled();
    const raw = await pickup();
    expect(raw).toMatchObject({ texts: ['Súper del sábado'], ignored: 0, error: null });
    expect(new Uint8Array(await raw!.file!.arrayBuffer())).toEqual(JPEG);
    // Recoger es borrar: no queda nada esperando.
    expect(caches.store.has(SHARE_CACHE)).toBe(false);
    expect(await pickup()).toBeNull();
    const routed = await routeShare(raw!);
    expect(routed).toMatchObject({ kind: 'expense', title: 'Súper del sábado' });
    expect(routed.kind === 'expense' && routed.file?.type).toBe('image/jpeg');
  });

  it('un enlace de grupo (como desde WhatsApp) llega por el cuerpo, nunca en la dirección', async () => {
    const payload = await encodeGroup(newGroup('Piso', ['Alex', 'Ana']));
    const link = `${SCOPE}#g=${payload}`;
    const res = await dispatch(sharePost({ text: `Únete al grupo: ${link}`, url: '' }));
    expect(res!.headers.get('location')).toBe(`${SCOPE}#compartido`);
    expect(res!.headers.get('location')).not.toContain(payload);
    expect(net).not.toHaveBeenCalled();
    expect(await routeShare((await pickup())!)).toEqual({ kind: 'link', payload });
  });

  it('el tipo se decide por el contenido: un SVG que dice ser PNG se rechaza (y el texto se conserva)', async () => {
    await dispatch(sharePost({ foto: new File([SVG], 'x.png', { type: 'image/png' }), title: 'Hola' }));
    const raw = await pickup();
    expect(raw).toMatchObject({ file: null, error: 'type', texts: ['Hola'] });
    expect(await routeShare(raw!)).toEqual({ kind: 'error', error: 'type' });
  });

  it('una foto vacía o demasiado grande se rechaza sin guardarla', async () => {
    await dispatch(sharePost({ foto: new File([], 'v.jpg', { type: 'image/jpeg' }) }));
    expect(await pickup()).toMatchObject({ file: null, error: 'empty' });
    const big = new Uint8Array(SHARE_MAX_IMAGE + 1);
    big.set(JPEG);
    await dispatch(sharePost({ foto: new File([big], 'g.jpg', { type: 'image/jpeg' }) }));
    expect(await pickup()).toMatchObject({ file: null, error: 'size' });
  });

  it('un campo de foto sin archivo (sin nombre ni bytes) es «sin foto», no un error', async () => {
    await dispatch(sharePost({ foto: new File([], ''), text: 'Cena' }));
    const raw = await pickup();
    expect(raw).toMatchObject({ file: null, error: null, texts: ['Cena'] });
    expect(await routeShare(raw!)).toEqual({ kind: 'expense', file: null, title: 'Cena' });
  });

  it('un texto que pasa del tope se rechaza', async () => {
    const huge = 'a'.repeat(SHARE_MAX_TEXT + 1);
    await dispatch(sharePost({ text: huge }));
    expect(await pickup()).toMatchObject({ texts: [], error: 'size' });
  });

  it('varias fotos: se adjunta la primera; demasiadas, ninguna', async () => {
    const f = () => new File([JPEG], 'a.jpg', { type: 'image/jpeg' });
    await dispatch(sharePost({ foto: [f(), f(), f()] }));
    expect(await pickup()).toMatchObject({ ignored: 2, error: null });
    await dispatch(sharePost({ foto: Array.from({ length: 21 }, f) }));
    expect(await pickup()).toMatchObject({ file: null, error: 'size' });
  });

  it('solo atiende la navegación al `action` exacto; nada sale a la red', async () => {
    const other = await dispatch(sharePost({ text: 'x' }, { mode: 'cors', destination: '' }));
    expect(other?.status).toBe(405);
    // Un formulario de otra web dentro de un iframe tampoco.
    expect((await dispatch(sharePost({ text: 'x' }, { destination: 'iframe' })))?.status).toBe(405);
    expect(caches.store.has(SHARE_CACHE)).toBe(false);
    // Otra ruta o con ?consulta: el service worker no la toca (como cualquier POST).
    expect(await dispatch(sharePost({ text: 'x' }, { url: `${ACTION}?a=1` }))).toBeUndefined();
    expect(await dispatch(sharePost({ text: 'x' }, { url: `${SCOPE}otra` }))).toBeUndefined();
    expect(net).not.toHaveBeenCalled();
  });

  it('un cuerpo que no es multipart no se interpreta', async () => {
    const req = new Request(ACTION, { method: 'POST', body: 'text=hola', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    Object.defineProperty(req, 'mode', { value: 'navigate' });
    Object.defineProperty(req, 'destination', { value: 'document' });
    expect((await dispatch(req))?.status).toBe(303);
    expect(await pickup()).toMatchObject({ texts: [], error: 'read' });
  });

  it('al activar una versión nueva no se borra lo compartido pendiente (sí las cachés viejas)', async () => {
    await caches.open('repartito-shell-viejo');
    await dispatch(sharePost({ text: 'Cena' }));
    let done: Promise<unknown> | undefined;
    listeners.activate!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(caches.store.has('repartito-shell-viejo')).toBe(false);
    expect(caches.store.has(SHARE_CACHE)).toBe(true);
  });
});

describe('recogida en la página (la Cache API es del origen compartido: se valida todo)', () => {
  const put = async (meta: unknown, file?: Blob) => {
    const c = await caches.open(SHARE_CACHE);
    const u = shareUrls(SCOPE);
    await c.put(u.meta, new Response(typeof meta === 'string' ? meta : JSON.stringify(meta)));
    if (file) await c.put(u.file, new Response(file));
  };
  const ok = { v: 1, at: Date.now(), texts: ['Cena'], file: false, ignored: 0, error: null };

  it('descarta lo caducado, lo de otra versión, lo mal formado y lo borra igualmente', async () => {
    for (const bad of [{ ...ok, at: Date.now() - SHARE_TTL_MS - 1 }, { ...ok, at: Date.now() + 3_600_000 }, { ...ok, v: 2 }, { ...ok, texts: 'Cena' }, { ...ok, texts: [1] }, { ...ok, texts: ['a', 'b', 'c', 'd'] }, '{', '[]']) {
      await put(bad);
      expect(await pickup()).toBeNull();
      expect(caches.store.has(SHARE_CACHE)).toBe(false);
    }
  });

  it('un error desconocido se trata como «no se pudo leer»; `ignored` raro, como 0', async () => {
    await put({ ...ok, error: '<img>', ignored: -5 });
    expect(await pickup()).toMatchObject({ error: 'read', ignored: 0 });
  });

  it('la foto solo cuenta si los datos dicen que la hay', async () => {
    await put(ok, new Blob([JPEG]));
    expect((await pickup())!.file).toBeNull();
  });

  it('`discard` borra cualquier resto sin leerlo', async () => {
    await put(ok);
    await webShareSource(caches, SCOPE).discard();
    expect(caches.store.has(SHARE_CACHE)).toBe(false);
  });
});

describe('mismos valores en el service worker, la página y el manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { scope: string; share_target: Record<string, unknown> & { params: { files: { name: string; accept: string[] }[] } } };

  it('share_target: POST multipart (nunca GET: un enlace iría en ?consulta) dentro del ámbito', () => {
    const st = manifest.share_target;
    expect(st.method).toBe('POST');
    expect(st.enctype).toBe('multipart/form-data');
    expect(new URL(st.action as string, `https://bertmarti.github.io${manifest.scope}manifest.webmanifest`).href).toBe(ACTION);
    expect(st.params.files.map((f) => f.name)).toEqual(['foto']);
    expect(st.params.files[0]!.accept).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
  });

  it('topes y nombres de caché', () => {
    expect(SHARE_MAX_IMAGE).toBe(PHOTO_MAX_INPUT);
    expect(SW).toContain(`const SHARE_CACHE = '${SHARE_CACHE}';`);
    expect(SW).toContain('const SHARE_MAX_IMAGE = 40 * 1024 * 1024;');
    expect(SW).toContain('const SHARE_MAX_TEXT = 1_500_000 + 16_384;');
    expect(SHARE_MAX_TEXT).toBe(1_500_000 + 16_384);
    expect(SW).toContain("new URL('compartir/datos', SCOPE)");
    expect(SW).toContain("new URL('compartir/foto', SCOPE)");
    expect(shareUrls(SCOPE)).toEqual({ meta: `${SCOPE}compartir/datos`, file: `${SCOPE}compartir/foto` });
  });

  it('el resto de peticiones siguen igual: un GET de otra ruta del origen no se toca', async () => {
    const req = new Request('https://bertmarti.github.io/otra-web/');
    expect(await dispatch(req)).toBeUndefined();
  });
});

/**
 * «Compartir con Repartito»: qué se hace con lo recibido (enlace, foto, texto, URL ajena) y cómo lo recoge la app.
 * El service worker y la Cache API se prueban en share-sw.test.ts.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import App from '../../src/App';
import { encodeGroup, loadGroups, newGroup, saveGroups } from '../../src/core';
import { memoryPhotoStore, setPhotoStore } from '../../src/ui/photos';
import {
  base64Bytes,
  findPayload,
  fromNative,
  routeShare,
  setShareSource,
  SHARE_MAX_IMAGE_NATIVE,
  sniffImage,
  titleFrom,
  type RawShare,
  type ShareSource,
} from '../../src/ui/shareTarget';

const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
vi.mock('../../src/ui/image', () => ({ compressPhoto: vi.fn(async () => FOTO) }));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0xff, 0xd9]);
const raw = (p: Partial<RawShare>): RawShare => ({ texts: [], file: null, ignored: 0, error: null, ...p });
const enc = (s: string) => new TextEncoder().encode(s);

describe('sniffImage: el tipo por los primeros bytes', () => {
  it('reconoce JPEG, PNG, GIF, WebP y AVIF', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(enc('GIF89a....'))).toBe('image/gif');
    expect(sniffImage(enc('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(enc('\0\0\0\x1cftypavif'))).toBe('image/avif');
  });

  it('rechaza SVG, HTML, HEIC, PDF y lo vacío', () => {
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<!doctype html>', '\0\0\0\x18ftypheic', '%PDF-1.7', '']) expect(sniffImage(enc(s))).toBeNull();
  });
});

describe('routeShare: enlace, foto o concepto', () => {
  it('un enlace de grupo dentro de un mensaje va a la vista previa (gana a la foto y al texto)', async () => {
    const payload = await encodeGroup(newGroup('Piso', ['Alex', 'Ana']));
    expect(findPayload(`Únete: https://bertmarti.github.io/repartito/#g=${payload} ¡gracias!`)).toBe(payload);
    expect(await routeShare(raw({ texts: ['Piso', `https://bertmarti.github.io/repartito/#g=${payload}`], file: new Blob([JPEG]) }))).toEqual({ kind: 'link', payload });
    // También si la foto vino mal: el enlace sigue valiendo.
    expect(await routeShare(raw({ texts: [`#g=${payload}`], error: 'type' }))).toEqual({ kind: 'link', payload });
  });

  it('un #g= que no es de Repartito no es un enlace', () => {
    expect(findPayload('https://ejemplo.test/#g=hola')).toBeNull();
    expect(findPayload('nada')).toBeNull();
  });

  it('una foto abre un gasto con el tipo detectado (no el declarado)', async () => {
    const r = await routeShare(raw({ file: new Blob([JPEG], { type: 'image/svg+xml' }) }));
    expect(r.kind).toBe('expense');
    expect(r.kind === 'expense' && r.file?.type).toBe('image/jpeg');
    expect(r.kind === 'expense' && r.title).toBe('');
  });

  it('rechaza fotos que no son imagen, vacías o demasiado grandes', async () => {
    expect(await routeShare(raw({ file: new Blob(['<svg/>'], { type: 'image/png' }) }))).toEqual({ kind: 'error', error: 'type' });
    expect(await routeShare(raw({ file: new Blob([]) }))).toEqual({ kind: 'error', error: 'empty' });
    expect(await routeShare(raw({ file: new Blob([JPEG, new Uint8Array(100)]) }), 50)).toEqual({ kind: 'error', error: 'size' });
  });

  it('un texto sin enlace es el concepto: sin direcciones, sin controles, en una línea y a 120 caracteres', async () => {
    expect(titleFrom('  Cena‮ del\nviernes  https://tienda.example/x?y=1 ')).toBe('Cena del viernes');
    expect(titleFrom('x'.repeat(500))).toHaveLength(120);
    expect(await routeShare(raw({ texts: ['Bombona'] }))).toEqual({ kind: 'expense', file: null, title: 'Bombona' });
  });

  it('una URL ajena no se abre nunca: se explica que no es de Repartito', async () => {
    for (const u of ['https://example.com/', 'javascript:alert(1)', 'intent://scan#Intent;end', 'data:text/html,<b>x</b>']) {
      expect(await routeShare(raw({ texts: [u] }))).toEqual({ kind: 'error', error: 'foreign' });
    }
    expect(await routeShare(raw({ texts: ['   '] }))).toEqual({ kind: 'error', error: 'empty' });
  });

  it('textos de más o demasiado largos se rechazan', async () => {
    expect(await routeShare(raw({ texts: ['a', 'b', 'c', 'd'] }))).toEqual({ kind: 'error', error: 'size' });
    expect(await routeShare(raw({ texts: ['a'.repeat(2_000_000)] }))).toEqual({ kind: 'error', error: 'size' });
  });
});

describe('lo que llega del plugin de Android (dato de fuera: se comprueba)', () => {
  it('base64 bien formado y acotado', () => {
    expect(base64Bytes(btoa('hola'), 10)).toEqual(enc('hola'));
    expect(base64Bytes('no es base64!', 100)).toBeNull();
    expect(base64Bytes('abc', 100)).toBeNull();
    expect(base64Bytes(btoa('x'.repeat(30)), 10)).toBeNull();
  });

  it('imagen y textos; vacío es nada; error desconocido = no se pudo leer', async () => {
    const r = fromNative({ text: 'Cena', image: btoa(String.fromCharCode(...JPEG)), mime: 'image/jpeg' })!;
    expect(r.texts).toEqual(['Cena']);
    expect(new Uint8Array(await r.file!.arrayBuffer())).toEqual(JPEG);
    expect(fromNative({})).toBeNull();
    expect(fromNative(null)).toBeNull();
    expect(fromNative({ error: '<script>' })).toMatchObject({ error: 'read' });
    expect(fromNative({ image: '***' })).toMatchObject({ file: null, error: 'read' });
    expect(fromNative({ image: 'A'.repeat(Math.ceil(SHARE_MAX_IMAGE_NATIVE / 3) * 4 + 4) })).toMatchObject({ error: 'read' });
  });
});

/* ---------- En la app ---------- */

let fetchMock: Mock;
let photos: ReturnType<typeof memoryPhotoStore>;

function memorySource(item: RawShare | null): ShareSource & { taken: number; discarded: number } {
  let pending = item;
  const s = {
    taken: 0,
    discarded: 0,
    take: async () => {
      s.taken++;
      const p = pending;
      pending = null;
      return p;
    },
    discard: async () => {
      s.discarded++;
      pending = null;
    },
  };
  return s;
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/repartito/');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  photos = memoryPhotoStore();
  setPhotoStore(photos);
});

afterEach(() => {
  cleanup();
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  setPhotoStore(null);
  setShareSource(undefined);
});

/** Abre la app como lo hace el service worker al terminar: `/repartito/#compartido`. */
function openShared(item: RawShare | null, flag = true) {
  const src = memorySource(item);
  setShareSource(src);
  history.replaceState(null, '', flag ? '/repartito/#compartido' : '/repartito/');
  render(<App />);
  return src;
}

const piso = () => newGroup('Piso', ['Alex', 'Ana']);
const viaje = () => newGroup('Viaje', ['Alex', 'Leo'], 'EUR', '✈️');

describe('la app recoge lo compartido', () => {
  it('una foto con un solo grupo: «Nuevo gasto» con la foto, que solo se guarda (en IndexedDB) al añadirlo', async () => {
    const g = piso();
    saveGroups([g]);
    openShared(raw({ file: new Blob([JPEG], { type: 'image/jpeg' }), texts: ['Súper'] }));
    // El fragmento se borra al momento y nada va en ?consulta.
    expect(location.hash).toBe('');
    expect(location.search).toBe('');
    const exp = await screen.findByRole('dialog', { name: 'Nuevo gasto' });
    expect(await within(exp).findByRole('button', { name: 'Ver la foto del ticket en grande' })).toBeTruthy();
    expect((within(exp).getByLabelText('Concepto') as HTMLInputElement).value).toBe('Súper');
    expect(photos.records.size).toBe(0);
    fireEvent.change(within(exp).getByLabelText('Importe'), { target: { value: '12,40' } });
    fireEvent.click(within(exp).getByRole('button', { name: 'Añadir gasto' }));
    await waitFor(() => expect(photos.records.size).toBe(1));
    const saved = loadGroups().groups[0]!.expenses.find((e) => e.title === 'Súper')!;
    expect([...photos.records.values()][0]).toMatchObject({ id: saved.id, groupId: g.id, data: FOTO });
    // La foto nunca entra en el grupo (ni en los enlaces ni en las copias).
    expect(localStorage.getItem('repartito:v1:grupos')).not.toContain('base64');
    expect(location.search).toBe('');
  });

  it('cerrar sin añadir no guarda la foto', async () => {
    saveGroups([piso()]);
    openShared(raw({ file: new Blob([JPEG]) }));
    const exp = await screen.findByRole('dialog', { name: 'Nuevo gasto' });
    await within(exp).findByRole('button', { name: 'Ver la foto del ticket en grande' });
    fireEvent.click(within(exp).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(photos.records.size).toBe(0);
  });

  it('con varios grupos pregunta en cuál, con el último abierto primero', async () => {
    const a = piso();
    const b = viaje();
    saveGroups([a, b]);
    localStorage.setItem('repartito:v1:ajustes', JSON.stringify({ lang: 'es', theme: 'auto', me: {}, lastGroup: b.id }));
    openShared(raw({ texts: ['Taxi al aeropuerto'] }));
    const pick = await screen.findByRole('dialog', { name: '¿En qué grupo lo apuntas?' });
    const options = within(pick).getAllByRole('button').filter((x) => /Piso|Viaje/.test(x.textContent ?? ''));
    expect(options.map((x) => x.textContent)).toEqual([expect.stringContaining('Viaje'), expect.stringContaining('Piso')]);
    fireEvent.click(options[1]!);
    const exp = await screen.findByRole('dialog', { name: 'Nuevo gasto' });
    expect((within(exp).getByLabelText('Concepto') as HTMLInputElement).value).toBe('Taxi al aeropuerto');
    expect(screen.queryByRole('dialog', { name: '¿En qué grupo lo apuntas?' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /Piso/ })).toBeTruthy();
  });

  it('un enlace de grupo abre la misma vista previa que abrir el enlace, y se fusiona al confirmar', async () => {
    const g = piso();
    const payload = await encodeGroup(g);
    openShared(raw({ texts: [`Mira: https://bertmarti.github.io/repartito/#g=${payload}`] }));
    const sheet = await screen.findByRole('dialog', { name: 'Grupo recibido' });
    expect(await within(sheet).findByText('Piso')).toBeTruthy();
    expect(loadGroups().groups).toHaveLength(0);
    fireEvent.click(await within(sheet).findByRole('button', { name: /Añadir|Fusionar/ }));
    await waitFor(() => expect(loadGroups().groups.map((x) => x.id)).toEqual([g.id]));
    expect(location.search).toBe('');
    expect(location.href).not.toContain(payload);
  });

  it('sin grupos, avisa; una URL ajena, también, sin abrirla', async () => {
    openShared(raw({ texts: ['Cena'] }));
    expect(await screen.findByText(/Crea primero un grupo/)).toBeTruthy();
    cleanup();
    saveGroups([piso()]);
    openShared(raw({ texts: ['https://example.com/promo'] }));
    expect(await screen.findByText(/no es de un grupo de Repartito/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(location.href).toBe('http://localhost:3000/repartito/');
  });

  it('errores del service worker: tamaño y formato, con un aviso claro', async () => {
    saveGroups([piso()]);
    openShared(raw({ error: 'size' }));
    expect(await screen.findByText('Es demasiado grande para Repartito (fotos de hasta 40 MB).')).toBeTruthy();
    cleanup();
    openShared(raw({ error: 'type' }));
    expect(await screen.findByText(/Ese formato de imagen no se puede abrir/)).toBeTruthy();
  });

  it('#compartido sin nada esperando: avisa de que no ha llegado', async () => {
    openShared(null);
    expect(await screen.findByText(/No ha llegado lo que has compartido/)).toBeTruthy();
  });

  it('sin #compartido no se lee nada: cualquier resto se borra sin mirarlo', async () => {
    saveGroups([piso()]);
    const src = openShared(raw({ texts: ['Cena'] }), false);
    await act(async () => undefined);
    expect(src.taken).toBe(0);
    expect(src.discarded).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('varias fotos: avisa de que solo va la primera', async () => {
    saveGroups([piso()]);
    openShared(raw({ file: new Blob([JPEG]), ignored: 2 }));
    expect(await screen.findByText('Solo se adjunta la primera foto: una por gasto.')).toBeTruthy();
    expect(await screen.findByRole('dialog', { name: 'Nuevo gasto' })).toBeTruthy();
  });
});

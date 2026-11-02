/**
 * Sustituto de los plugins de Capacitor en el build web (ver `resolve.alias` en vite.config.ts): la web nunca
 * los usa (`NATIVE` es `false`), y así no viajan en el paquete publicado.
 */
const unavailable = (): never => {
  throw new Error('Solo en la app de Android');
};
export const Share = { share: unavailable };
export const Filesystem = { writeFile: unavailable };
export const Directory = { Cache: 'CACHE' };
export const Encoding = { UTF8: 'utf8' };
export const registerPlugin = unavailable;

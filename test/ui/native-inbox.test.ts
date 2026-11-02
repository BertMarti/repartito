import { describe, expect, it, vi } from 'vitest';

// Como el proxy de Capacitor: responde a cualquier propiedad con un método nativo (también a `then`).
vi.mock('@capacitor/core', () => ({
  registerPlugin: () =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === 'take'
            ? () => Promise.resolve({ text: 'hola' })
            : () => new Promise(() => undefined), // un método que no existe en Java nunca contesta
      },
    ),
}));

describe('shareInbox (regresión del emulador)', () => {
  it('entrega el plugin aunque su proxy parezca una promesa', async () => {
    const { shareInbox } = await import('../../src/ui/native');
    const listo = await Promise.race([shareInbox(), new Promise((r) => setTimeout(() => r('colgado'), 200))]);
    expect(listo).not.toBe('colgado');
    const { plugin } = listo as Awaited<ReturnType<typeof shareInbox>>;
    await expect(plugin.take()).resolves.toEqual({ text: 'hola' });
  });
});

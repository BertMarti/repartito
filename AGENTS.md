# AGENTS.md · Repartito

Instrucciones para agentes de IA (Claude Code, OpenCode, Codex…) y personas que contribuyan.

## Qué es

PWA gratuita para **repartir gastos** de piso, pareja o viaje: sin cuenta, sin anuncios, sin límites y sin
conexión. Los datos viven en el navegador. Se colabora enviando un **enlace** que se fusiona con la copia
de cada persona (ver [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md)). Publicada en GitHub Pages:
<https://bertmarti.github.io/repartito/>.

## Tecnología

- **TypeScript estricto + React 19 + Vite 8**. CSS propio, sin librerías de UI ni de gráficas.
- Fuentes con `@fontsource` (Fraunces, Manrope): nunca CDN.
- Cifrado y compresión con la plataforma: Web Crypto y `CompressionStream`.
- **Vitest** (happy-dom) y **ESLint 10** con reglas anti-XSS.
- **Node 24**. Si tu Node local es anterior, antepón `./dk.sh` (ejecuta en un contenedor Node 24).
- **Android**: Capacitor 8 (plugins oficiales Share y Filesystem, y uno propio, `ShareInbox`, para recibir lo que se
  comparte con la app), JDK 21, compileSdk 36. Ver [docs/ANDROID.md](docs/ANDROID.md).

## Comandos

| Acción | Comando |
|---|---|
| Instalar | `npm ci` (`.npmrc` impide scripts de instalación) |
| Desarrollo | `npm run dev` |
| Todo el control de calidad | `npm run check` (lint + tipos + tests) |
| Build | `npm run build` (sale en `dist/`, base `/repartito/`) |
| App de Android | `npm run build:android`, luego `cd android && ./gradlew assembleDebug` |

## Estructura

- `src/core/`: **dominio puro y probado**. Es la fuente de verdad del dinero, los repartos, la fusión y la
  validación. Cada cambio aquí lleva tests en `test/core.test.ts`.
- `src/ui/`, `src/i18n/`, `src/styles/`: interfaz.
- `public/`: manifest, iconos y `sw.js` (service worker escrito a mano).
- `android/`: proyecto nativo (manifiesto, iconos, firma por variables de entorno). `src/ui/native.ts` concentra lo que cambia en la app.
- `docs/`: sincronización, arquitectura, app de Android y modelo de amenazas.

## Reglas (bloqueantes en revisión)

1. **Dinero en céntimos enteros** en todas partes. Nunca `0.1 + 0.2`.
2. Todo dato que entra de fuera (enlace, archivo, CSV, `localStorage`) pasa por `parseGroup`,
   `decodeGroup`, `readBackup` o `importSplitwise`. Nunca se usa un objeto de fuera sin validar.
3. **Nunca** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`, `eval` ni
   `new Function` (ESLint y el CI lo bloquean; la CSP exige Trusted Types).
4. **Ninguna petición a terceros**: ni analítica, ni CDN, ni fuentes externas. La CSP es `'self'`.
5. Los datos de un grupo **nunca** van en la ruta ni en `?consulta`: solo en el fragmento `#g=`, que la app
   borra de la barra nada más leerlo.
6. Borrar es una lápida (`deleted: true` + `updatedAt`); los ids son UUID; cualquier cambio de modelo
   mantiene la fusión **conmutativa, asociativa e idempotente** (tests).
7. Toda celda de texto exportada a CSV pasa por la protección anti-fórmulas.
8. Las actions de GitHub se fijan por SHA; los workflows piden el mínimo de permisos.
9. Cada dependencia nueva se justifica en el PR.
10. Cada regla de seguridad nueva llega con un test que falla si se quita.
11. La app de Android **no pide permisos** del sistema (el CI lo comprueba) ni guarda copias en la nube. Un plugin
    nuevo de Capacitor se justifica en el PR y en el modelo de amenazas.
12. Nunca subir claves de firma (`*.jks`, `*.p12`, `*.keystore`): la firma vive en el entorno `android-release`.

## Diseño: «dos mitades»

Cálido, alegre y claro; lo contrario de una app de banco. El motivo es un círculo partido en diagonal en
dos colores. Fraunces para titulares e importes, Manrope para la interfaz.
- **Papel** `#FBF7F0`, **tinta** `#1D1A16`, **tomate** `#FF5A3C` (debes), **menta** `#17B897` (te deben).
- Tema oscuro igual de cuidado y `prefers-reduced-motion` respetado.
- Pensado para el móvil: barra inferior, botón «+ Gasto», objetivos táctiles de 44 px y sin desbordes a 320 px.

## Roles de agentes

| Rol | Qué hace | Definición |
|---|---|---|
| **lead** | Planifica (PLAN.md), divide en issues, revisa y mantiene MEMORY.md. | — |
| **builder** | Implementa un issue en su rama, con tests. | — |
| **security-auditor** | Revisa cada PR contra estas reglas y el modelo de amenazas. Solo lectura. | `.claude/agents/`, `.opencode/agent/` |
| **docs** | README para usuarios (sin tecnicismos), `docs/` y CHANGELOG. | `.opencode/agent/docs.md` |

Skills de Claude Code: `/security-check` y `/release`.

## Flujo

1. Un issue por tarea; rama `agent/<rol>/<nº>-<tema>`.
2. `npm run check` y `npm run build` en verde.
3. PR con qué cambia, cómo se probó (incluido el móvil) e impacto en seguridad.
4. `security-auditor` revisa; el lead fusiona; MEMORY.md y CHANGELOG al día.
5. Nunca subir datos reales de gastos, nombres de personas reales, capturas con datos reales ni secretos.

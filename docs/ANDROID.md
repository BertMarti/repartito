# App de Android

> Documento técnico. Para instalarla, ver el [README](../README.md#-instálala-en-el-móvil).

La app de Android es **la misma web** empaquetada con [Capacitor](https://capacitorjs.com/) 8: el código de
`src/` se compila con `vite build --mode android` (base `/`, sin service worker) y se copia dentro del APK.
No hay una segunda base de código.

## Qué cambia respecto a la web

| | Web (GitHub Pages) | App de Android |
|---|---|---|
| Origen | `https://bertmarti.github.io`, compartido con otras webs del autor (I6, I7) | `https://localhost` **propio de la app**: nadie más lee su almacenamiento |
| Sin conexión | Service worker con huellas SHA-256 | Los archivos van dentro del APK |
| Permisos | Los del navegador | **Ninguno** (ni siquiera Internet) |
| Compartir enlaces | `navigator.share` si existe | Menú del sistema (plugin Share) |
| Copias y CSV | Descarga | Se escriben en la caché privada y se ofrecen con el menú del sistema (Filesystem + Share) |
| Enlaces que se comparten | Dirección de la web | Siempre la web pública (`PUBLIC_URL`), nunca `localhost` |
| Copia en la nube de Google | — | **Desactivada** (`allowBackup=false` y reglas de extracción vacías): los gastos no salen del móvil |
| Recibir del menú de compartir | `share_target` del manifest (POST al service worker) | `ACTION_SEND` (`image/*`, `text/plain`) → plugin propio `ShareInbox` |

Fotos de tickets (v0.3.0): `<input type="file" accept="image/*">` **sin** `capture`. Así Capacitor abre el selector
del sistema (que ya ofrece la cámara por su cuenta) y la app no necesita el permiso `CAMERA`. Las fotos se guardan
en el IndexedDB del WebView, dentro de los datos privados de la app, excluidos de la copia en la nube.

**Compartir con Repartito** (Share Target): el manifiesto declara dos `intent-filter` de `ACTION_SEND` (una imagen
o `text/plain`) en `MainActivity`. Los recibe un plugin de Capacitor **propio y dentro del repo**,
`android/app/src/main/java/io/github/bertmarti/repartito/ShareInboxPlugin.java` (unas 150 líneas, sin
dependencias), registrado en `MainActivity.onCreate`. Se descartaron los plugins de terceros para esto: hacen
más de lo necesario (varios archivos, copias en disco, rutas de archivo hacia JS) y serían una dependencia nativa
más que auditar.

- Lee la imagen con el permiso temporal que concede el propio intent sobre esa URI: **ningún `uses-permission`**.
- Solo `content://` de otras apps: rechaza `file://`, las URIs con usuario (`content://0@…`) y cualquier autoridad
  que resuelva a un proveedor de la propia app (como su `FileProvider`, con las copias de seguridad).
- El tipo se decide por los primeros bytes (JPEG, PNG, WebP, GIF, AVIF), no por el que declara la otra app (hay
  galerías que dicen `image/jpg` u `application/octet-stream`). Como mucho **15 MB**: la foto cruza el puente en
  base64 (+33 %) y en JSON, y con 20 MB un móvil con poca memoria podía quedarse sin heap (si pasa, se avisa en vez de
  cerrar la app). Una foto de móvil suele pesar 2-8 MB.
- Los textos, hasta 1,5 MB, aunque en la práctica un `ACTION_SEND` no pasa de ~1 MB (límite de Binder): un enlace de
  grupo enorme falla ya en la app que lo envía. Ese caso se abre pegando el enlace en **Abrir enlace o archivo**.
- Lo leído se queda **en memoria** hasta que la web llama a `take()` una vez (al arrancar y cuando el plugin avisa
  con el evento `shared`). JS no puede pedir ninguna URI: no es un lector de archivos. Nada va a logcat.
- Al volver desde «Recientes», Android repite el intent original con `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`, y al
  recrear la actividad tras cerrar el proceso, `getIntent()` vuelve a ser el `ACTION_SEND`: los dos casos se ignoran
  para no abrir dos veces lo mismo (`MainActivity`).
- El aviso `shared` va retenido (`retainUntilConsumed`): si llega mientras la web arranca, lo recibe al suscribirse.
- La web lo valida como cualquier dato de fuera (`fromNative`, `routeShare` en `src/ui/shareTarget.ts`) y la foto
  se recomprime con `compressPhoto` antes de guardarse en IndexedDB.

Barras del sistema: `SystemBars.insetsHandling = native`. El CSS ya usa `env(safe-area-inset-*)` y el modo
por defecto (`css`) inyectaba variables que no se usan, a veces antes de que existiera el documento (error de
consola que detectó la prueba en emulador).

Todo lo específico está en `src/ui/native.ts`, detrás de la constante de compilación `NATIVE`. En el build web,
los plugins de Capacitor se cambian por `src/ui/native-stub.ts` (0,17 kB): la web no lleva Capacitor.

## Compilar

Hace falta Node 24, JDK 21 y el SDK de Android (compileSdk 36).

```bash
npm ci
npm run build:android            # tipos + build web en modo android + cap sync
cd android && ./gradlew assembleDebug
```

El APK de depuración queda en `android/app/build/outputs/apk/debug/`. Iconos y pantallas de arranque:
`python3 scripts/brand/android-icons.py`.

## CI (`.github/workflows/android.yml`)

1. **Compilar**: build web en modo android, validación del wrapper de Gradle (`distributionSha256Sum` fijado),
   APK de depuración y comprobación de que **no pide ningún permiso** `android.permission.*`.
2. **Emulador** (API 35): instala el APK y `scripts/android-e2e.mjs` se conecta a su WebView por DevTools.
   Comprueba el origen propio, la CSP con Trusted Types, que no hay service worker, el grupo de ejemplo, los
   saldos y que el enlace compartido apunta a la web pública. Después envía `ACTION_SEND` con `adb shell am start`
   como lo haría WhatsApp: un enlace de grupo abre la vista previa, un texto abre «Nuevo gasto» con ese concepto, una
   URL ajena no se abre y una imagen que apunta al `FileProvider` de la propia app (`content://0@…`) se rechaza. Falla ante cualquier error de consola, excepción
   o violación de CSP. Las capturas quedan como artefacto.
3. **Firmar y publicar** (solo etiquetas `v*`): ver abajo.

## Firma

- La clave (RSA 4096, PKCS#12) se generó una vez y **no está en el repositorio** (`.gitignore` bloquea
  `*.jks`, `*.p12`, `*.keystore`). Hay una copia fuera del repo, en el equipo del autor.
- En GitHub vive en el **entorno `android-release`**, que solo admite etiquetas `v*`: ni ramas ni PR pueden
  leer los secretos.
- El CI verifica que el APK lleva el certificado esperado (`CERT_SHA256` en el workflow) y que **no es
  depurable** (en las compilaciones publicadas la depuración del WebView queda apagada).
- Perder la clave significa que la app instalada no se podría actualizar: habría que desinstalar y volver a
  instalar con una clave nueva (los datos se recuperan con la copia de seguridad).

## Comprobar un APK descargado

```bash
sha256sum -c SHA256SUMS.txt
gh attestation verify repartito-v0.2.0.apk -R BertMarti/repartito
apksigner verify --print-certs repartito-v0.2.0.apk
```

El certificado tiene que tener la huella SHA-256
`5a:5b:27:42:59:e6:d3:0b:ed:71:7d:24:c0:18:e7:10:73:bc:8d:23:90:2d:db:ad:9d:80:ea:4f:4e:65:bb:be`.

## Pendiente

- **Abrir los enlaces `#g=` directamente en la app** (App Links): necesita `/.well-known/assetlinks.json` en la
  raíz de `bertmarti.github.io`. Mientras tanto, el enlace se abre en el navegador o se pega en la app con
  **Abrir enlace o archivo**.
- **Google Play**: el AAB de cada release está listo; publicarlo requiere una cuenta de desarrollador.
- **iOS**: requiere un Mac y una cuenta de Apple Developer.

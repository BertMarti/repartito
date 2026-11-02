# MEMORY.md · Repartito
Última actualización: 2026-11-02 por builder (rama `feat/compartir-con`)

Memoria compartida entre agentes: estado, decisiones y trampas. Lo estable está en [AGENTS.md](AGENTS.md);
la hoja de ruta, en [PLAN.md](PLAN.md).

## Estado

- v0.1.0 completa: 82 tests (69 de dominio, 13 de interfaz), lint y tipos limpios, `npm audit` sin avisos.
- Probada a mano en el navegador a 320 y 375 px, tema oscuro, inglés, sin conexión, enlaces con y sin contraseña y fusión.
- Auditoría independiente (Fable): 1 alto, 5 medios y varios bajos; todo corregido con tests `F1`…`F15` (ver MODELO_DE_AMENAZAS).

## Decisiones (y por qué)

- **Elección del producto**: búsqueda de necesidades (oct. 2026). Splitwise limita su plan gratis a 3-4 gastos al día, con esperas y anuncios. En España no aparece ninguna alternativa gratis, sin anuncios y sin registro. Lo más pedido en apps de productividad es un modo sin conexión que funcione de verdad.
- **Sin servidor**: GitHub Pages es gratis para siempre y no hay datos de nadie que proteger en un servidor. La colaboración va por enlace más fusión.
- **Fusión LWW + lápidas** (último que escribe gana, con borrados marcados): es suficiente para gastos (pocas ediciones concurrentes del mismo gasto) y es fácil de demostrar conmutativa, asociativa e idempotente.
- **Ids deterministas en gastos fijos** (`<id>~AAAA-MM`) con el `updatedAt` del fijo: no se duplican entre móviles, gana la versión más reciente del fijo y cualquier edición manual gana a ambas. Solo valen si el fijo existe y el mes no pasa de +2.
- **Ediciones monótonas**: `updatedAt = max(ahora, anterior + 1)`. Enlaces con ediciones a más de 24 h vista se rechazan (`incomingProblem`).
- **Nada se guarda sin `revalidate`**: fusiones, importaciones, gastos fijos y ediciones pasan otra vez `parseGroup`; si no, el grupo «desaparecería» al reabrir.
- **Service worker con huellas**: el plugin `swIntegrity` (vite.config.ts) inyecta el SHA-256 de cada archivo de `dist/` y la versión en `sw.js`. Mismo origen que otras webs del autor → la Cache API es compartida.
- **Contraseña generada**: 4×4 símbolos de un alfabeto de 31 sin ambigüedades (≈ 79 bits), con muestreo por rechazo.
- **Importar Splitwise**: su CSV trae el efecto neto por persona. Un pagador → gasto con reparto exacto. Varios pagadores o «Payment» → pares deudor→acreedor. Los saldos quedan idénticos (test).
- **`parseAmount`**: el último separador es decimal solo si le siguen 1-2 cifras; con 3 es de miles («1.234» = 1234). Rechaza separadores seguidos.
- **Validación**: los ids deben ser UUID, lo que bloquea por diseño claves como `__proto__`; el emoji solo admite emojis; topes de 50 personas, 20 000 gastos, 120 caracteres por texto y 1e9 céntimos.
- **Enlaces**: `#g=1.` sin contraseña o `#g=1e.` con ella (PBKDF2 600 000 + AES-GCM con AAD). Tope de 1,5 MB de texto y de 8 MB al descomprimir.
- **App de Android con Capacitor 8** (v0.2.0): misma base de código; `NATIVE` es constante de compilación (`--mode android`) y en la web los plugins se cambian por `native-stub.ts`. Origen propio `https://localhost` (resuelve I6/I7 en la app), sin permisos, `allowBackup=false`, `loggingBehavior: none`. Los enlaces siempre usan `PUBLIC_URL`.
- **Firma**: PKCS#12 RSA 4096, alias `repartito`, huella SHA-256 fijada en `android.yml` (`CERT_SHA256`) (fijada en `android.yml`). Secretos en el entorno `android-release` (solo etiquetas `v*`). Copia de la clave fuera del repo, en el equipo del autor: sin ella no se puede actualizar la app instalada.
- **Versión de Android** = `package.json` (`x.y.z` → versionCode `x*10000+y*100+z`).
- **Prueba de la app**: emulador API 35 en el CI y `scripts/android-e2e.mjs` por DevTools (solo los APK de depuración permiten inspeccionar el WebView).
- **Coordinación**: el repo de perfil `BertMarti` (README y `site/`) lo gestiona la sesión «Revisión de repositorios GitHub». A ella se le pasan las capturas `.webp` de 640×400 y los textos, sin dominios reales, IPs ni emails.

- **Plantillas en el modelo del grupo** (v0.3.0), no solo locales: son del piso («la bombona la paga siempre Leo»)
  y lo útil es que todos las tengan. Siguen las reglas de la fusión (UUID, `updatedAt`, lápidas, `revalidate`) y
  hay tests de las propiedades con ediciones al azar. Las versiones anteriores descartan el campo y la unión lo
  recupera: no hizo falta subir `v`. Guardar con el mismo nombre (sin tildes ni mayúsculas) actualiza.
- **Fotos solo en el dispositivo, en IndexedDB** (`repartito-fotos`, clave = id del gasto, índice por grupo), sin
  tocar el modelo (ni `hasPhoto`). Se guardan como `data:image/jpeg` (+33 % por el base64, a cambio de no tocar la
  CSP ni convertir al pintar). Sin dependencias nuevas: el envoltorio de IndexedDB está detrás de la interfaz
  `PhotoStore` y los tests usan `memoryPhotoStore` (por eso no hace falta `fake-indexeddb`).
- **Varias monedas** (v0.4.0): `original?: { currency, amount, rate, inverse? }` en gastos y gastos fijos (no en
  plantillas). `rate` = lo que se escribió en millonésimas y en su dirección (sin `inverse`: 1 [grupo] = x [otra],
  como cotizan los bancos; con `inverse`: 1 [otra] = x [grupo]). Se descartó «unidades mínimas del grupo por 10⁶ de la
  otra» porque pierde cifras con monedas débiles (COP, ARS) y no devuelve exacto lo escrito al invertirlo. `amount` se
  calcula una vez con BigInt (mitades hacia arriba) y `parseGroup` lo recalcula y exige igualdad exacta.
- **Importes exactos en la moneda del grupo** aunque el gasto sea en otra: es lo que suma `amount`; lo contrario
  obligaría a repartir céntimos de redondeo al convertir cada parte.
- **Desempate de la fusión**: misma `updatedAt` → gana la versión con `original`, luego JSON. Motivo: la v0.3 descarta
  `original` al leer, y en orden JSON la copia recortada podía ganar (`}` > `,`).
- **Lápidas sin `original`** (se quita al borrar y al validar): un gasto borrado no bloquea cambiar la moneda del grupo
  ni deja el grupo inválido tras cambiarla.
- **Moneda del grupo bloqueada** con gastos o fijos vivos en otras monedas (`hasForeign`), al editar y al fusionar.
- **Idiomas** (rama `feat/idiomas`): `es` es la referencia (`Dict`); `ca`, `gl`, `pt` (de Portugal) y `en` se
  comprueban por tipo y por test (mismas claves, mismas `{variables}`, parejas `_one/_other`, sin marcado). La lista,
  los locales de `Intl` y la detección viven en `src/core/lang.ts` (el dominio no depende de `i18n/`). Sin ajuste
  guardado, `loadSettings` toma el primer idioma de `navigator.languages` que la app sabe hablar (`pt-BR` → `pt`;
  `eu`, `ast`, `an` → `es`; ninguno → `en`; lista vacía → `es`) y, en cuanto se guardan las preferencias, queda fijo:
  se descartó un modo «automático» persistente por simplicidad (los usuarios de antes ya tienen `lang` guardado y no
  cambian). **Euskera fuera** hasta tener una revisión nativa: preferimos español a una traducción floja.
- **Tono por idioma**: tú/vosotros → «tu/vosaltres» (ca), «ti/vós» (gl) y «tu/vocês» (pt-PT). En pt-PT, equivalentes
  locales: MB WAY (no Bizum), talão, telemóvel, palavra-passe, «Juntar» por «Fusionar»; y sin «Obrigado/a» en los
  recordatorios (lo escribe la persona, con su género): «Agradeço desde já». En catalán se evita «de {name}» (el
  apóstrofo dependería del nombre): «Import: {name}», y en el CSV «Part (Anna)». Los meses van tal como los da `Intl`
  («octubre del 2026» en ca), por eso las frases con `{month}` en catalán son «Darrer mes: …».
- **Selector de idioma**: chips que bajan de línea (`.chip--lang`), no el segmentado: cinco no caben a 320 px.
- **Recordatorio**: «Recordar»/«Avisar» sustituye a «Copiar» en las transferencias en las que estás tú (con copia
  como alternativa); las demás siguen con «Copiar». `shareLink` acepta ya `url` opcional.
- **Compartir con Repartito** (rama `feat/compartir-con`): `share_target` por **POST multipart también para el
  texto** (un enlace `#g=` compartido llegaría como `?text=` con GET y quedaría en los registros de Pages). El
  service worker solo atiende la **navegación** POST a `/repartito/compartir` (otro POST ahí: 405 local), lo deja
  en la Cache API `repartito-compartido` (`compartir/datos` JSON + `compartir/foto`) y redirige 303 a
  `/repartito/#compartido`. Se eligió la Cache API y no IndexedDB porque el service worker ya la usa, cabe una
  `Response` con el Blob y los tests la falsean fácil; las dos son del origen compartido (I7), así que la página
  la borra al recogerla, descarta lo de más de 10 min y lo valida todo otra vez. `activate` no borra esa caché.
- **Ruteo** (`routeShare`): un `#g=` en cualquier texto gana (vista previa y fusión de siempre); si no, foto y/o
  concepto → «Nuevo gasto» (un grupo: directo; varios: hoja «¿En qué grupo?» con el último abierto primero; ninguno:
  aviso); una URL ajena → aviso, nunca se abre. La foto viaja en la capa `expense` (`shared`) sin comprimir y la
  hoja la comprime al abrirse con `usePhotoDraft(…, initial)`: hasta «Añadir gasto» no se guarda nada.
- **Android**: plugin propio `ShareInboxPlugin.java` (descartados los de terceros: más superficie y rutas de archivo
  hacia JS). Lee la URI en el hilo de plugins de Capacitor (el mismo que atiende `take()`, así que no hay carreras),
  tope de 20 MB por el base64 del puente. En la web `@capacitor/core` se cambia por `native-stub.ts`.

## Trampas conocidas

- GitHub Pages no permite cabeceras propias: la CSP va en `<meta>` (no admite `frame-ancestors`).
- Las rutas de la SPA no existen en Pages (404): la navegación es por estado interno con `pushState` en la misma URL.
- happy-dom: `CompressionStream` y Web Crypto vienen de Node 24 (por eso se usa `./dk.sh` con un Node local antiguo).
- `eslint-disable-next-line` tiene que ir justo encima de la línea: un comentario en medio lo anula.
- El Chromium sin cabeza del equipo de desarrollo no tiene fuente de emojis: las capturas del README evitan pantallas con emoji.
- La demo no llama «Tú» a nadie («Marta pagó a Tú»): usa «Alex» y la app marca «(tú)».
- Con `bash -e`, una línea `! comando` en mitad de un paso de Actions **no** hace fallar el paso: solo cuenta si es la última línea. Usa `if …; then exit 1; fi`.
- En el equipo de desarrollo (arm64) no hay SDK de Android: el APK solo se compila en el CI (rama + PR).
- happy-dom no tiene canvas ni IndexedDB: la compresión se prueba con un codificador falso (`shrink`) y en la
  interfaz se simula `compressPhoto` con `vi.mock`; sin IndexedDB, la app no ofrece adjuntar fotos.
- `createImageBitmap(file)` respeta la orientación EXIF; no usar `URL.createObjectURL` para pintar (la CSP no admite
  `blob:` en `img-src`).
- En Capacitor, `capture` en el `<input type="file">` lanzaría la cámara y pediría `CAMERA` si se declarara: no usarlo.
- El panel de navegador integrado de Claude no registraba el service worker («An unknown error occurred when
  fetching the script»). En noviembre de 2026 ya lo registra con `vite preview` (config `amedias` del
  `launch.json` de la carpeta de trabajo).
- **Simular un share target en un Chromium de escritorio**: formulario `multipart` desde una página **fuera** del
  ámbito y sin la CSP de la app (p. ej. la 404 de `vite preview` en `/fuera-del-ambito`: la app tiene
  `form-action 'none'`), con `accept-charset="UTF-8"`. Sin él, la 404 (sin `<meta charset>`) envía «Súper» en
  Latin-1 y `request.formData()` del service worker falla con un «Failed to fetch» que parece un problema del
  cuerpo. Un `<input type=file>` vacío envía una parte de archivo sin nombre ni bytes: el service worker la ignora.
  Para archivos de disco, Chromium sin cabeza por CDP con `DOM.setFileInputFiles`.
- No hay `javac` en el equipo, pero el JRE trae el módulo: `java -m jdk.compiler/com.sun.tools.javac.Main` compila
  el plugin contra clases de Android y Capacitor de mentira para cazar fallos de sintaxis y tipos (no sustituye a
  Gradle en el CI). Ojo con APIs de Java 9+ (`Set.of`): `minSdk` es 24.
- `git checkout <archivo>` para deshacer una prueba de mutación devuelve el archivo a HEAD: copia antes o usa `git stash`.
- `Intl` en `es-ES` formatea el yen como «3500 JPY» (no «3500 ¥»): los tests de interfaz buscan el código.
- `parseRate` no es `parseAmount`: un separador que aparece una sola vez es **siempre decimal** («1.234» = 1,234),
  porque los cambios llevan a menudo tres decimales. El equivalente en vivo («≈ 21,67 €») delata un cambio mal escrito.
- En el navegador integrado, `form_input` cambia el valor del DOM pero React no se entera: para probar formularios,
  teclear de verdad (`computer type`) o usar el `setter` nativo + evento `input`/`change`. Las capturas van un fotograma
  por detrás durante las animaciones de las hojas.
- happy-dom (y Node 24) dicen `navigator.languages = ['en-US']`: `test/setup.ts` simula un dispositivo en español
  para que los tests de interfaz, escritos en español, no cambien de idioma. Para probar la detección, redefinir
  `navigator.language(s)` con `Object.defineProperty` y devolverlo a `es-ES` al acabar.
- `Intl` en `pt-PT` escribe «12/10» para `{ day, month: 'short' }` (no «12 out.»), y en `ca-ES` «12 d’oct.»: es lo
  que da CLDR, no un fallo.
- `sw.js` en `public/` lleva `VERSION = 'dev'` e `INTEGRITY = {}`: sin build no cachea nada. El CI comprueba que el build los reescribe.
- `pkill -f <patrón>` desde la herramienta Bash puede matar su propio shell (el patrón aparece en su línea de
  órdenes): mejor `kill <pid>`.

## Tras publicar (2026-10-25)

- Repo público `BertMarti/repartito`, Pages desplegado desde Actions y release v0.1.0. CI, CodeQL, Scorecard y despliegue en verde.
- Build reproducible: la `VERSION` del service worker publicada coincide con la del build local.
- Comprobado en la web publicada: CSP con `trusted-types repartito-sw`, service worker activo con cachés verificadas, consola limpia.
- CodeQL avisó de `js/unvalidated-dynamic-method-call` en `scripts/brand/render.mjs` (herramienta local): corregido.
- Avisos de Scorecard aceptados por ahora (proyecto de una persona): protección de rama, revisión de código, fuzzing, insignia CII.
- Tarjetas 640×400 para el perfil enviadas a la sesión «Revisión de repositorios GitHub», que las publica con su propia PR.

## v0.2.0 publicada (2026-10-25)

- **Nuevo nombre, Repartito**, por las apps «A medias» ya existentes en App Store y Google Play. Repo renombrado a `BertMarti/repartito` (GitHub redirige el antiguo); web en `/repartito/` (la ruta `/amedias/` da 404).
- Release v0.2.0 con `repartito-v0.2.0.apk`, `.aab` y `SHA256SUMS.txt`: firmados en el entorno `android-release`, huella del certificado verificada en el CI, atestaciones de procedencia comprobadas por la API.
- Web publicada comprobada: service worker en `/repartito/`, cachés `amedias-*` antiguas borradas, consola limpia.
- El `gh` del equipo de desarrollo (2.46) no tiene `gh attestation`: se comprueba con `gh api repos/BertMarti/repartito/attestations/sha256:<huella>`.
- Pendiente (PLAN v0.3): App Links para abrir los `#g=` en la app (necesita `assetlinks.json` en la raíz del dominio) y Google Play (cuenta de desarrollador del autor).

## v0.2.1 publicada (2026-10-26)

- Hallazgos de la revisión externa P1-P4 corregidos con tests (PR #2). Release con APK/AAB firmados (misma huella de certificado que la v0.2.0, así que se instala encima) y atestaciones comprobadas.

## v0.3.0 en rama (2026-10-27)

- Rama `feat/v0.3` subida, **sin PR**: la revisa el lead. Atajos (Repetir, plantillas), recordatorio amable y fotos
  de tickets locales. 128 tests en verde (lint, tipos, build web y `build:android`).
- Probado en el navegador integrado a 375 y 320 px, tema oscuro: compresión (4000×3000 → 1600×1200, 328 KB),
  miniatura, vista en grande, quitar, borrar con el gasto y con «Borrar todo», plantillas y recordatorio (copia).
  Sin errores de CSP ni de Trusted Types.
- Pendiente de comprobar en un móvil real: el menú de compartir de Android con el recordatorio y el selector de
  fotos dentro de la app (el emulador del CI no lo cubre).

## v0.4.0 (publicada el 2026-10-28)

- PR #4 fusionada y publicada como v0.4.0. Varias monedas por grupo con cambio manual (`src/core/fx.ts`,
  `src/ui/sheets/MoneyField.tsx`). 210 tests en verde (lint, tipos, build web y `build:android`).
- Probado en el navegador integrado a 375 y 320 px, claro y oscuro: gasto en JPY (≈ 21,67 €), en USD con el cambio al
  revés y reparto por importes, cambio propuesto en un pago, edición, «Grupo y personas» con la moneda bloqueada, saldos
  y resumen. Sin desbordes (ancho de página = ancho de pantalla) ni errores de CSP o Trusted Types.
- Auditoría (subagente security-auditor): nada bloqueante. Corregidos: `commit` ya no deja escapar un error de `fn`
  (avisa con `toast.notApplied` y devuelve `false`), `updateRecurring` con `amount` sin `original` quita la otra
  moneda, y el aviso de `currency` al fusionar explica cómo salir (misma moneda en los dos móviles). Aceptado: la
  bifurcación de moneda entre dos móviles sin conexión (T13).
- Pendiente: probarlo en un móvil real Decidido: las plantillas guardan el equivalente en la moneda del grupo (sencillo y sin cambio que caduque); se revisará si alguien lo pide.

## v0.5.0 «Lenguas» (publicada el 2026-10-31)

- PR #5 fusionada y publicada como v0.5.0. Catalán, gallego y portugués de Portugal, detección del
  idioma del dispositivo y selector en Ajustes. 242 tests en verde (lint, tipos, build web y `vite build --mode android`).
- Probado en el navegador integrado a 320 px con el build (`vite preview`) en ca, gl y pt: inicio, las cuatro pestañas
  del grupo, nuevo gasto, «Grupo y personas», compartir, ajustes y nuevo grupo. Ancho de página = ancho de pantalla en
  todas, consola sin errores (ni CSP ni Trusted Types). En catalán, «Prova-ho amb un grup d’exemple» ocupa dos líneas
  y la línea «Ha pagat Leo, 11 d’oct.» tres; en todos, como en español, los nombres largos de los saldos se recortan
  con «…» cuando el importe es grande.
- Auditoría (subagente security-auditor): nada bloqueante. Corregido: `detectLang` buscaba en un objeto literal y una
  etiqueta `constructor` en `navigator.languages` devolvía `Object` como idioma (pantalla en blanco sin salida);
  ahora usa `Object.hasOwn`, con test.
- Pendiente: lectura de hablantes nativos de ca, gl y pt; euskera con revisión nativa; `cap sync` y el APK no se
  han probado en esta rama (no cambia nada nativo; las cadenas de Android solo llevan «Repartito»).

## Compartir con Repartito (rama `feat/compartir-con`, 2026-11-02, sin PR)

- 279 tests en verde (lint, tipos, build web y `build:android` con `cap sync`). El APK no se compila en este equipo
  (sin SDK de Android en arm64): lo hace el CI, que también comprueba que no pide permisos y prueba en el emulador
  enlace, texto y URL ajena por `ACTION_SEND`. El plugin Java se comprobó con `javac` contra clases de mentira.
- Probado con el build (`vite preview`): navegaciones POST reales al service worker (Chromium 156 sin cabeza con
  archivos de disco, y el navegador integrado) con foto (4000×3000 → 1600×1200, guardada en IndexedDB al añadir el
  gasto y no en el grupo), SVG disfrazado de PNG (rechazado), enlace de grupo (vista previa), URL ajena (aviso),
  texto (concepto) y dos grupos (selector a 320 px, claro y oscuro). Siempre `location.search` vacío, `#compartido`
  borrado y la caché temporal vacía tras recogerla; consola sin errores de CSP ni de Trusted Types.
- Pendiente: probarlo en un Android real (web instalada y APK) con una foto de la galería; el emulador no cubre las
  imágenes. Visto de paso (no es de esta rama): con un nombre de grupo de 40 caracteres, la barra superior del grupo
  desborda a 320 px (el `h1` tiene elipsis pero su contenedor no se encoge).

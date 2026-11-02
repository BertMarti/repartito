# Modelo de amenazas

Repartito es una web estática (GitHub Pages) sin servidor propio ni cuentas. Los datos viven en el
navegador de cada persona. Análisis STRIDE de lo que sí puede salir mal.

## Activos

1. Los gastos de cada grupo (quién paga qué, cuánto, conceptos): datos personales y económicos.
2. La integridad de los saldos (que nadie «cuele» deudas).
3. La disponibilidad de la app en el móvil (que un enlace no la rompa).

## Actores

| Actor | Capacidades |
|---|---|
| Alguien que te envía un enlace o archivo malicioso | Controla por completo su contenido. |
| Quien intercepta un enlace | Lo lee si no tiene contraseña. |
| Un paquete npm o una action comprometidos | Ejecutan código en el build o en el CI. |
| Otra web | Intenta enmarcar la app o leer sus datos. |
| Otra web del mismo origen (`bertmarti.github.io/*`) | Comparte `localStorage`, Cache API y registros de service worker (I6, I7). |
| Un miembro del grupo malintencionado | Envía enlaces válidos pero manipulados (fechas, monedas, lápidas). |

## STRIDE

| # | Amenaza | Mitigación | Dónde |
|---|---|---|---|
| T1 | **Manipulación**: un enlace con importes negativos, NaN, repartos que no suman o personas inventadas | Validación estricta campo a campo; los repartos se recalculan siempre con aritmética entera. | `validate.ts`, `split.ts`, tests «rechaza: …» |
| T2 | Contaminación de prototipos con `__proto__`/`constructor` en un JSON | Objetos reconstruidos desde cero; claves de los repartos solo con formato UUID. | `validate.ts`, test «no contamina objetos» |
| T3 | Un enlace cifrado modificado | AES-GCM autentica: cualquier cambio falla al descifrar. | `share.ts` |
| T4 | **Fusión que te quita datos**: un enlace válido que, al juntarse con tu copia, pasaría de los límites; al reabrir la app el grupo se rechazaría | Antes de guardar, el resultado de cualquier fusión, importación, gasto fijo o edición pasa otra vez la validación completa (`revalidate`); si no la pasa, no se guarda y se avisa. | `merge.ts` (`incomingProblem`), `store.ts`, test F1 |
| T5 | **Cambios a escondidas** en una fusión (nombre, moneda, personas quitadas, gastos borrados, gastos fijos) | La vista previa enseña todo lo que cambiaría; lo que borra o cambia la moneda va en rojo. «Ya estás al día» solo si la fusión no cambia nada de verdad. | `mergePreview`, `IncomingSheet.tsx`, test F2 |
| T6 | Cambio de moneda con otros decimales (EUR → JPY) que multiplica todo por 100 | Se rechaza si hay gastos, tanto al editar como al fusionar. | `factory.ts`, `incomingProblem`, test F3 |
| T7 | **Ediciones «pegajosas»** con fechas adelantadas: ganarían a las tuyas durante meses | Se rechazan enlaces con ediciones a más de 24 h vista, y cada edición propia es siempre posterior a la versión que corrige (`max(ahora, anterior + 1)`). | `validate.ts`, `factory.ts`, test F4 |
| T8 | Lápidas de gastos fijos de meses futuros que anulan cobros que aún no existen | Un gasto `<fijo>~AAAA-MM` solo es válido si el fijo existe y el mes no pasa de dos meses vista. | `validate.ts`, test F5 |
| T9 | CSV de Splitwise con importes desorbitados, fechas imposibles o varias monedas | Esas filas se saltan y el resultado pasa la validación completa. | `csv.ts`, test F6 |
| T10 | Repartos que no cuadran (porcentajes que no suman 100 %, importes exactos que no suman el total) inflan el resumen | Se rechazan al validar. | `validate.ts`, test F14 |
| I1 | **Divulgación**: los datos en la URL acaban en servidores o historiales | Van en el fragmento `#` (no se envía al servidor ni en el `Referer`); la app lo borra de la barra y de la entrada actual del historial nada más leerlo. **No** puede borrarlo del historial global del navegador, de su sincronización ni de la app de mensajería por la que llegó: para grupos sensibles, usa contraseña. | `share.ts`, `store.ts` |
| I2 | Enlace interceptado | Contraseña opcional: PBKDF2 600 000 + AES-256-GCM. La que genera la app tiene unos 79 bits de azar (4 bloques de 4 símbolos): probarlas todas está fuera del alcance práctico. Una contraseña corta elegida a mano sí se puede adivinar sin conexión. | `share.ts`, `util.ts` |
| I3 | Fuga por `Referer` o recursos externos | `no-referrer`; la app no hace ninguna petición a terceros (sin analítica, CDN ni fuentes externas). | `index.html`, tests de interfaz |
| I4 | XSS que robe los datos de todos los grupos | CSP estricta (`default-src 'self'`, sin `unsafe-*`), **Trusted Types** con una sola política permitida (`trusted-types repartito-sw`, ni siquiera `default`), texto siempre como texto (React), ESLint y CI prohíben `innerHTML`/`eval`. | `vite.config.ts`, `eslint.config.js`, `ci.yml` |
| I5 | CSV abierto en Excel ejecuta fórmulas | Celdas que empiezan por `= + - @` neutralizadas con apóstrofo. | `csv.ts`, test |
| D1 | **Denegación**: un enlace o archivo enorme o una bomba de descompresión cuelga el móvil | Topes de 1,5 MB (enlace), 8 MB (descomprimido), 20 MB (archivo), 50 personas, 20 000 gastos; la descompresión se corta en el tope. | `share.ts`, `validate.ts`, test «bombas» |
| D2 | Un gasto fijo con fechas absurdas genera miles de gastos | Como mucho 36 meses de golpe; día del mes 1-28. | `recurring.ts` |
| D3 | Almacenamiento lleno o dañado | Error visible al guardar; al cargar se apartan los grupos dañados sin perder los demás. La copia en bruto se guarda con fecha (las 3 últimas) y se puede descargar desde Ajustes. | `storage.ts`, `store.ts`, `SettingsSheet.tsx`, test F11 |
| D4 | Abrir `…/repartito/icon.svg` (o cualquier otra ruta) sustituía la copia sin conexión de la app | El service worker solo guarda como app la propia `index.html`, y solo si su huella SHA-256 coincide con la publicada. | `public/sw.js`, test manual |
| D5 | Lista con miles de gastos que atasca el móvil | Se pintan de 150 en 150 («Ver más»); los totales del mes se calculan con todos. | `ExpensesTab.tsx` |
| I6 | **Origen compartido**: todas las webs de `bertmarti.github.io/*` (otros proyectos del mismo autor) son el mismo origen y comparten `localStorage`; un XSS en cualquiera de ellas podría leer o escribir los grupos | Las demás webs del origen son del mismo autor y todas tienen `script-src 'self'` sin `unsafe-*`, pero **no todas son tan estrictas** como esta: alguna se conecta a servidores externos (p. ej. un juego en línea por WebSocket), permite estilos en línea o `wasm-unsafe-eval`, y ninguna más usa Trusted Types. No existe el sitio raíz `bertmarti.github.io`, así que nadie puede registrar un service worker en `/`. Riesgo bajo pero real. Arreglo de fondo: origen propio (subdominio u organización `repartito`, PLAN v0.3); la app de Android ya lo tiene (A1). | PLAN, revisión externa P1 |
| I7 | El mismo origen comparte también la **Cache API** y los service workers: otra página podría escribir un script falso en la caché de la app | Al compilar se inyecta en `sw.js` el SHA-256 de cada archivo publicado; nada se guarda ni se sirve desde la caché si su huella no coincide (se borra y se pide a la red). Cada despliegue estrena cachés. Riesgo restante: anular el registro del service worker (solo afecta al modo sin conexión). | `vite.config.ts` (`swIntegrity`), `public/sw.js`, test manual |
| E1 | Enmarcar la app (clickjacking) | Sin acciones peligrosas de un clic; GitHub Pages no permite cabeceras, así que `frame-ancestors` no aplica (riesgo aceptado, bajo). | — |
| SC1 | Dependencia comprometida | Pocas dependencias, todas de build; `ignore-scripts=true`; `npm audit`, revisión de dependencias y Dependabot con 7 días de espera. La imagen de Node de `dk.sh` va fijada por digest. | `.npmrc`, `ci.yml`, `dependabot.yml`, `dk.sh` |
| SC2 | Action comprometida | Actions fijadas por SHA, permisos mínimos; solo el trabajo `deploy` puede publicar, y antes pasa lint, tipos, tests, `npm audit` y las comprobaciones de CSP y huellas. | `.github/workflows/` |

## App de Android

La app de Android ([docs/ANDROID.md](ANDROID.md)) es la misma web dentro de un APK. Cambia la superficie:

| # | Amenaza | Mitigación | Dónde |
|---|---|---|---|
| A1 | Otras webs del mismo origen leen los datos (I6, I7) | En la app, el origen es `https://localhost` **propio del APK**: no se comparte con nadie. | Capacitor |
| A2 | La app filtra datos por la red | **Ningún permiso del sistema**, ni Internet. El CI falla si el APK pide alguno. | `AndroidManifest.xml`, `android.yml` |
| A3 | Copia automática de los gastos en la nube de Google o al pasar a otro móvil | `allowBackup=false` y reglas de extracción que lo excluyen todo. | `AndroidManifest.xml`, `data_extraction_rules.xml` |
| A4 | Los plugins escriben en el registro del sistema (logcat) textos con datos (p. ej. un enlace) | `loggingBehavior: none`. | `capacitor.config.json` |
| A5 | Depurar el WebView de la app publicada | Solo las compilaciones de depuración permiten DevTools; el CI comprueba que el APK publicado **no es depurable**. | `android.yml` |
| A6 | `FileProvider` expone más archivos de los necesarios | Solo la caché privada (`cache-path`), donde se escriben las copias y los CSV antes de compartirlos. | `file_paths.xml` |
| A7 | APK manipulado o firmado por otro | Firma con una clave que solo vive en un entorno de GitHub restringido a etiquetas `v*`; el CI verifica la huella del certificado; atestación de procedencia y `SHA256SUMS.txt` en cada release. | `android.yml`, `docs/ANDROID.md` |
| A8 | Gradle o su wrapper comprometidos | `wrapper-validation` y `distributionSha256Sum` fijado; actions por SHA. | `android.yml`, `gradle-wrapper.properties` |
| A9 | El build web arrastra código nativo | Los plugins de Capacitor se sustituyen por un módulo vacío en la web. | `vite.config.ts`, `native-stub.ts` |

## Fotos de tickets, plantillas y recordatorios (v0.3.0)

| # | Amenaza | Mitigación | Dónde |
|---|---|---|---|
| L1 | **Las fotos de los tickets se filtran** en un enlace, una copia de seguridad o el CSV | Las fotos nunca forman parte del grupo: viven en IndexedDB (`repartito-fotos`) con el id del gasto como clave, y el JSON del gasto no cambia (ni siquiera una marca `hasPhoto`). Enlaces, copias y CSV se generan solo con el grupo. | `photos.ts`, test «nunca va en el grupo, los enlaces, las copias ni el CSV» |
| L2 | **Restos de fotos** tras borrar un gasto, un grupo o todos los datos | Borrar el gasto borra su foto (`commit` detecta las lápidas nuevas); un borrado que llega al fusionar también (`prunePhotos`, además al abrir la app); «Eliminar el grupo» y «Borrar todos los datos» las borran. Las fotos de grupos que no se conocen (p. ej. apartados por dañados) no se tocan. | `store.ts`, `photos.ts` (`orphanPhotos`), tests de interfaz |
| L3 | Una imagen manipulada (enorme, bomba de píxeles, SVG con script) | Solo `image/*` de hasta 40 MB; se decodifica con `createImageBitmap` y se vuelve a codificar en JPEG con un canvas (≤ 1600 px, ≤ 400 KB), así que nunca se guarda el archivo original. Al leer de IndexedDB solo se acepta `data:image/jpeg` o `data:image/webp` en base64 y de tamaño acotado; SVG y cualquier otra cosa se descartan. Se pinta en un `<img>`, que no ejecuta scripts. | `image.ts`, `photos.ts` (`isPhotoData`), tests |
| L4 | Aflojar la CSP para enseñar fotos | **La CSP no cambia.** Las fotos se enseñan como `data:` (ya permitido en `img-src`) y se abren sin URL `blob:` (`createImageBitmap` lee el archivo directamente; si falla, se carga como `data:`). | `vite.config.ts`, `image.ts`, test de CSP |
| L5 | El selector de fotos hace que la app de Android pida la cámara | `<input type="file" accept="image/*">` **sin** `capture`: Capacitor abre el selector del sistema y no pide `CAMERA`. El CI sigue comprobando que el APK no declara ningún permiso. | `PhotoField.tsx`, `android.yml` |
| L6 | En la web, otras páginas del mismo origen leen las fotos (I6) | IndexedDB es por origen, igual que `localStorage`: mismo riesgo y misma solución de fondo (origen propio, PLAN). En la app de Android el origen es propio (A1) y `allowBackup=false` excluye también IndexedDB (A3). | PLAN |
| L7 | El recordatorio de pago revela más de la cuenta | Solo nombres, importe y nombre del grupo; **nunca** el enlace ni otros datos (test). Es un mensaje que la persona decide enviar desde el menú del sistema. | `BalancesTab.tsx`, test «mensaje sin enlace» |
| T11 | **Plantillas manipuladas** en un enlace (ids raros, repartos que no cuadran, miles de plantillas, fechas adelantadas) | Misma validación estricta que gastos y fijos: UUID, quien paga y el reparto apuntan a personas del grupo, con importe el reparto cuadra, sin importe no hay importes exactos y los porcentajes suman 100 %, tope de 100 (lápidas incluidas). Cuentan para `latestEdit` (F4) y para los límites al fusionar (F1); la vista previa enseña sus cambios (F2). | `validate.ts`, `merge.ts`, tests «plantillas» |

## Varias monedas (v0.4.0)

| # | Amenaza | Mitigación | Dónde |
|---|---|---|---|
| T12 | **Cambio manipulado o importe desacompasado**: un enlace enseña «3500 ¥» pero su `amount` cobra otra cosa, o trae un cambio absurdo (cero, negativo, decimal, enorme), una dirección rara o la misma moneda que el grupo | `parseGroup` recalcula `amount` a partir de `original` con aritmética entera y rechaza el grupo entero si no coincide **exactamente**; el cambio tiene que ser un entero entre `RATE_MIN` y `RATE_MAX`, `inverse` solo puede ser `true`, la moneda tiene que ser de la lista y distinta de la del grupo. Los repartos por importes exactos siguen teniendo que sumar `amount`. | `validate.ts`, `fx.ts`, tests «rechaza …» de «varias monedas» |
| T13 | **Cambio de la moneda del grupo** con gastos en otras monedas: los cambios dejarían de ser respecto a la moneda en que se escribieron (o el grupo se volvería inválido si pasa a ser la del gasto) | Se impide al editar (`renameGroup`) y al fusionar (`incomingProblem` → `currency`, se explica sin fusionar). Las lápidas no guardan `original`, así que un gasto borrado no lo bloquea para siempre. Riesgo aceptado (disponibilidad, baja): si un móvil cambia la moneda mientras otro, sin conexión, apunta un gasto en otra moneda, cada uno rechaza el enlace del otro hasta que pongan la misma moneda; el aviso lo explica. Si el cambio llega mientras la hoja de ajustes está abierta, no se guarda y se avisa. | `factory.ts`, `merge.ts`, `store.ts`, tests «moneda del grupo» |
| T14 | **Pérdida silenciosa** del importe original al pasar por un móvil con la v0.3 (que descarta campos desconocidos) | El `amount` sigue siendo correcto, así que los saldos no cambian. Con la misma marca de edición, la fusión prefiere la versión con `original` (orden total: sigue siendo conmutativa, asociativa e idempotente). Efecto lateral: con marcas idénticas (relojes desajustados), una edición con `original` gana a una lápida; antes decidía el orden JSON, igual de arbitrario, y la vista previa lo enseña (T5). | `merge.ts`, test «la versión de un móvil con la v0.3…» |
| D6 | Un cambio que hace desbordar el cálculo | La conversión usa BigInt; un resultado que no cabe en un entero seguro se trata como inválido (nunca pasa la validación ni el formulario). | `fx.ts`, test |

## Compartir con Repartito (Share Target)

Desde el menú de compartir del móvil llega a la app una foto (el ticket) o un texto (p. ej. un enlace de grupo
desde WhatsApp). En la web lo recibe el service worker (`share_target` del manifest); en la app de Android, el
plugin propio `ShareInbox`. Lo decide `src/ui/shareTarget.ts` (`routeShare`).

| # | Amenaza | Mitigación | Dónde |
|---|---|---|---|
| S1 | **Divulgación**: un enlace compartido lleva los datos del grupo; con un `share_target` por `GET` iría en `?text=…` y quedaría en los registros de GitHub Pages y su CDN | `method: POST` y `multipart/form-data` (también para el texto). El service worker atiende el POST a `/repartito/compartir` entero y **nunca lo reenvía a la red**: valida, guarda en el dispositivo y redirige (303) a `/repartito/#compartido`, un fragmento fijo sin datos que la app borra al leerlo. Un POST que no sea la navegación de compartir recibe un 405 local. | `manifest.webmanifest`, `public/sw.js`, tests «nunca en la dirección», «solo atiende la navegación…» y de `share_target` |
| S2 | Lo compartido **espera en la Cache API**, que comparten las demás webs de `bertmarti.github.io` (I6, I7): podrían leerlo o dejar uno falso | Solo espera el tiempo de una redirección: la app lo recoge y **borra la caché** al momento; lo que tenga más de 10 minutos (o fechas raras) se descarta; si la app se abre sin `#compartido`, se borra sin leerlo; lo nuevo sustituye a lo anterior. Lo recogido se valida entero (forma, tipos, topes, tipo real de la imagen) y sigue el mismo camino que un enlace o una foto elegida a mano, así que lo peor que puede hacer una web hermana es **proponer** un enlace o una foto que hay que confirmar. Mismo riesgo de fondo que `localStorage` (arreglo: origen propio, PLAN). | `shareTarget.ts` (`webShareSource`), tests «recogida en la página» |
| S3 | Si otra web del origen **anula el registro del service worker** (riesgo restante de I7), un POST de compartir llegaría a GitHub Pages con el enlace en el cuerpo | Pages no atiende POST (responde con un error) y el enlace va en el cuerpo, no en la URL, que es lo que acaba en los registros de acceso. Riesgo aceptado (bajo): requiere un XSS en una web hermana y compartir justo después. Con contraseña, el enlace no revela nada. | — |
| S4 | **Imagen manipulada** (enorme, bomba de píxeles, SVG con script, HEIC que no se puede abrir, muchas a la vez) | Solo se adjunta la primera; tope de 40 MB (15 MB en la app), 20 archivos y 1,5 MB por texto; el tipo se decide por los **primeros bytes** (JPEG, PNG, GIF, WebP, AVIF), no por lo que declara quien la envía, en el service worker y otra vez en la página. Luego pasa por `compressPhoto` como cualquier foto (L3): nunca se guarda el original. | `sw.js` (`sniffImage`), `shareTarget.ts`, `image.ts`, tests |
| S5 | **Una URL cualquiera** compartida con la app (`https://…`, `javascript:`, `intent:`) | Nunca se abre ni se navega a ella: solo se busca un `#g=` con formato de Repartito, que va a `decodeGroup` y a la vista previa con confirmación (T5). Cualquier otra dirección se quita del concepto o se rechaza con un aviso. | `shareTarget.ts` (`findPayload`, `titleFrom`), tests «una URL ajena no se abre nunca» |
| S6 | Otra web hace un POST a `/repartito/compartir` con un formulario (como un enlace malicioso) | Solo se atiende la navegación de una ventana (`destination: document`), no la de un iframe. Aun así, equivale a enviarte un enlace: se abre la vista previa o «Nuevo gasto» y **nada se guarda** sin que toques Fusionar/Añadir o Añadir gasto. | `IncomingSheet.tsx`, `ExpenseSheet.tsx`, tests |
| A10 | En Android, **cualquier app puede enviar un `ACTION_SEND`** a Repartito, también con una URI de los archivos privados de la propia app (p. ej. las copias de seguridad de su `FileProvider`, A6) o un `file://` | Plugin propio y pequeño (`ShareInboxPlugin.java`), sin dependencias: solo `content://` de **otras** apps: se rechazan `file://`, las URIs con usuario (`content://0@…`, que el sistema resolvería igual) y cualquier autoridad que resuelva a un proveedor de la propia app. Tipo por los primeros bytes (no el declarado), tope de 15 MB (antes de leer si el proveedor anuncia el tamaño) y, si falta memoria, aviso en vez de cierre; textos acotados. Lee con el permiso temporal que da el intent: **sin `uses-permission`** (el CI lo comprueba). Lo leído se queda en memoria hasta que la web lo pide una vez con `take()`: JS no puede pedir ninguna URI (no es un lector de archivos), nada va a logcat ni a disco, y al volver desde «Recientes» o tras cerrar Android el proceso no se repite. La web lo valida igual que en S4/S5. | `ShareInboxPlugin.java`, `AndroidManifest.xml`, `android-e2e.mjs`, tests «lo que llega del plugin» |

## Revisión externa (después de la v0.2.0)

Otra sesión revisó el código en solo lectura buscando lo que no cubrían F1-F15 ni A1-A9:

| ID | Gravedad | Hallazgo | Resolución |
|---|---|---|---|
| P1 | baja | I6 describía las webs hermanas como más estrictas de lo que son. | I6 corregido; origen propio adelantado al PLAN v0.3. |
| P2 | baja | Con enlace cifrado, el **nombre del grupo** viajaba en claro en el mensaje y en la vista previa del chat. | El mensaje y el título ya no lo llevan cuando hay contraseña (test). |
| P3 | baja | En navegadores sin `deflate-raw` (Safari < 16.4, Chrome < 103, Firefox < 113) un enlace válido parecía dañado. | Se detecta y se explica que hay que actualizar el navegador, sin pedir otro enlace (test). |
| P4 | baja | «Borrar todo» no borraba restos con el nombre antiguo (`amedias:v1:*`). | Ahora sí (test). |

## Riesgos aceptados

- **Dispositivo comprometido** o extensiones del navegador maliciosas: pueden leer `localStorage`.
- **Quien tiene el enlace y la contraseña** ve el grupo entero (como recibir el archivo).
- **Relojes desajustados** pueden decidir qué edición gana en una fusión (ver
  [SINCRONIZACION.md](SINCRONIZACION.md#límites-del-modelo)); con un margen de 24 h.
- **Origen compartido con otras webs del autor en `github.io`** (I6, I7) en la web, hasta pasar a un dominio propio. La app de Android no lo tiene (A1).
- **Instalar el APK fuera de Google Play** obliga a permitir «fuentes desconocidas» para ese archivo; se mitiga con la firma verificable y la atestación (A7).
- **Las fotos de los tickets no están en las copias de seguridad** (a propósito, L1): al cambiar de móvil o borrar
  los datos del navegador se pierden. La app lo avisa junto al botón de la foto.
- **Compartir con la web sin service worker** (S3): si otra web del origen lo anulara, lo compartido iría a GitHub
  Pages en el cuerpo de un POST. Desaparece con el origen propio.
- **Navegadores sin Trusted Types** (Firefox y Safari antiguos): la CSP sigue bloqueando scripts ajenos; solo
  falta esa capa extra.

## Auditoría independiente (v0.1.0)

Antes de publicar, otro modelo (Fable) auditó el código sin ver las conclusiones del autor. Encontró
1 fallo alto (F1: fusión que superaba los límites y hacía desaparecer el grupo), 5 medios (F2-F6) y varios
bajos o informativos. **Todos están corregidos** y cada uno tiene su test de regresión (`F1`…`F15` en
`test/core.test.ts` y `test/ui/app.test.tsx`); D4 e I7 se comprobaron a mano en el navegador (caché
envenenada a propósito: el script falso no se ejecuta).
- **Sin cabeceras HTTP propias** en GitHub Pages: la CSP va en `<meta>`, que no admite `frame-ancestors`.

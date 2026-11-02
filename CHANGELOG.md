# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Sin publicar]

## [1.0.0] - 2026-11-02 «Estable»

Primera versión estable: el compromiso de que tus datos, tus enlaces y tus copias siguen funcionando en toda la 1.x.

### Añadido

- [Estabilidad y compatibilidad](docs/ESTABILIDAD.md): qué no cambia en la 1.x (datos guardados, enlaces `#g=`, fusión
  entre versiones distintas, copias de seguridad, CSV, cálculos, dirección de la web y app de Android), la excepción
  por seguridad y qué no es interfaz pública.

### Arreglado

- Un nombre de grupo largo (40 caracteres) ensanchaba la pantalla del grupo a 320 px: la columna de la cuadrícula
  medía el título sin cortar. Ahora el título se corta con «…» y nada se sale.

## [0.6.0] - 2026-11-02

### Añadido

- **Compartir con Repartito** desde el menú de compartir del móvil. Una **foto de un ticket** (desde la galería o la
  cámara) abre «Nuevo gasto» con la foto ya puesta, en el grupo que haya o, si hay varios, en el que elijas (el
  último abierto sale primero). Un **enlace de grupo** (p. ej. desde WhatsApp) abre la misma vista previa y fusión
  que abrir el enlace. Cualquier otro texto se usa como concepto; una dirección que no es de Repartito no se abre.
  Funciona en la app de Android y en la web instalada (Chrome en Android).

### Seguridad

- Web: `share_target` por **POST** `multipart/form-data`, también para el texto, para que un enlace compartido nunca
  vaya en `?consulta` (quedaría en los registros del servidor). El service worker lo atiende sin salir a la red, lo
  deja unos segundos en una caché del dispositivo (`repartito-compartido`) y vuelve a la app con un fragmento fijo
  (`#compartido`); la app lo recoge, lo borra y lo valida otra vez (la Cache API la comparte el origen, I7). El tipo de
  la imagen se decide por sus primeros bytes (JPEG, PNG, GIF, WebP, AVIF); SVG y HEIC se rechazan. Topes: una foto de
  40 MB, 1,5 MB por texto. Amenazas S1-S6.
- Android: plugin propio `ShareInbox` (sin dependencias nuevas ni permisos): solo `content://` de otras apps, nunca
  los archivos de la propia app; lee como mucho 15 MB, decide el tipo por los primeros bytes y lo guarda en memoria hasta que la web lo pide una vez.
  Amenaza A10. La prueba en emulador envía ahora un enlace, un texto y una URL ajena con `ACTION_SEND`.
- Sin dependencias npm nuevas ni cambios en la CSP.

## [0.5.0] - 2026-10-31

### Añadido

- **Catalán, gallego y portugués de Portugal**, además de español e inglés. Todas las pantallas, avisos, el
  recordatorio amable, el mensaje para compartir, el grupo de ejemplo y el CSV (cabeceras, tipo y categoría) salen
  en el idioma elegido. Dinero, fechas y números usan el formato de cada uno (`ca-ES`, `gl-ES`, `pt-PT`).
- **Idioma del dispositivo**: la primera vez, la app elige el primero de la lista del navegador o del móvil que sabe
  hablar (`ca-ES-valencia` → catalán, `pt-BR` → portugués; euskera, asturiano y aragonés → español; cualquier otro →
  inglés). Lo elegido en Ajustes se guarda y manda.

### Cambiado

- En Ajustes, el idioma se elige con botones que bajan de línea (cinco no caben en una fila a 320 px); cada nombre va
  en su propio idioma y marcado con `lang` para los lectores de pantalla.
- `<html lang>` lleva ahora la región (`es-ES`, `ca-ES`, `gl-ES`, `pt-PT`, `en-GB`).
- El CSV escribe la categoría con su nombre en el idioma de la app («Comer fuera», «Eating out») en vez del
  identificador interno («restaurante»).

### Seguridad

- Sin dependencias nuevas ni cambios en la CSP. Las traducciones son texto estático; un test comprueba que no llevan
  marcado ni llaves sueltas y que todas tienen las mismas claves y variables que el español. La categoría traducida
  del CSV pasa por la misma protección anti-fórmulas (test). Un idioma guardado desconocido, o una etiqueta del
  dispositivo como «constructor», se ignora (tests).

## [0.4.0] - 2026-10-28

### Añadido

- **Varias monedas en un mismo grupo** (viajes): junto al importe, un selector de moneda. En otra moneda se escribe
  el cambio a mano (la app propone el último que usó el grupo para esa moneda y deja escribirlo al revés: «1 EUR =
  161,5 JPY» o «1 JPY = 0,0062 EUR») y enseña en vivo el equivalente en la moneda del grupo. Vale para gastos, pagos
  y gastos fijos; «Repetir hoy» copia también la moneda y el cambio.
- En la lista de gastos y de gastos fijos, el importe original junto al equivalente; la búsqueda también lo encuentra.
- El CSV añade «Moneda original», «Importe original» y «Cambio» cuando el grupo tiene gastos en otras monedas.

### Cambiado

- Saldos, repartos, resumen y estadísticas siguen en la moneda del grupo. Los repartos por importes exactos se
  escriben también en la moneda del grupo (la hoja lo avisa).
- La moneda del grupo no se puede cambiar mientras haya gastos en otras monedas, ni al editar ni al fusionar un enlace.

### Seguridad

- El equivalente se calcula con aritmética entera (BigInt) y redondeo determinista, y la validación lo **recalcula**:
  un enlace o archivo con un importe que no cuadra con el original y el cambio, con un cambio fuera de límites o con
  la misma moneda que el grupo se rechaza entero (tests).
- La fusión sigue siendo conmutativa, asociativa e idempotente con gastos en varias monedas (tests con ediciones al
  azar). Con la misma marca de edición gana la versión que conserva el importe original, para que no lo pierda un
  grupo que pasó por un móvil con la v0.3.

## [0.3.0] - 2026-10-27

### Añadido

- **Repetir hoy**: en cualquier gasto, abre uno nuevo igual con la fecha de hoy.
- **Plantillas** de gasto («Súper», «Bombona», «Luz»): se guardan desde el formulario («Guardar como plantilla»), se usan con un toque al apuntar un gasto y se borran desde «Grupo y personas». Son del grupo: viajan en los enlaces y se fusionan como lo demás. El grupo de ejemplo trae dos.
- **Recordatorio amable** en «Cómo quedar a cero»: «Recordar» (si te deben) o «Avisar» (si debes tú) abre el menú de compartir del sistema con un mensaje listo para WhatsApp; sin menú de compartir, lo copia.
- **Foto del ticket** en cada gasto, guardada solo en el dispositivo, con miniatura, vista en grande y botón para quitarla. Se reduce en el propio móvil (≤ 1600 px, ≤ 400 KB). En la lista, un icono marca los gastos con foto.
- La vista previa al fusionar enseña los cambios en plantillas.

### Seguridad

- Las fotos viven en IndexedDB y nunca entran en el grupo: ni en enlaces, ni en copias de seguridad, ni en el CSV (tests). Se borran al borrar el gasto (también si el borrado llega al fusionar), el grupo o todos los datos.
- La CSP no cambia: las fotos se enseñan como `data:` (ya permitido) y se abren sin URL `blob:`.
- La app de Android sigue sin pedir ningún permiso: el selector de fotos no usa `capture` (que pediría la cámara).
- Las plantillas pasan la misma validación estricta que el resto del grupo (UUID, límites, repartos que cuadran) y la fusión sigue siendo conmutativa, asociativa e idempotente (tests con ediciones al azar).
- El recordatorio solo lleva nombres, importe y nombre del grupo: nunca el enlace.

## [0.2.1] - 2026-10-25

### Seguridad

- Con un enlace protegido por contraseña, el nombre del grupo ya no aparece en el mensaje ni en la vista previa del chat.
- «Borrar todos los datos» también borra lo que quedara guardado con el nombre antiguo.
- Modelo de amenazas: la amenaza del origen compartido (I6) describe con precisión las webs hermanas.

### Corregido

- En navegadores antiguos sin `deflate-raw`, un enlace válido ya no se presenta como dañado: se explica que hay que actualizar el navegador.

## [0.2.0] - 2026-10-25

### Cambiado

- **Nuevo nombre: Repartito** (antes «a medias»): ya había otras apps de gastos con ese nombre en las tiendas. La web pasa a `https://bertmarti.github.io/repartito/`; los datos guardados se migran solos y los enlaces ya enviados se siguen abriendo.

### Añadido

- **App de Android** (APK en cada release): la misma app, instalable como cualquier otra.
- En la app, compartir enlaces y guardar copias o CSV con el menú del sistema.
- Iconos adaptativos (también monocromos) y pantalla de arranque con la marca.

### Seguridad

- La app tiene su propio origen: no comparte almacenamiento con otras webs de `github.io`.
- No pide ningún permiso del sistema (ni Internet) y no copia los datos en la nube de Google.
- APK y AAB firmados en un entorno protegido, con huella del certificado verificada, atestación de procedencia y `SHA256SUMS.txt`.
- La web publicada no incluye Capacitor (sustituto vacío de 0,17 kB).

## [0.1.0] - 2026-10-25

### Añadido

- Grupos de gastos (piso, pareja, viaje) con personas, gastos y pagos, sin cuenta ni límites.
- Repartos a partes iguales, por importes, por partes o por porcentajes, que cuadran al céntimo.
- Saldos y «cómo quedar a cero» con el mínimo de transferencias, y registro de pagos.
- Gastos fijos mensuales (alquiler, internet, suscripciones) que se apuntan solos.
- Compartir y sincronizar sin servidor: enlace o QR que fusiona los cambios de todos, con contraseña opcional.
- Importación desde Splitwise (CSV) conservando los saldos, exportación a CSV y copias de seguridad.
- Resumen por meses y categorías.
- Español e inglés, tema claro y oscuro, instalable y funciona sin conexión (PWA).
- Seguridad: validación estricta, CSP con Trusted Types, enlaces cifrados, CSV anti-fórmulas y CI de seguridad.

### Seguridad

Auditoría independiente antes de publicar; todo corregido y con test de regresión:

- Una fusión, importación o edición que pasaría de los límites ya no se guarda (antes el grupo podía desaparecer al reabrir la app).
- La vista previa de un enlace enseña todo lo que cambiaría (también borrados, personas quitadas, gastos fijos, nombre y moneda).
- No se aceptan enlaces con ediciones fechadas en el futuro ni cambios de moneda que descuadren los importes; tus correcciones siempre ganan.
- No se aceptan lápidas de gastos fijos de meses futuros ni repartos que no cuadran.
- La importación de Splitwise salta filas desorbitadas, fechas imposibles y otras monedas.
- Contraseñas generadas de unos 79 bits (antes, unos 30).
- Service worker con huellas SHA-256 de cada archivo: no guarda ni sirve nada manipulado, y una navegación cualquiera ya no reemplaza la copia sin conexión.
- CSP con `trusted-types amedias-sw` y sin `blob:`.
- Los datos dañados se apartan con fecha y se pueden descargar desde Ajustes.
- El despliegue exige las mismas comprobaciones que el CI.

[Sin publicar]: https://github.com/BertMarti/repartito/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/BertMarti/repartito/compare/v0.6.0...v1.0.0
[0.6.0]: https://github.com/BertMarti/repartito/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/BertMarti/repartito/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/BertMarti/repartito/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/BertMarti/repartito/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/BertMarti/repartito/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/BertMarti/repartito/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/BertMarti/repartito/releases/tag/v0.1.0

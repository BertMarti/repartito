# PLAN.md · Repartito

## Por qué existe

En 2026 la app de referencia para repartir gastos limita su plan gratuito a unos pocos gastos al día, con
esperas y anuncios. Las alternativas piden cuenta, tienen anuncios o un plan de pago. Lo que más se pide en
apps de productividad es que **funcionen sin conexión de verdad**, y la queja más repetida es que lo gratis
pase a ser de pago. Repartito resuelve un problema diario (el súper del piso, la cena, el viaje) sin
ninguna de esas trabas.

## Principios

1. **Gratis para siempre, sin cuenta, sin anuncios y sin límites artificiales.**
2. **Tus datos son tuyos**: viven en tu dispositivo; compartir es una decisión explícita.
3. **Rápido de usar a diario**: apuntar un gasto en menos de 5 segundos.
4. **Cuadra al céntimo**: aritmética entera y tests.
5. **Seguro por defecto** frente a enlaces y archivos de otras personas.

## v0.1.0 «Primera cuenta» — publicada

- [x] Dominio: repartos (iguales, importes, partes, %), saldos, transferencias mínimas, gastos fijos.
- [x] Fusión sin servidor (conmutativa, asociativa, idempotente) y enlaces comprimidos y cifrables.
- [x] Validación estricta, CSV anti-fórmulas e importación de Splitwise.
- [x] Interfaz completa ES/EN, tema claro/oscuro, PWA sin conexión.
- [x] CI (lint, tipos, tests, build, audit, gitleaks), CodeQL, Scorecard, Dependabot.
- [x] Despliegue en GitHub Pages y README con capturas.
- [x] Auditoría de seguridad independiente (1 alto, 5 medios: todo corregido con tests).

## v0.2.0 «Bolsillo» — publicada

- [x] App de Android (Capacitor): origen propio, sin permisos, sin copia en la nube.
- [x] Compartir y guardar copias o CSV con el menú del sistema.
- [x] CI que la prueba en un emulador y publica APK y AAB firmados, con atestación de procedencia.

## v0.3.0 «Bizum» — publicada

- [x] Recordatorio amable para pedir lo que te deben (texto listo para WhatsApp, sin el enlace del grupo).
- [x] Fotos de tickets guardadas solo en el dispositivo (IndexedDB), nunca en el enlace, las copias ni el CSV.
- [x] Atajos: «Repetir hoy» en cualquier gasto y plantillas por grupo («Súper», «Bombona», «Luz») que se sincronizan.

## v0.4.0 «Casa propia» — publicada en parte (el resto depende del autor)

- [ ] **Origen propio** para la web (amenazas I6, I7, revisión externa P1): no compartir `localStorage`, Cache API
  ni service workers con otras webs de `bertmarti.github.io`. Necesita que el autor cree una **organización de
  GitHub** (`repartito.github.io`) o apunte un **subdominio** propio a Pages; luego, cambiar `base`, `PUBLIC_URL` y
  migrar los datos (el navegador no los pasa de un origen a otro: copia de seguridad o enlace).
- [ ] **Abrir los enlaces `#g=` directamente en la app** (App Links): necesita servir `/.well-known/assetlinks.json`
  en la **raíz del dominio** (imposible en `bertmarti.github.io/repartito/`; posible con el origen propio) con la
  huella del certificado de firma.
- [ ] **Publicar en Google Play**: el AAB firmado ya se genera en cada versión; falta la **cuenta de desarrollador
  del autor** (alta de pago único y verificación de identidad) y la ficha de la tienda.
- [x] **Varias monedas** en un mismo grupo (viajes) con cambio manual (rama `feat/monedas`): cada gasto, pago o gasto
  fijo puede llevar su moneda, su importe y el cambio que se escribió; el equivalente en la moneda del grupo se
  calcula una vez y la validación lo recalcula. Saldos y fusión no cambian (ver
  [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md#varias-monedas-v040)).

## «Juntos» — más adelante

- [ ] Sincronización en vivo opcional entre dispositivos (WebRTC o un relé cifrado de extremo a extremo).
- [x] **Compartir con Repartito** (Share Target, rama `feat/compartir-con`): una foto de ticket abre «Nuevo gasto»
  con ella; un enlace de grupo, la vista previa y fusión. Web: `share_target` por POST atendido en el service
  worker (nada en `?consulta` ni en la red). Android: `ACTION_SEND` con un plugin propio, sin permisos. Falta
  probarlo en un móvil real (el emulador del CI solo cubre textos y enlaces).
- [ ] Widgets.
- Más idiomas (en parte):
  - [x] Catalán, gallego y portugués de Portugal (**v0.5.0 «Lenguas»**), con detección del idioma del dispositivo y
    selector en Ajustes. Falta una lectura de hablantes nativos antes de anunciarlos a lo grande.
  - [ ] **Euskera, pendiente de revisión nativa**: no se publica una traducción sin que la revise alguien que lo
    hable. Mientras, un dispositivo en euskera ve la app en español.

# Estabilidad y compatibilidad (1.x)

Desde la v1.0.0, Repartito sigue [Semantic Versioning](https://semver.org/lang/es/). Lo importante en una app sin
servidor es que **tus datos y tus enlaces sigan funcionando** aunque cada persona del grupo tenga una versión distinta.
Estas son las promesas de toda la 1.x; romper cualquiera exigiría la 2.0.0, avisada en el CHANGELOG con los pasos.

## Lo que no cambia en 1.x

| Pieza | Promesa |
|---|---|
| **Tus datos** | Lo guardado en el navegador o en la app (`repartito:v1:*`) lo abre cualquier 1.x posterior sin hacer nada. Si un cambio de modelo lo necesitara, la app migraría sola al abrir. |
| **Enlaces de grupo** | Un enlace `#g=1.…` (sin contraseña) o `#g=1e.…` (con contraseña) creado con cualquier 1.x se abre y se fusiona en cualquier otra 1.x. Ver [SINCRONIZACION.md](SINCRONIZACION.md). |
| **Fusión entre versiones** | Dos personas con 1.x distintas pueden sincronizarse: la fusión sigue siendo conmutativa, asociativa e idempotente, y lo nuevo llega como campos **opcionales**: una versión anterior los ignora (la validación descarta lo que no conoce) sin perder el resto del gasto. Un valor nuevo en un campo que ya existe (por ejemplo, otro tipo de reparto) no se añadirá en la 1.x. |
| **Copias de seguridad** | Un archivo exportado con cualquier 1.x (`{"app":"repartito","v":1,…}`) se importa en cualquier 1.x posterior. |
| **CSV** | Las columnas del CSV exportado se mantienen (se pueden añadir al final). La importación de Splitwise sigue aceptando su formato. |
| **Dinero** | Mismos repartos y mismos saldos al céntimo para los mismos gastos: lo comprueban los tests del dominio (`test/core.test.ts`). |
| **Dirección de la web** | <https://bertmarti.github.io/repartito/> mientras no haya origen propio; si llega (PLAN, «Casa propia»), la antigua seguirá abriendo y explicará cómo pasar los datos. |
| **App de Android** | El mismo paquete (`io.github.bertmarti.repartito`) y la misma firma: cada versión se instala encima de la anterior sin perder datos. Sigue sin pedir permisos del sistema. |

## La excepción: la seguridad

Si un fallo de seguridad solo se arregla rechazando algo que antes se aceptaba (por ejemplo, un enlace o un archivo
mal formado, o un límite de tamaño), se hará en una versión de parche o menor, explicado en la sección «Seguridad»
del CHANGELOG. Un enlace o archivo válido de una 1.x nunca se rechaza por ese motivo.

## Lo que no es interfaz pública

- Los textos, las traducciones, el diseño y la disposición de las pantallas.
- El código de `src/` usado como biblioteca.
- El formato interno de lo que guarda el service worker en su caché.

## Soporte

Se mantiene la última versión: la web se actualiza sola y la app de Android se descarga de la última release. Para
informar de un fallo, ver [SECURITY.md](../SECURITY.md).

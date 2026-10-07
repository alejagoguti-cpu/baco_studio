# Baco Studio · Control de obra

Web responsive en español para organizar habitaciones con **dos maestros distintos**, consultar el personal suministrado, registrar procesos y cargar evidencia fotográfica en Google Drive. Diseño inspirado en el dashboard «Ware Sync» de la referencia de Behance: fondo crema, menú lateral con submenús y botón naranja, buscador superior, KPIs con mini barras, contador de estados en índigo, vista de lista con selección y exportación CSV, mapa por sector con fichas de color y tarjetas de equipo. La planta suministrada se conserva sin modificaciones. No se inventan números ni asignaciones.

## Ejecutar

Requiere Node.js 22 o posterior. No utiliza dependencias de npm.

```sh
npm start
```

Abre http://127.0.0.1:4173. Para comprobar:

```sh
npm run check
npm test
```

También puede alojarse como web estática en HTTPS, conservando la estructura de archivos. Los módulos funcionan con rutas relativas, incluso dentro de `/baco_studio/`.

## Uso

1. Crea una habitación indicando número, sector, proceso y exactamente dos integrantes diferentes del equipo.
2. Abre la tarjeta para registrar fotos con fecha, momento (antes/durante/después), proceso y observaciones.
3. Sin Drive, las fotografías quedan **pendientes en este dispositivo** en IndexedDB. No se reportan como subidas.
4. Con Drive, la app sube a `Proyecto / Habitación / Proceso`. La respuesta de Drive confirma cada carga. Si falla, las fotos restantes siguen pendientes. Una carga con respuesta perdida se recupera por su ID antes de reintentarse.
5. «Registro fotográfico → Actualizar desde Drive» guarda las asignaciones modificadas y consulta las habitaciones y fotos existentes del proyecto.

## Activar Google Drive (configuración necesaria)

La integración implementada requiere un proyecto real de Google Cloud; el código no contiene credenciales de una cuenta ni simula una conexión.

1. Habilita **Google Drive API** en Google Cloud.
2. Configura la pantalla de consentimiento OAuth. En modo de prueba agrega las cuentas del equipo como usuarios de prueba.
3. Crea un ID de cliente OAuth de tipo **Aplicación web**. Autoriza el origen exacto de la web (incluyendo esquema y puerto), por ejemplo `http://127.0.0.1:4173` para desarrollo y el dominio HTTPS elegido para producción.
4. En la web, pulsa **Conectar Drive**, pega el ID de cliente y autoriza tu cuenta. La aplicación solicita únicamente `drive.file`. El token vive en memoria, no en localStorage ni en el repositorio.
5. Si no eliges una carpeta existente, se crea «Baco Studio · Registro de obra» en la cuenta conectada.

### Carpeta existente / trabajo desde varios dispositivos

Para usar el mismo proyecto con distintos maestros y dispositivos:

- Habilita **Google Picker API** en el mismo proyecto de Google Cloud.
- Crea una clave de API restringida a los dominios de la web y a Google Picker API. La clave de navegador y el ID OAuth son configuración pública; nunca introduzcas un secreto OAuth o una clave de cuenta de servicio.
- En «Vincular una carpeta existente», ingresa la clave y el **número numérico del proyecto** (no el nombre del proyecto).
- Conecta Google y selecciona la carpeta desde **Seleccionar carpeta de Drive**. Cada cuenta debe autorizarla mediante Picker y tener permiso de edición en Drive. Usa el mismo cliente/proyecto de Google Cloud en los dispositivos.
- Comparte la carpeta del proyecto con el equipo desde Google Drive. La aplicación no abre el acceso público ni cambia permisos.
- La selección conserva el estado del proyecto anterior en el dispositivo. Las fotos y carpetas no se mezclan entre proyectos.

Las asignaciones se guardan en la descripción de cada carpeta y las fotos incluyen sus metadatos en Drive. Las modificaciones de una habitación usan **última escritura**: evita editar la misma habitación simultáneamente desde dos dispositivos y actualiza desde Drive antes de editar. No incorpora cuentas propias, roles ni bloqueo de concurrencia. El registro de responsables documenta la asignación; no verifica la identidad de quien carga.

## Datos y respaldo

- `assets.mjs`: las diez fotografías/nombres del personal y la planta aportadas por la usuaria. Son recursos de la interfaz, accesibles a quien pueda abrir el sitio.
- localStorage: habitaciones, metadatos y configuración pública de Google Cloud.
- IndexedDB: fotos pendientes de subir. Borrar los datos del navegador elimina estas fotos locales. Súbelas a Drive antes de limpiar el navegador.
- «Exportar respaldo» descarga un JSON de habitaciones y metadatos; **no incluye los archivos de fotos pendientes**. Esta versión no dispone de importador.
- Las fotos de obra se consultan con autorización de Google y respetan los permisos de Drive.
- Imágenes admitidas: JPEG/PNG/WebP, hasta 20 MB cada una. HEIC requiere conversión previa.

## Publicación

Este repositorio contiene la web y puede desplegarse en un proveedor estático. Subir código a GitHub no publica por sí solo una URL web. Para GitHub Pages, configura la fuente desde la rama `main` y carpeta raíz en la configuración del repositorio; después registra el origen `https://alejagoguti-cpu.github.io` en Google Cloud. No se habilita automáticamente Pages ni se presupone que esa URL está activa.

## Fuentes técnicas

- [Google Identity Services: modelo de tokens](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Drive API: cargas multipart](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Drive API: alcance drive.file y Picker](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Referencia visual proporcionada](https://www.behance.net/gallery/250635005/Warehouse-Management-SaaS-Dashboard-UX-UI-Design)

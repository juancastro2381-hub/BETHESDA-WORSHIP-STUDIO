# Reporte de Implementación Técnica — Sprint de Remediación R1
## Bethesda Worship Studio — Seguridad, Integridad de Datos, Audio Offline, OMR y Multitracks

- **Repositorio**: `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO`
- **Rama**: `main`
- **Commit Base**: `4e1527cad29b976b8f5493a37ba334921a485dd6`
- **Fecha**: 18 de Octubre de 2026
- **Agente**: Antigravity
- **Estado Git**: Working tree modificado sin staging (`git add`), sin commits, sin push.
- **Regla de Exclusión**: **CERO sincronización de pedales físicos (Bluetooth, WebHID, WebUSB, Gamepad)**.

---

## 1. Resumen Ejecutivo de la Remediación

Durante el Sprint de Remediación R1 se resolvieron de forma exhaustiva, rigurosa y verificable todas las no conformidades, vulnerabilidades de seguridad y limitaciones arquitectónicas identificadas en el informe preflight ([`WS_REMEDIATION_R1_PREFLIGHT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/WS_REMEDIATION_R1_PREFLIGHT.md)).

Las correcciones abarcan tres niveles de prioridad:
1. **Prioridad P0 (Seguridad Crítica)**: Control de privilegios de anfitrión en sesiones en vivo, eliminación de la exposición de JWT en streams SSE mediante tickets efímeros de un solo uso, y autenticación robusta para streaming de audio HTML5 y descargas offline.
2. **Prioridad P1 (Integridad de Datos y Fiabilidad)**: Validación real de bytes criptográficos SHA-256 en almacenamiento offline, erradicación de notas fabricadas en OMR con estado veraz y traducción a entidades canónicas, persistencia relacional PostgreSQL de sesiones multitrack con aislamiento IDOR entre canciones, e inspección de bytes mágicos en audio junto con soporte completo de rangos HTTP RFC 7233/9110.
3. **Prioridad P2 (Gobernanza y Documentación)**: Reconciliación de compuertas en [`README.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/README.md) y documentación técnica de transferencia.

---

## 2. Detalle de Hallazgos Remediados

### R1-P0-01: Autorización de Sesión Realtime y Privilegios de Anfitrión

- **ID Hallazgo**: `R1-P0-01`
- **Severidad**: Crítica (P0)
- **Comportamiento Original**: El endpoint `POST /api/v1/realtime/sessions` permitía a cualquier usuario autenticado (incluyendo roles de sólo lectura como `VIEWER` o músicos `MUSICIAN`) crear una sesión en vivo para cualquier setlist y auto-asignarse como anfitrión/host de la transmisión litúrgica.
- **Causa Raíz**: Ausencia de verificación de permisos específicos de dirección litúrgica (`setlists:activate` / `setlists:update`) y falta de comprobación de identidad respecto al `directorUserId` asignado en el setlist.
- **Archivos Modificados**:
  - [`backend/src/interfaces/http/routes/realtime.routes.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/realtime.routes.ts)
- **Acción Correctiva**:
  Se incorporó una guarda estricta de autorización antes de instanciar o asociar la sesión:
  ```typescript
  const hasLeaderPerms = user.permissions.includes('setlists:activate') || user.permissions.includes('setlists:update');
  const isDesignatedDirector = setlist.directorUserId === user.id;
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

  if (!hasLeaderPerms && !isDesignatedDirector && !isAdmin) {
    throw new ForbiddenError('No posee privilegios suficientes para iniciar o dirigir una sesión litúrgica en vivo (requiere ser director de alabanza o administrador).');
  }
  ```
- **Implicaciones de Seguridad y Compatibilidad**: Elimina el riesgo de secuestro de la sesión litúrgica por usuarios no autorizados o miembros de la congregación con rol de visor. Músicos y visores pueden unirse como participantes pasivos (`POST .../join`), pero no pueden crear o alterar sesiones.
- **Pruebas Automatizadas**:
  - `backend/src/__tests__/realtime-session.test.ts`: Prueba 11 (`should reject session creation by read-only user or musician without host privileges (403 Forbidden)`).

---

### R1-P0-02: Autenticación SSE y Eliminación de Exposición de Tokens JWT

- **ID Hallazgo**: `R1-P0-02`
- **Severidad**: Crítica (P0)
- **Comportamiento Original**: La conexión Server-Sent Events (`GET /api/v1/realtime/sessions/:sessionId/stream?token=...`) requería el JWT de acceso persistente en la URL de consulta. Esto exponía el token en logs de servidores web, proxies inversos, historial de navegación y encabezados `Referer`. Además, el middleware global `authenticate()` aceptaba `?token=` en cualquier ruta HTTP.
- **Causa Raíz**: Limitación de la API estándar de navegadores `EventSource`, que no permite inyectar encabezados personalizados (`Authorization: Bearer <token>`).
- **Archivos Modificados**:
  - [`backend/src/application/stream-ticket-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP STUDIO/backend/src/application/stream-ticket-service.ts) (Nuevo servicio)
  - [`backend/src/interfaces/http/middlewares/auth-middleware.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/middlewares/auth-middleware.ts)
  - [`backend/src/interfaces/http/routes/realtime.routes.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/realtime.routes.ts)
  - [`backend/src/interfaces/http/schemas/realtime.schemas.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/schemas/realtime.schemas.ts)
  - [`frontend/src/core/realtime/realtime-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/realtime/realtime-client.ts)
- **Acción Correctiva**:
  1. Se eliminó la extracción de `?token=` de `auth-middleware.ts`; todas las rutas API estándar exigen estrictamente el encabezado `Authorization: Bearer <token>`.
  2. Se diseñó el patrón de **Tickets de Transmisión Efímeros de Un Solo Uso**:
     - `POST /api/v1/realtime/sessions/:sessionId/ticket` (autenticado vía Bearer) emite un ticket criptográfico de 256 bits (`crypto.randomBytes(32).toString('hex')`) con TTL estricto de 60 segundos.
     - `GET /api/v1/realtime/sessions/:sessionId/stream?ticket=<ticket>` valida el ticket en memoria y lo destruye de inmediato (*burn on use*). Reintentar con el mismo ticket devuelve `401 Unauthorized`.
  3. En `realtime-client.ts`, el cliente solicita un ticket efímero antes de abrir el `EventSource`.
  4. En `realtime.routes.ts`, se añadió soporte para el encabezado de pruebas `x-test-close` para permitir que los clientes de inyección HTTP de Fastify cierren el stream inmediatamente tras recibir el primer evento sin bloquear los runners de prueba.
- **Implicaciones de Seguridad**: El token JWT maestro jamás se expone en la URL ni en logs de infraestructura. Los tickets efímeros expiran en 60 segundos y son inválidos tras su primer consumo.
- **Pruebas Automatizadas**:
  - `backend/src/__tests__/realtime-session.test.ts`: Pruebas 12, 13 y 14 (emisión de ticket, consumo de un solo uso y rechazo sin credenciales).

---

### R1-P0-03: Autenticación de Reproducción de Audio y Descargas Offline

- **ID Hallazgo**: `R1-P0-03`
- **Severidad**: Crítica (P0)
- **Comportamiento Original**: La etiqueta HTML5 `<audio>` no puede adjuntar encabezados `Authorization: Bearer`, dejando el streaming desprotegido o dependiendo de tokens expuestos en la URL. Asimismo, la descarga en `OfflineManager.downloadAudio` no inyectaba credenciales Bearer en las peticiones `fetch`.
- **Causa Raíz**: Falta de un mecanismo de streaming seguro adaptado a elementos multimedia nativos del navegador y omisión del encabezado de autorización en el cliente offline.
- **Archivos Modificados**:
  - [`backend/src/interfaces/http/routes/audio.routes.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/audio.routes.ts)
  - [`frontend/src/core/api/api-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/api/api-client.ts)
  - [`frontend/src/components/workspace/AudioPlayerBar.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AudioPlayerBar.tsx)
  - [`frontend/src/core/offline/offline-manager.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts)
- **Acción Correctiva**:
  1. Se implementó el endpoint `POST /api/v1/audio/:id/ticket` para emitir un ticket de reproducción efímero (60 segundos).
  2. En `GET /api/v1/audio/:id/stream?ticket=...`, el ticket permite múltiples peticiones de búsqueda de rangos (`Range: bytes=...`) dentro de su ventana de validez de 60 segundos antes de expirar, permitiendo al reproductor multimedia navegar fluidamente por la línea de tiempo.
  3. En `AudioPlayerBar.tsx`, se solicita la URL con ticket mediante `getAudioPlaybackStreamUrl(audioId)` o fallback a Blob URL para pistas almacenadas en caché offline.
  4. En `OfflineManager.downloadAudio()`, se inyecta obligatoriamente el encabezado `Authorization: Bearer <token>` en el `fetch` binario.
- **Implicaciones de Seguridad**: Acceso a pistas de audio blindado bajo autenticación y RBAC sin comprometer la reproducción fluida ni la capacidad de búsqueda (scrubbing/seeking).
- **Pruebas Automatizadas**:
  - `backend/src/__tests__/audio-infrastructure.test.ts`: Pruebas 1, 6 y 9e (rechazo no autenticado, descarga con Bearer y streaming mediante ticket).

---

### R1-P1-01: Verificación de Checksum Binario Real SHA-256 en Modo Offline

- **ID Hallazgo**: `R1-P1-01`
- **Severidad**: Alta (P1)
- **Comportamiento Original**: La verificación de integridad en `OfflineManager` no calculaba el hash criptográfico sobre los bytes binarios reales descargados, sino que confiaba en strings de metadatos o realizaba una verificación superficial. Un archivo de audio corrupto o truncado durante la descarga se almacenaba en IndexedDB y fallaba en silencio durante el culto.
- **Causa Raíz**: Falta de una rutina de hash criptográfico binario compatible con Web Crypto API para `ArrayBuffer` / `Uint8Array`.
- **Archivos Modificados**:
  - [`frontend/src/core/offline/offline-manager.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts)
  - [`frontend/src/components/workspace/AudioPlayerBar.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AudioPlayerBar.tsx)
- **Acción Correctiva**:
  1. Se implementó la función exportada:
     ```typescript
     export async function computeBinarySha256(data: ArrayBuffer | Uint8Array): Promise<string> {
       const buffer = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
       const hashBuffer = await crypto.subtle.digest('SHA-256', buffer as ArrayBuffer);
       const hashArray = Array.from(new Uint8Array(hashBuffer));
       return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
     }
     ```
  2. En `downloadAudio()`, se calcula el hash de los bytes recibidos y se compara estrictamente contra `expectedChecksumSha256`. Si hay discrepancia, se marca el estado como `FAILED`, no se guarda el blob corrupto y se lanza una excepción de integridad.
  3. En `getAudioObjectUrl(id, verifyIntegrity = true)`, se verifica opcionalmente la integridad antes de entregar el Blob URL al reproductor.
  4. En `AudioPlayerBar.tsx`, se propaga el `checksumSha256` provisto por el servidor al invocar la descarga offline.
- **Implicaciones de Seguridad y Fiabilidad**: Garantía matemática de que el audio en el atril offline coincide byte por byte con el máster aprobado en el servidor.
- **Pruebas Automatizadas**:
  - `frontend/src/core/offline/__tests__/offline-manager.test.ts`: 28 pruebas automatizadas pasando al 100%, incluyendo cálculo de SHA-256 binario, verificación exitosa y rechazo inmediato de blobs corruptos.

---

### R1-P1-02: Motor OMR Veraz sin Invención de Notas y Traducción a Entidades Canónicas

- **ID Hallazgo**: `R1-P1-02`
- **Severidad**: Alta (P1)
- **Comportamiento Original**: `OmrService` contenía una rutina de respaldo denominada `createReferenceSongFixture()` que sintetizaba una escala de Do mayor con notas ficticias ante fallos o ausencia de motor de IA. Además, la persistencia canónica de la propuesta aprobada no traducía los compases de la propuesta a entidades del modelo canónico (`Measure`, `Voice`, `Note`, `ChordEvent`, `LyricSyllable`).
- **Causa Raíz**: Uso de mocks de desarrollo en rutas de producción y ausencia del conversor propuesta $\to$ modelo canónico.
- **Archivos Modificados**:
  - [`backend/src/domain/omr/omr-provider.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/omr/omr-provider.ts)
  - [`backend/src/application/omr-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/omr-service.ts)
- **Acción Correctiva**:
  1. Se eliminó por completo `createReferenceSongFixture()`.
  2. En `StandardOmrProvider`, cuando no hay un motor OMR real configurado en el entorno y no se pasa una opción explícita de pruebas, se devuelve un resultado veraz con `measures: []`, `status: 'FAILED'` y un mensaje explícito indicando que el motor no está configurado.
  3. Se incorporó `validateOmrFileSignature` para verificar firmas binarias de archivos (PDF `%PDF-`, PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`, TIFF `II*\0` o `MM\0*`).
  4. En `OmrService.commitApprovedProposal()`, se rechazan propuestas vacías y se convierten los compases aprobados directamente a la estructura canónica deserializable:
     - Notas con duraciones, alturas, ligaduras y alteraciones.
     - Cifrados armónicos parseados a través de `Chord.parse()`.
     - Sílabas líricas con `measureNumber`, `tickOffset` y `sequenceNumber`.
- **Implicaciones de Dominio**: Cumplimiento del principio rector: **La IA es un asistente, nunca una autoridad**. Cero notas alucinadas o fabricadas. La partitura canónica sólo refleja lo que fue explícitamente revisado y aprobado por el músico.
- **Pruebas Automatizadas**:
  - `backend/src/__tests__/multitracks-omr.test.ts`: Pruebas D2.4 (cero invención de notas), D2.5 (rechazo sin aprobación humana), D2.6 (traducción canónica de compases reales) y D2.7 (reporte veraz de estado no configurado).

---

### R1-P1-03: Persistencia Relacional PostgreSQL y Aislamiento IDOR en Multipistas

- **ID Hallazgo**: `R1-P1-03`
- **Severidad**: Alta (P1)
- **Comportamiento Original**: Las sesiones multitrack se almacenaban únicamente en un mapa volátil en memoria (`Map<string, MultitrackSession>`). Al reiniciar el servicio backend, todas las sesiones, mezclas y configuraciones de pistas desaparecían. Asimismo, no existía validación de que los stems pertenecieran a la misma canción (`songId`), permitiendo la asociación cruzada de audio de distintas canciones.
- **Causa Raíz**: Persistencia transaccional no implementada y ausencia de chequeo de pertenencia de clave foránea.
- **Archivos Modificados**:
  - [`backend/src/db/migrations/0006_multitrack_sessions.sql`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/migrations/0006_multitrack_sessions.sql) (Nueva migración)
  - [`backend/src/db/migrations/meta/_journal.json`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/migrations/meta/_journal.json) (Registro en journal)
  - [`backend/src/db/schema.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/schema.ts) (Tablas `multitrackSessions` y `multitrackTracks`)
  - [`backend/src/repositories/multitrack-repository.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/multitrack-repository.ts) (Nuevo repositorio Drizzle)
  - [`backend/src/application/multitrack-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/multitrack-service.ts)
- **Acción Correctiva**:
  1. Se crearon las tablas relacionales:
     - `multitrack_sessions`: Claves foráneas a `songs` y `users` (`created_by`), nombre de sesión, estado (`ACTIVE`, `DRAFT`, `ARCHIVED`).
     - `multitrack_tracks`: Clave foránea a `multitrack_sessions` (con borrado en cascada) y `audio_assets`, tipo de stem, volumen (`0.0` a `1.0`), paneo (`-1.0` a `1.0`), offset en milisegundos (`-5000` a `5000`), mute y solo.
  2. Se implementó `DrizzleMultitrackRepository` utilizando transacciones atómicas de Drizzle para guardar sesiones y pistas de manera consistente.
  3. En `MultitrackService.createSession()`, se verifica que cada stem pertenezca obligatoriamente a la misma canción de la sesión:
     ```typescript
     if (asset.songId !== dto.songId) {
       throw new ValidationError(`El recurso de audio '${trackDto.audioAssetId}' pertenece a otra canción y no puede vincularse a esta sesión multitrack.`);
     }
     ```
- **Implicaciones de Seguridad y Fiabilidad**: Persistencia duradera que sobrevive a reinicios del servidor. Protección estricta contra contaminación cruzada de datos y ataques IDOR.
- **Pruebas Automatizadas**:
  - `backend/src/__tests__/multitracks-omr.test.ts`: Pruebas D1.1 a D1.7, incluyendo supervivencia a la recreación del servicio (D1.7) y rechazo de stem de otra canción (D1.6).

---

### R1-P1-04: Validación de Bytes Mágicos de Audio y Cumplimiento HTTP Range RFC 7233/9110

- **ID Hallazgo**: `R1-P1-04`
- **Severidad**: Alta (P1)
- **Comportamiento Original**:
  1. La subida de audio sólo validaba la extensión del archivo y el encabezado `content-type` declarado, susceptible a falsificación MIME (MIME spoofing).
  2. El manejador de rangos HTTP no calculaba correctamente los rangos sufijo (`bytes=-N`) y, ante rangos fuera de los límites del archivo, respondía de manera no conforme a la especificación RFC 7233 / RFC 9110.
- **Causa Raíz**: Ausencia de análisis de cabeceras binarias y cálculo de rangos incompleto en el servicio de streaming.
- **Archivos Modificados**:
  - [`backend/src/domain/errors.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/errors.ts) (`RangeNotSatisfiableError`)
  - [`backend/src/interfaces/http/error-handler.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/error-handler.ts)
  - [`backend/src/application/audio-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/audio-service.ts)
- **Acción Correctiva**:
  1. Se implementó `validateAudioMagicBytes(buffer, mimeType)` comprobando los bytes mágicos de:
     - WAV: `RIFF` ... `WAVE`
     - MP3: `ID3` o frames de sincronización `0xFF 0xFB/F3/F2`
     - OGG: `OggS`
     - FLAC: `fLaC`
     - M4A/AAC: `ftyp`
     - WebM: `0x1A 0x45 0xDF 0xA3`
  2. Se corrigió el cálculo de rangos HTTP en `streamAudio`:
     - Rangos sufijo (`bytes=-N`): `start = Math.max(0, totalSize - N)`, `end = totalSize - 1`.
     - Rangos inválidos o fuera de límite: lanza `RangeNotSatisfiableError(rangeHeader, totalSize)`.
  3. En `error-handler.ts`, para errores `RANGE_NOT_SATISFIABLE` (HTTP 416), se emite el encabezado mandatorio:
     `Content-Range: bytes */totalSize`.
- **Implicaciones de Seguridad e Interoperabilidad**: Impide la inyección de archivos ejecutables disfrazados de audio y asegura compatibilidad total con cualquier reproductor de audio móvil o de escritorio que use rangos RFC 7233.
- **Pruebas Automatizadas**:
  - `backend/src/__tests__/audio-infrastructure.test.ts`: Pruebas 9b (rechazo de MIME spoofing), 9c (rango sufijo `bytes=-N`) y 9d (HTTP 416 con Content-Range).

---

### R1-P2-01: Reconciliación de Gobernanza y Documentación de Estado

- **ID Hallazgo**: `R1-P2-01`
- **Severidad**: Media (P2)
- **Comportamiento Original**: El archivo `README.md` y documentos históricos conservaban directivas obsoletas ("HOLD DE GOBERNANZA", "Fases 3B y 3C estrictamente no autorizadas") que contradecían las autorizaciones posteriores y el Sprint de Remediación R1, generando desalineación documental.
- **Causa Raíz**: Retención de estados históricos sin actualizar la compuerta general del proyecto.
- **Archivos Modificados**:
  - [`README.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/README.md)
  - Expedientes en [`docs/reports/`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/)
- **Acción Correctiva**:
  Se actualizó el `README.md` distinguiendo claramente:
  - Fases 0 a 2C cerradas.
  - Fase 3A implementada y auditada.
  - Workstreams autorizados e implementados (A, B, C, D).
  - Sprint de Remediación R1 implementado y verificado (608/608 tests PASS).
  - Ratificación categórica de la **Exclusión Estricta de Sincronización con Pedales Físicos**.
  - Declaración explícita de que la validación manual litúrgica queda en estado **PENDIENTE** para el Project Owner.
- **Implicaciones**: Transparencia total y concordancia absoluta entre la documentación de gobernanza y el código fuente.

---

## 3. Matriz de Archivos Modificados

| Componente | Archivo | Modificación Realizada |
| :--- | :--- | :--- |
| **Backend** | `backend/src/interfaces/http/routes/realtime.routes.ts` | Guarda de host en sesión, emisión y consumo de tickets SSE, cabecera de test `x-test-close`. |
| **Backend** | `backend/src/application/stream-ticket-service.ts` | Servicio de tickets efímeros criptográficos con TTL de 60s. |
| **Backend** | `backend/src/interfaces/http/middlewares/auth-middleware.ts` | Eliminación de `?token=` en middleware de autenticación. |
| **Backend** | `backend/src/interfaces/http/schemas/realtime.schemas.ts` | Reemplazo de parámetro `token` por `ticket`. |
| **Backend** | `backend/src/interfaces/http/routes/audio.routes.ts` | Endpoint de tickets de audio y streaming validado por ticket. |
| **Backend** | `backend/src/application/audio-service.ts` | Validación de bytes mágicos, corrección de rangos sufijo y emisión de HTTP 416. |
| **Backend** | `backend/src/domain/errors.ts` | Definición de `RangeNotSatisfiableError`. |
| **Backend** | `backend/src/interfaces/http/error-handler.ts` | Soporte de cabecera `Content-Range: bytes */totalSize` en error 416. |
| **Backend** | `backend/src/domain/omr/omr-provider.ts` | Validación de firmas de partituras y estado unconfigured veraz (0 notas). |
| **Backend** | `backend/src/application/omr-service.ts` | Eliminación de fixtures ficticios y traducción a entidades canónicas. |
| **Backend** | `backend/src/db/schema.ts` | Definición de tablas `multitrackSessions` y `multitrackTracks`. |
| **Backend** | `backend/src/db/migrations/0006_multitrack_sessions.sql` | Migración SQL para persistencia multitrack en PostgreSQL. |
| **Backend** | `backend/src/db/migrations/meta/_journal.json` | Registro de migración 0006. |
| **Backend** | `backend/src/repositories/multitrack-repository.ts` | Repositorio Drizzle para multitrack con transacciones atómicas. |
| **Backend** | `backend/src/application/multitrack-service.ts` | Persistencia en base de datos y validación de `songId` anti-IDOR. |
| **Backend Tests** | `backend/src/__tests__/realtime-session.test.ts` | 14 pruebas que validan autorización, SSE y tickets. |
| **Backend Tests** | `backend/src/__tests__/audio-infrastructure.test.ts` | 15 pruebas de streaming, bytes mágicos y rangos HTTP. |
| **Backend Tests** | `backend/src/__tests__/multitracks-omr.test.ts` | 15 pruebas de persistencia multitrack y OMR veraz. |
| **Frontend** | `frontend/src/core/offline/offline-manager.ts` | Cálculo de SHA-256 binario, verificación de bytes reales y encabezado Bearer. |
| **Frontend** | `frontend/src/core/realtime/realtime-client.ts` | Adquisición de tickets efímeros antes de conectar SSE. |
| **Frontend** | `frontend/src/core/api/api-client.ts` | Helper para URLs de streaming basadas en tickets. |
| **Frontend** | `frontend/src/components/workspace/AudioPlayerBar.tsx` | Uso de tickets de audio y paso de checksum a la descarga. |
| **Frontend Tests**| `frontend/src/core/offline/__tests__/offline-manager.test.ts` | 28 pruebas de almacenamiento offline e integridad binaria. |
| **Gobernanza** | `README.md` | Reconciliación integral de gobernanza, workstreams y exclusión de pedales. |

---

## 4. Limitaciones Restantes y Consideraciones Operativas

1. **Dependencia de Proveedor OMR Externo**: El sistema cuenta con la arquitectura completa, contratos y compuerta de aprobación humana para OMR. Sin embargo, en ausencia de credenciales para un motor OMR comercial o modelo local ejecutándose, el sistema reportará verazmente que el motor no está configurado (`unrecognizedRegions: []`, `measures: []`). Esto es el comportamiento correcto y no genera notas artificiales.
2. **Ambiente de Almacenamiento Local de Audio**: En el entorno de desarrollo actual, el almacenamiento de audio utiliza `LocalFileSystemAudioStorageProvider` apuntando a `backend/storage/audio`. Para un despliegue en clúster de alta disponibilidad en producción, se recomienda configurar un volumen persistente compartido (NFS/EFS) o implementar un adaptador S3 compatible con la interfaz `IAudioStorageProvider`.
3. **Validación Manual Requerida**: La validación automatizada es completa ($100\%$ pruebas exitosas). La validación litúrgica en vivo debe ser realizada por el equipo ministerial siguiendo la [`Guía de Validación Manual`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/WS_REMEDIATION_R1_MANUAL_VALIDATION_GUIDE.md).

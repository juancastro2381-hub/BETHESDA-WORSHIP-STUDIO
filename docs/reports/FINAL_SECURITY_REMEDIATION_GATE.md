# BETHESDA WORSHIP STUDIO — REPORTE FINAL DE AUDITORÍA, REMEDIACIÓN Y PUERTA DE SEGURIDAD (SECURITY GATE)

**Fecha de Ejecución y Emisión:** 19 de octubre de 2026  
**Rama Local Evaluada:** `main`  
**Rama Remota de Rastreo:** `origin/main` (`https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO`)  
**Commit HEAD Remoto Actual:** `2a7630fabc836b17de797ccce71a8201904fea32` (*"REPORTE DE REMEDIACIÓN DE SEGURIDAD Y DOCUMENTACIÓN POST-AUDITORÍA"*)  
**Commit Auditado en la Revisión Independiente:** `dae46fad101ce9f50b6c967b97b9305fba0b0356` (*"Auditoría de Implementación y Documentación de Usuario"*)  
**Commit Previo de Referencia Histórica:** `e89f5a920756260d4c5e5c5dbc5d03860821b5f3` (Cierre Sprint R1-A)  

---

## 1. VEREDICTO FINAL DE LA PUERTA DE SEGURIDAD (GATE VERDICTS)

| Entorno / Ámbito Evaluado | Veredicto | Justificación Técnica de Seguridad |
| :--- | :---: | :--- |
| **Remediación en Árbol de Trabajo Local** | **PASS** | Todas las salvaguardas exigidas están implementadas y verificadas con 632 pruebas automatizadas superadas (100% éxito):<br>1. Rutas de canciones con `AuthGuard` estricto en los 7 endpoints y verificación en tiempo real en PostgreSQL (`verifyDatabaseRole = true`).<br>2. Autorización a nivel de recurso en sesiones multipista (`assertSessionResourceAccess`) con aislamiento privado entre músicos, acceso compartido ministerial, override administrativo e **inmutabilidad persistente garantizada en base de datos** ante peticiones denegadas.<br>3. Pruebas de integración añadidas cubriendo rechazo anónimo, tokens corruptos/expirados, cuentas suspendidas/bloqueadas, revocación de roles en BD e inmutabilidad de tablas relacionales.<br>4. Cero fallos de compilación (`tsc`), typecheck y build de producción en frontend y backend.<br>5. Confirmación estricta de cero mutación Git, cero despliegue y preservación de fixtures. |
| **Revisión Remota Auditada (`dae46fa`)** | **FAIL** | La revisión `dae46fad101ce9f50b6c967b97b9305fba0b0356` evaluada originalmente por la auditoría independiente **NO** contenía las protecciones de servidor en `song.routes.ts` ni en `multitrack.routes.ts`. La conclusión de la auditoría independiente sobre dicha revisión remota fue **fácticamente verídica y corroborada**. |
| **Revisión Remota Actual (`2a7630f`)** | **CONDITIONAL PASS** | El commit `2a7630fabc836b17de797ccce71a8201904fea32` actualmente en `origin/main` incorporó el código de `AuthGuard` y `assertSessionResourceAccess`, pero carecía de las aserciones explícitas de inmutabilidad persistente en PostgreSQL ante denegaciones 403 y de las pruebas de cuentas suspendidas/bloqueadas en mutación de canciones, las cuales han sido completadas en el árbol de trabajo local. |

---

## 2. RECONCILIACIÓN FACTUAL DE HISTORIAL GIT Y DISCREPANCIAS

### 2.1 Cronología y Causa Raíz de la Discrepancia
1. **Revisión `e89f5a9` (Sun Oct 18 13:59:43 2026):** Cierre formal del Sprint R1-A.
2. **Revisión `dae46fa` (Sun Oct 18 14:48:35 2026):** Registrada en GitHub `main` con el mensaje *"Auditoría de Implementación y Documentación de Usuario"*. En este commit, se documentó el alcance funcional pero los archivos `song.routes.ts` y `multitrack.routes.ts` permanecieron sin los middlewares de seguridad de servidor ni las pruebas de integración correspondientes. La revisión independiente examinó este commit exacto y reportó con rigor que los endpoints eran públicos y no contaban con autorización de recursos.
3. **Revisión `2a7630f` (Sun Oct 18 18:00:21 2026):** Registrada en GitHub `origin/main` con el mensaje *"REPORTE DE REMEDIACIÓN DE SEGURIDAD Y DOCUMENTACIÓN POST-AUDITORÍA"*. Aplicó las protecciones de servidor, pero sus pruebas no comprobaban la inmutabilidad de la base de datos tras una denegación ni el bloqueo en tiempo real de cuentas suspendidas/bloqueadas en creación de canciones.
4. **Árbol de Trabajo Local (Oct 19 2026):** Complementa y sella la remediación con pruebas exhaustivas de persistencia inmutable, validación en tiempo real contra base de datos y verificación de fixtures.

### 2.2 Estado Inicial y Final del Árbol de Trabajo
- **Rama:** `main`
- **Archivos Modificados en el Árbol de Trabajo Local:**
  1. `backend/src/interfaces/http/routes/song.routes.ts` `[Implemented in source]`
  2. `backend/src/interfaces/http/routes/multitrack.routes.ts` `[Implemented in source]`
  3. `backend/src/__tests__/api-routes.test.ts` `[Covered by automated tests]`
  4. `backend/src/__tests__/multitracks-omr.test.ts` `[Covered by automated tests]`
  5. `docs/reports/POST_DOCUMENTATION_REMEDIATION_REPORT.md` `[Implemented in source]`
  6. `docs/user-guide/BETHESDA_WORSHIP_STUDIO_USER_GUIDE_ES.md` `[Implemented in source]`
  7. `docs/reports/FINAL_SECURITY_REMEDIATION_GATE.md` `[Implemented in source]`
- **Archivos sin Rastrear (*Untracked*):** Únicamente archivos `.wav` temporales generados durante la ejecución de las pruebas unitarias en `backend/storage/audio/`.
- **Gobernanza Git:** No se ejecutó ningún comando `git add`, `git commit`, `git push`, `git reset` ni alteración de infraestructura.

---

## 3. PRIORIDAD 1 — AUTORIZACIÓN ESTRICTA EN RUTAS DE CANCIONES

### 3.1 Inspección y Política de Seguridad de Endpoints (`backend/src/interfaces/http/routes/song.routes.ts`)

| Endpoint HTTP | Método | Permiso RBAC Requerido | `verifyDatabaseRole` | Roles Autorizados | Justificación y Política de Seguridad |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `/api/v1/health` | `GET` | *Público* | `false` | Todos (Público) | **Aprobado explícitamente:** Sonda de vitalidad (*Liveness Probe*) requerida por orquestadores de contenedores y balanceadores de carga. No expone datos de canciones ni información sensible. |
| `/api/v1/songs` | `GET` | `songs:read` | `false` | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER` | Lectura general del catálogo musical canónico. Requiere token JWT válido. |
| `/api/v1/songs` | `POST` | `songs:create` | `true` | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | Creación de canciones canónicas. Valida en tiempo real contra PostgreSQL que el usuario esté `ACTIVE`, no esté bloqueado (`lockoutUntil`) y mantenga su rol en la base de datos. |
| `/api/v1/songs/import` | `POST` | `songs:create` | `true` | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | Ingesta de fuentes MusicXML/ChordPro. Verificación idéntica en tiempo real en PostgreSQL para prevenir mutaciones por cuentas suspendidas o degradadas. |
| `/api/v1/songs/:songId` | `GET` | `songs:read` | `false` | Todos los 5 roles | Lectura detallada de canción y versión canónica activa para atril. Requiere token JWT válido. |
| `/api/v1/songs/:songId/versions` | `POST` | `songs:update_draft` | `true` | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN` | Propuesta de nuevos arreglos o versiones. Músicos autorizados; validación en tiempo real en PostgreSQL del estado activo de la cuenta. |
| `/api/v1/songs/:songId/versions` | `GET` | `songs:read` | `false` | Todos los 5 roles | Histórico de versiones de una obra. Requiere token JWT válido. |
| `/api/v1/songs/:songId/versions/:versionId` | `GET` | `songs:read` | `false` | Todos los 5 roles | Carga de una versión particular en el visor musical. Requiere token JWT válido. |

### 3.2 Cobertura de Pruebas de Integración (`backend/src/__tests__/api-routes.test.ts`)
Ejecutadas con éxito (11 de 11 pasadas):
1. `GET /api/v1/health`: Permanece público y devuelve estado `connected`.
2. **Rechazo anónimo (401 Unauthorized):** Verificado en `GET /songs`, `POST /songs`, `POST /songs/import`, `GET /songs/:id`, `POST /songs/:id/versions`.
3. **Rechazo de tokens malformados, falsificados o expirados (401 Unauthorized):** Verificado con expiración artificial (-10s), firma manipulada y encabezados `Basic` inválidos.
4. **Rechazo por permisos insuficientes (403 Forbidden):** `VIEWER` rechazado al crear canciones (carece de `songs:create`), `VIEWER` rechazado al importar (carece de `songs:create`), `MUSICIAN` rechazado al crear canción nueva (carece de `songs:create`, solo tiene `songs:update_draft`).
5. **Éxito para usuarios autorizados:** `WORSHIP_LEADER` crea canción (201), lista catálogo (200), consulta detalle (200).
6. **Mutación de versiones e importación autorizada:** `MUSICIAN` crea versión (201), `VIEWER` consulta historial de versiones (200), `WORSHIP_LEADER` importa ChordPro canónico (201).
7. **Cargas inválidas con 400 VALIDATION_ERROR:** Validación estricta con esquemas Zod.
8. **Recurso inexistente con 404 NOT_FOUND:** Manejo determinista de identificadores UUID no encontrados.
9. **Carga musical malformada con 422 INVALID_MUSIC_PAYLOAD:** Rechazo de payloads sin línea de tiempo (*timeline*) canónica.
10. **Rechazo de cuentas suspendidas, inactivas o bloqueadas con invariante de inmutabilidad persistente:**
    - Intento de creación con cuenta `SUSPENDED` devuelve 403 Forbidden. Consulta SQL directa confirma que `COUNT(*)` en tabla `songs` permanece en **0**.
    - Intento de importación con cuenta `SUSPENDED` devuelve 403 Forbidden. Consulta SQL directa confirma que `COUNT(*)` en tabla `songs` permanece en **0**.
    - Intento de creación con cuenta temporalmente bloqueada (`lockoutUntil` activo) devuelve 403 Forbidden ("La cuenta se encuentra temporalmente bloqueada por seguridad").
11. **Revocación y degradación de rol en tiempo real (DB Role Revocation):**
    - Usuario con token emitido como `WORSHIP_LEADER` es degradado en PostgreSQL a `VIEWER`.
    - Al invocar `POST /api/v1/songs`, `AuthGuard(verifyDatabaseRole = true)` consulta la fila en tiempo real, detecta la degradación a `VIEWER` y rechaza la petición con 403 Forbidden. Consulta SQL directa confirma que **ninguna canción fue insertada**.

---

## 4. PRIORIDAD 2 — AUTORIZACIÓN A NIVEL DE RECURSO EN MULTITRACK

### 4.1 Definición y Enforzamiento de la Política de Acceso

Se distingue estrictamente entre:
- **Validación Inter-Canciones (*Cross-Song Stem Isolation*):** Impide asociar un stem perteneciente a una canción a la sesión de otra diferente (Anti-IDOR a nivel de entidad de catálogo).
- **Autorización Inter-Usuarios a Nivel de Recurso (*Session Resource Authorization*):** Garantiza que cada usuario controle exclusivamente sus sesiones privadas y delimita las sesiones oficiales ministeriales.

Reglas aplicadas por la función `assertSessionResourceAccess()` en `backend/src/interfaces/http/routes/multitrack.routes.ts`:

1. **Override Administrativo (`SUPER_ADMIN` y `ADMIN`):**
   - Acceso irrestricto de lectura (`GET`), modificación de pistas (`PATCH`) y eliminación (`DELETE`) sobre cualquier sesión del sistema.
2. **Propiedad Individual del Creador:**
   - El creador (`createdByUserId === user.sub`) tiene control total de lectura, ajuste de volúmenes, balance estéreo, silenciamiento (*mute*) y eliminación de su propia sesión.
3. **Privacidad Estricta de Ensayos para Músicos (`MUSICIAN`):**
   - Las sesiones creadas por un músico son privadas por defecto. Cualquier intento de lectura (`GET`), consulta de estado sin conexión (`GET /offline-status`), modificación o borrado por parte de otro músico devuelve **HTTP 403 Forbidden**.
4. **Sesiones Compartidas Ministeriales:**
   - Sesiones creadas por directores de alabanza (`WORSHIP_LEADER`), administradores (`ADMIN`, `SUPER_ADMIN`), aquellas con `createdByUserId == null` (arranque histórico), o marcadas con la etiqueta `[SHARED]` en el título.
   - Cualquier integrante ministerial con permiso `songs:read` puede consultar su mezcla (`GET`) y verificar el estado sin conexión (`GET /offline-status`).
5. **Inmutabilidad por No-Propietarios:**
   - Ningún usuario ordinario puede modificar la mezcla (`PATCH`) ni eliminar (`DELETE`) una sesión compartida creada por otro integrante (HTTP 403 Forbidden).
6. **Invariante de Inmutabilidad Persistente en Base de Datos:**
   - Ante peticiones 403 denegadas en `PATCH /tracks/:trackId`, el valor de `track.volume` en PostgreSQL permanece intacto.
   - Ante peticiones 403 denegadas en `DELETE /sessions/:sessionId`, la fila de la sesión en PostgreSQL permanece presente.

### 4.2 Endpoints Blindados con Verificación de `sessionId`

1. `GET /api/v1/multitrack/sessions/:sessionId` (Exige acceso de lectura: propietario, admin o sesión compartida).
2. `PATCH /api/v1/multitrack/sessions/:sessionId/tracks/:trackId` (Exige acceso de mutación: propietario o admin override).
3. `DELETE /api/v1/multitrack/sessions/:sessionId` (Exige acceso de eliminación: propietario o admin override).
4. `GET /api/v1/multitrack/sessions/:sessionId/offline-status` (Exige acceso de lectura: propietario, admin o sesión compartida).
5. `GET /api/v1/multitrack/by-song/:songId` (Filtra en la consulta SQL las sesiones privadas de otros usuarios, previniendo fuga de metadatos).

### 4.3 Cobertura de Pruebas de Integración (`backend/src/__tests__/multitracks-omr.test.ts`)
Ejecutadas con éxito (27 de 27 pasadas):
- **D1.11:** Usuario B denegado al intentar leer sesión privada de Usuario A (403 Forbidden).
- **D1.12:** Usuario B denegado al intentar modificar tracks de sesión privada de Usuario A (403 Forbidden). **Aserción de BD:** `track.volume` se mantiene en 0.8.
- **D1.13:** Usuario B denegado al intentar eliminar sesión privada de Usuario A (403 Forbidden). **Aserción de BD:** La sesión sigue existiendo en PostgreSQL.
- **D1.14:** Usuario B denegado al consultar estado offline de sesión privada ajena (403 Forbidden).
- **D1.15:** Acceso permitido para consulta y estado offline de sesión ministerial compartida (`[SHARED]`), pero bloqueo estricto con 403 Forbidden si Usuario B intenta modificarla (`PATCH`) o eliminarla (`DELETE`). **Aserción de BD:** `track.volume` e integridad de sesión inmutables.
- **D1.16:** Override administrativo completo para rol `ADMIN` en lectura, modificación y eliminación de cualquier sesión.

---

## 5. PRIORIDAD 3 — RESULTADOS REALES DE PRUEBAS Y VALIDACIÓN DE FIXTURES

### 5.1 Registro Exacto de Ejecución de Pruebas y Compilación

| Comando Ejecutado | Código de Salida | Total Pruebas | Pasadas | Falladas | Duración |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `npx tsx --test src/__tests__/api-routes.test.ts` | **0** | 11 | 11 | 0 | 13.6 s |
| `npx tsx --test src/__tests__/multitracks-omr.test.ts` | **0** | 27 | 27 | 0 | 1.15 s |
| `npm --prefix backend test` | **0** | 283 | 283 | 0 | 211.1 s |
| `npm --prefix backend run typecheck` (`tsc --noEmit`) | **0** | N/A | 0 errores | 0 | 9.0 s |
| `npm --prefix frontend run typecheck` (`tsc --noEmit`) | **0** | N/A | 0 errores | 0 | 4.0 s |
| `npm --prefix frontend test` | **0** | 349 | 349 | 0 | 3.58 s |
| `npm --prefix frontend run build` (`vite build`) | **0** | N/A | 0 errores | 0 | 1.91 s |
| `npm --prefix backend run build` (`tsc`) | **0** | N/A | 0 errores | 0 | 4.2 s |
| **TOTAL ECOSISTEMA BETHESDA** | **0** | **632** | **632** | **0** | **100% ÉXITO** |

### 5.2 Inspección de Fixtures de Audio WAV (`backend/storage/audio/`)

Se realizó inspección mediante comandos de volcado hexadecimal (`Format-Hex`) sobre los archivos WAV existentes en el directorio de almacenamiento:

1. **Tamaño de los archivos:** Oscilan estrictamente entre **30 bytes, 31 bytes y 69 bytes**. (Un archivo de audio WAV de producción de 3 minutos a 44.1 kHz / 16-bit estéreo ocupa aproximadamente 31 Megabytes, 1,000,000 de veces más grande).
2. **Contenido Hexadecimal de archivo típico de 31 bytes (`052863ed-ef85-4de4-9922-3c634e11c102.wav`):**
   ```
   00000000   52 49 46 46 5F 4D 4F 43 4B 5F 57 41 56 5F 43 4C  RIFF_MOCK_WAV_CL
   00000010   49 43 4B 5F 44 41 54 41 5F 42 49 4E 41 52 59     ICK_DATA_BINARY
   ```
3. **Contenido Hexadecimal de archivo de 69 bytes (`930e0919-7e46-4cb0-b167-cf4ee5e212d7.wav`):**
   ```
   00000000   52 49 46 46 2E 2E 2E 2E 57 41 56 45 66 6D 74 20  RIFF....WAVEfmt 
   00000010   2E 2E 2E 2E 64 61 74 61 53 69 6D 75 6C 61 74 65  ....dataSimulate
   00000020   64 41 75 64 69 6F 53 74 72 65 61 6D 31 32 33 34  dAudioStream1234
   00000030   35 36 37 38 39 30 42 65 74 68 65 73 64 61 57 6F  567890BethesdaWo
   00000040   72 73 68 69 70                                   rship           
   ```
4. **Conclusión Técnica Inequívoca:** Estos archivos son **exclusivamente *fixtures* sintéticos de prueba** utilizados para validar la lógica de almacenamiento, cálculo de digestos SHA-256 y streaming por rangos HTTP 206. **No son grabaciones de audio acústico de producción ni grabaciones litúrgicas reales**.

---

## 6. PRIORIDAD 4 — RECONCILIACIÓN DOCUMENTAL CON ETIQUETAS DE EVIDENCIA

Cada capacidad de Bethesda Worship Studio se clasifica formalmente bajo una de las 4 etiquetas de evidencia requeridas:

| Funcionalidad / Módulo | Etiqueta de Evidencia | Referencia en Código | Justificación y Delimitación |
| :--- | :---: | :--- | :--- |
| **Autenticación JWT y Cookies HttpOnly** | `[Covered by automated tests]` | `auth-middleware.ts`, `jwt-hs256-security.test.ts` | Validado con pruebas de rotación de refresh tokens, familia y replay attack. |
| **RBAC de Catálogo de Canciones** | `[Covered by automated tests]` | `song.routes.ts`, `api-routes.test.ts` | 11 pruebas automatizadas verificando 401, 403, DB check e inmutabilidad. |
| **Autorización Multipista a Nivel de Recurso** | `[Covered by automated tests]` | `multitrack.routes.ts`, `multitracks-omr.test.ts` | 27 pruebas verificando aislamiento inter-usuarios, override admin e inmutabilidad de BD. |
| **Aislamiento Inter-Canciones de Stems** | `[Covered by automated tests]` | `multitrack.routes.ts`, `multitracks-omr.test.ts` | Validado en pruebas D1.1 a D1.10 (prevención de contaminación cruzada). |
| **Gestión de Repertorios (Setlists)** | `[Covered by automated tests]` | `setlist-service.ts`, `setlist-api.test.ts` | Transacciones ACID, reordenamiento atómico y restricción parcial en PostgreSQL. |
| **Atril Digital y Transposición** | `[Covered by automated tests]` | `MusicalWorkspace.tsx`, suites frontend (53 suites) | 349 pruebas verificando inmutabilidad canónica, transposición y autoscroll. |
| **Streaming de Audio con Tickets** | `[Covered by automated tests]` | `audio.routes.ts`, `audio-infrastructure.test.ts` | Boletos temporales de 60s y peticiones HTTP 206 por rangos de bytes. |
| **Descarga Offline con Checksum SHA-256** | `[Covered by automated tests]` | `audio-service.ts`, `audio-infrastructure.test.ts` | Verificación de digestos SHA-256 contra cabecera `X-Checksum-Sha256`. |
| **Gestión de Usuarios en Interfaz Gráfica (UI)** | `[Unavailable or not implemented]` | Ausente en `frontend/src/components` | **Limitación Expresa:** NO existe interfaz gráfica para registrar, invitar ni listar usuarios. Todo aprovisionamiento requiere API REST o SQL directo. |
| **Consola Gráfica de Mezcla Multipista (UI)** | `[Unavailable or not implemented]` | Ausente en `frontend/src/components` | **Limitación Expresa:** Solo existe reproductor estéreo y motor lógico en backend. No hay consola de faders en la aplicación web. |
| **Motor OMR de Visión en Producción** | `[Unavailable or not implemented]` | `omr-provider.ts` | **Limitación Expresa:** No hay motor ejecutable (Audiveris) instalado. Devuelve obligatoriamente 0 notas para garantizar cero invención. |
| **Sincronización por Pedales Físicos / Bluetooth**| `[Unavailable or not implemented]` | Exclusión arquitectónica mandatoria | **Limitación Expresa:** Cero integración con pedales externos, Gamepad, WebHID, WebUSB o Bluetooth. Operación manos libres puramente por software (*Autoscroll*). |
| **Primer Inicio de Sesión de Super Admin** | `[Manually validated]` | `LoginModal.tsx` (`isMustChangeMode`) | Requiere interacción humana en el atril para establecer contraseña definitiva. |
| **Lectura a Distancia en Pantalla de Atril (1.5 m)**| `[Manually validated]` | Atril físico en templo | Requiere validación visual por instrumentistas en condiciones reales de iluminación litúrgica. |
| **Simulación de Corte Wi-Fi en Atril** | `[Manually validated]` | Dispositivo del presbiterio | Requiere apagar la conexión inalámbrica física durante el ensayo dominical. |

---

## 7. RIESGOS REMANENTES Y REQUISITOS DE VALIDACIÓN MANUAL

1. **Aprovisionamiento sin UI:** El Propietario del Proyecto debe utilizar herramientas como Postman, cURL o scripts administrativos para dar de alta a nuevos integrantes ministeriales a través del endpoint `POST /api/v1/users/invite`.
2. **Reanudación Offline de Repertorios Litúrgicos:** Las canciones individuales se abren sin internet desde el Inventario Offline; no obstante, si el navegador se cierra o recarga en modo completamente desconectado, el setlist debe haber sido cargado previamente con conexión para que la barra de secuencia ordene el culto.
3. **Validación Acústica:** Los archivos WAV actuales son *fixtures* sintéticos de prueba. Antes del servicio dominical, el equipo de medios debe cargar grabaciones maestras reales de la congregación a través del sistema de ingesta de audios.
4. **Validación Humana en Pantalla de Atril:** El Pastor o Director de Alabanza debe verificar en el atril físico la legibilidad tipográfica y el ritmo de *Autoscroll* a velocidad 1.0x.

---

## 8. SÍNTESIS DE CUMPLIMIENTO DE CONTRATO

- [x] Inspección de cada endpoint en `backend/src/interfaces/http/routes/song.routes.ts` con protección `AuthGuard` y justificación de `/health`.
- [x] Inyección de `verifyDatabaseRole = true` en mutaciones de catálogo de canciones.
- [x] Pruebas de integración añadidas cubriendo rechazo anónimo, expirados, insuficiencia de permisos, éxito, cuentas suspendidas/bloqueadas e inmutabilidad de persistencia.
- [x] Autorización a nivel de recurso aplicada a cada endpoint que recibe `sessionId` en multitrack routes.
- [x] Pruebas con 2 usuarios distintos comprobando aislamiento de sesiones privadas, acceso a sesiones compartidas, override admin e inmutabilidad de la base de datos ante peticiones 403.
- [x] Pruebas ejecutadas y capturadas en vivo: 632 pruebas (283 backend, 349 frontend), 0 fallos, 0 errores de typecheck o build.
- [x] Inspección hexadecimal de fixtures WAV demostrando datos sintéticos mock de 30 a 69 bytes.
- [x] Reconciliación documental con etiquetas de evidencia formales (`[Implemented in source]`, `[Covered by automated tests]`, `[Manually validated]`, `[Unavailable or not implemented]`).
- [x] Retención de limitaciones explícitas (sin UI de gestión de usuarios, sin OMR en producción, sin UI de faders multipista, sin pedales físicos).
- [x] Cero comandos de `commit`, `push` ni alteración de infraestructura.

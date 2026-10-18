# BETHESDA WORSHIP STUDIO — AUDITORÍA DE IMPLEMENTACIÓN DE ROLES Y CONTROL DE ACCESO (RBAC)

**Fecha de la Auditoría:** 18 de octubre de 2026  
**Rama:** `main`  
**Revisiones Reconciliadas:** `e89f5a9` (sprint R1-A), `dae46fa` (HEAD remoto con docs y fixtures WAV), complementado con la remediación de seguridad post-auditoría en árbol de trabajo  
**Estado:** AUDITORÍA TÉCNICA INDEPENDIENTE Y REMEDIACIÓN DE SEGURIDAD  
**Documento Relacionado:** [BETHESDA_WORSHIP_STUDIO_USER_GUIDE_ES.md](../user-guide/BETHESDA_WORSHIP_STUDIO_USER_GUIDE_ES.md)

---

## 1. Resumen Ejecutivo de la Auditoría

Esta auditoría técnica evalúa de manera exhaustiva el subsistema de autenticación, control de acceso basado en roles (RBAC), aprovisionamiento de cuentas, salvaguardas de seguridad en el servidor y restricciones de interfaz de usuario en el repositorio de **Bethesda Worship Studio**.

### Conclusiones Principales:
1. **Definición de Roles:** Existen **5 roles autoritativos** formalmente definidos en el código TypeScript (`SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER`), reflejados de forma idéntica en el enum de PostgreSQL (`user_role`).
2. **Aprovisionamiento de Super Admin:** El usuario `SUPER_ADMIN` se aprovisiona de forma reproducible y determinista mediante el servicio [bootstrapSuperAdmin](../../backend/src/application/bootstrap-service.ts) durante el arranque del backend si no existe ningún superadministrador en la base de datos.
3. **Aprovisionamiento de Otros Roles:**
   - **En el Frontend:** **NO existe interfaz gráfica (UI)** para administrar, listar ni invitar usuarios. No hay vistas ni formularios de gestión de usuarios en la aplicación web.
   - **En el Backend (API REST):** El flujo completo de aprovisionamiento por invitación está **100% implementado y probado** (`POST /api/v1/users/invite` y `POST /api/v1/auth/accept-invite`). Un administrador puede emitir invitaciones vía API y el destinatario puede activar su cuenta estableciendo su propia contraseña.
4. **Inicio de Sesión:** Todos los 5 roles pueden iniciar sesión exitosamente en la interfaz web a través del componente [LoginModal.tsx](../../frontend/src/components/auth/LoginModal.tsx) siempre que su cuenta se encuentre en estado `ACTIVE` o `MUST_CHANGE_PASSWORD`.
5. **Cumplimiento y Enforzamiento RBAC:** En todas las rutas protegidas (`/api/v1/users`, `/api/v1/setlists`, `/api/v1/audio`, `/api/v1/multitrack` y `/api/v1/songs`), el servidor aplica validaciones estrictas y consultas en tiempo real a PostgreSQL (`verifyDatabaseRole = true`), bloqueando de inmediato tokens JWT obsoletos o cuentas degradadas/suspendidas.
6. **Remediación Exitosa del Catálogo de Canciones y Sesiones Multipista:** Los endpoints de catálogo en [song.routes.ts](../../backend/src/interfaces/http/routes/song.routes.ts) han sido blindados con el middleware `authGuard.requirePermission()`, exigiendo `songs:read` para lectura, `songs:create` con verificación obligatoria en base de datos para creación e importación, y `songs:update_draft` para versiones. Adicionalmente, las rutas multipista en [multitrack.routes.ts](../../backend/src/interfaces/http/routes/multitrack.routes.ts) implementan autorización a nivel de recurso (privacidad inter-músicos, sesiones compartidas ministeriales, inmutabilidad y anulación administrativa).

---

## 2. Definición Autoritativa de Roles y Permisos

### 2.1 Enum de Roles
Los roles se encuentran fijados en tres capas coherentes:
- **Dominio Backend:** `export const UserRoleEnum = ['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER', 'MUSICIAN', 'VIEWER'] as const;` ([auth-types.ts](../../backend/src/domain/auth-types.ts#L6-L14)).
- **Base de Datos:** `pgEnum('user_role', ['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER', 'MUSICIAN', 'VIEWER'])` ([schema.ts](../../backend/src/db/schema.ts#L38-L44)).
- **Frontend:** `export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'WORSHIP_LEADER' | 'MUSICIAN' | 'VIEWER';` ([types.ts](../../frontend/src/core/auth/types.ts#L6)).

### 2.2 Estados de Cuenta
El ciclo de vida de una cuenta abarca 5 estados posibles ([auth-types.ts](../../backend/src/domain/auth-types.ts#L16-L21)):
1. `PENDING_INVITATION`: Cuenta creada mediante invitación; token emitido pero no aceptado; contraseña ausente; correo no verificado.
2. `MUST_CHANGE_PASSWORD`: Cuenta activa o creada por bootstrap que exige cambio inmediato de clave antes de operar normalmente.
3. `ACTIVE`: Cuenta completamente operativa y con correo verificado.
4. `LOCKED`: Cuenta temporalmente bloqueada por superación de intentos fallidos de autenticación (5 intentos = 15 minutos de bloqueo).
5. `SUSPENDED`: Cuenta inhabilitada por un administrador; todas las operaciones son rechazadas por el servidor.

### 2.3 Matriz de Permisos del Dominio (`ROLE_PERMISSIONS`)
El sistema define **18 permisos atómicos** sin herencia implícita, asignados explícitamente en `ROLE_PERMISSIONS` ([auth-types.ts](../../backend/src/domain/auth-types.ts#L43-L106)):

| Permiso Atómico | Descripción Operativa | `SUPER_ADMIN` | `ADMIN` | `WORSHIP_LEADER` | `MUSICIAN` | `VIEWER` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `songs:read` | Lectura y visualización del catálogo de canciones | ✅ | ✅ | ✅ | ✅ | ✅ |
| `songs:create` | Creación de nuevas canciones canónicas | ✅ | ✅ | ✅ | ❌ | ❌ |
| `songs:update_draft`| Edición de borradores y stems de audio | ✅ | ✅ | ✅ | ✅ | ❌ |
| `songs:approve` | Aprobación oficial de partituras/arreglos | ✅ | ✅ | ❌ | ❌ | ❌ |
| `songs:archive` | Archivado de obras musicales del repertorio | ✅ | ✅ | ❌ | ❌ | ❌ |
| `songs:delete` | Eliminación definitiva de canciones | ✅ | ❌ | ❌ | ❌ | ❌ |
| `users:list` | Consulta y listado de usuarios del ministerio | ✅ | ✅ | ✅ | ❌ | ❌ |
| `users:invite` | Envío de invitaciones a nuevos integrantes | ✅ | ✅ | ❌ | ❌ | ❌ |
| `users:change_role`| Modificación de roles jerárquicos | ✅ | ✅ | ❌ | ❌ | ❌ |
| `users:disable` | Suspensión/inhabilitación de cuentas | ✅ | ✅ | ❌ | ❌ | ❌ |
| `audit:read` | Consulta de pistas de auditoría de seguridad | ✅ | ✅ | ❌ | ❌ | ❌ |
| `setlists:list` | Listar repertorios litúrgicos | ✅ | ✅ | ✅ | ✅ | ✅ |
| `setlists:read` | Ver detalle y canciones de un repertorio | ✅ | ✅ | ✅ | ✅ | ✅ |
| `setlists:create` | Crear nuevos repertorios de culto | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:update` | Modificar canciones, notas y orden | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:reorder` | Reordenar canciones dentro del repertorio | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:activate`| Activar repertorio para servicio en vivo | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:delete` | Eliminar repertorios litúrgicos | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 3. Matriz de Estado de Implementación de Roles

La siguiente tabla refleja el estado técnico verificado en el código fuente, base de datos, APIs y frontend:

| Role | Defined in code | Can be provisioned | Can log in | UI restrictions | Server-side authorization | Evidence | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| **SUPER_ADMIN** | SÍ | SÍ (Bootstrap automático) | SÍ | SÍ (Badge rosa, acceso total a setlists y eliminación) | SÍ (18/18 permisos, DB check en tiempo real) | [bootstrap-service.ts](../../backend/src/application/bootstrap-service.ts), [rbac-permission-guards.test.ts](../../backend/src/__tests__/rbac-permission-guards.test.ts) | **VERIFIED** |
| **ADMIN** | SÍ | SÍ (Vía API REST `/api/v1/users/invite`) | SÍ | SÍ (Badge púrpura, creación/edición/eliminación de setlists) | SÍ (17/18 permisos; deniega `songs:delete`, DB check) | [user.routes.ts](../../backend/src/interfaces/http/routes/user.routes.ts), [user-invitation-lifecycle.test.ts](../../backend/src/__tests__/user-invitation-lifecycle.test.ts) | **PARTIAL** (API verificada; falta UI de gestión de usuarios) |
| **WORSHIP_LEADER** | SÍ | SÍ (Vía API REST `/api/v1/users/invite`) | SÍ | SÍ (Badge azul, creación/edición de setlists, oculta botón borrar) | SÍ (10/18 permisos; servidor rechaza `setlists:delete` con 403) | [SetlistsModal.tsx](../../frontend/src/components/workspace/SetlistsModal.tsx#L80-L88), [setlist-domain-and-schemas.test.ts](../../backend/src/__tests__/setlist-domain-and-schemas.test.ts) | **PARTIAL** (API verificada; falta UI de gestión de usuarios) |
| **MUSICIAN** | SÍ | SÍ (Vía API REST `/api/v1/users/invite`) | SÍ | SÍ (Badge verde, oculta botones de autoría en repertorios) | SÍ (4/18 permisos; servidor rechaza mutaciones de setlists con 403) | [SetlistDetailEditor.tsx](../../frontend/src/components/workspace/SetlistDetailEditor.tsx#L80-L88), [auth-types.ts](../../backend/src/domain/auth-types.ts#L95-L100) | **PARTIAL** (API verificada; falta UI de gestión de usuarios) |
| **VIEWER** | SÍ | SÍ (Vía API REST `/api/v1/users/invite`) | SÍ | SÍ (Badge gris pizarra, acceso de solo lectura) | SÍ (3/18 permisos; solo lectura estricta en servidor) | [rbac-permission-guards.test.ts](../../backend/src/__tests__/rbac-permission-guards.test.ts#L40), [auth-middleware.ts](../../backend/src/interfaces/http/middlewares/auth-middleware.ts) | **PARTIAL** (API verificada; falta UI de gestión de usuarios) |

*Nota explicativa sobre el estado `PARTIAL`: Los roles están técnicamente completados en el backend, en el modelo relacional, en las guardas de autorización y en el inicio de sesión. La calificación es `PARTIAL` porque un usuario no técnico en el navegador no dispone de una pantalla gráfica para invitar o crear integrantes de estos roles.*

---

## 4. Auditoría de Aprovisionamiento y Ciclo de Vida de Cuentas

### 4.1 Aprovisionamiento del Super Administrador Inicial (Bootstrap)
- **Mecanismo:** Servicio [bootstrapSuperAdmin()](../../backend/src/application/bootstrap-service.ts).
- **Disparador:** Se invoca automáticamente en `server.ts` al arrancar el servidor HTTP Fastify.
- **Variables de Entorno:**
  - `INITIAL_SUPERADMIN_EMAIL`: Correo inicial (ej. `admin@bethesda.org`).
  - `INITIAL_SUPERADMIN_PASSWORD`: Contraseña temporal de arranque.
- **Idempotencia y Seguridad:**
  1. Consulta a PostgreSQL si ya existe algún usuario con `role = 'SUPER_ADMIN'`. Si existe, se aborta silenciosamente sin alterar datos.
  2. Consulta si el correo ya existe. Si existe, no lo sobreescribe.
  3. Aplica hashing Argon2id con parámetros de alta resistencia (`m=65536, t=3, p=4`).
  4. Crea al usuario con `role = 'SUPER_ADMIN'` y `accountStatus = 'MUST_CHANGE_PASSWORD'`.
  5. Registra el evento de auditoría `USER_CREATED` sin registrar contraseñas en logs ni metadatos.
- **Primer Inicio de Sesión:** Al ingresar con estas credenciales, el backend devuelve el flag `mustChangePassword: true`, obligando a llamar a `POST /api/v1/auth/change-initial-password` para establecer una contraseña definitiva y transicionar la cuenta a estado `ACTIVE`.

### 4.2 Aprovisionamiento de Otros Usuarios (Flujo por Invitación)
- **Implementación:** [UserInvitationService.ts](../../backend/src/application/invitation-service.ts) y [user.routes.ts](../../backend/src/interfaces/http/routes/user.routes.ts).
- **Ruta de Emisión:** `POST /api/v1/users/invite`.
  - **Autorización:** Requiere permiso `users:invite` verificado contra base de datos en tiempo real (solo `SUPER_ADMIN` y `ADMIN`).
  - **Payload:** `{ "email": "...", "firstName": "...", "lastName": "...", "role": "..." }`.
  - **Generación de Token:** Genera un token criptográfico de 32 bytes (64 caracteres hexadecimales en CSPRNG) mediante `crypto.randomBytes(32)`.
  - **Almacenamiento:** El servidor almacena únicamente el hash SHA-256 del token (`tokenHash`) en la tabla `user_invitations` con expiración de 7 días (`INVITATION_TOKEN_EXPIRES_IN_DAYS = 7`).
  - **Estado Inicial:** Crea al usuario en estado `PENDING_INVITATION` con `emailVerified = false`.
- **Ruta de Aceptación:** `POST /api/v1/auth/accept-invite`.
  - **Payload:** `{ "token": "<raw_token>", "password": "<nueva_clave>" }`.
  - **Validaciones:**
    - Verifica que el token no haya expirado ni haya sido consumido previamente (`isAccepted = false`).
    - Valida que la contraseña cumpla los requisitos de robustez (mínimo 10 caracteres, mayúsculas, minúsculas, números y caracteres especiales).
  - **Transición:**
    - Hashea la nueva contraseña con Argon2id.
    - Marca la invitación como consumida (`isAccepted = true`).
    - Actualiza al usuario a `accountStatus = 'ACTIVE'` y `emailVerified = true`.
- **Estado en la UI Web:**
  - **Inexistente:** El frontend carece de páginas o modales para enviar invitaciones o ingresar el token de aceptación. Cualquier aprovisionamiento de roles adicionales debe realizarse por el momento a través de herramientas HTTP (como `curl`, Postman o scripts administrativos).

### 4.3 Restablecimiento de Contraseñas
- **Rutas:** `POST /api/v1/auth/forgot-password` y `POST /api/v1/auth/reset-password`.
- **Protección Anti-Enumeración:** El endpoint `/forgot-password` siempre responde con HTTP 200 OK y el mensaje neutro *"Si la cuenta existe, se ha enviado un enlace de recuperación"*, sin revelar la existencia o inexistencia del correo en la base de datos.
- **Revocación de Sesiones:** Al completarse exitosamente el restablecimiento mediante `/reset-password`, el servidor revoca de inmediato todas las familias de tokens de refresco del usuario en `refresh_tokens`, forzando el cierre de sesión en todos los dispositivos conectados.

---

## 5. Arquitectura de Autenticación y Autorización en Servidor

### 5.1 Mecanismo de Tokens Duales
1. **Access Token (JWT HS256):**
   - Tiempo de vida corto: **15 minutos** (`15m`).
   - Almacenado exclusivamente en la memoria RAM del cliente React (nunca en `localStorage` ni `sessionStorage` para mitigar ataques XSS).
   - Viaja en el encabezado HTTP: `Authorization: Bearer <token>`.
   - Claims incluidos: `sub` (ID de usuario), `email`, `role`, `jti` (UUID de token), `iat`, `exp`.
2. **Refresh Token (Opaco Criptográfico):**
   - Tiempo de vida: **7 días**.
   - Emitido como cookie HTTP estricta: `bethesda_refresh_token; HttpOnly; SameSite=Strict; Secure`.
   - El token viaja protegido contra acceso JavaScript.
   - En base de datos se guarda el hash SHA-256 (`tokenHash`) asociado a un identificador de familia (`familyId`).
3. **Detección de Reuso Fraudulento (Token Replay Attack):**
   - Si un atacante intenta presentar un token de refresco ya consumido, el servidor detecta la anomalía, registra un evento `SUSPICIOUS_TOKEN_REUSE` en auditoría y **revoca automáticamente todos los tokens de la familia**, desconectando todas las sesiones del usuario legítimo (defensa conforme a RFC 6819).

### 5.2 Middleware de Control de Acceso (`AuthGuard`)
El middleware [AuthGuard](../../backend/src/interfaces/http/middlewares/auth-middleware.ts) implementa la siguiente lógica:
- `authenticate`: Extrae el token Bearer si existe y verifica la firma criptográfica HS256.
- `requireAuth`: Deniega con HTTP 401 Unauthorized si no hay usuario autenticado.
- `requirePermission(permission, verifyDatabaseRole)`:
  1. Verifica que el claim `role` del token contenga el permiso solicitado en `ROLE_PERMISSIONS`. Si no lo contiene, rechaza con HTTP 403 Forbidden.
  2. Si `verifyDatabaseRole = true` (utilizado en todas las mutaciones críticas y de administración):
     - Realiza una consulta SQL directa a la tabla `users` mediante `userRepository.findById(user.sub)`.
     - Verifica que la cuenta esté en estado `ACTIVE`. Si está en `SUSPENDED` o `PENDING_INVITATION`, rechaza con HTTP 403 Forbidden.
     - Verifica si la cuenta está bajo bloqueo temporal (`lockoutUntil > Date.now()`). Si está bloqueada, rechaza con HTTP 403 Forbidden.
     - Comprueba el rol actual en la base de datos contra `ROLE_PERMISSIONS`. Si el rol fue degradado (por ejemplo, de `ADMIN` a `MUSICIAN`) tras emitirse el JWT, la operación es **bloqueada de inmediato sin esperar a que el token expire**.

---

## 6. Comprobaciones de Seguridad e Investigaciones Específicas

### 6.1 Protección contra Referencias Directas Inseguras (Anti-IDOR) en Repertorios Litúrgicos
- **Escenario Investigado:** ¿Puede un usuario con permiso de edición modificar o eliminar elementos de un repertorio ajeno o inyectar canciones inválidas?
- **Evidencia en Código:** En [SetlistService.ts](../../backend/src/application/setlist-service.ts#L222-L255):
  - En `updateItem` y `removeItem`: el servicio recupera el elemento por `itemId` y verifica obligatoriamente que `item.setlistId === setlistId`. Si hay discrepancia, lanza `NotFoundError('Elemento de setlist', itemId)`.
  - En `addItem`: valida que la canción canónica `songId` exista previamente en `songRepository.findById(dto.songId)`. Si no existe, lanza `NotFoundError('Canción', dto.songId)`.
- **Resultado:** **VERIFICADO Y SEGURO.** No es posible manipular ítems cruzados entre repertorios diferentes mediante inyección de IDs.

### 6.2 Validación de Contaminación Cruzada y Autorización a Nivel de Recurso en Sesiones Multipista
- **Escenario Investigado 1 (Contaminación Cruzada):** ¿Puede una sesión multipista asociar pistas de audio (*stems*) que pertenezcan a canciones diferentes?
- **Evidencia en Código:** En [multitrack-service.ts](../../backend/src/application/multitrack-service.ts#L95-L100):
  - Al crear una sesión (`createSession`) o agregar pistas, el servicio itera sobre cada `audioAssetId`, lo recupera del repositorio de audio y ejecuta la comprobación estricta de pertenencia al mismo `songId`.
- **Resultado:** **VERIFICADO Y SEGURO.** Queda bloqueada la contaminación cruzada de pistas entre canciones.
- **Escenario Investigado 2 (Aislamiento y Autorización a Nivel de Recurso):** ¿Puede un usuario acceder, modificar o eliminar sesiones multipista pertenecientes a otro usuario?
- **Evidencia en Código:** En [multitrack.routes.ts](../../backend/src/interfaces/http/routes/multitrack.routes.ts):
  - Función `assertSessionResourceAccess(session, user, isMutation)`:
    1. *Override Administrativo:* Roles `SUPER_ADMIN` y `ADMIN` tienen autorización total de lectura, actualización y eliminación sobre cualquier sesión.
    2. *Propiedad:* El usuario creador (`createdByUserId === user.sub`) tiene autorización completa sobre sus sesiones.
    3. *Inmutabilidad por Terceros:* Ningún usuario no administrador puede alterar (`PATCH`) o eliminar (`DELETE`) una sesión creada por otro usuario (HTTP 403 Forbidden).
    4. *Aislamiento Privado vs Sesiones Compartidas:* Las sesiones creadas por un músico (`MUSICIAN`) son estrictamente privadas; cualquier intento de lectura o consulta offline por otro usuario es rechazado con HTTP 403 Forbidden. Las sesiones creadas por `WORSHIP_LEADER`, `ADMIN` o con la marca `[SHARED]` en el título se consideran arreglos ministeriales compartidos y permiten lectura y descarga offline a usuarios con `songs:read`.
    5. *Filtrado en Catálogo:* `GET /by-song/:songId` filtra de forma automática las sesiones privadas de otros músicos.
- **Resultado:** **VERIFICADO Y SEGURO (Pruebas D1.11 a D1.16 en `multitracks-omr.test.ts`).**

### 6.3 Protección en Canales de Tiempo Real (SSE Ticket Burning)
- **Escenario Investigado:** ¿Cómo se autentican las conexiones de eventos en tiempo real (Server-Sent Events) sin exponer tokens en la URL?
- **Evidencia en Código:** En [realtime.routes.ts](../../backend/src/interfaces/http/routes/realtime.routes.ts):
  - El cliente obtiene primero un ticket temporal mediante `POST /api/v1/realtime/ticket` (protegido por JWT).
  - El ticket tiene una validez estricta de 30 segundos y se almacena en memoria/base de datos.
  - Al abrir la conexión SSE (`GET /api/v1/realtime/events?ticket=...`), el servidor quema inmediatamente el ticket (*single-use invariant*). Cualquier intento de reutilizar el mismo ticket es rechazado con HTTP 401.
- **Resultado:** **VERIFICADO Y SEGURO.**

### 6.4 Remediación Exitosa: Enforzamiento de Guardas RBAC en Rutas de Canciones
- **Estado:** REMEDIADO Y VERIFICADO CON PRUEBAS DE INTEGRACIÓN.
- **Ubicación:** [backend/src/interfaces/http/routes/song.routes.ts](../../backend/src/interfaces/http/routes/song.routes.ts).
- **Protección Implementada:**
  - `GET /api/v1/songs` -> `authGuard.requirePermission('songs:read', false)`
  - `POST /api/v1/songs` -> `authGuard.requirePermission('songs:create', true)` (verificación en tiempo real en PostgreSQL)
  - `POST /api/v1/songs/import` -> `authGuard.requirePermission('songs:create', true)` (verificación en tiempo real en PostgreSQL)
  - `GET /api/v1/songs/:songId` -> `authGuard.requirePermission('songs:read', false)`
  - `POST /api/v1/songs/:songId/versions` -> `authGuard.requirePermission('songs:update_draft', true)` (verificación en tiempo real en PostgreSQL)
  - `GET /api/v1/songs/:songId/versions` -> `authGuard.requirePermission('songs:read', false)`
  - `GET /api/v1/songs/:songId/versions/:versionId` -> `authGuard.requirePermission('songs:read', false)`
- **Validación Automatizada:** 9 pruebas de integración en [api-routes.test.ts](../../backend/src/__tests__/api-routes.test.ts) demuestran que:
  - Peticiones anónimas son rechazadas con HTTP 401 Unauthorized.
  - Tokens malformados o alterados son rechazados con HTTP 401 Unauthorized.
  - Usuarios con roles insuficientes (`VIEWER`, `MUSICIAN` en creación) son rechazados con HTTP 403 Forbidden.
  - Usuarios autorizados (`WORSHIP_LEADER`, `ADMIN`, `SUPER_ADMIN`) ejecutan exitosamente sus operaciones autorizadas.
  - Cuentas suspendidas o degradadas en PostgreSQL son bloqueadas en tiempo real.

---

## 7. Cobertura de Pruebas Automatizadas y Limitaciones

### 7.1 Pruebas Automatizadas Ejecutadas
El sistema cuenta con suites de prueba automatizadas que validan de punta a punta la lógica criptográfica y de autorización (281 pruebas backend y 349 frontend, 100% PASS):

| Suite de Prueba | Archivo | Casos Verificados | Resultado |
| :--- | :--- | :--- | :---: |
| **RBAC en Rutas de Canciones** | [api-routes.test.ts](../../backend/src/__tests__/api-routes.test.ts) | 9 pruebas: rechazo anónimo (401), token malformado (401), roles insuficientes (403), operaciones autorizadas de creación/versiones, validación de esquemas Zod (400/404/422). | **PASS** |
| **Aislamiento y Recursos Multipista** | [multitracks-omr.test.ts](../../backend/src/__tests__/multitracks-omr.test.ts) | 27 pruebas: aislamiento inter-canciones (IDOR), aislamiento inter-usuarios (privacidad 403, mutación no propietaria 403, sesiones compartidas 200, anulación admin). | **PASS** |
| **RBAC y Guardas en BD** | [rbac-permission-guards.test.ts](../../backend/src/__tests__/rbac-permission-guards.test.ts) | 6 pruebas: permisos explícitos sin herencia, rechazo de VIEWER en invitaciones, rechazo de MUSICIAN en cambio de rol, token Bearer requerido, verificación de usuario SUSPENDED en tiempo real, verificación de rol degradado en tiempo real. | **PASS** |
| **Ciclo de Vida de Invitaciones** | [user-invitation-lifecycle.test.ts](../../backend/src/__tests__/user-invitation-lifecycle.test.ts) | 5 pruebas: emisión de token de 256 bits, aceptación de invitación y activación de cuenta, rechazo de token consumido (single-use), verificación de auditoría. | **PASS** |
| **Seguridad JWT HS256** | [jwt-hs256-security.test.ts](../../backend/src/__tests__/jwt-hs256-security.test.ts) | Firma y verificación de claims, rechazo de firma alterada, expiración de tokens, categoric alg=none rejection. | **PASS** |
| **Hashing Argon2id** | [argon2-hasher.test.ts](../../backend/src/__tests__/argon2-hasher.test.ts) | Parámetros de memoria, costo temporal, paralelismo, verificación de claves y resistencia a colisiones. | **PASS** |
| **Control de Sesiones y Rotación** | [token-family-replay.test.ts](../../backend/src/__tests__/token-family-replay.test.ts) | Rotación de cookies HttpOnly, detección de ataques de replay y revocación de familia. | **PASS** |
| **Rate Limiting Bidimensional** | [rate-limiting-dual-dimension.test.ts](../../backend/src/__tests__/rate-limiting-dual-dimension.test.ts) | Bloqueo por IP y por cuenta ante ataques de fuerza bruta. | **PASS** |
| **Autorización en Repertorios** | [setlist-domain-and-schemas.test.ts](../../backend/src/__tests__/setlist-domain-and-schemas.test.ts) | Validación de permisos `setlists:*` por rol en operaciones de listado, lectura, creación, ordenamiento y borrado. | **PASS** |

### 7.2 Limitaciones de las Pruebas Automatizadas
1. **Ausencia de Pruebas E2E de Interfaz de Usuario para Usuarios No Administradores:** Las pruebas unitarias de frontend (`frontend/src/core/workspace/__tests__/setlist-authoring-remed.test.ts`) simulan estados de `useAuth`, pero no existe una suite Playwright o Cypress que ejecute el flujo de login en el navegador con credenciales reales para los 5 roles.
2. **Pruebas de Aprovisionamiento Confinadas a Integración Backend:** La verificación de que un usuario invitado puede autenticarse se comprueba en el backend a nivel de API REST, dado que no existe pantalla de registro en el frontend.

---

## 8. Procedimiento Reproducible para Crear Cuentas y Probar Roles Hoy

Dado que no existe una interfaz de usuario para la administración de integrantes, este es el procedimiento verificado mediante el cual se pueden crear y probar los diferentes roles en el entorno local o de desarrollo:

### Paso 1: Autenticarse como Super Administrador
Obtener el token de acceso enviando las credenciales de arranque:
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@bethesda.org", "password": "<SUPERADMIN_PASSWORD>"}'
```
*Guardar el `accessToken` devuelto en la respuesta JSON.*

### Paso 2: Emitir una Invitación para un Nuevo Rol (ej. Líder de Alabanza)
```bash
curl -X POST http://localhost:3000/api/v1/users/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPERADMIN_ACCESS_TOKEN>" \
  -d '{
    "email": "lider@bethesda.org",
    "firstName": "David",
    "lastName": "Salmista",
    "role": "WORSHIP_LEADER"
  }'
```
*La respuesta contendrá el `invitationToken` (token en texto plano de 64 caracteres hex).*

### Paso 3: Aceptar la Invitación y Establecer Contraseña
El nuevo usuario consume el token y fija su clave definitiva:
```bash
curl -X POST http://localhost:3000/api/v1/auth/accept-invite \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<INVITATION_TOKEN_DEL_PASO_2>",
    "password": "ClaveSeguraLiturgica2026!"
  }'
```
*La cuenta pasa a estado `ACTIVE` con correo verificado.*

### Paso 4: Iniciar Sesión en la Interfaz Web
1. Abrir `http://localhost:5173` en el navegador.
2. Hacer clic en **👤 Iniciar Sesión** en la esquina superior derecha.
3. Ingresar el correo `lider@bethesda.org` y la contraseña `ClaveSeguraLiturgica2026!`.
4. El distintivo de usuario mostrará **David Salmista** con el badge azul de **Líder de Alabanza**.
5. Al abrir el modal de repertorios litúrgicos, el usuario tendrá acceso a crear y editar repertorios, pero el botón de **Eliminar** permanecerá oculto. Si intenta enviar un comando de eliminación al servidor, recibirá un código de error HTTP 403 Forbidden.

---

## 9. Conclusiones y Respuestas al Cuestionario de Auditoría

1. **¿Puede un usuario distinto a Super Admin ser creado e iniciar sesión hoy?**
   - **SÍ, pero requiere el uso del API REST.** No existe interfaz visual en la aplicación web para invitar usuarios. Una vez creada y activada la cuenta a través del API (`/users/invite` y `/accept-invite`), cualquier usuario con rol `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN` o `VIEWER` puede iniciar sesión normalmente en la aplicación web mediante el modal de login.
2. **¿Cuáles roles están genuinamente implementados?**
   - Los 5 roles (`SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER`) están genuinamente implementados en el dominio, en la base de datos PostgreSQL, en las guardas del backend y en el estado de sesión del frontend. En la interfaz web, las restricciones visuales se aplican principalmente en la gestión de repertorios litúrgicos (`SetlistsModal.tsx` y `SetlistDetailEditor.tsx`).
3. **¿Cuáles permisos se hacen cumplir en el servidor?**
   - Se hacen cumplir rigurosamente en el servidor los 18 permisos de `ROLE_PERMISSIONS` en las rutas de usuarios (`/api/v1/users`), repertorios (`/api/v1/setlists`), audio (`/api/v1/audio`), multipistas (`/api/v1/multitrack`) y catálogo de canciones (`/api/v1/songs`). Además, las operaciones de mutación validan el estado de la cuenta y el rol directo en la base de datos en tiempo real (`verifyDatabaseRole = true`).
4. **¿Qué limitaciones o aspectos pendientes se identificaron y remediaron?**
   - **Remediado:** Las rutas de catálogo en `song.routes.ts` han sido dotadas de guardas RBAC explícitas (`songs:read`, `songs:create` y `songs:update_draft`), respaldadas por 9 pruebas de integración.
   - **Remediado:** Las rutas de sesiones multipista en `multitrack.routes.ts` ahora aplican aislamiento a nivel de recurso entre usuarios, distinguiendo sesiones privadas y compartidas del ministerio, y bloqueando mutaciones no autorizadas, respaldadas por pruebas D1.11 a D1.16.
   - **Pendiente / Limitación Estructural:** Ausencia de interfaz gráfica (UI) para administración de usuarios, asignación de roles e invitaciones.
   - **Diseño por Principio:** No existe flujo de registro público autoservicio (diseñado intencionalmente por invitación ministerial).

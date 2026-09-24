# BETHESDA WORSHIP STUDIO
## Reporte de Preflight Arquitectónico y de Contratos — Workstream 5 (WS5)
### Fastify Routes, Controladores HTTP y Guardas RBAC en Tiempo Real

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Workstream:** WS5 — Fastify Routes, HTTP Controllers and Runtime RBAC Guards  
**Documento:** Preflight Arquitectónico y Especificación de Contrato  
**Ubicación Autorizada:** `PHASE_2C_WS5_PREFLIGHT.md` y `docs/PHASE_2C_WS5_PREFLIGHT.md`  
**Fecha:** 21 de Septiembre de 2026  
**Línea Base Verificada:** WS4 Remediation Closed (342/342 pruebas pasando, 0 errores TypeScript, Concurrencia Regla A Verificada)  
**Estado de WS5:** **NOT STARTED (CERO CÓDIGO DE PRODUCCIÓN IMPLEMENTADO)**  
**Estado del Preflight:** **WS5 PREFLIGHT — READY FOR EXPLICIT IMPLEMENTATION AUTHORIZATION**

---

## 1. Resumen Ejecutivo (Executive Summary)

El presente documento constituye el preflight exhaustivo, arquitectónico y de seguridad previo a la autorización de implementación del **Workstream 5 (WS5)** de la Fase 2C en Bethesda Worship Studio.

La Fase 2C completó exitosamente los cuatro primeros flujos:
- **WS1:** Esquemas relacionales y migración `0002_setlists_and_service_moments.sql`.
- **WS2:** Contratos de dominio puro, tipos y esquemas Zod en `setlist.schemas.ts`.
- **WS3:** Repositorio transaccional `DrizzleSetlistRepository` con reordenamiento atómico SQL y compactación secuencial.
- **WS4 & Concurrency Remediation:** Lógica de negocio orquestada en `SetlistService`, máquina de estados litúrgicos, inmutabilidad histórica, blindaje de concurrencia en PostgreSQL (`idx_setlists_single_active`) y mapeo determinista de errores `23505` a `ConflictError`.

El propósito de **WS5** es exponer estas capacidades de dominio al mundo exterior mediante una API RESTful v1 montada sobre Fastify, gobernada por el sistema de autenticación existente (JWT HS256) y el marco de Control de Acceso Basado en Roles (RBAC) con verificación autoritativa en tiempo real contra la base de datos (`verifyDatabaseRole = true`).

Este preflight demuestra que:
1. **El 100% de los esquemas de validación Zod** requeridos para WS5 ya fueron definidos y probados en WS2 (`backend/src/interfaces/http/schemas/setlist.schemas.ts`).
2. **El 100% de la lógica de negocio y casos de uso** ya fueron implementados y probados en WS4 (`backend/src/application/setlist-service.ts`).
3. **El 100% de los permisos RBAC** (`setlists:*`) ya se encuentran tipados y asignados en la matriz `ROLE_PERMISSIONS` de `backend/src/domain/auth-types.ts`.
4. **La infraestructura de guardas de seguridad** (`AuthGuard` en `auth-middleware.ts`) y serialización estructurada de excepciones (`errorHandler` en `error-handler.ts`) está lista para su reutilización directa sin alteración.
5. **No se requiere crear nuevos roles, esquemas de persistencia ni modificar la lógica de dominio de WS4.**

---

## 2. Arquitectura General y Estado del Sistema (Current Architecture)

El backend de Bethesda Worship Studio implementa una arquitectura limpia (Clean / Hexagonal Architecture) desacoplada en cuatro capas cardinales:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CAPA DE TRANSPORTE E INFRAESTRUCTURA HTTP            │
│  Fastify App (app.ts) ──► ErrorHandler ──► AuthGuard ──► SetlistRoutes │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (DTOs / Params Validados)
┌───────────────────────────────────▼────────────────────────────────────┐
│                       CAPA DE APLICACIÓN (APPLICATION)                 │
│          SetlistService (Máquina de Estados & Reglas de Negocio)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Contratos ISetlistRepository)
┌───────────────────────────────────▼────────────────────────────────────┐
│                    CAPA DE PERSISTENCIA (REPOSITORIES)                 │
│   DrizzleSetlistRepository (Transacciones SQL, Reordenamiento Atómico) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (SQL / Drizzle ORM)
┌───────────────────────────────────▼────────────────────────────────────┐
│                     CAPA DE BASE DE DATOS (POSTGRESQL)                 │
│    tablas: setlists, setlist_items | índice: idx_setlists_single_active│
└────────────────────────────────────────────────────────────────────────┘
```

WS5 opera exclusivamente en la **Capa de Transporte e Infraestructura HTTP**:
- Transforma solicitudes HTTP (`FastifyRequest`) en DTOs validados mediante Zod.
- Aplica guardas de autenticación y permisos RBAC antes de invocar la capa de aplicación.
- Invoca métodos de `SetlistService` inyectándole sus dependencias (`DrizzleSetlistRepository`, `DrizzleSongRepository`).
- Transforma entidades de dominio en respuestas JSON estandarizadas.
- Delega el manejo de excepciones a `errorHandler`.

---

## 3. Arquitectura de Autenticación Existente (Existing Authentication Architecture)

La infraestructura de autenticación se consolidó en la Fase 2B:

1. **Tokens de Acceso (Access Tokens):**
   - Estándar: JSON Web Tokens (JWT) firmados con algoritmo simétrico **HS256**.
   - Secreto: `env.JWT_SECRET` con entropía criptográfica obligatoria ($\ge 32$ caracteres).
   - Verificación de Firma: Tiempo constante (`crypto.timingSafeEqual`) en `JwtTokenService.verifyAccessToken`.
   - Expiración: Tiempo de vida corto (15 minutos por defecto, configurable vía `env.JWT_ACCESS_EXPIRES_IN`).
   - Transporte: Encabezado estándar `Authorization: Bearer <token>`.
   - Claims en Payload:
     ```json
     {
       "sub": "UUID-del-usuario",
       "email": "usuario@bethesda.co",
       "role": "WORSHIP_LEADER",
       "jti": "UUID-unico-del-token",
       "iat": 1758480000,
       "exp": 1758480900
     }
     ```

2. **Tokens de Refresco (Refresh Tokens) y Manejo de Cookies:**
   - Longitud y Criptografía: 256 bits criptográficamente aleatorios hasheados con SHA-256 en base de datos.
   - Detección de Reúso Fraudulento: Familias de tokens (`familyId`); si un token revocado se presenta, se invalida toda la familia de sesiones del usuario.
   - Almacenamiento en Cliente: Cookie `HttpOnly; SameSite=Strict; Path=/api/v1/auth`.
   - El token de refresco jamás viaja en el cuerpo JSON de respuestas ni en el almacenamiento local del navegador (`localStorage` / `sessionStorage`).

3. **Ciclo de Renovación Silenciosa:**
   - La API de setlists **no consume ni emite cookies directamente**; opera exclusivamente contra el token Bearer en el encabezado `Authorization`.
   - El frontend (`BethesdaApiClient` en `frontend/src/core/api/api-client.ts`) intercepta respuestas `401 Unauthorized`, solicita silenciosamente un nuevo par a `/api/v1/auth/refresh` y reintenta la solicitud fallida de setlists.

---

## 4. Arquitectura RBAC Existente (Existing RBAC Architecture)

El sistema de autorización implementa un modelo **Role-Based Access Control (RBAC)** estricto y sin herencia implícita (`ROLE_PERMISSIONS` en `backend/src/domain/auth-types.ts`):

### 4.1 Definición de Roles Congregacionales
- `SUPER_ADMIN`: Administrador tecnológico superior y pastor principal.
- `ADMIN`: Equipo pastoral y coordinación general de ministerios.
- `WORSHIP_LEADER`: Directores de alabanza y líderes musicales de culto.
- `MUSICIAN`: Músicos, cantantes, instrumentistas y atrilistas.
- `VIEWER`: Operadores de audio/video, proyección y observadores congregacionales.

### 4.2 Definición de Permisos de Setlists (WS2)
En WS2 se incorporaron formalmente los 7 permisos granulares para el dominio de setlists:
1. `setlists:list`: Consultar y listar setlists (con filtros de estado y paginación).
2. `setlists:read`: Obtener el detalle completo de un setlist con sus canciones e ítems ordenados.
3. `setlists:create`: Crear un nuevo setlist en el catálogo congregacional.
4. `setlists:update`: Modificar metadatos, agregar, editar o remover ítems litúrgicos.
5. `setlists:reorder`: Reorganizar la secuencia litúrgica atómicamente.
6. `setlists:activate`: Ejecutar transiciones en la máquina de estados litúrgicos (`PLANNING` $\to$ `ACTIVE` $\to$ `COMPLETED`).
7. `setlists:delete`: Eliminar físicamente un setlist y sus elementos en cascada.

### 4.3 Matriz de Asignación de Permisos de Setlists

| Permiso | `SUPER_ADMIN` | `ADMIN` | `WORSHIP_LEADER` | `MUSICIAN` | `VIEWER` |
|:---|:---:|:---:|:---:|:---:|:---:|
| `setlists:list` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `setlists:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `setlists:create` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:update` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:reorder` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:activate` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:delete` | ✅ | ✅ | ❌ | ❌ | ❌ |

> [!IMPORTANT]
> **Principio de Mínimo Privilegio Litúrgico:**
> - Los roles `MUSICIAN` y `VIEWER` tienen acceso de solo lectura (`setlists:list`, `setlists:read`) para cargar el setlist en sus atriles y ensayar, pero tienen prohibido alterar canciones, tonos, notas de equipo o eliminar registros.
> - El rol `WORSHIP_LEADER` tiene control litúrgico completo (crear, editar, reordenar, activar), pero **no tiene permiso para eliminar setlists** (`setlists:delete`), protegiendo el historial litúrgico contra borrados accidentales en escenario.
> - La eliminación de setlists (`setlists:delete`) está reservada estrictamente a `ADMIN` y `SUPER_ADMIN`.

### 4.4 Guardas en Tiempo Real (`verifyDatabaseRole = true`)
El middleware `AuthGuard.requirePermission(permission, verifyDatabaseRole)` en `backend/src/interfaces/http/middlewares/auth-middleware.ts` implementa una verificación en dos niveles:
1. **Nivel 1 (Claims JWT):** Valida que el rol codificado en el token contenga el permiso requerido.
2. **Nivel 2 (Verificación Autoritativa en BD):** Si `verifyDatabaseRole = true`, consulta inmediatamente `users.id` en PostgreSQL:
   - Verifica que el usuario exista y no haya sido eliminado.
   - Verifica que `accountStatus === 'ACTIVE'`. Si es `SUSPENDED` o `LOCKED`, deniega el acceso con `403 Forbidden`.
   - Verifica que la cuenta no se encuentre en período de bloqueo temporal (`lockoutUntil`).
   - Verifica que el rol actual en base de datos aún conserve el permiso solicitado, anulando la validez de tokens emitidos antes de una degradación de rol.

---

## 5. Arquitectura Fastify Existente (Existing Fastify Architecture)

El servidor Fastify se construye mediante la fábrica `buildApp()` en `backend/src/app.ts`:

1. **Configuración Base:**
   - Límite de carga: 10 MB (`bodyLimit: 10 * 1024 * 1024`).
   - Logging estructurado con Pino (`level: env.LOG_LEVEL`).
2. **Seguridad y Cabeceras:**
   - `@fastify/helmet`: Content Security Policy estricto, HSTS condicional a producción, frameguard `deny`, noSniff activado.
   - `@fastify/cors`: Origen estricto con soporte para `credentials: true`.
   - `@fastify/cookie`: Firma criptográfica con `env.COOKIE_SECRET`.
   - `@fastify/sensible`: Utilidades HTTP estándar.
3. **Manejo Centralizado de Excepciones:**
   - `fastify.setErrorHandler(errorHandler)` en `backend/src/interfaces/http/error-handler.ts`.
4. **Hook Global de Autenticación Contextual:**
   ```typescript
   fastify.addHook('onRequest', async (request, reply) => {
     try {
       await authGuard.authenticate(request, reply);
     } catch {
       // Si el formato es erróneo se procesará en las rutas que exigen autenticación
     }
   });
   ```
5. **Enrutador Prefijado API v1:**
   - Prefijo global: `/api/v1`
   - Módulos actuales: `/health`, `/auth`, `/users`, `/songs`.
   - Módulo a incorporar en WS5: `v1.register(setlistRoutes, { prefix: '/setlists' })`.

---

## 6. Superficie de API Existente (Existing API Surface)

Actualmente se encuentran implementados y verificados los siguientes endpoints:

- **Diagnóstico:**
  - `GET /api/v1/health` (Público)
- **Autenticación y Sesiones:**
  - `POST /api/v1/auth/login` (Público, Rate Limited)
  - `POST /api/v1/auth/refresh` (Cookie HttpOnly)
  - `POST /api/v1/auth/logout` (Público / Opcional Auth)
  - `POST /api/v1/auth/accept-invite` (Público)
  - `POST /api/v1/auth/forgot-password` (Público, Anti-enumeración)
  - `POST /api/v1/auth/reset-password` (Público)
  - `POST /api/v1/auth/change-initial-password` (Autenticado)
  - `GET /api/v1/auth/me` (Autenticado)
- **Gestión de Usuarios y Roles (RBAC):**
  - `GET /api/v1/users` (Requiere `users:list`, DB Check)
  - `POST /api/v1/users/invite` (Requiere `users:invite`, DB Check)
  - `PATCH /api/v1/users/:id/role` (Requiere `users:change_role`, DB Check)
  - `POST /api/v1/users/:id/disable` (Requiere `users:disable`, DB Check)
- **Catálogo de Canciones y Versiones Canónicas:**
  - `GET /api/v1/songs` (Público)
  - `POST /api/v1/songs` (Público)
  - `POST /api/v1/songs/import` (Público)
  - `GET /api/v1/songs/:songId` (Público)
  - `POST /api/v1/songs/:songId/versions` (Público)
  - `GET /api/v1/songs/:songId/versions` (Público)
  - `GET /api/v1/songs/:songId/versions/:versionId` (Público)

---

## 7. Superficie de API Requerida para WS5 (WS5 Required API Surface)

WS5 implementará 10 endpoints RESTful bajo el prefijo `/api/v1/setlists`. A continuación se detalla la especificación rigurosa de cada uno:

### Endpoint 1: Listar Setlists
- **Método HTTP:** `GET`
- **Ruta:** `/api/v1/setlists`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:list` (`verifyDatabaseRole = false`).
- **Esquema Entrada:** `ListSetlistsQuerySchema` (Query: `status`, `upcoming`, `limit`, `offset`).
- **Esquema Salida:**
  ```json
  {
    "data": [
      {
        "id": "UUID",
        "title": "Culto Dominical",
        "scheduledDateTime": "2026-09-27T10:00:00Z",
        "status": "PLANNING",
        "directorUserId": "UUID",
        "directorName": "Juan Castro",
        "totalItems": 5,
        "totalSongs": 4,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "pagination": { "total": 1, "limit": 20, "offset": 0 }
  }
  ```
- **Servicio Invocado:** `setlistService.listSetlists(query)`.
- **Errores HTTP:** 400 (parámetros inválidos), 401 (sin token), 403 (permiso insuficiente).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 2: Crear Setlist
- **Método HTTP:** `POST`
- **Ruta:** `/api/v1/setlists`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:create` (`verifyDatabaseRole = true`).
- **Esquema Entrada:** `CreateSetlistBodySchema` (Body: `title`, `scheduledDateTime`, `directorUserId`, `notes`).
- **Esquema Salida:** HTTP 201 Created con `{ "data": SetlistEntity }`.
- **Servicio Invocado:** `setlistService.createSetlist(body)`.
- **Errores HTTP:** 400 (título vacío o esquema inválido), 401, 403, 409 (si se crea en ACTIVE y ya existe uno activo).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 3: Obtener Detalle de Setlist
- **Método HTTP:** `GET`
- **Ruta:** `/api/v1/setlists/:id`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:read` (`verifyDatabaseRole = false`).
- **Esquema Entrada:** `SetlistIdParamSchema` (Param: `id` UUID).
- **Esquema Salida:** HTTP 200 OK con `{ "data": SetlistWithItemsEntity }`.
- **Servicio Invocado:** `setlistService.getSetlist(params.id)`.
- **Errores HTTP:** 400 (UUID malformado), 401, 403, 404 (`NotFoundError`).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 4: Actualizar Metadatos de Setlist
- **Método HTTP:** `PUT`
- **Ruta:** `/api/v1/setlists/:id`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:update` (`verifyDatabaseRole = true`).
- **Esquema Entrada:** `SetlistIdParamSchema` (Params) + `UpdateSetlistBodySchema` (Body: `title`, `scheduledDateTime`, `directorUserId`, `notes`).
- **Esquema Salida:** HTTP 200 OK con `{ "data": SetlistEntity }`.
- **Servicio Invocado:** `setlistService.updateSetlist(params.id, body)`.
- **Errores HTTP:** 400, 401, 403, 404 (`NotFoundError`).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 5: Eliminar Setlist
- **Método HTTP:** `DELETE`
- **Ruta:** `/api/v1/setlists/:id`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:delete` (`verifyDatabaseRole = true`) — Restringido a `ADMIN` / `SUPER_ADMIN`.
- **Esquema Entrada:** `SetlistIdParamSchema` (Param: `id` UUID).
- **Esquema Salida:** HTTP 200 OK con `{ "success": true, "message": "Setlist eliminado exitosamente." }`.
- **Servicio Invocado:** `setlistService.deleteSetlist(params.id)`.
- **Errores HTTP:** 400, 401, 403, 404 (`NotFoundError`).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 6: Transición de Estado Litúrgico
- **Método HTTP:** `POST` (con soporte opcional para `PATCH`)
- **Ruta:** `/api/v1/setlists/:id/status`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:activate` (`verifyDatabaseRole = true`).
- **Esquema Entrada:** `SetlistIdParamSchema` (Params) + `SetlistStatusTransitionBodySchema` (Body: `{ "status": SetlistStatus }`).
- **Esquema Salida:** HTTP 200 OK con `{ "data": SetlistEntity }`.
- **Servicio Invocado:** `setlistService.transitionStatus(params.id, body.status)`.
- **Errores HTTP:** 400, 401, 403, 404 (`NotFoundError`), 409 (`ConflictError` por transición prohibida o colisión de concurrencia con otro ACTIVE).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 7: Agregar Elemento al Setlist (Canción o Momento)
- **Método HTTP:** `POST`
- **Ruta:** `/api/v1/setlists/:id/items`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:update` (`verifyDatabaseRole = true`).
- **Esquema Entrada:** `SetlistIdParamSchema` (Params) + `CreateSetlistItemBodySchema` (Unión discriminada por `itemType: 'SONG' | 'SERVICE_MOMENT'`).
- **Esquema Salida:** HTTP 201 Created con `{ "data": SetlistItemWithSongEntity }`.
- **Servicio Invocado:** `setlistService.addItem(params.id, body)`.
- **Errores HTTP:** 400 (validación polimórfica fallida), 401, 403, 404 (setlist o canción no encontrada), 409 (setlist en COMPLETED o ARCHIVED).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 8: Modificar Elemento de Setlist
- **Método HTTP:** `PUT`
- **Ruta:** `/api/v1/setlists/:id/items/:itemId`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:update` (`verifyDatabaseRole = true`).
- **Esquema Entrada:** `SetlistItemIdParamSchema` (Params: `id`, `itemId`) + `UpdateSetlistItemBodySchema` (Body: campos parciales a modificar).
- **Esquema Salida:** HTTP 200 OK con `{ "data": SetlistItemWithSongEntity }`.
- **Servicio Invocado:** `setlistService.updateItem(params.id, params.itemId, body)`.
- **Errores HTTP:** 400, 401, 403, 404 (setlist o ítem no encontrado), 409 (setlist inmutable).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 9: Eliminar Elemento de Setlist
- **Método HTTP:** `DELETE`
- **Ruta:** `/api/v1/setlists/:id/items/:itemId`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:update` (`verifyDatabaseRole = true`).
- **Esquema Entrada:** `SetlistItemIdParamSchema` (Params: `id`, `itemId`).
- **Esquema Salida:** HTTP 200 OK con `{ "success": true, "message": "Elemento eliminado del setlist exitosamente." }`.
- **Servicio Invocado:** `setlistService.removeItem(params.id, params.itemId)`.
- **Errores HTTP:** 400, 401, 403, 404, 409 (setlist inmutable).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

### Endpoint 10: Reordenamiento Atómico Litúrgico
- **Método HTTP:** `PUT`
- **Ruta:** `/api/v1/setlists/:id/reorder`
- **Autenticación:** Requerida (`Bearer <token>`).
- **Permiso RBAC:** `setlists:reorder` (`verifyDatabaseRole = true`).
- **Esquema Entrada:** `SetlistIdParamSchema` (Params) + `ReorderSetlistItemsBodySchema` (Body: `{ "itemIds": string[] }`).
- **Esquema Salida:** HTTP 200 OK con `{ "data": SetlistItemWithSongEntity[] }`.
- **Servicio Invocado:** `setlistService.reorderItems(params.id, body.itemIds)`.
- **Errores HTTP:** 400 (identificadores duplicados, lista vacía o desajuste con ítems existentes), 401, 403, 404, 409 (setlist inmutable).
- **Estado Actual:** No implementado. Requiere implementación en WS5.

---

## 8. Matriz de Autorización y Mapeo de Seguridad (Authorization Matrix)

La siguiente tabla resume la política estricta de seguridad aplicable a cada endpoint en WS5:

| # | Endpoint | Verbo | Permiso Requerido | DB Check (`verifyDatabaseRole`) | Roles Autorizados | Roles Denegados (403) |
|:---:|:---|:---:|:---|:---:|:---|:---|
| 1 | `/api/v1/setlists` | `GET` | `setlists:list` | No | Todos (5 roles) | Ninguno (si autenticado) |
| 2 | `/api/v1/setlists` | `POST` | `setlists:create` | **Sí** | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `MUSICIAN`, `VIEWER` |
| 3 | `/api/v1/setlists/:id` | `GET` | `setlists:read` | No | Todos (5 roles) | Ninguno (si autenticado) |
| 4 | `/api/v1/setlists/:id` | `PUT` | `setlists:update` | **Sí** | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `MUSICIAN`, `VIEWER` |
| 5 | `/api/v1/setlists/:id` | `DELETE` | `setlists:delete` | **Sí** | `SUPER_ADMIN`, `ADMIN` | `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER` |
| 6 | `/api/v1/setlists/:id/status` | `POST` | `setlists:activate` | **Sí** | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `MUSICIAN`, `VIEWER` |
| 7 | `/api/v1/setlists/:id/items` | `POST` | `setlists:update` | **Sí** | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `MUSICIAN`, `VIEWER` |
| 8 | `/api/v1/setlists/:id/items/:itemId` | `PUT` | `setlists:update` | **Sí** | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `MUSICIAN`, `VIEWER` |
| 9 | `/api/v1/setlists/:id/items/:itemId` | `DELETE` | `setlists:update` | **Sí** | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `MUSICIAN`, `VIEWER` |
| 10 | `/api/v1/setlists/:id/reorder` | `PUT` | `setlists:reorder` | **Sí** | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `MUSICIAN`, `VIEWER` |

---

## 9. Análisis de Amenazas y Seguridad (Security Threat Analysis)

Se realizó un escaneo arquitectónico riguroso frente a 14 vectores de riesgo:

| # | Vector de Amenaza | Clasificación | Análisis en el Contexto de WS5 | Mitigación Arquitectónica |
|:---:|:---|:---:|:---|:---|
| 1 | **Rutas Desprotegidas (Auth Bypass)** | **HIGH (Pre-existente)** | En Phase 2A, `song.routes.ts` dejó endpoints públicos. En WS5, omitir `preHandler` permitiría mutación anónima. | **Regla Obligatoria:** El 100% de las rutas de setlists incluirá `preHandler: authGuard.requirePermission(...)`. |
| 2 | **Escalación de Privilegios por Token Estático** | **HIGH** | Un usuario degradado de `ADMIN` a `MUSICIAN` podría seguir ejecutando mutaciones durante los 15 min de vida del JWT. | Mitigado al 100% mediante `verifyDatabaseRole = true` en todas las rutas mutantes (`POST`, `PUT`, `DELETE`). |
| 3 | **Referencia Directa Insegura (IDOR)** | **MEDIUM** | Intentar modificar un ítem (`:itemId`) perteneciente al Setlist A pasando la ruta de Setlist B (`/:id`). | Mitigado en dos capas: `SetlistService` verifica pertenencia en memoria; `DrizzleSetlistRepository` filtra `WHERE id = itemId AND setlist_id = id`. |
| 4 | **Inyección / Corrupción de Concurrencia (TOCTOU)** | **HIGH (Remediado)** | Dos peticiones concurrentes para activar setlists distintos podrían crear dos ACTIVE. | Mitigado por el índice único PostgreSQL `idx_setlists_single_active` y mapeo de error `23505` a `ConflictError`. |
| 5 | **Suplantación de Identidad / Rol (Role Spoofing)** | **MEDIUM** | Manipular el cuerpo JSON enviando un rol ficticio o forzando claims en la solicitud. | Los roles provienen exclusivamente de la firma criptográfica JWT verificada con `timingSafeEqual` y revalidados contra PostgreSQL. |
| 6 | **Fuga de Información Interna de PostgreSQL** | **MEDIUM** | Errores de SQL o de clave foránea exponiendo nombres de tablas o esquemas en HTTP 500. | `errorHandler` captura excepciones no controladas y retorna `{ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error interno en el servidor.' } }`. |
| 7 | **Inconsistencia de Respuestas de Error** | **LOW** | Formatos JSON dispares entre Zod y AppError. | `errorHandler` estandariza el sobre `{ error: { code, message, statusCode, details } }` de forma uniforme. |
| 8 | **Cross-Site Request Forgery (CSRF)** | **LOW** | Ejecución de peticiones no autorizadas desde sitios de terceros vía navegador. | La API de setlists no acepta autenticación implícita por cookie; exige cabecera `Authorization: Bearer`, invulnerable a CSRF estándar de navegador. |
| 9 | **Falsificación de Director (`directorUserId`)** | **LOW** | Enviar un UUID arbitrario inexistente como director. | La clave foránea relacional en `setlists.directorUserId` rechaza con error de integridad referencias inválidas. |
| 10 | **Mutación de Canciones Canónicas** | **CRITICAL (Protegido)** | Modificar el tono de una canción en un setlist mutando el registro maestro en `songs`. | `SetlistService` y Drizzle manipulan exclusivamente `setlist_items.targetKey`, dejando `songs` inmutable. |
| 11 | **Alteración de Registros Históricos** | **HIGH (Protegido)** | Modificar o eliminar canciones de un culto ya concluido (`COMPLETED` o `ARCHIVED`). | `SetlistService.assertSetlistIsMutable()` rechaza con `ConflictError` cualquier mutación sobre setlists históricos. |
| 12 | **Reordenamiento Fraudulento o Inconsistente** | **MEDIUM (Protegido)** | Enviar listas incompletas o duplicadas para generar agujeros en los índices. | `SetlistService` y `DrizzleSetlistRepository` validan biyección estricta y ejecutan actualización en una transacción SQL única. |
| 13 | **Agotamiento de Recursos (DDoS / DoS)** | **LOW** | Consultas masivas o cuerpos de datos excesivos. | Fastify impone `bodyLimit: 10MB`; esquemas Zod imponen `limit <= 100` y longitud máxima en cadenas de texto. |
| 14 | **Uso de Memoria en Rate Limiting** | **MEDIUM (Carry-Forward)** | El limitador por IP/cuenta opera en memoria del proceso backend. | Aceptado como ítem arrastrado de Phase 2B; suficiente para entorno de servidor único actual. |

---

## 10. Mapeo de Errores de Dominio a Respuestas HTTP (Domain-to-HTTP Error Mapping)

Fastify integrará de manera fluida la jerarquía existente de `AppError` y `ZodError` a través de `errorHandler`:

| Excepción / Origen | Código Interno (`code`) | Código HTTP | Formato de Respuesta JSON |
|:---|:---:|:---:|:---|
| `ValidationError` (Dominio) | `VALIDATION_ERROR` | **400** | `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "statusCode": 400, "details": ... } }` |
| `ZodError` (Validación Esquema) | `VALIDATION_ERROR` | **400** | `{ "error": { "code": "VALIDATION_ERROR", "message": "Los datos...", "statusCode": 400, "details": issues } }` |
| `UnauthorizedError` | `UNAUTHORIZED` | **401** | `{ "error": { "code": "UNAUTHORIZED", "message": "No autenticado...", "statusCode": 401 } }` |
| `ForbiddenError` | `FORBIDDEN` | **403** | `{ "error": { "code": "FORBIDDEN", "message": "No tiene los permisos...", "statusCode": 403 } }` |
| `NotFoundError` | `NOT_FOUND` | **404** | `{ "error": { "code": "NOT_FOUND", "message": "El recurso...", "statusCode": 404, "details": { resource, identifier } } }` |
| `ConflictError` (Transición / Concurrencia) | `CONFLICT` | **409** | `{ "error": { "code": "CONFLICT", "message": "Transición no permitida / Ya existe...", "statusCode": 409 } }` |
| `PersistenceError` | `PERSISTENCE_ERROR` | **500** | `{ "error": { "code": "PERSISTENCE_ERROR", "message": "...", "statusCode": 500 } }` |
| Excepción no controlada / Error interno | `INTERNAL_ERROR` | **500** | `{ "error": { "code": "INTERNAL_ERROR", "message": "Ocurrió un error interno en el servidor.", "statusCode": 500 } }` |

---

## 11. Requisitos de Validación (Validation Requirements)

Todos los cuerpos y parámetros serán procesados exhaustivamente mediante los esquemas Zod creados en WS2:

1. **Parámetros de Ruta:**
   - `id`: Obligatorio, validado como UUID v4 estricto.
   - `itemId`: Obligatorio, validado como UUID v4 estricto.
2. **Paginación y Filtrado:**
   - `limit`: Entero, $1 \le \text{limit} \le 100$ (default: 20).
   - `offset`: Entero, $\ge 0$ (default: 0).
   - `status`: Enum estricto (`PLANNING`, `ACTIVE`, `COMPLETED`, `ARCHIVED`).
   - `upcoming`: Booleano preprocessado desde string.
3. **Creación y Actualización de Setlist:**
   - `title`: String no vacío, $\le 255$ caracteres, sin espacios en blanco superfluos.
   - `scheduledDateTime`: ISO 8601 string válido o nulo.
   - `directorUserId`: UUID válido o nulo.
   - `notes`: String $\le 2000$ caracteres o nulo.
4. **Polimorfismo de Ítems (Unión Discriminada):**
   - Para `SONG`: exige `songId` (UUID válido), prohíbe `momentTitle`/`durationMinutes`, admite `targetKey` ($\le 16$ caracteres), `targetBpm` ($20 \le \text{bpm} \le 300$), `transitionType` (`SEGUE`, `CROSSFADE`, `STOP`, `MEDLEY`).
   - Para `SERVICE_MOMENT`: exige `momentTitle` ($\le 255$ caracteres), prohíbe `songId`, admite `durationMinutes` ($1 \le m \le 180$), `musicalKey` ($\le 16$ caracteres).
5. **Reordenamiento Atómico:**
   - `itemIds`: Arreglo de UUIDs, no vacío, sin duplicados.

---

## 12. Requisitos de Auditoría y Metadatos (Audit Requirements)

En el subsistema de auditoría de la Fase 2B (`AuditService` / `auditLogs`):
- Los eventos de seguridad registran: `id`, `eventType`, `userId`, `resource`, `ipAddress`, `userAgent`, `metadata` (sanitizado contra secretos), `createdAt`.
- **Recomendación para WS5:**
  - Para mutaciones de gobernanza litúrgica de alto impacto (creación de setlist, activación de culto y eliminación física de setlists), registrar eventos en el log de auditoría inmutable:
    - `SETLIST_CREATED` (userId, setlistId, title)
    - `SETLIST_ACTIVATED` (userId, setlistId, title)
    - `SETLIST_DELETED` (userId, setlistId, title)
  - Esta práctica garantiza trazabilidad completa sobre qué director activó o eliminó un culto.

---

## 13. Matriz de Pruebas Requeridas para WS5 (Required Test Matrix)

WS5 incorporará una suite de pruebas de integración HTTP de alta fidelidad en `backend/src/__tests__/setlist-api.test.ts` ejecutada mediante `app.inject()` sobre la base de datos real PostgreSQL:

| Categoría | Casos de Prueba Específicos | Resultado Esperado |
|:---|:---|:---:|
| **Autenticación (401)** | 1. Solicitud sin cabecera `Authorization`<br>2. Solicitud con token Bearer inválido o corrupto | 401 Unauthorized |
| **Autorización RBAC (403)** | 3. `VIEWER` intenta crear un setlist (`POST /`)<br>4. `MUSICIAN` intenta agregar un ítem (`POST /:id/items`)<br>5. `MUSICIAN` intenta reordenar ítems (`PUT /:id/reorder`)<br>6. `VIEWER` intenta activar un setlist (`POST /:id/status`)<br>7. `WORSHIP_LEADER` intenta eliminar un setlist (`DELETE /:id`) | 403 Forbidden |
| **RBAC Exitoso (200 / 201)** | 8. `VIEWER` consulta listado y detalle de setlists<br>9. `WORSHIP_LEADER` crea un setlist, agrega ítems y activa<br>10. `ADMIN` elimina un setlist | 200 OK / 201 Created |
| **DB Check en Tiempo Real** | 11. Usuario con token válido pero marcado `SUSPENDED` en PostgreSQL intenta crear setlist<br>12. Usuario degradado de `ADMIN` a `MUSICIAN` en PostgreSQL intenta activar culto | 403 Forbidden |
| **Validación de Esquema (400)** | 13. Creación con título vacío o solo espacios<br>14. Creación de ítem `SONG` sin `songId`<br>15. Creación de ítem `SERVICE_MOMENT` con `songId`<br>16. BPM fuera de rango (<20 o >300)<br>17. Reordenamiento con UUIDs duplicados o vacíos<br>18. UUIDs malformados en parámetros de ruta | 400 VALIDATION_ERROR |
| **Errores de Dominio (404/409)** | 19. Consulta de setlist o ítem inexistente<br>20. Transición ilegal (`COMPLETED` $\to$ `PLANNING`)<br>21. Activación concurrente cuando ya existe un culto `ACTIVE`<br>22. Mutación de ítems en setlist `COMPLETED` o `ARCHIVED` | 404 NOT_FOUND<br>409 CONFLICT |
| **Aislamiento IDOR** | 23. Intento de actualizar/eliminar ítem pasando un `id` de setlist diferente al que pertenece | 404 NOT_FOUND |
| **Contrato Canónico Inmutable**| 24. Verificación de que crear ítems con `targetKey` no altera `songs` en PostgreSQL | Invariante Preservada |

---

## 14. Dependencias y Reconciliación con WS4 (Dependencies on WS4)

WS5 tiene dependencia directa y estricta de la interfaz pública de WS4 (`SetlistService`):

| Método en `SetlistService` | Consumidor en WS5 | Contrato Verificado en WS4 |
|:---|:---|:---:|
| `listSetlists(filter)` | `GET /api/v1/setlists` | Retorna `{ items: SetlistSummaryEntity[], total: number }` |
| `createSetlist(dto)` | `POST /api/v1/setlists` | Retorna `SetlistEntity` en estado PLANNING |
| `getSetlist(id)` | `GET /api/v1/setlists/:id` | Retorna `SetlistWithItemsEntity` con ítems ordenados |
| `updateSetlist(id, dto)` | `PUT /api/v1/setlists/:id` | Retorna `SetlistEntity` actualizado |
| `deleteSetlist(id)` | `DELETE /api/v1/setlists/:id` | Elimina setlist y sus ítems en cascada |
| `transitionStatus(id, status)` | `POST /api/v1/setlists/:id/status` | Valida máquina de estados e invariante única ACTIVE |
| `addItem(setlistId, dto)` | `POST /api/v1/setlists/:id/items` | Crea ítem polimórfico y valida mutabilidad |
| `updateItem(setlistId, itemId, dto)` | `PUT /api/v1/setlists/:id/items/:itemId` | Actualiza overrides litúrgicos sin tocar canciones |
| `removeItem(setlistId, itemId)` | `DELETE /api/v1/setlists/:id/items/:itemId` | Elimina ítem y compacta secuencia |
| `reorderItems(setlistId, itemIds)` | `PUT /api/v1/setlists/:id/reorder` | Reordenamiento atómico SQL |

> [!NOTE]
> La compatibilidad entre `SetlistService` (WS4) y los requerimientos de transporte de WS5 es del **100%**. No se requiere ninguna modificación a WS4.

---

## 15. Decisiones y Puntos de Confirmación (Decisions Requiring Authorization)

Para garantizar total transparencia con la dirección técnica, se documentan las siguientes 4 decisiones arquitectónicas:

1. **Decisión 1 — Verbo HTTP para Transición de Estado Litúrgico:**
   - *Alternativa A (Recomendada):* `POST /api/v1/setlists/:id/status` (según plan original aprobado en `PHASE_2C_IMPLEMENTATION_PLAN.md` Sección 6).
   - *Alternativa B:* `PATCH /api/v1/setlists/:id/status` (para partidarios de la semántica PATCH).
   - *Postura de este Preflight:* Implementar `POST /api/v1/setlists/:id/status` como ruta principal autorizada, permitiendo registrar un alias `PATCH` si se desea máxima compatibilidad.

2. **Decisión 2 — Política de Verificación en Base de Datos (`verifyDatabaseRole = true`):**
   - *Propuesta:* Exigir `verifyDatabaseRole = true` estrictamente en las 8 operaciones mutantes (`POST`, `PUT`, `DELETE`).
   - *Justificación:* Garantiza que un usuario suspendido o degradado no pueda alterar la liturgia ni un solo segundo más, mientras que las consultas de lectura (`GET`) aprovechan la validación en memoria del JWT para maximizar el rendimiento en atril.

3. **Decisión 3 — Registro en Auditoría de Seguridad:**
   - *Propuesta:* Integrar `auditService.log` en creación de setlist, activación de culto (`SETLIST_ACTIVATED`) y eliminación física (`SETLIST_DELETED`).
   - *Justificación:* Trazabilidad completa sin sobrecargar operaciones de reordenamiento o edición menor de notas.

4. **Decisión 4 — Validación de Existencia de `directorUserId`:**
   - *Propuesta:* Validar formato UUID en Zod y dejar que la clave foránea relacional en PostgreSQL garantice la existencia del usuario referenciado.
   - *Justificación:* Evita consultas adicionales redundantes manteniendo la integridad referencial a nivel de base de datos.

---

## 16. Secuencia Recomendada de Implementación de WS5 (Recommended Sequence)

Una vez emitida la autorización explícita para WS5, se recomienda ejecutar el siguiente plan de trabajo estructurado:

```
Paso 1: Crear plugin Fastify backend/src/interfaces/http/routes/setlist.routes.ts
        ├── Instanciar repositorios y SetlistService
        ├── Configurar AuthGuard
        ├── Definir endpoints GET (listar y detalle) con guards de lectura
        ├── Definir endpoints POST/PUT/DELETE con verifyDatabaseRole: true
        └── Mapear respuestas JSON y delegar errores a errorHandler
Paso 2: Registrar setlistRoutes en backend/src/app.ts
        ├── Registrar en /api/v1 con prefijo /setlists
        └── Documentar etiquetas en OpenAPI Swagger
Paso 3: Implementar suite de pruebas backend/src/__tests__/setlist-api.test.ts
        ├── Pruebas de autenticación y ausencia de token (401)
        ├── Pruebas de matriz RBAC completa para los 5 roles (403 vs 200/201)
        ├── Pruebas de verificación de rol en tiempo real (cuentas suspendidas)
        ├── Pruebas de esquemas Zod y validación polimórfica (400)
        ├── Pruebas de errores de dominio (404, 409)
        └── Pruebas de IDOR y persistencia canónica intacta
Paso 4: Verificación de Regresión Completa y Compilación TypeScript
        ├── backend test runner (158 + nuevas pruebas de API)
        ├── frontend test runner (184 pruebas)
        ├── tsc --noEmit (backend y frontend)
        └── Verificación de integridad de base de datos
Paso 5: Reporte Autorizado de Implementación WS5
        ├── PHASE_2C_WS5_IMPLEMENTATION_REPORT.md
        ├── docs/PHASE_2C_WS5_IMPLEMENTATION_REPORT.md
        └── Verificación de hashes SHA-256
```

---

## 17. Compuerta de Salida del Preflight (WS5 Preflight Exit Gate)

El preflight concluye con la siguiente evaluación de criterios:

- [x] Fastify y su ciclo de vida han sido completamente auditados.
- [x] El flujo de autenticación JWT HS256 y cookies ha sido verificado.
- [x] El sistema de guardas RBAC (`AuthGuard`) está listo para integrarse.
- [x] Los esquemas Zod de WS2 cubren el 100% de los parámetros y payloads requeridos.
- [x] La interfaz de `SetlistService` (WS4) satisface todos los casos de uso sin adaptaciones.
- [x] Los 10 endpoints requeridos han sido formalmente especificados.
- [x] La matriz de autorización RBAC para los 5 roles está completamente definida.
- [x] El análisis de amenazas de seguridad no identificó bloqueantes arquitectónicos.
- [x] El plan de pruebas unitarias y de integración HTTP está detallado.
- [x] Cero código de producción de WS5 ha sido creado.

---

## 18. Declaración Explícita de Estado y Límites (Explicit Statement)

$$\mathbf{WS5\ PREFLIGHT:\ READY\ FOR\ EXPLICIT\ IMPLEMENTATION\ AUTHORIZATION}$$

**DECLARACIÓN EXPLÍCITA DE LÍMITES:**
- Durante este preflight **NO SE HA IMPLEMENTADO CÓDIGO DE PRODUCCIÓN DE WS5**.
- No se ha creado `setlist.routes.ts`.
- No se ha modificado `app.ts`.
- No se han modificado los componentes ni contratos del frontend.
- No se ha alterado la lógica de negocio ni la remediación de concurrencia de WS4.
- La base de datos, los 125 cantos canónicos y los 108 usuarios de la congregación permanecen intactos.
- La línea base verificada se mantiene en **342 / 342 pruebas PASS** con **0 errores TypeScript**.

El sistema se encuentra en un estado técnicamente cerrado, estable y a la espera de la instrucción explícita del usuario para iniciar la implementación de WS5.

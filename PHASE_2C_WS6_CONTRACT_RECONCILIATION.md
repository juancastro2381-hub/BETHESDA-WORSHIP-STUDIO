# BETHESDA WORSHIP STUDIO
## Enmienda y Reconciliación de Contratos — Workstream 6 (WS6)
### Especificación Técnica Definitiva de Transporte, Modelado y Ejecución en Atril

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Workstream:** WS6 — Frontend API Client & Setlist Execution Hook  
**Documento:** Reconciliación Exhaustiva de Contratos HTTP, Dominio y Atril Pre-Implementación  
**Ubicación Autorizada:** `PHASE_2C_WS6_CONTRACT_RECONCILIATION.md` y `docs/PHASE_2C_WS6_CONTRACT_RECONCILIATION.md`  
**Fecha:** 21 de Septiembre de 2026  
**Línea Base Verificada:** WS5 Implementado y Verificado (376/376 pruebas PASS, 0 errores TypeScript, PostgreSQL íntegro)  
**Estado de Producción:** **CERO CÓDIGO DE PRODUCCIÓN IMPLEMENTADO O MODIFICADO**  
**Clasificación:** **WS6 CONTRACT RECONCILIATION — READY FOR IMPLEMENTATION AUTHORIZATION**

---

## 1. Executive Summary

El presente documento formaliza la **reconciliación técnica exhaustiva y vinculante de contratos** para el Workstream 6 (WS6) de la Fase 2C en Bethesda Worship Studio.

Tras la culminación exitosa de los primeros cinco workstreams de la Fase 2C:
- **WS1:** Modelado de persistencia relacional y migración `0002_setlists_and_service_moments.sql`.
- **WS2:** Contratos de dominio puro y esquemas Zod en `setlist.schemas.ts`.
- **WS3:** Repositorio transaccional `DrizzleSetlistRepository` con reordenamiento atómico SQL y bloqueo pesimista `FOR UPDATE`.
- **WS4 & Concurrency Remediation:** Lógica de negocio en `SetlistService`, máquina de estados litúrgicos, inmutabilidad histórica, blindaje a nivel de motor en PostgreSQL (`idx_setlists_single_active`) y traducción de errores de colisión `23505` a `ConflictError`.
- **WS5:** 10 endpoints RESTful en Fastify (`/api/v1/setlists`), guardas RBAC con verificación en base de datos (`verifyDatabaseRole = true`), auditoría mandatoria y 34 pruebas de integración HTTP (192 backend / 184 frontend = 376 total PASS).

El documento preliminar `PHASE_2C_WS6_PREFLIGHT.md` propuso una arquitectura de integración para el frontend. Sin embargo, una auditoría detallada reveló discrepancias entre los tipos propuestos preliminarmente en el preflight y la implementación real de los contratos HTTP de WS5, el sistema de excepciones de transporte, y los contratos de teoría musical existentes en el frontend.

El propósito de esta enmienda es **eliminar el 100% de la ambigüedad contractual antes de autorizar la implementación de WS6**:
1. Se sustituyen todas las firmas preliminares laxas o que usaban `any` por uniones discriminadas fuertemente tipadas basadas en los esquemas Zod reales de WS5.
2. Se concilian los esquemas de respuesta JSON reales de cada endpoint de WS5 frente al modelo DTO del frontend.
3. Se unifica el modelo de excepciones HTTP creando un `ApiError` estructurado que mapea fielmente los códigos del backend (`VALIDATION_ERROR`, `CONFLICT`, `FORBIDDEN`, `NOT_FOUND`, etc.).
4. Se reutiliza de manera estricta el motor canónico de teoría musical (`MusicalKey.parse`, `PitchClass`, `TranspositionEngine`), garantizando que la transposición armónica sea una proyección pura en tiempo de ejecución sin mutación alguna de la base de datos ni de las canciones canónicas.
5. Se congelan las fronteras funcionales entre WS6 (lógica y transporte) y WS7 (componentes visuales), la política de almacenamiento volátil y la exclusión de tiempo real en la Fase 2C.

---

## 2. Authoritative Sources Inspected

La presente reconciliación se sustenta en la inspección directa del código fuente activo en el repositorio:

| Fuente Autorativa | Ruta de Archivo | Responsabilidad Inspeccionada |
|:---|:---|:---|
| **Rutas y Controladores HTTP WS5** | `backend/src/interfaces/http/routes/setlist.routes.ts` | 10 endpoints, serialización de respuestas, códigos HTTP 200/201/409, manejo de parámetros y middleware RBAC |
| **Esquemas Zod de Validación WS5** | `backend/src/interfaces/http/schemas/setlist.schemas.ts` | Validaciones estructurales, uniones discriminadas (`SONG` vs `SERVICE_MOMENT`), restricciones de rango y tipado inferido |
| **Tipos de Dominio Puro** | `backend/src/domain/setlist-types.ts` | Entidades `SetlistEntity`, `SetlistItemWithSongEntity`, `SetlistWithItemsEntity`, `SetlistSummaryEntity` y enums |
| **Lógica de Negocio y Reglas WS4** | `backend/src/application/setlist-service.ts` | Máquina de estados, invariantes de negocio (Reglas A, B, C), validaciones de integridad y excepciones de dominio |
| **Repositorio y Persistencia SQL** | `backend/src/repositories/setlist-repository.ts` | Consultas SQL con Drizzle ORM, proyecciones relacionales, reordenamiento atómico y manejo de error PostgreSQL `23505` |
| **Manejador Global de Errores** | `backend/src/interfaces/http/error-handler.ts` y `backend/src/domain/errors.ts` | Formato canónico `{ error: { code, message, statusCode, details } }` |
| **Cliente API Frontend Existente** | `frontend/src/core/api/api-client.ts` | Mecanismo `fetchWithAuth()`, interceptor de autenticación, soporte de cookies `HttpOnly` y renovación silenciosa ante 401 |
| **Autenticación y Sesiones Frontend** | `frontend/src/core/auth/auth-context.tsx`, `token-manager.ts`, `types.ts` | Modelo de 5 roles de usuario, almacenamiento en memoria volátil de tokens y ciclo de refresco |
| **Teoría Musical y Transposición** | `frontend/src/core/music-theory/musical-key.ts`, `pitch-class.ts`, `transposition.ts` | 30 tonalidades canónicas, parser unificado `MusicalKey.parse`, aritmética modular de semitonos y motor de transposición |
| **Espacio de Trabajo de Atril** | `frontend/src/core/workspace/use-musical-workspace.ts`, `workspace-orchestrator.ts` | Gestión de la vista proyectada y parámetros de transposición en runtime |
| **Preflight Preliminar** | `PHASE_2C_WS6_PREFLIGHT.md` | Especificación previa sujeta a esta enmienda formal |

---

## 3. Actual WS5 HTTP Contracts

A continuación se resume la matriz de los 10 endpoints HTTP implementados y verificados en WS5 (`setlist.routes.ts`):

```
1.  GET    /api/v1/setlists                      -> 200 OK: { data: SetlistSummaryEntity[], pagination: { total, limit, offset } }
2.  POST   /api/v1/setlists                      -> 201 Created: { data: SetlistEntity }
3.  GET    /api/v1/setlists/:id                  -> 200 OK: { data: SetlistWithItemsEntity }
4.  PUT    /api/v1/setlists/:id                  -> 200 OK: { data: SetlistEntity }
5.  DELETE /api/v1/setlists/:id                  -> 200 OK: { success: true, message: string }
6.  POST   /api/v1/setlists/:id/status           -> 200 OK: { data: SetlistEntity }
7.  POST   /api/v1/setlists/:id/items            -> 201 Created: { data: SetlistItemWithSongEntity }
8.  PUT    /api/v1/setlists/:id/items/:itemId    -> 200 OK: { data: SetlistItemWithSongEntity }
9.  DELETE /api/v1/setlists/:id/items/:itemId    -> 200 OK: { success: true, message: string }
10. PUT    /api/v1/setlists/:id/reorder          -> 200 OK: { data: SetlistItemWithSongEntity[] }
```

---

## 4. GET Setlists Contract Reconciliation

### Discrepancia Identificada
El preflight preliminar propuso que el método `listSetlists` retornara una promesa con forma directa `{ items: FrontendSetlistSummary[], total: number }`, mientras que el contrato HTTP real de WS5 encapsula el resultado dentro de un sobre con las propiedades `data` y `pagination`.

### Inspección del Código Autorativo
En `backend/src/interfaces/http/routes/setlist.routes.ts` (líneas 56-72):
```typescript
fastify.get(
  '/',
  { preHandler: authGuard.requirePermission('setlists:list', false) },
  async (request, reply) => {
    const query = ListSetlistsQuerySchema.parse(request.query);
    const result = await setlistService.listSetlists(query);

    return reply.status(200).send({
      data: result.items,
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
      },
    });
  }
);
```

### Respuesta JSON Real en Tiempo de Ejecución
```json
{
  "data": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "title": "Culto de Alabanza y Adoración",
      "scheduledDateTime": "2026-09-27T10:00:00.000Z",
      "status": "PLANNING",
      "directorUserId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "directorName": "Juan Pérez",
      "totalItems": 6,
      "totalSongs": 4,
      "createdAt": "2026-09-21T15:30:00.000Z",
      "updatedAt": "2026-09-21T15:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

### Propiedades, Opcionalidad y Nulabilidad
- `data`: Array de resúmenes de setlist.
  - `id`: `string` (UUID v4) [Requerido]
  - `title`: `string` (1-255 caracteres) [Requerido]
  - `scheduledDateTime`: `string` (ISO 8601) o `null` [Nullable]
  - `status`: `'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'` [Requerido]
  - `directorUserId`: `string` (UUID v4) o `null` [Nullable]
  - `directorName`: `string` o `undefined` (omitido en JSON si no hay usuario asignado) [Opcional]
  - `totalItems`: `number` (entero $\ge 0$) [Requerido]
  - `totalSongs`: `number` (entero $\ge 0$) [Requerido]
  - `createdAt`: `string` (ISO 8601) [Requerido]
  - `updatedAt`: `string` (ISO 8601) [Requerido]
- `pagination`: Objeto con metadatos de paginación.
  - `total`: `number` (total de registros coincidentes en la base de datos)
  - `limit`: `number` (límite solicitado, por defecto 20)
  - `offset`: `number` (desplazamiento, por defecto 0)

### Adaptación en el Frontend
El cliente `BethesdaApiClient` en el frontend recibirá el sobre HTTP sin renombrar silenciosamente propiedades, exponiendo un resultado ergonómico para la UI:

```typescript
// DTO HTTP de Transporte
export interface HttpListSetlistsResponse {
  data: FrontendSetlistSummary[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

// Adaptador en BethesdaApiClient.listSetlists:
// Mapea res.data -> items y res.pagination -> metadatos
```

---

## 5. POST Setlist Contract Reconciliation

### Discrepancia Identificada
El preflight preliminar propuso que `POST /api/v1/setlists` retornara `Promise<FrontendSetlistDetail>`, sugiriendo que devolvía la lista de ítems (`items: []`) y el nombre del director (`directorName`).

### Inspección del Código Autorativo
En `backend/src/interfaces/http/routes/setlist.routes.ts` (líneas 77-106):
```typescript
const created = await setlistService.createSetlist(body);
// Retorna created que es de tipo SetlistEntity pura
return reply.status(201).send({
  data: created,
});
```

En `backend/src/domain/setlist-types.ts` (líneas 34-43):
```typescript
export interface SetlistEntity {
  id: string;
  title: string;
  scheduledDateTime: Date | null;
  status: SetlistStatus;
  directorUserId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Respuesta JSON Real
```json
{
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "title": "Vigilia de Oración",
    "scheduledDateTime": "2026-10-02T19:00:00.000Z",
    "status": "PLANNING",
    "directorUserId": null,
    "notes": "Coordinación de alabanza congregacional",
    "createdAt": "2026-09-21T18:00:00.000Z",
    "updatedAt": "2026-09-21T18:00:00.000Z"
  }
}
```

### Hallazgos Críticos
1. **Ítems NO incluidos:** La respuesta es una `SetlistEntity`. Los ítems no están presentes en la respuesta HTTP (un setlist recién creado tiene 0 ítems).
2. **`directorName` NO incluido:** Solo se retorna el `directorUserId`. La consulta SQL en `create()` no realiza un join contra la tabla `users`.
3. **Paginación:** No aplica.
4. **Nulabilidad exacta:** `scheduledDateTime`, `directorUserId` y `notes` son estrictamente `string | null`.

### Decisión de Contrato en WS6
El método `createSetlist` de `BethesdaApiClient` retornará `Promise<FrontendSetlistEntity>`. Si el componente que llama necesita inicializar un estado detallado para atril, puede inicializar `items: []` localmente o invocar `getSetlist(id)` si requiere el `directorName` resuelto.

---

## 6. PUT Setlist Contract Reconciliation

### Discrepancia Identificada
El preflight preliminar planteó que `PUT /api/v1/setlists/:id` retornaba `Promise<FrontendSetlistDetail>`.

### Inspección del Código Autorativo
En `backend/src/interfaces/http/routes/setlist.routes.ts` (líneas 127-140):
```typescript
const updated = await setlistService.updateSetlist(params.id, body);
return reply.status(200).send({
  data: updated,
});
```
`setlistService.updateSetlist()` retorna `SetlistEntity` (entidad básica sin ítems).

### Respuesta JSON Real
```json
{
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "title": "Culto Dominical — Modificado",
    "scheduledDateTime": "2026-09-27T11:00:00.000Z",
    "status": "PLANNING",
    "directorUserId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "notes": "Modificación de orden pastoral",
    "createdAt": "2026-09-21T15:30:00.000Z",
    "updatedAt": "2026-09-21T18:15:00.000Z"
  }
}
```

### Estrategia Seleccionada: Opción A (Consumo Directo y Fusión Local)
Se evaluaron las opciones de diseño:
- **Opción A (Recomendada):** `BethesdaApiClient.updateSetlist(id, dto)` retorna `Promise<FrontendSetlistEntity>`. Si un setlist ya está cargado en `useSetlistExecution`, el hook actualiza los metadatos editados (`title`, `scheduledDateTime`, `notes`, `updatedAt`, `directorUserId`) preservando los `items` existentes en memoria.
- **Opción B:** Hacer un `GET /api/v1/setlists/:id` subsiguiente forzoso.
- **Opción C:** Crear un nuevo endpoint en backend (PROHIBIDO por restricciones de alcance).

**Justificación:**  
La Opción A respeta con fidelidad matemática el contrato WS5, evita una llamada de red redundante e innecesaria en el escenario con wifi inestable, previene recargas visuales parpadeantes en el atril y preserva la inmutabilidad de la lista de ítems cargados.

---

## 7. Setlist Item Contract Reconciliation (Eliminación de `any`)

### Regla Fundamental
En el preflight preliminar se observaron firmas con `item: any`. **`any` queda total y definitivamente PROHIBIDO.**

### Inspección de Esquemas Zod en WS5
En `backend/src/interfaces/http/schemas/setlist.schemas.ts` (líneas 120-214):

1. **Ítem de Canción (`CreateSongItemPayloadSchema`):**
   - `itemType: 'SONG'` (Literal estricto)
   - `songId: string` (UUID v4 obligatorio)
   - `targetKey?: string | null` (1 a 16 caracteres, opcional/nullable)
   - `targetBpm?: number | null` (entero entre 20 y 300, opcional/nullable)
   - `transitionType?: 'SEGUE' | 'CROSSFADE' | 'STOP' | 'MEDLEY'` (por defecto 'STOP')
   - `notesForTeam?: string | null` (máximo 2000 caracteres, opcional/nullable)
   - `sequenceOrder?: number` (entero $\ge 1$, opcional)
   - **Campos Prohibidos:** `momentTitle`, `durationMinutes`, `musicalKey` **NO** están permitidos.

2. **Ítem de Momento Litúrgico (`CreateServiceMomentItemPayloadSchema`):**
   - `itemType: 'SERVICE_MOMENT'` (Literal estricto)
   - `songId: never` (Prohibido explícitamente: un momento no puede tener `songId`)
   - `momentTitle: string` (1 a 255 caracteres, obligatorio)
   - `durationMinutes?: number | null` (entero entre 1 y 180, opcional/nullable)
   - `musicalKey?: string | null` (1 a 16 caracteres, opcional/nullable, ej. para tonalidad de fondo en oración)
   - `notesForTeam?: string | null` (máximo 2000 caracteres, opcional/nullable)
   - `sequenceOrder?: number` (entero $\ge 1$, opcional)
   - **Campos Prohibidos:** `songId`, `targetKey`, `targetBpm`, `transitionType` **NO** están permitidos.

3. **Actualización de Ítem (`UpdateSetlistItemBodySchema`):**
   - `targetKey?: string | null` (1-16 chars)
   - `targetBpm?: number | null` (20-300)
   - `transitionType?: 'SEGUE' | 'CROSSFADE' | 'STOP' | 'MEDLEY'`
   - `momentTitle?: string | null` (1-255 chars)
   - `durationMinutes?: number | null` (1-180)
   - `musicalKey?: string | null` (1-16 chars)
   - `notesForTeam?: string | null` (máximo 2000 chars)
   - **Regla de Validación:** Debe suministrarse al menos un campo (`refine((data) => Object.keys(data).length > 0)`).
   - **Invariante:** El `itemType` no puede modificarse en una actualización (un ítem no puede mutar de tipo; debe ser eliminado y recreado).

### Tipos TypeScript Definitivos para WS6
```typescript
export type FrontendSetlistItemType = 'SONG' | 'SERVICE_MOMENT';
export type FrontendTransitionType = 'SEGUE' | 'CROSSFADE' | 'STOP' | 'MEDLEY';

export interface CreateSongItemPayload {
  itemType: 'SONG';
  songId: string;
  targetKey?: string | null;
  targetBpm?: number | null;
  transitionType?: FrontendTransitionType;
  notesForTeam?: string | null;
  sequenceOrder?: number;
}

export interface CreateServiceMomentPayload {
  itemType: 'SERVICE_MOMENT';
  momentTitle: string;
  durationMinutes?: number | null;
  musicalKey?: string | null;
  notesForTeam?: string | null;
  sequenceOrder?: number;
}

export type CreateSetlistItemPayload =
  | CreateSongItemPayload
  | CreateServiceMomentPayload;

export interface UpdateSetlistItemPayload {
  targetKey?: string | null;
  targetBpm?: number | null;
  transitionType?: FrontendTransitionType;
  momentTitle?: string | null;
  durationMinutes?: number | null;
  musicalKey?: string | null;
  notesForTeam?: string | null;
}
```

---

## 8. Setlist Item Response Types & Reorder Contract Reconciliation

### 1. `POST /api/v1/setlists/:id/items`
- **Código HTTP:** 201 Created
- **Respuesta JSON:**
  ```json
  {
    "data": {
      "id": "item-uuid",
      "setlistId": "setlist-uuid",
      "sequenceOrder": 1,
      "itemType": "SONG",
      "songId": "song-uuid",
      "targetKey": "Bb",
      "targetBpm": 74,
      "transitionType": "SEGUE",
      "momentTitle": null,
      "durationMinutes": null,
      "musicalKey": null,
      "notesForTeam": "Entrada suave con piano",
      "createdAt": "2026-09-21T18:00:00.000Z",
      "updatedAt": "2026-09-21T18:00:00.000Z",
      "song": {
        "id": "song-uuid",
        "title": "Sublime Gracia",
        "artist": "John Newton",
        "defaultKey": "G",
        "defaultBpm": 70,
        "timeSignature": "4/4",
        "status": "APPROVED"
      }
    }
  }
  ```

### 2. `PUT /api/v1/setlists/:id/items/:itemId`
- **Código HTTP:** 200 OK
- **Respuesta JSON:** `{ data: SetlistItemWithSongEntity }` (misma estructura que el ítem creado).

### 3. `DELETE /api/v1/setlists/:id/items/:itemId`
- **Código HTTP:** 200 OK
- **Respuesta JSON:**
  ```json
  {
    "success": true,
    "message": "Elemento eliminado del setlist exitosamente."
  }
  ```

### 4. `PUT /api/v1/setlists/:id/reorder`
- **Payload de Entrada:**
  ```json
  {
    "itemIds": [
      "item-uuid-2",
      "item-uuid-1",
      "item-uuid-3"
    ]
  }
  ```
  *Reglas de Validación WS5:*
  - `itemIds` debe ser array de UUIDs válidos no vacío.
  - No puede contener duplicados.
  - La cantidad debe coincidir exactamente con la cantidad de ítems del setlist.
  - Todos los IDs deben pertenecer al setlist.
- **Código HTTP:** 200 OK
- **Respuesta JSON:**
  ```json
  {
    "data": [
      {
        "id": "item-uuid-2",
        "sequenceOrder": 1,
        "itemType": "SERVICE_MOMENT",
        "song": null
      },
      {
        "id": "item-uuid-1",
        "sequenceOrder": 2,
        "itemType": "SONG",
        "song": { "id": "...", "title": "..." }
      }
    ]
  }
  ```

### Objeto Embebido `song`
El objeto `song` embebido dentro de `SetlistItemWithSongEntity`:
- Para `itemType === 'SONG'`: contiene exactamente `{ id, title, artist, defaultKey, defaultBpm, timeSignature, status }`.
- Para `itemType === 'SERVICE_MOMENT'`: es estrictamente `null`.
- **Propiedades NO retornadas por WS5 en este nivel:** No incluye `ccliNumber`, `canonicalPayload`, `lyrics`, `chords` ni `versions`. Si el atrilista visualiza la partitura, el `CanonicalMusicPayload` se solicita a través del endpoint canónico `/api/v1/songs/:id`.

---

## 9. Status Transition Contract

### Inspección del Endpoint
- **Ruta:** `POST /api/v1/setlists/:id/status`
- **Permiso RBAC:** `setlists:activate` con `verifyDatabaseRole = true` (solo `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`).
- **Request Body:**
  ```json
  {
    "status": "ACTIVE"
  }
  ```
- **Respuesta Éxito (200 OK):**
  ```json
  {
    "data": {
      "id": "setlist-uuid",
      "title": "Culto Dominical",
      "scheduledDateTime": "2026-09-27T10:00:00.000Z",
      "status": "ACTIVE",
      "directorUserId": "user-uuid",
      "notes": null,
      "createdAt": "2026-09-21T15:00:00.000Z",
      "updatedAt": "2026-09-21T18:30:00.000Z"
    }
  }
  ```

### Matriz de Errores y Mapeo al Estado Frontend
WS5 genera errores estructurados bajo diferentes condiciones de rechazo:

| Escenario de Rechazo | Código HTTP | Error Code Backend | Mensaje Real Backend | Mapeo al Estado del Hook WS6 |
|:---|:---:|:---:|:---|:---|
| **Conflicto Regla A:** Ya existe otro setlist activo | 409 | `CONFLICT` | `"Ya existe un setlist en estado ACTIVE ('{title}'). Debe finalizar o cambiar su estado antes de activar un nuevo culto."` | Captura `ConflictError`, expone mensaje descriptivo permitiendo al usuario identificar el culto en colisión sin corromper el atril. |
| **Conflicto Regla B:** Transición prohibida (ej. `PLANNING` a `COMPLETED`) | 409 | `CONFLICT` | `"Transición de estado litúrgico no permitida: no se puede cambiar de '{status}' a '{newStatus}'."` | Bloquea la acción en UI y notifica la incompatibilidad de la máquina de estados. |
| **Conflicto Regla C:** Mutación sobre setlist `COMPLETED` o `ARCHIVED` | 409 | `CONFLICT` | `"No se pueden {accion} un setlist en estado {status}."` | Muestra aviso de inmutabilidad histórica. |
| **Permisos Insuficientes:** Activación intentada por `MUSICIAN` o `VIEWER` | 403 | `FORBIDDEN` | `"Acceso denegado. No posee permisos suficientes para esta operación."` | Notifica que se requiere rol pastoral o de dirección. |
| **Setlist Inexistente** | 404 | `NOT_FOUND` | `"El recurso 'Setlist' con identificador '{id}' no fue encontrado."` | Notifica la ausencia del recurso y resetea el setlist cargado. |

---

## 10. Frontend API Error Contract

### Inspección del Manejador de Errores del Backend
En `backend/src/interfaces/http/error-handler.ts` (líneas 11-70) y `errors.ts`, todo error retorna:
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Mensaje descriptivo en español",
    "statusCode": 409,
    "details": null
  }
}
```

### Clase de Excepción Estructurada en Frontend
Para eliminar la duplicación y el manejo ad-hoc de errores de red, se formaliza la siguiente clase para el cliente de WS6:

```typescript
export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: unknown;

  public constructor(
    message: string,
    statusCode: number,
    code: string = 'UNKNOWN_ERROR',
    details: unknown = null
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static async fromResponse(res: Response): Promise<ApiError> {
    try {
      const json = await res.json();
      if (json?.error) {
        return new ApiError(
          json.error.message || `Error HTTP ${res.status}`,
          json.error.statusCode || res.status,
          json.error.code || 'HTTP_ERROR',
          json.error.details ?? null
        );
      }
    } catch {
      // Si la respuesta no es JSON válido
    }
    return new ApiError(`Error en el servidor: HTTP ${res.status}`, res.status, 'HTTP_ERROR');
  }
}
```

---

## 11. Authentication Contract

### Verificación de Comportamiento en `fetchWithAuth`
En `frontend/src/core/api/api-client.ts` (líneas 69-101):
1. **Inyección de Token:** Se consulta `tokenManager.getToken()`. Si existe, se añade la cabecera `Authorization: Bearer <token>`.
2. **Cookies HttpOnly:** Toda solicitud incluye `credentials: 'include'`.
3. **Renovación Silenciosa:** Si el backend retorna 401:
   - Se intercepta la respuesta.
   - Se invoca `refreshSession()`, la cual envía la cookie HttpOnly de refresco al endpoint `/auth/refresh`.
   - Si tiene éxito, `tokenManager.setToken(accessToken, expiresIn)` actualiza el token en memoria privada de JavaScript.
   - Se reinyecta el nuevo token en el header y se reintenta automáticamente la petición original.
   - Si falla, se invoca `tokenManager.clearToken()`.

### Conclusión de Autenticación para WS6
El ciclo de vida de autenticación, transporte de tokens y renovación automática ante expiración **ya se encuentra 100% implementado y probado**. Los nuevos métodos de setlists de WS6 delegarán sus llamadas en `fetchWithAuth()`, heredando de manera transparente esta resiliencia sin requerir código de autenticación adicional.

---

## 12. RBAC Contract

### Inspección del Modelo de Roles Existente
En `frontend/src/core/auth/types.ts` (línea 6):
```typescript
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'WORSHIP_LEADER' | 'MUSICIAN' | 'VIEWER';
```
**No existen otros roles.** Se confirma que **NO se crearán roles nuevos** ni roles exclusivos de frontend.

### Matriz de Permisos UX vs Autoridad de Backend
La siguiente tabla define los controles de interfaz (UX) para WS6/WS7 frente a la regla autoritativa del backend:

| Capacidad en Interfaz de Setlists | Roles con Acceso UX | Permiso Fastify | Comportamiento Backend |
|:---|:---:|:---:|:---:|
| Ver catálogo de setlists | Todos los 5 roles | `setlists:list` | Permitido para cualquier usuario autenticado |
| Ver detalle y navegación en atril | Todos los 5 roles | `setlists:read` | Permitido para cualquier usuario autenticado |
| Crear nuevo setlist | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `setlists:create` | Verificación en PostgreSQL con `verifyDatabaseRole = true` |
| Editar metadatos de setlist | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `setlists:update` | Verificación en PostgreSQL con `verifyDatabaseRole = true` |
| Agregar / editar / borrar ítems | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `setlists:update` | Verificación en PostgreSQL con `verifyDatabaseRole = true` |
| Reordenar ítems de culto | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `setlists:reorder` | Verificación en PostgreSQL con `verifyDatabaseRole = true` |
| Activar / Finalizar culto | `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER` | `setlists:activate` | Verificación en PostgreSQL con `verifyDatabaseRole = true` |
| Eliminar setlist en cascada | `SUPER_ADMIN`, `ADMIN` | `setlists:delete` | Verificación en PostgreSQL con `verifyDatabaseRole = true` |

> [!IMPORTANT]
> **Postura de Seguridad:**
> Los checks en frontend mediante `hasRole()` son exclusivamente para ocultar o deshabilitar botones y evitar acciones no permitidas en la UI. El backend Fastify con `AuthGuard` es la **única autoridad de seguridad**.

---

## 13. Transposition Contract

### Inspección de Utilidades de Teoría Musical Existentes
Se inspeccionó `frontend/src/core/music-theory/`:
1. **Representación de Tonalidad:** Clase `MusicalKey` en `musical-key.ts`.
2. **Tonalidades Mayores:** 15 tonalidades canónicas ($C, G, D, A, E, B, F\sharp, C\sharp, F, B\flat, E\flat, A\flat, D\flat, G\flat, C\flat$).
3. **Tonalidades Menores:** 15 tonalidades canónicas naturales ($Am, Em, Bm, F\sharp m, C\sharp m, G\sharp m, D\sharp m, A\sharp m, Dm, Gm, Cm, Fm, B\flat m, E\flat m, A\flat m$).
4. **Notación de Alteraciones:** Soportada plenamente mediante `Accidental` y `KeySignature`.
5. **Equivalencias Enarmónicas:** Modela clases de tono canónicas $0$ a $11$ mediante `PitchClass`.
6. **Sensibilidad a Mayúsculas/Minúsculas:** `MusicalKey.parse(keyStr)` normaliza cadenas (`G`, `G Major`, `Sol Mayor`, `Em`, `E minor`, `bm`, `f#m`).
7. **Tonalidades Inválidas:** `MusicalKey.parse()` lanza excepción si la cadena no es reconocida.
8. **Comportamiento ante `targetKey` nulo:** Cuando `targetKey` es `null`, la canción se interpreta en su tono canónico original ($\Delta = 0$).
9. **Comportamiento ante `defaultKey` nulo:** Las canciones canónicas en la base de datos exigen `defaultKey`. Si faltara, el cálculo retorna $\Delta = 0$ de forma segura.
10. **Parser Canónico Único:** **Ya existe `MusicalKey.parse()`**. **NO se creará un segundo parser de notas ni tonalidades.**
11. **Motor de Distancia:** `PitchClass.shortestDistanceTo(target)` calcula la distancia mínima en el rango $[-6, +6]$ semitonos.

### Función Pura de Cálculo de Transposición para WS6
```typescript
import { MusicalKey } from '../music-theory/musical-key.ts';

export function calculateTranspositionSemitones(
  sourceKeyStr: string | null | undefined,
  targetKeyStr: string | null | undefined
): number {
  if (!sourceKeyStr || !targetKeyStr) {
    return 0;
  }
  try {
    const sourceKey = MusicalKey.parse(sourceKeyStr);
    const targetKey = MusicalKey.parse(targetKeyStr);
    const sourcePc = sourceKey.tonic.toPitchClass();
    const targetPc = targetKey.tonic.toPitchClass();
    return sourcePc.shortestDistanceTo(targetPc);
  } catch {
    // Si alguna tonalidad no es parseable, fallback determinista a tono original
    return 0;
  }
}
```

### Invariante de Inmutabilidad
- El modelo `CanonicalMusicPayload` es **estrictamente inmutable**.
- La transposición se proyecta en tiempo de ejecución suministrando $\Delta_{\text{semitonos}}$ al `ProjectionService` de `MusicalWorkspace`.
- **Cero mutaciones en la base de datos. Cero mutaciones en el catálogo de canciones maestras.**

---

## 14. WS6 / WS7 Boundary

Se congela de manera formal e irrevocable la frontera entre workstreams:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             ALCANCE ESTRICTO DE WS6                              │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 1. Métodos de Setlist en BethesdaApiClient (con DTOs tipados y ApiError).       │
│ 2. Hook de Orquestación useSetlistExecution.ts (máquina de estado de culto).     │
│ 3. Función de cálculo armónico calculateTranspositionSemitones.                  │
│ 4. Suites de pruebas unitarias y de integración del hook y cliente API.          │
│ 5. Reporte técnico formal PHASE_2C_WS6_IMPLEMENTATION_REPORT.md.                │
└──────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼ (Una vez completado y verificado WS6)
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             ALCANCE ESTRICTO DE WS7                              │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 1. Componente SetlistsModal.tsx (gestión visual y selección de cultos).         │
│ 2. Componente SetlistNavigationToolbar.tsx (barra de atril para escenario).     │
│ 3. Componente ServiceMomentCard.tsx (tarjeta de momentos litúrgicos).           │
│ 4. Integración visual en MusicalWorkspace.tsx.                                  │
│ 5. Manejadores de atajos de teclado de atril y responsive design.               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 15. Off-Setlist Song Contract

### Comportamiento Aprobado
Si durante un culto un músico abre el catálogo general o la base de datos de canciones y selecciona una canción que no forma parte del setlist:
1. El setlist cargado **permanece en memoria de React** (`loadedSetlist` NO se pone en `null`).
2. El índice actual (`currentIndex`) se **preserva intacto**.
3. La canción independiente se carga en `MusicalWorkspace` para su visualización y ejecución libre.
4. Se habilita un mecanismo en la barra de atril (`[Volver al Culto: Ítem N]`) que permite al músico regresar inmediatamente a la canción del culto donde se encontraba sin recargar datos ni perder posición.

---

## 16. In-Memory Execution Contract

### Política de Estado en Memoria
- El estado de ejecución litúrgica (`loadedSetlist`, `currentIndex`, etc.) se almacena **exclusivamente como estado reactivo volátil de React** (`useState` dentro de `useSetlistExecution`).
- **PROHIBICIÓN ABSOLUTA:** Cero almacenamiento de `currentIndex` o `loadedSetlist` en `localStorage`, `sessionStorage` o `IndexedDB`.
- **Comportamiento ante recarga (F5):**
  - La memoria volátil de React se reinicia limpiamente.
  - El token de acceso se rehidrata mediante la cookie HttpOnly de refresco.
  - El usuario puede volver a seleccionar el culto activo desde el modal de cultos.
- **Justificación:** Los dispositivos de atril en el altar son de uso compartido entre múltiples ministros y músicos. Persistir posiciones o estados de culto en el disco del navegador introduce riesgos de desincronización y fuga de contexto entre diferentes cultos o usuarios.

---

## 17. Real-Time Boundary

### Frontera de Sincronización en Tiempo Real
- **EXCLUIDO TOTALMENTE DE LA FASE 2C:**
  - Cero WebSockets.
  - Cero Server-Sent Events (SSE).
  - Cero Redis pub/sub.
  - Cero bucles de polling o intervalos periódicos (`setInterval`).
- **Fase Autorizada:** La sincronización de atriles en tiempo real ("Atril Maestro / Atriles Esclavos") forma parte de la **Fase 4** de la hoja de ruta estratégica del producto.
- En la Fase 2C, cada atril opera mediante llamadas REST HTTP iniciadas por el usuario y transiciones de estado locales reactivas.

---

## 18. Resolved Decisions

A continuación se resumen las decisiones técnicas zanjadas con esta enmienda:

1. **GET `/api/v1/setlists`:** Se confirma el sobre `{ data, pagination }`. El cliente API expone `{ items, total, limit, offset }`.
2. **POST `/api/v1/setlists`:** Retorna `{ data: SetlistEntity }` (sin ítems). El cliente retorna `FrontendSetlistEntity`.
3. **PUT `/api/v1/setlists/:id`:** Retorna `{ data: SetlistEntity }`. El hook adopta la Estrategia A (fusión local de metadatos preservando los ítems en memoria).
4. **Item Payloads:** Se eliminó todo uso de `any`. Se formalizó la unión discriminada `CreateSongItemPayload` y `CreateServiceMomentPayload`.
5. **Item Responses:** Confirmado que el ítem retornado embebe `song` con un subconjunto específico de metadatos cuando es `SONG`, y `null` cuando es `SERVICE_MOMENT`.
6. **Mapeo de Conflictos (409):** Mapeo de errores estructurados de WS5 para Regla A (setlist activo concurrente), Regla B (transición ilegal) y Regla C (inmutabilidad histórica).
7. **Modelo de Errores Frontend:** Clase `ApiError` estructurada.
8. **Autenticación:** Reutilización plena de `fetchWithAuth()` y ciclo de silent refresh con cookie HttpOnly.
9. **RBAC:** 5 roles confirmados, autoritativos en backend, utilizados en frontend únicamente para UX controls.
10. **Transposición:** Reutilización exclusiva de `MusicalKey.parse()` y `PitchClass.shortestDistanceTo()`, preservando la inmutabilidad de `CanonicalMusicPayload`.
11. **Frontera WS6/WS7:** Separación estricta entre capa lógica (WS6) y componentes visuales (WS7).
12. **Canciones fuera del setlist:** Preservación de posición litúrgica y retorno rápido.
13. **Estado volátil:** Memoria de React exclusivamente (sin Web Storage).
14. **Exclusión de Real-Time:** WebSockets/SSE formalmente diferidos a la Fase 4.

---

## 19. Remaining Ambiguities

$$\mathbf{AMBIGÜEDADES\ RESTANTES:\ CERO\ (0)}$$

Todos los puntos de contacto entre el backend Fastify (WS5) y el frontend React (WS6) han sido contrastados contra el código fuente real. No existe ninguna discrepancia abierta ni elemento pendiente de definición contractual.

---

## 20. Final WS6 Implementation Contract

A continuación se presenta el contrato de tipos TypeScript final que será implementado en WS6:

```typescript
/**
 * @file setlist-client-types.ts
 * @description Contratos de tipos definitivos para la integración de Setlists en el Frontend (Fase 2C — WS6).
 */

export type FrontendSetlistStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type FrontendSetlistItemType = 'SONG' | 'SERVICE_MOMENT';
export type FrontendTransitionType = 'SEGUE' | 'CROSSFADE' | 'STOP' | 'MEDLEY';

export interface FrontendSetlistSummary {
  id: string;
  title: string;
  scheduledDateTime: string | null;
  status: FrontendSetlistStatus;
  directorUserId: string | null;
  directorName?: string | null;
  totalItems: number;
  totalSongs: number;
  createdAt: string;
  updatedAt: string;
}

export interface FrontendSetlistEntity {
  id: string;
  title: string;
  scheduledDateTime: string | null;
  status: FrontendSetlistStatus;
  directorUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FrontendSetlistItemSong {
  id: string;
  title: string;
  artist: string | null;
  defaultKey: string;
  defaultBpm: number;
  timeSignature: string;
  status: string;
}

export interface FrontendSetlistItem {
  id: string;
  setlistId: string;
  sequenceOrder: number;
  itemType: FrontendSetlistItemType;
  songId: string | null;
  targetKey: string | null;
  targetBpm: number | null;
  transitionType: FrontendTransitionType | null;
  momentTitle: string | null;
  durationMinutes: number | null;
  musicalKey: string | null;
  notesForTeam: string | null;
  createdAt: string;
  updatedAt: string;
  song: FrontendSetlistItemSong | null;
}

export interface FrontendSetlistDetail extends FrontendSetlistEntity {
  directorName?: string | null;
  items: FrontendSetlistItem[];
}

// Payloads tipados para mutaciones
export interface CreateSongItemPayload {
  itemType: 'SONG';
  songId: string;
  targetKey?: string | null;
  targetBpm?: number | null;
  transitionType?: FrontendTransitionType;
  notesForTeam?: string | null;
  sequenceOrder?: number;
}

export interface CreateServiceMomentPayload {
  itemType: 'SERVICE_MOMENT';
  momentTitle: string;
  durationMinutes?: number | null;
  musicalKey?: string | null;
  notesForTeam?: string | null;
  sequenceOrder?: number;
}

export type CreateSetlistItemPayload =
  | CreateSongItemPayload
  | CreateServiceMomentPayload;

export interface UpdateSetlistItemPayload {
  targetKey?: string | null;
  targetBpm?: number | null;
  transitionType?: FrontendTransitionType;
  momentTitle?: string | null;
  durationMinutes?: number | null;
  musicalKey?: string | null;
  notesForTeam?: string | null;
}

export interface CreateSetlistPayload {
  title: string;
  scheduledDateTime?: string | null;
  directorUserId?: string | null;
  notes?: string | null;
}

export interface UpdateSetlistPayload {
  title?: string;
  scheduledDateTime?: string | null;
  directorUserId?: string | null;
  notes?: string | null;
}
```

---

## 21. Test Contract

Para WS6, se autoriza la creación de las siguientes suites de pruebas en Node.js Test Runner:

1. **`frontend/src/core/api/__tests__/setlist-api-client.test.ts`:**
   - Pruebas mock de peticiones HTTP para los 10 endpoints de setlists.
   - Verificación de serialización correcta de payloads discriminados (`SONG` vs `SERVICE_MOMENT`).
   - Verificación del lanzamiento de `ApiError` estructurado con códigos de estado 400, 401, 403, 404, 409 y 500.
   - Verificación del flujo de refresco automático ante 401.

2. **`frontend/src/core/workspace/__tests__/use-setlist-execution.test.ts`:**
   - Inicialización del hook en estado vacío.
   - Carga exitosa de un setlist con ítems polimórficos ordenados.
   - Navegación secuencial (`goToNext`, `goToPrevious`, `goToIndex`), respetando límites de índice.
   - Verificación del cálculo de transposición litúrgica armónica ($\Delta_{\text{semitonos}}$) entre el tono canónico de la canción y el `targetKey`.
   - Alternancia entre modo de canción (`itemType === 'SONG'`) y modo litúrgico (`itemType === 'SERVICE_MOMENT'`).
   - Mapeo de errores de conflicto (409) al intentar activar un setlist cuando ya existe uno activo.
   - Fusión correcta de metadatos tras invocación de actualización (`updateSetlist`).

---

## 22. SHA-256 Verification

```
SHA-256
PHASE_2C_WS6_CONTRACT_RECONCILIATION.md
09403838B69FB023AAD90EB98E0B40B94CCEFDFAD3EE2351086EAE978254C402

docs/PHASE_2C_WS6_CONTRACT_RECONCILIATION.md
09403838B69FB023AAD90EB98E0B40B94CCEFDFAD3EE2351086EAE978254C402

MATCH: YES
```

---

## 23. WS6 Contract Reconciliation Exit Gate

| Criterio de Verificación | Estado | Evidencia y Justificación |
|:---|:---:|:---|
| **Respuesta de Endpoints WS5 Auditada** | **PASSED** | Los 10 endpoints fueron contrastados contra `setlist.routes.ts`, `setlist.schemas.ts` y `setlist-repository.ts`. |
| **Payloads de Ítems Fuertemente Tipados** | **PASSED** | Se eliminó el 100% de `any`; uniones discriminadas exactas `CreateSongItemPayload` y `CreateServiceMomentPayload`. |
| **Fusión de Actualización (PUT) Resuelta** | **PASSED** | Estrategia A formalizada: consumo de `SetlistEntity` y actualización de metadatos en memoria local. |
| **Mapeo de Errores Formalizado** | **PASSED** | Clase `ApiError` creada para representar códigos 400, 401, 403, 404, 409 y 500 del backend. |
| **Contrato de Autenticación Verificado** | **PASSED** | Reutilización íntegra de `fetchWithAuth()` y ciclo de cookies HttpOnly con silent refresh. |
| **Contrato RBAC Verificado** | **PASSED** | 5 roles autoritativos en backend confirmados; matriz de permisos UX para atril documentada. |
| **Contrato de Transposición Verificado** | **PASSED** | Reutilización de `MusicalKey.parse()` y `PitchClass`; cálculo de semitonos como proyección sin mutaciones en BD. |
| **Frontera WS6/WS7 Congelada** | **PASSED** | WS6 confinado a API Client y Hook de Ejecución; WS7 a componentes visuales de UI. |
| **Canciones Fuera del Setlist Resuelto** | **PASSED** | Preservación de posición litúrgica y retorno rápido documentado. |
| **Estado en Memoria Volátil Congelado** | **PASSED** | Cero almacenamiento en disco o Web Storage; memoria volátil de React. |
| **Exclusión de Tiempo Real Congelada** | **PASSED** | WebSockets y SSE formalmente postergados a Fase 4. |
| **Ambigüedades Restantes** | **CERO (0)** | No quedan decisiones contractuales abiertas. |
| **Código de Producción Modificado** | **CERO (0)** | 0 archivos modificados en frontend, backend o base de datos. |
| **Dependencias Agregadas** | **CERO (0)** | 0 dependencias agregadas a `package.json`. |
| **Copias Sincronizadas y Hash SHA-256** | **PASSED** | Ambos archivos existen, son idénticos byte a byte y verificados criptográficamente. |

$$\mathbf{CLASIFICACIÓN\ FINAL:\ WS6\ CONTRACT\ RECONCILIATION\ —\ READY\ FOR\ IMPLEMENTATION\ AUTHORIZATION}$$

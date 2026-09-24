# BETHESDA WORSHIP STUDIO
## Phase 2C — Reporte de Implementación y Verificación: Workstream 2 (WS2)
### Dominio, Permisos RBAC y Esquemas de Validación Zod

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Etapa:** **Workstream 2 (WS2) — Domain, RBAC Permissions and Zod Schemas**  
**Documento Oficial Autorizado:** `PHASE_2C_WS2_IMPLEMENTATION_REPORT.md` y `docs/PHASE_2C_WS2_IMPLEMENTATION_REPORT.md`  
**Fecha:** 20 de Septiembre de 2026  
**Línea Base Previa:** WS1 Implementado y Verificado (243 pruebas pasando)  
**Estado de Salida:** **IMPLEMENTED & VERIFIED (EXIT GATE WS2 APROBADO)**

---

## 1. Alcance Implementado en WS2

El objetivo estricto de WS2 ha sido establecer la capa de **autorización RBAC de dominio y los esquemas de validación Zod** para la gestión litúrgica de Setlists y Momentos de Servicio, sin implementar repositorios, servicios ni controladores HTTP (reservados para WS3, WS4 y WS5).

Se implementó:
1. **Extensión del Modelo RBAC:**
   - 7 permisos explícitos de dominio para Setlists añadidos a la unión `Permission` en `backend/src/domain/auth-types.ts`.
   - Asignación estricta y granular en `ROLE_PERMISSIONS` para los 5 roles canónicos (`SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER`).
   - Principio de **cero herencia implícita** rigurosamente preservado.
   - Restricción total de mutación para `MUSICIAN` y `VIEWER` (solo permisos de lectura `setlists:list` y `setlists:read`).
   - Restricción de eliminación (`setlists:delete`) exclusiva para `ADMIN` y `SUPER_ADMIN` (denegada a `WORSHIP_LEADER`).
2. **Entidades y Contratos de Dominio:**
   - Módulo `backend/src/domain/setlist-types.ts` con tipos puros: `SetlistEntity`, `SetlistItemEntity`, `SetlistItemWithSongEntity`, `SetlistWithItemsEntity`, `SetlistSummaryEntity` y `SetlistFilterOptions`.
3. **Módulo de Esquemas Zod (`backend/src/interfaces/http/schemas/setlist.schemas.ts`):**
   - Parámetros de ruta: `SetlistIdParamSchema`, `SetlistItemIdParamSchema`.
   - Consulta paginada y filtros: `ListSetlistsQuerySchema` (coerción de enteros y booleanos).
   - Creación y actualización de Setlists: `CreateSetlistBodySchema`, `UpdateSetlistBodySchema`.
   - Transición de estado: `SetlistStatusTransitionBodySchema` (`PLANNING`, `ACTIVE`, `COMPLETED`, `ARCHIVED`).
   - **Validación Polimórfica de Elementos:** `CreateSetlistItemBodySchema` implementado mediante `z.discriminatedUnion('itemType', [...])`:
     - `SONG`: Requiere obligatoriamente `songId` (UUID válido), permite `targetKey` (1-16 chars), `targetBpm` (20-300), `transitionType` (`SEGUE`, `CROSSFADE`, `STOP`, `MEDLEY` con valor por defecto `STOP`), y `notesForTeam`.
     - `SERVICE_MOMENT`: Requiere obligatoriamente `momentTitle` (1-255 chars), permite `durationMinutes` (1-180), `musicalKey` (1-16 chars) y `notesForTeam`.
   - Actualización de elementos: `UpdateSetlistItemBodySchema` con refinamiento que exige al menos un campo.
   - **Reordenamiento Atómico Transaccional:** `ReorderSetlistItemsBodySchema` que exige un array no vacío de UUIDs válidos y valida mediante `.refine(...)` que no existan identificadores duplicados.

---

## 2. Archivos Creados y Modificados

| Archivo | Acción | Propósito y Contenido |
|---|---|---|
| [`backend/src/domain/auth-types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/auth-types.ts) | **MODIFICADO** | Adición de los 7 permisos `setlists:*` y su mapeo explícito en `ROLE_PERMISSIONS`. |
| [`backend/src/domain/setlist-types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/setlist-types.ts) | **CREADO** | Tipos, interfaces y contratos de dominio para Setlists y Momentos de Servicio. |
| [`backend/src/interfaces/http/schemas/setlist.schemas.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/schemas/setlist.schemas.ts) | **CREADO** | Esquemas Zod para parámetros, consultas, mutaciones y reordenamiento. |
| [`backend/src/__tests__/setlist-domain-and-schemas.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/setlist-domain-and-schemas.test.ts) | **CREADO** | Suite de 32 pruebas automatizadas para dominio, permisos y esquemas Zod. |
| [`backend/src/__tests__/rbac-permission-guards.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/rbac-permission-guards.test.ts) | **MODIFICADO** | Actualización de la aserción de permisos del rol VIEWER (línea 40) para reflejar los nuevos permisos de lectura autorizados (`setlists:list` y `setlists:read`). |

---

## 3. Matriz de Autorización RBAC Implementada

Se implementó el mapeo estricto y explícito sin asunciones de herencia:

| Permiso de Dominio | `SUPER_ADMIN` | `ADMIN` | `WORSHIP_LEADER` | `MUSICIAN` | `VIEWER` |
|:---|:---:|:---:|:---:|:---:|:---:|
| `setlists:list` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `setlists:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `setlists:create` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:update` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:reorder` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:activate` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `setlists:delete` | ✅ | ✅ | ❌ | ❌ | ❌ |

**Implicaciones de Seguridad:**
- `MUSICIAN` y `VIEWER` pueden consultar y abrir listas de culto en el atril, pero el sistema rechaza cualquier intento de creación, edición, reordenamiento o activación (HTTP 403 en capa de transporte).
- `WORSHIP_LEADER` tiene control total del flujo litúrgico (creación, edición, activación, reordenamiento), pero la eliminación de listas queda protegida exclusivamente para roles pastorales/administrativos (`ADMIN` y `SUPER_ADMIN`).
- Se mantiene el principio de **autoridad en base de datos en tiempo real** (`verifyDatabaseRole = true`), el cual será consumido en WS5 por los controladores HTTP.

---

## 4. Esquemas Zod y Comportamiento de Validación

1. **`CreateSetlistBodySchema` & `UpdateSetlistBodySchema`:**
   - Valida longitud obligatoria del título (1 a 255 caracteres).
   - Valida formato ISO 8601 estricto en fechas programadas (`.datetime()`).
   - Valida que `directorUserId` sea un UUID válido cuando se suministra.
   - Limita notas a un máximo de 2000 caracteres.
2. **`SetlistStatusTransitionBodySchema`:**
   - Permite estrictamente `'PLANNING'`, `'ACTIVE'`, `'COMPLETED'`, `'ARCHIVED'`.
   - Rechaza strings arbitrarios, valores nulos o tipos incorrectos.
3. **`CreateSetlistItemBodySchema` (Unión Discriminada Polimórfica):**
   - Si `itemType === 'SONG'`: Exige `songId` como UUID; valida rango de `targetBpm` (20 a 300); valida enum `transitionType` (`SEGUE`, `CROSSFADE`, `STOP`, `MEDLEY`) asignando `'STOP'` como valor por defecto.
   - Si `itemType === 'SERVICE_MOMENT'`: Exige `momentTitle` no vacío (1 a 255 chars); valida rango de `durationMinutes` (1 a 180 min); valida clave musical si se suministra.
   - Si `itemType` es omitido o no coincide con el discriminador: rechaza inmediatamente con error descriptivo.
4. **`ReorderSetlistItemsBodySchema`:**
   - Valida que `itemIds` sea un array de UUIDs.
   - Rechaza listas vacías (`.min(1)`).
   - Refinamiento contra duplicados: rechaza si existen elementos repetidos (`new Set(items).size === items.length`).
5. **`ListSetlistsQuerySchema`:**
   - Coerción segura de enteros para `limit` (1-100, default 20) y `offset` (min 0, default 0).
   - Preprocesamiento de string booleano (`'true'` / `'false'`) para el filtro `upcoming`.

---

## 5. Pruebas Creadas y Ejecutadas (Evidencia Concreta)

### 5.1 Nueva Suite WS2: `setlist-domain-and-schemas.test.ts`
32 pruebas automatizadas creadas y ejecutadas sobre Node.js Test Runner:

```text
▶ Phase 2C — WS2: Setlist Domain, RBAC Permissions & Zod Schemas
  ▶ 1. RBAC Domain Permissions and Role Mapping
    ✔ 1.1 should define all 7 required Phase 2C Setlist permissions (1.8166ms)
    ✔ 1.2 should grant full setlist permissions to ADMIN (0.2449ms)
    ✔ 1.3 should grant workflow permissions to WORSHIP_LEADER but strictly deny setlists:delete (0.1742ms)
    ✔ 1.4 should grant only read permissions to MUSICIAN and reject all mutations (0.122ms)
    ✔ 1.5 should grant only read permissions to VIEWER and reject all mutations (0.139ms)
  ✔ 1. RBAC Domain Permissions and Role Mapping (3.6912ms)
  ▶ 2. Setlist Creation and Update Schemas
    ✔ 2.1 should validate a valid complete setlist creation payload (1.7373ms)
    ✔ 2.2 should validate a minimal setlist creation payload (only title) (0.1954ms)
    ✔ 2.3 should reject setlist creation with empty title or title > 255 chars (0.4939ms)
    ✔ 2.4 should reject invalid date format in scheduledDateTime (0.6675ms)
    ✔ 2.5 should reject non-UUID directorUserId (0.7584ms)
    ✔ 2.6 should validate and accept valid setlist update payloads (0.3217ms)
    ✔ 2.7 should reject setlist update with empty title if provided (0.2348ms)
  ✔ 2. Setlist Creation and Update Schemas (4.9495ms)
  ▶ 3. Setlist Status Transition Schema
    ✔ 3.1 should accept valid status transitions (0.5127ms)
    ✔ 3.2 should reject invalid or unexpected status values (0.9936ms)
  ✔ 3. Setlist Status Transition Schema (1.6961ms)
  ▶ 4. Polymorphic Setlist Item Creation Schema
    ✔ 4.1 should validate a complete SONG item payload (0.5678ms)
    ✔ 4.2 should validate a minimal SONG item payload with default transition STOP (0.1281ms)
    ✔ 4.3 should reject SONG item missing songId or with invalid songId (0.1354ms)
    ✔ 4.4 should reject SONG item with out-of-range targetBpm (< 20 or > 300) (0.169ms)
    ✔ 4.5 should reject SONG item with invalid transitionType (0.146ms)
    ✔ 4.6 should validate a complete SERVICE_MOMENT item payload (0.1167ms)
    ✔ 4.7 should reject SERVICE_MOMENT item with missing or empty momentTitle (0.1339ms)
    ✔ 4.8 should reject SERVICE_MOMENT item with invalid durationMinutes (<= 0 or > 180) (0.1296ms)
    ✔ 4.9 should reject item payload with unknown or missing itemType discriminator (0.1277ms)
  ✔ 4. Polymorphic Setlist Item Creation Schema (1.9062ms)
  ▶ 5. Setlist Item Update Schema
    ✔ 5.1 should accept valid partial updates for items (0.3987ms)
    ✔ 5.2 should reject empty update payload with no fields (0.1344ms)
  ✔ 5. Setlist Item Update Schema (0.6054ms)
  ▶ 6. Reorder Setlist Items Schema
    ✔ 6.1 should accept a valid array of distinct UUIDs (0.2983ms)
    ✔ 6.2 should reject empty itemIds array (0.0928ms)
    ✔ 6.3 should reject itemIds containing duplicate UUIDs (0.3097ms)
    ✔ 6.4 should reject itemIds containing invalid UUID strings (0.4664ms)
  ✔ 6. Reorder Setlist Items Schema (1.4335ms)
  ▶ 7. Query and Param Schemas
    ✔ 7.1 should parse and coerce query params with valid defaults (0.522ms)
    ✔ 7.2 should validate valid UUID path params (0.2562ms)
    ✔ 7.3 should reject invalid UUID in path params (0.172ms)
  ✔ 7. Query and Param Schemas (1.1428ms)
✔ Phase 2C — WS2: Setlist Domain, RBAC Permissions & Zod Schemas (16.4068ms)
ℹ tests 32 | suites 8 | pass 32 | fail 0 | skipped 0
```

### 5.2 Suite Completa de Backend (Regresión)
- **Comando:** `npm test`
- **Suites:** 20 suites ejecutadas
- **Pruebas Totales:** **91 pruebas** (59 pruebas preexistentes + 32 pruebas nuevas de WS2)
- **Resultados:** **91 PASS / 0 FAIL / 0 SKIPPED** (Duración: ~33.8s)

### 5.3 Suite Completa de Frontend (Regresión)
- **Comando:** `npm test`
- **Suites:** 36 suites ejecutadas
- **Pruebas Totales:** **184 pruebas**
- **Resultados:** **184 PASS / 0 FAIL / 0 SKIPPED** (Duración: ~2.2s)
- **Escenarios Dorados A–D:** 100% operativos.

### 5.4 Consolidado Global de Pruebas
$$\text{Total Pruebas del Sistema} = 91 \text{ (backend)} + 184 \text{ (frontend)} = \mathbf{275 / 275 \text{ PASS (100\%)}}$$

### 5.5 Verificación de Tipos TypeScript (`tsc --noEmit`)
- `backend`: **PASS (0 errores)**
- `frontend`: **PASS (0 errores)**

---

## 6. Verificación de Invariantes y No-Regresión

1. **`CanonicalMusicPayload`:** Cero mutaciones; los contratos musicales no han sido tocados.
2. **`totalMelodyNotes === 0`:** Totalmente preservado para contenido ChordPro.
3. **Arquitectura de Autenticación:** Se mantienen intactos el hashing Argon2id, el esquema JWT HS256, la rotación de refresh tokens y las cookies HttpOnly.
4. **Límites de WS2 Respetados:** Cero código de repositorios, servicios o rutas HTTP implementado en WS2.

---

## 7. Limitaciones Conocidas y Riesgos Restantes

1. **Consumo en Capa HTTP:** Los esquemas Zod y permisos definidos en WS2 serán cableados formalmente a endpoints en WS5 (`setlist.routes.ts`) y al repositorio en WS3.
2. **Verificación de Rol en Base de Datos:** Los permisos se encuentran plenamente validados a nivel de tipos y estructura de roles; su aplicación con `verifyDatabaseRole = true` en llamadas HTTP reales ocurrirá en WS5.

---

## 8. Estado de la Compuerta de Salida (Exit Gate WS2)

| Criterio del Exit Gate WS2 | Requisito | Resultado | Estado |
|---|---|---|---|
| Permisos de Setlists | 7 permisos agregados a `Permission` | Verificado en `auth-types.ts` | **PASSED** |
| Matriz de Roles | Mapeo explícito sin herencia implícita | Verificado en 5 pruebas unitarias | **PASSED** |
| Esquemas Zod de Setlist | Validación completa de creación, edición y estados | Verificado en 11 pruebas | **PASSED** |
| Validación Polimórfica | `z.discriminatedUnion` para `SONG` y `SERVICE_MOMENT` | Verificado en 9 pruebas | **PASSED** |
| Validación de Reordenamiento | Detección de duplicados, array no vacío y UUIDs | Verificado en 4 pruebas | **PASSED** |
| Pruebas Nuevas WS2 | $\ge 15$ pruebas de dominio y esquemas | 32 pruebas nuevas pasando | **PASSED** |
| Regresión Backend | 59 pruebas preexistentes pasando | 91/91 pruebas pasando (59 + 32) | **PASSED** |
| Regresión Frontend | 184 pruebas preexistentes pasando | 184/184 pruebas pasando | **PASSED** |
| Tipado Estricto | `tsc --noEmit` con 0 errores | 0 errores en backend y frontend | **PASSED** |
| Invariantes Musicales | `CanonicalMusicPayload` y Golden Scenarios intactos | Verificado al 100% | **PASSED** |

$$\mathbf{WS2\ EXIT\ GATE:\ IMPLEMENTED\ \&\ VERIFIED\ (PASSED)}$$

El sistema se encuentra detenido en este punto límite. **WS3 (Repository and SQL Transactions)** no ha sido iniciado y se encuentra en espera de su autorización explícita.

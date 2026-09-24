# BETHESDA WORSHIP STUDIO
## Phase 2C — Reporte de Implementación y Verificación: Workstream 4 (WS4)
### Servicio de Aplicación (`SetlistService`) y Orquestación Litúrgica

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Etapa:** **Workstream 4 (WS4) — SetlistService / Business Logic**  
**Documento Oficial Autorizado:** `PHASE_2C_WS4_IMPLEMENTATION_REPORT.md` y `docs/PHASE_2C_WS4_IMPLEMENTATION_REPORT.md`  
**Fecha:** 20 de Septiembre de 2026  
**Línea Base Previa:** WS3 Implementado y Reconciliado (297/297 pruebas globales: 113 backend + 184 frontend)  
**Estado de Salida:** **IMPLEMENTED & VERIFIED (EXIT GATE WS4 APROBADO)**  
**Estado de WS5:** **NOT STARTED (SISTEMA ESTRICTAMENTE DETENIDO)**

---

## 1. Alcance Implementado en WS4

En estricta conformidad con la autorización explícita de reglas de negocio y el preflight aprobado (`PHASE_2C_WS4_PREFLIGHT.md`), el Workstream 4 implementó la capa de **lógica de negocio y orquestación del servicio de aplicación** para Setlists y Momentos Litúrgicos:

1. **Creación del Servicio de Aplicación (`SetlistService`):**
   Implementado en [`backend/src/application/setlist-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/setlist-service.ts), operando limpiamente sobre la abstracción [`ISetlistRepository`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/setlist-repository.ts) y [`ISongRepository`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/song-repository.ts).
2. **Implementación de la Regla A (Invariante de Único Setlist `ACTIVE` — Alternativa A.1):**
   - Garantía global a nivel de congregación de que solo puede existir **un único Setlist en estado `ACTIVE` simultáneamente**.
   - Si se solicita activar un setlist existiendo ya otro en estado `ACTIVE`, la operación es rechazada de inmediato arrojando `ConflictError` sin alterar ni mutar ninguno de los dos cultos. Cero mecanismos de forzado (`force: true`) en este workstream.
3. **Implementación de la Regla B (Máquina de Estados Litúrgicos Estricta):**
   - Transiciones permitidas: `PLANNING -> ACTIVE`, `PLANNING -> ARCHIVED`, `ACTIVE -> COMPLETED`, `ACTIVE -> PLANNING`, `COMPLETED -> ARCHIVED`.
   - Transiciones explícitamente rechazadas con `ConflictError`: `COMPLETED -> ACTIVE`, `ARCHIVED -> PLANNING`, `ARCHIVED -> ACTIVE`, etc.
   - Idempotencia garantizada: transicionar al mismo estado (`PLANNING -> PLANNING`, `ACTIVE -> ACTIVE`, etc.) retorna la entidad sin error ni mutación.
4. **Implementación de la Regla C (Inmutabilidad Histórica en `COMPLETED` y `ARCHIVED`):**
   - Los cultos concluidos o archivados son de solo lectura litúrgica. Cualquier invocación a `addItem`, `updateItem`, `removeItem` o `reorderItems` sobre un setlist en estos estados es rechazada con `ConflictError`.
5. **Validación Polimórfica de Elementos:**
   - **`SONG`:** Exige `songId` válido y existente en el repositorio de canciones; soporta `targetKey`, `targetBpm`, `transitionType` (`SEGUE`, `CROSSFADE`, `STOP`, `MEDLEY`) y `notesForTeam`.
   - **`SERVICE_MOMENT`:** Exige `momentTitle` no vacío; permite `durationMinutes`, `musicalKey` (pad de fondo) y `notesForTeam`; prohíbe terminantemente `songId`.
6. **Delegación Transaccional:**
   - Delegación completa del reordenamiento atómico y compactación de secuencias a `ISetlistRepository`.
   - Cero acceso directo a base de datos desde `SetlistService`.

---

## 2. Arquitectura de `SetlistService` y Fronteras de Capa

```
┌────────────────────────────────────────────────────────┐
│ Rutas Fastify y Controladores HTTP (WS5 - NOT STARTED) │  ◄── RBAC en transporte & verifyDatabaseRole
└───────────────────────────┬────────────────────────────┘
                            │ (DTOs validados)
┌───────────────────────────▼────────────────────────────┐
│ SetlistService (WS4 - IMPLEMENTED & VERIFIED)          │  ◄── Reglas de negocio litúrgicas puras
└───────────────────────────┬────────────────────────────┘
                            │ (ISetlistRepository / ISongRepository)
┌───────────────────────────▼────────────────────────────┐
│ DrizzleSetlistRepository / PostgreSQL (WS3)            │  ◄── Persistencia atómica SQL & Row-lock
└────────────────────────────────────────────────────────┘
```

- **Transport-Agnostic:** `SetlistService` no utiliza ni importa tipos de Fastify, cabeceras HTTP, cookies ni códigos numéricos de estado.
- **Sin Dependencias de Infraestructura:** El servicio recibe sus repositorios mediante inyección de dependencias en el constructor:
  ```typescript
  export class SetlistService {
    public constructor(
      private readonly setlistRepo: ISetlistRepository,
      private readonly songRepo?: ISongRepository
    ) {}
    ...
  }
  ```

---

## 3. Matriz Exhaustiva de la Máquina de Estados Litúrgicos (Regla B)

| Estado Origen | Estado Destino | Decisión de Negocio | Comportamiento en `SetlistService` |
|:---|:---|:---:|---|
| `PLANNING` | `ACTIVE` | **PERMITIDO** | Verifica que no exista otro setlist activo; persiste estado `ACTIVE`. |
| `PLANNING` | `ARCHIVED` | **PERMITIDO** | Cancelación o descarte de culto programado; persiste `ARCHIVED`. |
| `ACTIVE` | `COMPLETED` | **PERMITIDO** | Conclusión litúrgica formal del servicio; persiste `COMPLETED`. |
| `ACTIVE` | `PLANNING` | **PERMITIDO** | Reversión a borrador (ej. activado por error en ensayo); persiste `PLANNING`. |
| `COMPLETED` | `ARCHIVED` | **PERMITIDO** | Archivo histórico del servicio finalizado; persiste `ARCHIVED`. |
| `COMPLETED` | `ACTIVE` | **RECHAZADO** | Emite `ConflictError`: *"no se puede cambiar de 'COMPLETED' a 'ACTIVE'"*. |
| `ARCHIVED` | `PLANNING` | **RECHAZADO** | Emite `ConflictError`: *"no se puede cambiar de 'ARCHIVED' a 'PLANNING'"*. |
| `ARCHIVED` | `ACTIVE` | **RECHAZADO** | Emite `ConflictError`: *"no se puede cambiar de 'ARCHIVED' a 'ACTIVE'"*. |
| `ARCHIVED` | `COMPLETED`| **RECHAZADO** | Emite `ConflictError`: *"no se puede cambiar de 'ARCHIVED' a 'COMPLETED'"*. |
| Cualquier $S$ | Mismo $S$ | **IDEMPOTENTE** | Retorna la entidad actual de inmediato sin emitir mutación ni error. |

---

## 4. Archivos Creados y Modificados en WS4

| Archivo | Acción | Propósito y Contenido |
|---|---|---|
| [`backend/src/application/setlist-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/setlist-service.ts) | **CREADO** | Clase `SetlistService` con orquestación completa, máquina de estados, validaciones polimórficas y control de invariantes. |
| [`backend/src/__tests__/setlist-service.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/setlist-service.test.ts) | **CREADO** | Suite de 40 pruebas unitarias y de reglas de negocio ejecutadas en Node.js Test Runner. |
| [`PHASE_2C_WS4_PREFLIGHT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_WS4_PREFLIGHT.md) | **CREADO** | Documento preflight formal en raíz del proyecto. |
| [`docs/PHASE_2C_WS4_PREFLIGHT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema musical - partituras/BETHESDA WORSHIP STUDIO/docs/PHASE_2C_WS4_PREFLIGHT.md) | **CREADO** | Copia sincronizada del preflight en `docs/`. |
| [`PHASE_2C_WS4_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_WS4_IMPLEMENTATION_REPORT.md) | **CREADO** | Reporte oficial de ingeniería de WS4 en raíz. |
| [`docs/PHASE_2C_WS4_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/PHASE_2C_WS4_IMPLEMENTATION_REPORT.md) | **CREADO** | Copia sincronizada del reporte oficial en `docs/`. |

---

## 5. Pruebas Creadas para WS4 (`setlist-service.test.ts`)

40 pruebas automatizadas creadas y ejecutadas sobre Node.js Test Runner:

```text
▶ Phase 2C — WS4: SetlistService Business Logic Tests
  ▶ 1. Setlist CRUD Operations
    ✔ 1.1 should create a setlist with title and default PLANNING status (0.9269ms)
    ✔ 1.2 should reject setlist creation with empty or whitespace-only title (0.7549ms)
    ✔ 1.3 should reject creating directly as ACTIVE if another setlist is already ACTIVE (0.476ms)
    ✔ 1.4 should retrieve an existing setlist with items via getSetlist (0.9162ms)
    ✔ 1.5 should throw NotFoundError when getSetlist target does not exist (0.1942ms)
    ✔ 1.6 should list setlists with pagination through listSetlists (0.1865ms)
    ✔ 1.7 should update setlist title and notes via updateSetlist (0.2491ms)
    ✔ 1.8 should reject updating setlist with empty title (0.1882ms)
    ✔ 1.9 should delete an existing setlist via deleteSetlist (0.2493ms)
    ✔ 1.10 should throw NotFoundError when attempting to delete a non-existent setlist (0.2501ms)
  ✔ 1. Setlist CRUD Operations (5.371ms)
  ▶ 2. State Machine & Single ACTIVE Invariant
    ✔ 2.1 should allow PLANNING -> ACTIVE when no other setlist is ACTIVE (0.3051ms)
    ✔ 2.2 should REJECT PLANNING -> ACTIVE when another setlist is already ACTIVE (Rule A) (0.2498ms)
    ✔ 2.3 should allow ACTIVE -> COMPLETED (natural conclusion of service) (0.1038ms)
    ✔ 2.4 should allow ACTIVE -> PLANNING (revert to draft if activated by mistake) (0.0795ms)
    ✔ 2.5 should allow COMPLETED -> ARCHIVED (historical archiving) (0.1186ms)
    ✔ 2.6 should allow PLANNING -> ARCHIVED (direct cancellation) (0.0827ms)
    ✔ 2.7 should REJECT COMPLETED -> ACTIVE (cannot reactivate completed service) (0.2708ms)
    ✔ 2.8 should REJECT ARCHIVED -> PLANNING (unsupported unarchiving) (0.1673ms)
    ✔ 2.9 should be IDEMPOTENT for same-state transitions (no error, returns entity) (0.1364ms)
  ✔ 2. State Machine & Single ACTIVE Invariant (1.7168ms)
  ▶ 3. Polymorphic Item Creation & Validation
    ✔ 3.1 should create a SONG item with valid songId and transition (0.4011ms)
    ✔ 3.2 should reject SONG item with missing songId (0.1741ms)
    ✔ 3.3 should reject SONG item when referenced songId does not exist in songs repository (0.1448ms)
    ✔ 3.4 should create a SERVICE_MOMENT item with title, duration, and pad musicalKey (0.1003ms)
    ✔ 3.5 should reject SERVICE_MOMENT item with empty or missing momentTitle (0.1011ms)
    ✔ 3.6 should reject SERVICE_MOMENT item if songId is provided (0.3751ms)
    ✔ 3.7 should reject unrecognized itemType (0.1748ms)
  ✔ 3. Polymorphic Item Creation & Validation (1.6634ms)
  ▶ 4. Finalized Setlist Immutability (Rule C)
    ✔ 4.1 should reject addItem on COMPLETED setlist with ConflictError (0.2518ms)
    ✔ 4.2 should reject addItem on ARCHIVED setlist with ConflictError (0.1407ms)
    ✔ 4.3 should reject updateItem on COMPLETED or ARCHIVED setlist (0.2748ms)
    ✔ 4.4 should reject removeItem on COMPLETED or ARCHIVED setlist (0.1784ms)
    ✔ 4.5 should reject reorderItems on COMPLETED or ARCHIVED setlist (0.3066ms)
  ✔ 4. Finalized Setlist Immutability (Rule C) (1.3093ms)
  ▶ 5. Item Mutation & Reordering
    ✔ 5.1 should update item properties in PLANNING state (0.2816ms)
    ✔ 5.2 should throw NotFoundError when updating an item not in setlist (0.1112ms)
    ✔ 5.3 should remove item in PLANNING state (0.1356ms)
    ✔ 5.4 should successfully reorder items and delegate to repository (0.2298ms)
    ✔ 5.5 should reject reorder with empty itemIds array (0.1355ms)
    ✔ 5.6 should reject reorder with duplicate IDs (0.1227ms)
    ✔ 5.7 should reject reorder when item count does not match setlist items count (0.1262ms)
    ✔ 5.8 should reject reorder when an ID does not belong to the setlist (0.1064ms)
  ✔ 5. Item Mutation & Reordering (1.4166ms)
  ▶ 6. Error Propagation & Resilience
    ✔ 6.1 should propagate PersistenceError from repository transparently (0.1598ms)
  ✔ 6. Error Propagation & Resilience (0.2096ms)
✔ Phase 2C — WS4: SetlistService Business Logic Tests (12.3233ms)
ℹ tests 40 | suites 7 | pass 40 | fail 0 | skipped 0
```

---

## 6. Resultados de Regresión del Sistema Completo

### 6.1 Backend (`npm test`)
- **Suites Ejecutadas:** 33 suites
- **Resultados:** **153 PASS / 0 FAIL / 0 SKIPPED**
- **Evolución Trazable:**
  - Línea base pre-WS4: 113 pruebas
  - Nuevas pruebas WS4: 40 pruebas
  - Total verificado: $113 + 40 = \mathbf{153 \text{ pruebas}}$

### 6.2 Frontend (`npm test`)
- **Suites Ejecutadas:** 36 suites
- **Resultados:** **184 PASS / 0 FAIL / 0 SKIPPED**
- **Escenarios Dorados A–D:** 100% operativos.
- **Invariante ChordPro:** `totalMelodyNotes === 0` estrictamente preservada.

### 6.3 Consolidado Global
$$\text{Total Pruebas del Sistema} = 153 \text{ (backend)} + 184 \text{ (frontend)} = \mathbf{337 / 337 \text{ PASS (100\%)}}$$

### 6.4 Verificación de Tipos TypeScript (`tsc --noEmit`)
- `backend`: **PASS (0 errores)**
- `frontend`: **PASS (0 errores)**

---

## 7. Verificación de Base de Datos e Integridad de Datos

Verificación directa mediante consultas al pool de PostgreSQL:
- **Canciones Canónicas:** **125** canciones preservadas intactas.
- **Usuarios de la Congregación:** **108** usuarios preservados intactos.
- **Setlists en Base de Datos:** **0** (cero fugas de datos de prueba).
- **Tablas Phase 2A y 2B:** Intactas y operativas.

---

## 8. Preservación de Invariantes Musicales y de Seguridad

1. **`CanonicalMusicPayload`:** Sin mutaciones; totalmente inalterado.
2. **Seguridad y Criptografía:** Argon2id, JWT HS256, cookies HttpOnly, refresco y auditoría sin modificaciones.
3. **Desacoplamiento de Transporte:** Cero código HTTP o Fastify en `SetlistService`.

---

## 9. Lista de Verificación del Exit Gate WS4

| Requisito del Exit Gate WS4 | Criterio de Aceptación | Estado |
|---|---|:---:|
| Preflight Técnico Aprobado | `PHASE_2C_WS4_PREFLIGHT.md` formalizado y sincronizado | **PASSED** |
| Servicio de Aplicación | `SetlistService` implementado con tipado estricto | **PASSED** |
| Regla A (Único Setlist ACTIVE) | Alternativa A.1 implementada con `ConflictError` sin forzados | **PASSED** |
| Regla B (Máquina de Estados) | Transiciones autorizadas validadas; rechazos estrictos; idempotencia | **PASSED** |
| Regla C (Inmutabilidad Histórica) | Ítems en `COMPLETED` y `ARCHIVED` son de solo lectura | **PASSED** |
| Validación Polimórfica | Validaciones estrictas de `SONG` y `SERVICE_MOMENT` | **PASSED** |
| Delegación de Persistencia | Delegación limpia a `ISetlistRepository` sin SQL directo | **PASSED** |
| Inmutabilidad Musical | Cero mutación en tablas `songs` y `song_versions` | **PASSED** |
| Pruebas Focalizadas WS4 | 40 pruebas automatizadas creadas y pasando (40/40) | **PASSED** |
| Regresión Backend | 153 / 153 pruebas pasando | **PASSED** |
| Regresión Frontend | 184 / 184 pruebas pasando (Escenarios Dorados A–D OK) | **PASSED** |
| Verificación TypeScript | 0 errores en backend y frontend | **PASSED** |
| Integridad de Base de Datos | 125 canciones y 108 usuarios intactos; 0 setlists residuales | **PASSED** |
| Documentación Sincronizada | Reportes sincronizados y verificados con SHA-256 | **PASSED** |
| Límite Estricto de Fase | WS5 (Fastify Routes / Controllers) NO iniciado | **PASSED** |

$$\mathbf{WS4\ EXIT\ GATE:\ IMPLEMENTED\ \&\ VERIFIED\ (PASSED)}$$

---

## 10. Confirmación de Límite de Trabajo

Se confirma formalmente que:
- **Workstream 4 (SetlistService) está COMPLETAMENTE IMPLEMENTADO Y VERIFICADO.**
- **Workstream 5 (Fastify Routes, Controladores HTTP y RBAC en Transporte) NO HA SIDO INICIADO.**
- El sistema se encuentra detenido y en reposo, en espera de la autorización explícita para WS5.

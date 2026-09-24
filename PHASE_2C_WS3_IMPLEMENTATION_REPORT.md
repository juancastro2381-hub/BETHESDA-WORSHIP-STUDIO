# BETHESDA WORSHIP STUDIO
## Phase 2C — Reporte de Implementación y Verificación: Workstream 3 (WS3)
### Capa de Repositorio, Transacciones SQL y Reordenamiento Atómico

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Etapa:** **Workstream 3 (WS3) — Repository and SQL Transactions**  
**Documento Oficial Autorizado:** `PHASE_2C_WS3_IMPLEMENTATION_REPORT.md` y `docs/PHASE_2C_WS3_IMPLEMENTATION_REPORT.md`  
**Fecha:** 20 de Septiembre de 2026  
**Línea Base Previa:** WS2 Implementado y Verificado (275 pruebas pasando: 91 backend + 184 frontend)  
**Estado de Salida:** **IMPLEMENTED & VERIFIED (EXIT GATE WS3 APROBADO)**  
**Estado de WS4:** **NOT STARTED (ESTRICTAMENTE DETENIDO)**

---

## 1. Alcance Implementado en WS3

El alcance de WS3 se centró exclusivamente en la **capa de persistencia, abstracción de repositorio y garantías transaccionales atómicas en PostgreSQL/Drizzle**, sin implementar lógica de negocio de servicios (WS4), rutas HTTP (WS5) ni componentes de interfaz (WS6/WS7):

1. **Definición de DTOs de Persistencia:** Enriquecimiento de `backend/src/domain/setlist-types.ts` con interfaces DTO para mutación de setlists e ítems (`CreateSetlistDTO`, `UpdateSetlistDTO`, `CreateSetlistItemDTO`, `UpdateSetlistItemDTO`, `ReorderSetlistItemsDTO`).
2. **Interfaz de Repositorio (`ISetlistRepository`):** Contrato desacoplado para operaciones CRUD de Setlists, gestión polimórfica de ítems (`SONG` y `SERVICE_MOMENT`), consultas con paginación/filtros y reordenamiento atómico.
3. **Implementación de Repositorio (`DrizzleSetlistRepository`):** Persistencia sobre PostgreSQL utilizando Drizzle ORM, respetando transacciones SQL (`db.transaction`), manejo de errores de dominio y proyecciones de agregados.
4. **Reordenamiento Atómico con Protección de Concurrencia:** Bloqueo pesimista de fila en PostgreSQL (`SELECT ... FOR UPDATE`), validación de pertenencia e integridad de cardinalidad, actualización en bloque dentro de una transacción SQL única y reversión total (`ROLLBACK`) ante fallos.
5. **Preservación Estricta de Integridad Referencial:** Eliminación en cascada limitada a ítems de setlists (`onDelete: 'cascade'`) garantizando que las canciones canónicas (`songs`) jamás sean modificadas o eliminadas (`onDelete: 'restrict'`).

---

## 2. Arquitectura de Repositorio

La persistencia de Setlists sigue el patrón Repository establecido en las fases 2A y 2B:
- **Aislamiento de Dominio:** Los métodos del repositorio aceptan DTOs de dominio y retornan entidades puras (`SetlistEntity`, `SetlistWithItemsEntity`, `SetlistItemWithSongEntity`, `SetlistSummaryEntity`), evitando exponer tipos internos de Drizzle o drivers SQL al resto de la aplicación.
- **Transaccionalidad Explícita:** Todas las operaciones que involucran mutaciones dependientes (creación de ítems con reordenamiento, compactación de secuencias al eliminar, reordenamiento de listas) se ejecutan dentro de transacciones de base de datos (`this.db.transaction(async (tx) => { ... })`).
- **Inyección de Dependencias:** El repositorio recibe opcionalmente una instancia de `Database` (por defecto `db`), permitiendo inyectar conexiones o transacciones para pruebas o composición.

---

## 3. Interfaz de Repositorio (`ISetlistRepository`)

Ubicada en `backend/src/repositories/setlist-repository.ts`:

```typescript
export interface ISetlistRepository {
  // Setlist CRUD
  list(filter?: SetlistFilterOptions): Promise<{ items: SetlistSummaryEntity[]; total: number }>;
  findById(id: string): Promise<SetlistWithItemsEntity | null>;
  create(dto: CreateSetlistDTO): Promise<SetlistEntity>;
  update(id: string, dto: UpdateSetlistDTO): Promise<SetlistEntity | null>;
  updateStatus(id: string, status: SetlistStatus): Promise<SetlistEntity | null>;
  delete(id: string): Promise<boolean>;

  // Setlist Items CRUD
  listItemsBySetlist(setlistId: string): Promise<SetlistItemWithSongEntity[]>;
  findItemById(itemId: string): Promise<SetlistItemWithSongEntity | null>;
  createItem(setlistId: string, dto: CreateSetlistItemDTO): Promise<SetlistItemWithSongEntity>;
  updateItem(setlistId: string, itemId: string, dto: UpdateSetlistItemDTO): Promise<SetlistItemWithSongEntity | null>;
  deleteItem(setlistId: string, itemId: string): Promise<boolean>;

  // Atomic Reordering
  reorderItems(setlistId: string, itemIds: string[]): Promise<SetlistItemWithSongEntity[]>;
}
```

---

## 4. Métodos Implementados en `DrizzleSetlistRepository`

| Método | Tipo | Propósito y Comportamiento |
|---|---|---|
| `list` | Consulta | Retorna listado paginado y filtrado de resúmenes de setlists con total count, cálculo de `totalItems` y `totalSongs`, y nombre del director. |
| `findById` | Consulta | Retorna el agregado completo con datos del setlist, nombre del director y la lista ordenada de ítems vinculados a los resúmenes de canciones. |
| `create` | Mutación | Inserta un nuevo setlist con estado inicial `PLANNING` (o el suministrado) y fechas normalizadas. |
| `update` | Mutación | Aplica actualizaciones parciales a título, fecha programada, director y notas, actualizando `updatedAt`. |
| `updateStatus` | Mutación | Persiste el cambio de estado litúrgico (`PLANNING`, `ACTIVE`, `COMPLETED`, `ARCHIVED`) y actualiza el timestamp. |
| `delete` | Mutación | Elimina el setlist en la base de datos (cascada a ítems; restricción sobre canciones). Retorna booleano. |
| `listItemsBySetlist` | Consulta | Retorna los elementos de un setlist ordenados por `sequenceOrder ASC` con metadatos de canciones. |
| `findItemById` | Consulta | Consulta un ítem individual por su identificador único. |
| `createItem` | Transacción | Verifica existencia de setlist y canción, calcula la secuencia o desplaza existentes, inserta el ítem y actualiza el setlist padre. |
| `updateItem` | Transacción | Modifica atributos litúrgicos o de ejecución de un ítem y actualiza `updatedAt` del setlist padre. |
| `deleteItem` | Transacción | Elimina el ítem y recompacta automáticamente las secuencias de los elementos subsiguientes para no dejar huecos. |
| `reorderItems` | Transacción | Bloquea el setlist padre (`FOR UPDATE`), valida pertenencia y conteo exacto de IDs, y aplica la nueva secuencia atómicamente. |

---

## 5. Consultas y Operaciones SQL Implementadas

1. **Listado con Conteo Eficiente (Sin problema N+1):**
   ```sql
   SELECT 
     setlists.id, setlists.title, setlists.scheduled_date_time, setlists.status,
     setlists.director_user_id, users.first_name, users.last_name,
     (SELECT count(*)::int FROM setlist_items WHERE setlist_items.setlist_id = setlists.id) as total_items,
     (SELECT count(*)::int FROM setlist_items WHERE setlist_items.setlist_id = setlists.id AND setlist_items.item_type = 'SONG') as total_songs,
     setlists.created_at, setlists.updated_at
   FROM setlists
   LEFT JOIN users ON setlists.director_user_id = users.id
   WHERE ...
   ORDER BY setlists.scheduled_date_time DESC, setlists.created_at DESC
   LIMIT $1 OFFSET $2;
   ```
2. **Consulta de Agregado con Canciones Vinculadas:**
   ```sql
   SELECT setlist_items.*, songs.id, songs.title, songs.artist, songs.default_key, songs.default_bpm, songs.time_signature, songs.status
   FROM setlist_items
   LEFT JOIN songs ON setlist_items.song_id = songs.id
   WHERE setlist_items.setlist_id = $1
   ORDER BY setlist_items.sequence_order ASC;
   ```
3. **Compactación Automática de Secuencias al Eliminar:**
   ```sql
   DELETE FROM setlist_items WHERE id = $1;
   UPDATE setlist_items 
   SET sequence_order = sequence_order - 1, updated_at = NOW() 
   WHERE setlist_id = $2 AND sequence_order > $3;
   ```

---

## 6. Límites y Fronteras de Transacción

- Las lecturas simples (`findById`, `list`) se ejecutan directamente sobre el pool de conexiones de PostgreSQL.
- Las mutaciones compuestas se envuelven rígidamente dentro de `db.transaction(async (tx) => { ... })`:
  - `createItem`: Verificación de existencia de setlist + canción + cálculo/desplazamiento de secuencia + inserción + actualización de timestamp padre.
  - `deleteItem`: Eliminación de ítem + decremento de secuencias posteriores + actualización de timestamp padre.
  - `reorderItems`: Bloqueo de concurrencia + verificación de integridad de conjunto + actualización de secuencias en bloque + actualización de timestamp padre.
- En caso de cualquier excepción lanzada durante el bloque de transacción, PostgreSQL emite un `ROLLBACK` total automático, garantizando cero estados huérfanos o inconsistentes.

---

## 7. Implementación de Reordenamiento Atómico

El reordenamiento de ítems cumple los 6 requisitos estrictos de la especificación:
1. **Verificación de Existencia:** Bloquea y verifica el setlist objetivo.
2. **Validación de Identificadores Duplicados:** Rechaza en memoria si `new Set(itemIds).size !== itemIds.length`.
3. **Validación de Cardinalidad:** Comprueba que `existingItems.length === itemIds.length`. Si un usuario omite elementos o agrega de más, la transacción es abortada de inmediato (`ValidationError`).
4. **Validación de Pertenencia Cruzada:** Comprueba que todos los IDs en `itemIds` pertenezcan a los ítems persistidos para ese setlist.
5. **Actualización Secuencial en Bloque:** Actualiza cada ítem asignando `sequenceOrder = index + 1`.
6. **Reversión Transaccional:** Demostrado empíricamente en la prueba `4.7`: un fallo intencional deja la secuencia original intacta sin modificaciones parciales.

---

## 8. Protección contra Condiciones de Carrera y Concurrencia

Para prevenir colisiones por reordenamientos simultáneos en el mismo setlist (ej. dos directores de alabanza reordenando en paralelo):
- Se ejecuta un **bloqueo pesimista a nivel de fila en PostgreSQL**:
  ```sql
  SELECT id FROM setlists WHERE id = $1 FOR UPDATE
  ```
- Cualquier transacción concurrente que intente reordenar o modificar la estructura del mismo setlist se suspende ordenadamente hasta que la primera transacción complete su `COMMIT` o `ROLLBACK`.
- Esto previene posiciones de secuencia duplicadas, secuencias incompletas o estados corruptos sin requerir sistemas externos de bloqueo distribuido (como Redis).

---

## 9. Comportamiento de Integridad Referencial

- **`setlists` $\to$ `setlist_items`:** Llave foránea configurada con `ON DELETE CASCADE`. Eliminar un setlist elimina limpiamente todos sus ítems asociados de forma automática.
- **`setlist_items` $\to$ `songs`:** Llave foránea configurada con `ON DELETE RESTRICT`. El repositorio jamás elimina ni muta una canción canónica al eliminar o modificar un ítem de setlist.
- **`setlists` $\to$ `users` (Director):** Llave foránea configurada con `ON DELETE SET NULL`. Si un usuario director es eliminado, el setlist preserva su integridad litúrgica con `directorUserId = null`.

---

## 10. Manejo de Errores y Diagnósticos

El repositorio no expone errores crudos de PostgreSQL ni códigos HTTP, traduciendo cualquier excepción al modelo de errores de dominio del proyecto (`AppError`):

| Error de Base de Datos / Dominio | Clase de Error Traducida | Código |
|---|---|---|
| Recurso no encontrado (Setlist, Canción) | `NotFoundError` | `NOT_FOUND` (404) |
| Fallo en validación estructural o pertenencia | `ValidationError` | `VALIDATION_ERROR` (400) |
| Conflicto de unicidad o concurrencia | `ConflictError` | `CONFLICT` (409) |
| Excepciones inesperadas de PostgreSQL/Drizzle | `PersistenceError` | `PERSISTENCE_ERROR` (500) |

---

## 11. Preservación del Límite de Autorización

- El repositorio es **completamente agnóstico de autorización HTTP**.
- La autorización RBAC (establecida en WS2) y la verificación autoritativa en base de datos (`verifyDatabaseRole = true`) se reservan para los controladores Fastify en WS5.
- Ningún control de seguridad de Phase 2B (Argon2id, JWT HS256, HttpOnly cookies, rotación de tokens) fue modificado ni debilitado.

---

## 12. Archivos Creados y Modificados

| Archivo | Acción | Propósito y Contenido |
|---|---|---|
| [`backend/src/domain/setlist-types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/setlist-types.ts) | **MODIFICADO** | Adición de DTOs de persistencia (`CreateSetlistDTO`, `UpdateSetlistDTO`, etc.). |
| [`backend/src/repositories/setlist-repository.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/setlist-repository.ts) | **CREADO** | Interfaz `ISetlistRepository` e implementación `DrizzleSetlistRepository`. |
| [`backend/src/__tests__/setlist-repository.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/setlist-repository.test.ts) | **CREADO** | Suite de pruebas de integración con PostgreSQL (22 pruebas automatizadas). |
| [`PHASE_2C_WS3_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_WS3_IMPLEMENTATION_REPORT.md) | **CREADO** | Reporte técnico formal en la raíz del proyecto. |
| [`docs/PHASE_2C_WS3_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/PHASE_2C_WS3_IMPLEMENTATION_REPORT.md) | **CREADO** | Copia sincronizada en el directorio de documentación. |

---

## 13. Pruebas Creadas para WS3 (`setlist-repository.test.ts`)

22 pruebas automatizadas ejecutadas contra PostgreSQL real en Node.js Test Runner:

```text
▶ Phase 2C — WS3: DrizzleSetlistRepository and SQL Transactions
  ▶ 1. Setlist CRUD Operations
    ✔ 1.1 should create a new setlist with default PLANNING status (13.4081ms)
    ✔ 1.2 should retrieve setlist by ID with director name and empty items list (14.2103ms)
    ✔ 1.3 should update setlist fields (5.5609ms)
    ✔ 1.4 should update setlist status transition to ACTIVE (7.5085ms)
    ✔ 1.5 should return null when querying non-existent setlist (3.0852ms)
  ✔ 1. Setlist CRUD Operations (45.3795ms)
  ▶ 2. Setlist Items & Polymorphic Persistence
    ✔ 2.1 should create a SONG item with execution overrides and default transition (12.2252ms)
    ✔ 2.2 should create a SERVICE_MOMENT item with auto sequence assignment (8.1838ms)
    ✔ 2.3 should retrieve items ordered by sequenceOrder via listItemsBySetlist (1.4327ms)
    ✔ 2.4 should update setlist item attributes (4.9414ms)
    ✔ 2.5 should delete an item and compact sequence numbers (11.0942ms)
  ✔ 2. Setlist Items & Polymorphic Persistence (40.7363ms)
  ▶ 3. Pagination & Filtering Queries
    ✔ 3.1 should filter by status COMPLETED (80.9701ms)
    ✔ 3.2 should filter by upcoming = true (2.4238ms)
    ✔ 3.3 should paginate correctly with limit and offset (3.5085ms)
  ✔ 3. Pagination & Filtering Queries (90.706ms)
  ▶ 4. Atomic Reorder Transactions and Concurrency Invariants
    ✔ 4.1 should successfully reorder items atomically (C -> A -> B) (10.5472ms)
    ✔ 4.2 should reject reorder with empty itemIds array (0.7339ms)
    ✔ 4.3 should reject reorder with duplicated IDs in array (0.3112ms)
    ✔ 4.4 should reject reorder when item count does not match setlist items count (4.8041ms)
    ✔ 4.5 should reject reorder when an item ID belongs to another setlist or does not exist (2.7112ms)
    ✔ 4.6 should reject reorder when setlistId does not exist (NotFoundError) (2.4213ms)
    ✔ 4.7 should verify rollback on failure: original sequence remains unaffected (4.9987ms)
  ✔ 4. Atomic Reorder Transactions and Concurrency Invariants (46.2506ms)
  ▶ 5. Referential Integrity & Delete Semantics
    ✔ 5.1 should fail to create a SONG item with a non-existent songId (4.3291ms)
    ✔ 5.2 should cascade-delete setlist items when setlist is deleted, without touching referenced song (12.4936ms)
  ✔ 5. Referential Integrity & Delete Semantics (17.0781ms)
✔ Phase 2C — WS3: DrizzleSetlistRepository and SQL Transactions (324.2332ms)
ℹ tests 22 | suites 6 | pass 22 | fail 0 | skipped 0
```

---

## 14. Pruebas de Regresión Ejecutadas

### 14.1 Backend
- **Comando:** `npm test`
- **Suites Ejecutadas:** 26 suites
- **Resultados:** **113 PASS / 0 FAIL / 0 SKIPPED** (91 previas + 22 agregadas de persistencia)

### 14.2 Frontend
- **Comando:** `npm test`
- **Suites Ejecutadas:** 36 suites
- **Resultados:** **184 PASS / 0 FAIL / 0 SKIPPED**
- **Escenarios Dorados A–D:** Totalmente operativos.

### 14.3 Total Consolidado
$$\text{Total Pruebas del Sistema} = 113 \text{ (backend)} + 184 \text{ (frontend)} = \mathbf{297 / 297 \text{ PASS (100\%)}}$$

---

## 15. Verificación de Tipos TypeScript (`tsc --noEmit`)

- `backend`: **PASS (0 errores)**
- `frontend`: **PASS (0 errores)**

---

## 16. Verificación de Base de Datos e Integridad de Datos

Tras la ejecución completa de la suite de pruebas de persistencia, se verificaron los registros en PostgreSQL:
- **Canciones canónicas existentes:** **125** (exactamente iguales al inicio).
- **Usuarios existentes:** **108** (exactamente iguales al inicio).
- **Setlists en base de datos:** **0** (todos los setlists y elementos de prueba fueron limpiados al 100% en el hook `after`).
- **Tablas de Phase 2A y 2B:** Intactas y operativas.

---

## 17. Verificación de Invariantes de Seguridad y Musicales

1. **`CanonicalMusicPayload`:** Sin mutaciones; completamente inmutable.
2. **`totalMelodyNotes === 0`:** Invariante ChordPro preservado en el frontend y en la persistencia.
3. **Mecanismos de Autenticación:** Argon2id, tokens de refresco, rotación y cookies HttpOnly intactos.

---

## 18. Limitaciones Conocidas y Riesgos Restantes

1. **Lógica de Flujo Litúrgico:** Las reglas de negocio de alto nivel (como garantizar que sólo exista un setlist en estado `ACTIVE` simultáneamente) corresponden a la capa de servicio `SetlistService` en WS4.
2. **Cableado de Controladores HTTP:** Los endpoints REST y la verificación de permisos RBAC en tiempo de ejecución se implementarán en WS5.

---

## 19. Lista de Verificación del Exit Gate WS3

| Requisito del Exit Gate WS3 | Criterio de Aceptación | Estado |
|---|---|:---:|
| Interfaz de Repositorio | `ISetlistRepository` definida con contratos limpios | **PASSED** |
| Implementación de Repositorio | `DrizzleSetlistRepository` implementado | **PASSED** |
| Setlist CRUD | Creación, lectura, edición y eliminación funcionales | **PASSED** |
| Persistencia de Ítems | Soporte polimórfico para `SONG` y `SERVICE_MOMENT` | **PASSED** |
| Paginación y Filtros | `limit`, `offset`, `status`, `upcoming` validados | **PASSED** |
| Reordenamiento Atómico | Transacción única, validación estricta y rollback comprobado | **PASSED** |
| Protección Concurrente | Bloqueo pesimista `FOR UPDATE` sobre fila de setlist | **PASSED** |
| Integridad Referencial | Cascada hacia ítems, restricción estricta sobre canciones | **PASSED** |
| Pruebas de Persistencia WS3 | 22 pruebas automatizadas creadas y pasando | **PASSED** |
| Pruebas de Regresión Backend | 113 / 113 pruebas pasando | **PASSED** |
| Pruebas de Regresión Frontend | 184 / 184 pruebas pasando | **PASSED** |
| Compilación TypeScript | 0 errores en backend y frontend | **PASSED** |
| Integridad de Datos Base | 125 canciones y 108 usuarios intactos sin fugas | **PASSED** |
| Invariantes Musicales | `CanonicalMusicPayload` y Escenarios Dorados intactos | **PASSED** |
| Documentación Sincronizada | Reportes raíz y docs verificados vía SHA-256 | **PASSED** |
| Confirmación Límite WS4 | WS4 no iniciado; sistema detenido en frontera WS3 | **PASSED** |

$$\mathbf{WS3\ EXIT\ GATE:\ IMPLEMENTED\ \&\ VERIFIED\ (PASSED)}$$

---

## 20. Confirmación de Límite de Trabajo

Se confirma formalmente que:
- **El Workstream 3 está COMPLETAMENTE IMPLEMENTADO Y VERIFICADO.**
- **El Workstream 4 (SetlistService) NO HA SIDO INICIADO.**
- El sistema se encuentra en reposo, esperando la autorización explícita para WS4.

---

## 21. Reconciliación Formal de Evidencia (WS3 Evidence Reconciliation)

En cumplimiento con el requerimiento de auditoría post-gate, se documenta la reconciliación formal y trazabilidad de los conteos de pruebas:

- **Conteo previo reportado en borrador de reporte:** 111 pruebas backend (91 base + 20 persistencia) / 295 total.
- **Conteo reportado en walkthrough y ejecuciones de consola:** 113 pruebas backend (91 base + 22 persistencia) / 297 total.
- **Conteo verificado independientemente en ejecución real:** **113 pruebas backend / 184 pruebas frontend / 297 total**.
- **Causa raíz de la discrepancia:** Durante la fase inicial de desarrollo de WS3, la suite `setlist-repository.test.ts` contaba con 20 pruebas. Posteriormente se incorporaron 2 pruebas adicionales de casos de borde esenciales (prueba 2.5 de compactación de secuencias post-eliminación y prueba 4.7 de verificación de rollback transaccional ante fallos). El walkthrough y las salidas de ejecución reflejaron la suite final de 22 pruebas ($91 + 22 = 113$), mientras que el borrador del reporte retuvo temporalmente los valores preliminares ($91 + 20 = 111$).
- **Conteo Autorativo Final Backend:** **113 / 113 PASS (100%)** distribuidas en 26 suites.
- **Conteo Autorativo Final Frontend:** **184 / 184 PASS (100%)** distribuidas en 36 suites (Escenarios Dorados A–D operativos).
- **Conteo Autorativo Final Global:** **297 / 297 PASS (100%)**.


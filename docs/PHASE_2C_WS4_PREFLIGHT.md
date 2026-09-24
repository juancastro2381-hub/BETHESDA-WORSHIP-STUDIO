# BETHESDA WORSHIP STUDIO
## Phase 2C — Preflight Técnico y Análisis de Reglas de Negocio: Workstream 4 (WS4)
### Servicio de Aplicación (`SetlistService`) y Orquestación de Flujo Litúrgico

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Etapa:** **Workstream 4 (WS4) — Setlist Service / Business Logic**  
**Documento Oficial:** `PHASE_2C_WS4_PREFLIGHT.md`  
**Fecha:** 20 de Septiembre de 2026  
**Línea Base Verificada:** WS3 Implementado y Verificado (297/297 pruebas pasando, TypeScript 0 errores, Base de datos íntegra)  
**Estado:** **PREFLIGHT COMPLETADO — EN ESPERA DE CONFIRMACIÓN DE REGLAS DE NEGOCIO**

---

## 1. Inspección de la Arquitectura Existente y Fronteras de Capa

WS4 se ubica arquitectónicamente en la **capa de aplicación (Application Services)**:
```
┌────────────────────────────────────────────────────────┐
│ Capa HTTP: Controladores Fastify & Rutas (WS5)        │  ◄── RBAC & verifyDatabaseRole = true
└───────────────────────────┬────────────────────────────┘
                            │ (DTOs validados)
┌───────────────────────────▼────────────────────────────┐
│ Capa de Aplicación: SetlistService (WS4)               │  ◄── Orquestación y Reglas de Negocio
└───────────────────────────┬────────────────────────────┘
                            │ (Contratos ISetlistRepository)
┌───────────────────────────▼────────────────────────────┐
│ Capa de Persistencia: DrizzleSetlistRepository (WS3)  │  ◄── Transacciones SQL atómicas & Row-lock
└────────────────────────────────────────────────────────┘
```

### Invariantes de Límite:
1. **Desacoplamiento de Transporte:** `SetlistService` no recibe objetos `FastifyRequest`, `FastifyReply`, ni manipula cabeceras HTTP o códigos numéricos de estado.
2. **Aislamiento de Persistencia:** `SetlistService` opera exclusivamente a través de la interfaz [`ISetlistRepository`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/setlist-repository.ts#L27-L44). No ejecuta sentencias SQL directas ni importa el cliente `db` directamente (inyección de dependencias).
3. **Inmutabilidad Canónica:** Las canciones de la tabla `songs` y sus versiones en `song_versions` son de solo lectura para el servicio de setlists. Cero mutaciones en la música maestra.

---

## 2. Clasificación Exhaustiva de Reglas de Negocio para WS4

### 2.1 Reglas Existentes Formalmente Documentadas (Autorizadas)

1. **Ciclo de Estados Litúrgicos:**
   Los estados autorizados son estrictamente: `'PLANNING'`, `'ACTIVE'`, `'COMPLETED'`, `'ARCHIVED'` (definidos en enum PostgreSQL y Zod).
2. **Estado Inicial por Defecto:**
   Al crear un setlist, su estado inicial es `PLANNING` a menos que se suministre explícitamente otro valor válido.
3. **Polimorfismo Estricto de Elementos:**
   - **`SONG`**: Debe referenciar obligatoriamente una canción válida (`songId`). Permite sobreescrituras de tono (`targetKey`), tempo (`targetBpm`), tipo de transición (`transitionType`: `'SEGUE'`, `'CROSSFADE'`, `'STOP'`, `'MEDLEY'`), y notas de dirección (`notesForTeam`).
   - **`SERVICE_MOMENT`**: Debe contener `momentTitle` obligatorio. Permite `durationMinutes`, `musicalKey` (pad/fondo) y `notesForTeam`. Prohíbe `songId`.
4. **Reordenamiento Atómico y Compactación:**
   El reordenamiento exige correspondencia 1:1 de los elementos existentes del setlist sin duplicados ni omisiones. La eliminación de un ítem compacta la secuencia automáticamente para mantener continuidad ($1, 2, 3...$).
5. **Cascada en Eliminación:**
   Eliminar un setlist elimina sus elementos asociados pero protege de forma absoluta las canciones canónicas (`onDelete: 'restrict'`).

---

### 2.2 Reglas Ya Implícitas en los Contratos de Dominio Actuales

1. **Existencia Previa de Recursos:**
   - No se puede consultar, actualizar, eliminar, cambiar estado o reordenar un setlist inexistente (emite `NotFoundError('Setlist', id)`).
   - No se puede asociar una canción inexistente a un ítem de tipo `SONG` (emite `NotFoundError('Canción', songId)`).
   - No se puede modificar o eliminar un ítem que no pertenece al setlist especificado (emite `NotFoundError` o `ValidationError`).
2. **Traducción de Excepciones:**
   Cualquier fallo de base de datos se normaliza en la jerarquía estructurada `AppError` (`NotFoundError`, `ValidationError`, `ConflictError`, `PersistenceError`).

---

### 2.3 Reglas Críticas que Requieren Confirmación de Diseño de Producto

#### Regla A: Alcance y Comportamiento del Setlist `ACTIVE` Único
El plan de implementación (`PHASE_2C_IMPLEMENTATION_PLAN.md` línea 63) establece:
> *"Solo puede haber un setlist en estado ACTIVE simultáneamente por congregación."*

- **Alcance Arquitectónico:** Dado que el sistema opera en un esquema de congregación única (no existe columna `organization_id` en el esquema de base de datos), el alcance es **global a nivel de toda la base de datos**.
- **Comportamiento ante Conflicto de Activación:**
  Existen dos alternativas de diseño de negocio cuando se solicita activar el Setlist B existiendo un Setlist A en estado `ACTIVE`:
  - **Alternativa A.1 (Conservadora con Conflicto — Recomendada):**
    Rechazar la operación con `ConflictError`:
    > *"Ya existe un setlist activo ('{tituloSetlistA}'). Debe finalizarlo o cambiar su estado antes de activar un nuevo culto."*
    *Justificación:* Previene que un segundo director o voluntario desactive accidentalmente el culto en vivo mientras el grupo de alabanza está ministrando en el escenario.
  - **Alternativa A.2 (Desactivación / Conclusión Automática):**
    El servicio automáticamente pasa el Setlist A activo previo a `COMPLETED` (o `PLANNING`) y activa el Setlist B en una misma operación.
  - **Alternativa A.3 (Parámetro Explícito de Sobrescritura):**
    Por defecto aplica la Alternativa A.1, pero acepta un flag `{ force: true }` para permitir que un usuario con privilegios desactive el anterior.

#### Regla B: Matriz de Transiciones de la Máquina de Estados
La documentación autoriza la secuencia nominal:
$$\text{PLANNING} \longrightarrow \text{ACTIVE} \longrightarrow \text{COMPLETED} \longrightarrow \text{ARCHIVED}$$

Se debe formalizar la validez de transiciones no lineales o reversiones:
| Origen | Destino | ¿Permitido? | Justificación Litúrgica |
|---|---|:---:|---|
| `PLANNING` | `ACTIVE` | **SÍ** | Inicio formal del culto o ensayo general. |
| `PLANNING` | `ARCHIVED` | **SÍ** | Cancelación o descarte de un culto planificado que no se realizó. |
| `ACTIVE` | `COMPLETED` | **SÍ** | Conclusión natural del servicio. |
| `ACTIVE` | `PLANNING` | **SÍ (con confirmación)** | Se activó por error durante la semana y debe volver a borrador. |
| `COMPLETED` | `ARCHIVED` | **SÍ** | Archivo histórico del servicio finalizado. |
| `COMPLETED` | `ACTIVE` | **RECHAZAR (o requerir reapertura)** | Un servicio cerrado no debe reactivarse salvo reapertura explícita. |
| `ARCHIVED` | `PLANNING` | **SÍ** | Restauración de un culto archivado para reutilizar su esquema. |
| Cualquiera | Mismo estado | **IDEMPOTENTE (No-op)** | Si ya está en ese estado, retornar la entidad sin error. |

#### Regla C: Mutabilidad de Ítems según el Estado del Setlist
- ¿Se permite agregar, editar o reordenar canciones en un setlist que ya está en estado `COMPLETED` o `ARCHIVED`?
  - **Recomendación Litúrgica:** En `COMPLETED` y `ARCHIVED`, el setlist debe ser **de solo lectura** para preservar el registro histórico de lo que realmente se tocó en el culto. Si se intenta mutar, emitir `ConflictError("No se pueden modificar los elementos de un setlist en estado COMPLETED o ARCHIVED.")`.

---

### 2.4 Reglas que NO Deben Ser Inventadas

1. **Cero Multi-Tenancy:** No inventar identificadores de sede, iglesia u organización ajenos al esquema.
2. **Cero WebSockets / Señalización en Tiempo Real en WS4:** La sincronización de atriles en vivo pertenece a la Fase 4. WS4 no debe incluir pub/sub ni sockets en memoria.
3. **Cero Duplicación de Lógica de Roles en el Servicio:** La verificación de roles y permisos `setlists:*` pertenece a la capa de rutas (WS5). `SetlistService` orquesta casos de uso de negocio puros.
4. **Cero Mutación de `songs`:** El servicio jamás debe alterar datos en la tabla de canciones maestras.

---

## 3. Matriz de Casos de Uso Planificados para `SetlistService`

```typescript
export class SetlistService {
  public constructor(
    private readonly setlistRepo: ISetlistRepository,
    private readonly songRepo: ISongRepository
  ) {}

  // 1. Gestión de Setlists
  public async createSetlist(dto: CreateSetlistDTO): Promise<SetlistEntity>;
  public async getSetlist(id: string): Promise<SetlistWithItemsEntity>;
  public async listSetlists(filter?: SetlistFilterOptions): Promise<{ items: SetlistSummaryEntity[]; total: number }>;
  public async updateSetlist(id: string, dto: UpdateSetlistDTO): Promise<SetlistEntity>;
  public async deleteSetlist(id: string): Promise<void>;

  // 2. Transición de Estados Litúrgicos
  public async transitionStatus(id: string, newStatus: SetlistStatus, options?: { force?: boolean }): Promise<SetlistEntity>;

  // 3. Gestión Polimórfica de Elementos
  public async addItem(setlistId: string, dto: CreateSetlistItemDTO): Promise<SetlistItemWithSongEntity>;
  public async updateItem(setlistId: string, itemId: string, dto: UpdateSetlistItemDTO): Promise<SetlistItemWithSongEntity>;
  public async removeItem(setlistId: string, itemId: string): Promise<void>;

  // 4. Reordenamiento Litúrgico
  public async reorderItems(setlistId: string, itemIds: string[]): Promise<SetlistItemWithSongEntity[]>;
}
```

---

## 4. Conclusión del Preflight y Recomendación Técnica

1. **Invariante `ACTIVE`:** Se recomienda implementar la **Alternativa A.1** (rechazo con `ConflictError` si ya existe un culto activo), permitiendo un parámetro opcional `{ force: true }` si se requiere relevar el culto activo.
2. **Inmutabilidad Histórica:** Se recomienda bloquear mutaciones de ítems en setlists con estado `COMPLETED` o `ARCHIVED`.
3. **Máquina de Estados:** Implementar las transiciones descritas en la sección 2.3 con validación determinista y mensajes en español acordes a la convención del proyecto.

---

## 5. Estado de Detención Mandatorio

Conforme a la instrucción de autorización:
- El preflight formal ha sido generado.
- Se presenta este documento para confirmación de las reglas de producto identificadas antes de iniciar la escritura de código en `SetlistService`.

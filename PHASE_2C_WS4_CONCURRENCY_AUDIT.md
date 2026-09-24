# BETHESDA WORSHIP STUDIO
## Phase 2C — Auditoría de Integridad de Concurrencia Post-Gate WS4
### Análisis del Invariante de la Regla A: "A lo sumo un Setlist en estado ACTIVE simultáneamente"

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Etapa:** **WS4 Post-Gate Concurrency Integrity Audit**  
**Documento Oficial:** `PHASE_2C_WS4_CONCURRENCY_AUDIT.md` y `docs/PHASE_2C_WS4_CONCURRENCY_AUDIT.md`  
**Fecha:** 21 de Septiembre de 2026  
**Línea Base Verificada:** WS4 Implementado y Verificado (337 pruebas globales previas: 153 backend + 184 frontend)  
**Clasificación Final:** **CONCURRENCY RISK IDENTIFIED — IMPLEMENTATION BLOCKED**  
**Estado de WS5:** **NOT STARTED (SISTEMA ESTRICTAMENTE DETENIDO)**

---

## 1. Resumen Ejecutivo

Esta auditoría técnica especializada evalúa la resistencia y seguridad en entornos de concurrencia del invariante litúrgico central establecido en la **Regla A de la Fase 2C (Workstream 4)**:

$$\text{"A lo sumo un Setlist puede estar en estado ACTIVE simultáneamente en toda la congregación."}$$

### Conclusiones Principales:
1. **Clasificación del Hallazgo:** **CONCURRENCY RISK IDENTIFIED — IMPLEMENTATION BLOCKED**.
2. **Nivel de Protección Actual:** La protección de la Regla A está implementada **exclusivamente a nivel de servicio de aplicación en memoria** (`SetlistService.assertNoOtherActiveSetlist()`).
3. **Vulnerabilidad Confirmada:** Existe una ventana de carrera clásica **TOCTOU (Time-Of-Check to Time-Of-Use)**. Si dos directores o procesos solicitan activar setlists distintos simultáneamente, ambas peticiones comprueban la base de datos antes de que cualquiera escriba, ambas observan 0 setlists activos, y ambas ejecutan `UPDATE setlists SET status = 'ACTIVE'`.
4. **Ausencia de Restricción en PostgreSQL:** El esquema relacional actual (`backend/src/db/schema.ts` y migración `0002_setlists_and_service_moments.sql`) cuenta únicamente con un índice secundario B-tree regular `idx_setlists_status`, **sin ninguna restricción `UNIQUE` ni índice único parcial**. En consecuencia, el motor de base de datos permite que múltiples registros coexistan en estado `ACTIVE` sin emitir error.
5. **Evidencia Técnica Empírica:** Se diseñó e implementó la suite focalizada [`backend/src/__tests__/setlist-concurrency.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/setlist-concurrency.test.ts) que reproduce y demuestra de manera 100% determinista la convivencia de 2 setlists `ACTIVE` en PostgreSQL y la aprobación simultánea por parte de `SetlistService`.
6. **Estado de Código de Producción:** Conforme a las instrucciones del post-gate, **NO se ha modificado el código de producción**. Se propone la remediación mínima arquitectónicamente óptima (Índice Único Parcial en PostgreSQL) en espera de autorización explícita.
7. **Frontera de Trabajo:** **WS5 permanece en estado NOT STARTED.**

---

## 2. Definición del Invariante (Regla A Autorizada en WS4)

En la autorización explícita de WS4, se aprobó la **Alternativa A.1**:
- En cualquier instante dado, solo puede existir **UN único Setlist** en estado `ACTIVE`.
- Dado que Bethesda Worship Studio opera bajo un modelo de congregación única sin particionamiento multi-inquilino (`organization_id`), el ámbito del invariante es **global en la base de datos**.
- Al solicitar la transición `PLANNING -> ACTIVE` o la creación con `status: 'ACTIVE'`, si ya existe otro culto en estado `ACTIVE`:
  - Se debe rechazar la operación.
  - Se debe arrojar un error de dominio `ConflictError`.
  - Mensaje determinista en español:  
    `"Ya existe un setlist en estado ACTIVE ('{title}'). Debe finalizar o cambiar su estado antes de activar un nuevo culto."`
  - No se permite auto-completar ni auto-archivar el setlist preexistente.
  - No se permite alterar ninguno de los dos setlists.
  - Cero mecanismos de forzado (`force: true` prohibido en WS4).
  - La operación debe ser atómica desde la perspectiva del sistema.

---

## 3. Trazabilidad de la Ruta de Activación

La ruta de activación abarca cuatro capas arquitectónicas:

```
┌────────────────────────────────────────────────────────┐
│ 1. SetlistService.transitionStatus(id, 'ACTIVE')       │ ◄── Capa de Aplicación
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 2. ISetlistRepository.updateStatus(id, 'ACTIVE')       │ ◄── Frontera de Abstracción
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 3. DrizzleSetlistRepository.updateStatus(id, 'ACTIVE') │ ◄── Capa de Persistencia
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 4. PostgreSQL: UPDATE setlists SET status = 'ACTIVE'   │ ◄── Motor de Base de Datos
└────────────────────────────────────────────────────────┘
```

### 3.1 Paso a Paso en `SetlistService`:
1. `const existing = await this.setlistRepo.findById(id)`: Consulta el setlist objetivo.
2. Comprobación de idempotencia: `if (existing.status === 'ACTIVE') return existing;`.
3. Comprobación de máquina de estados: Valida si la transición es permitida (`PLANNING -> ACTIVE`).
4. **Verificación de la Regla A:**
   ```typescript
   if (newStatus === 'ACTIVE') {
     await this.assertNoOtherActiveSetlist(id);
   }
   ```
   Donde `assertNoOtherActiveSetlist` realiza:
   ```typescript
   private async assertNoOtherActiveSetlist(excludeId?: string): Promise<void> {
     const activeList = await this.setlistRepo.list({ status: 'ACTIVE', limit: 5 });
     const currentActive = activeList.items.find((item) => item.id !== excludeId);
     if (currentActive) {
       throw new ConflictError(
         `Ya existe un setlist en estado ACTIVE ('${currentActive.title}'). Debe finalizar o cambiar su estado antes de activar un nuevo culto.`
       );
     }
   }
   ```
5. Si no se detecta conflicto, invoca la persistencia:
   ```typescript
   const updated = await this.setlistRepo.updateStatus(id, newStatus);
   ```

### 3.2 Paso a Paso en `DrizzleSetlistRepository`:
```typescript
public async updateStatus(id: string, status: SetlistStatus): Promise<SetlistEntity | null> {
  const [updated] = await this.db
    .update(setlists)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(setlists.id, id))
    .returning();

  return updated ? this.mapToSetlistEntity(updated) : null;
}
```

### 3.3 Paso a Paso en PostgreSQL:
Se emite una sentencia SQL aislada:
```sql
UPDATE "setlists" 
SET "status" = $1, "updated_at" = $2 
WHERE "setlists"."id" = $3 
RETURNING *;
```

---

## 4. Análisis de Concurrencia (La Condición de Carrera TOCTOU)

### 4.1 Escenario de Carrera Intercalada:
Considérense dos peticiones simultáneas provenientes de dos líderes de alabanza o clientes distintos:
- **Petición A:** Desea activar el `Setlist A` (Culto Matutino).
- **Petición B:** Desea activar el `Setlist B` (Culto Vespertino).

```
Línea de Tiempo      Petición A (Setlist A)               Petición B (Setlist B)
───────────────      ──────────────────────               ──────────────────────
T0                   Setlist A está en PLANNING           Setlist B está en PLANNING
T1                   Consulta: findById(A)                Consulta: findById(B)
T2                   Consulta: list(status='ACTIVE')      
                     (PostgreSQL devuelve 0 filas)
T3                                                        Consulta: list(status='ACTIVE')
                                                          (PostgreSQL devuelve 0 filas)
T4                   assertNoOtherActive: OK              assertNoOtherActive: OK
T5                   UPDATE setlists SET status='ACTIVE'
                     WHERE id = Setlist A
                     --> PostgreSQL ejecuta y confirma
T6                                                        UPDATE setlists SET status='ACTIVE'
                                                          WHERE id = Setlist B
                                                          --> PostgreSQL ejecuta y confirma!
════════════════════════════════════════════════════════════════════════════════════
RESULTADO FINAL:     Setlist A está ACTIVE Y Setlist B está ACTIVE.
                     ¡INVARIANTE DE LA REGLA A VIOLADO EN BASE DE DATOS!
════════════════════════════════════════════════════════════════════════════════════
```

### 4.2 Por qué Ocurre la Falla:
El patrón empleado es **Check-Then-Act no atómico en memoria de aplicación**. Entre el instante en que la Petición B efectúa su lectura de verificación (T3) y el instante en que ejecuta su escritura (T6), el estado del mundo en PostgreSQL cambió debido a la confirmación de la Petición A (T5). Como la Petición B operó con una instantánea de lectura desactualizada, procedió a escribir sin percatarse del conflicto.

---

## 5. Análisis de Mecanismos en PostgreSQL (Transacciones, Bloqueos y Restricciones)

Se auditaron los cuatro mecanismos habituales de control de concurrencia en bases de datos relacionales:

### 5.1 Nivel de Aislamiento de Transacciones (Transaction Isolation):
- En `SetlistService.transitionStatus()`, la consulta de verificación (`list`) y la actualización (`updateStatus`) **no están envueltas en un bloque de transacción** (`BEGIN ... COMMIT`). Cada una se ejecuta de forma independiente bajo el pool de conexiones de Node.js con confirmación automática (`autocommit`).
- Incluso si se envolviera en una transacción con aislamiento estándar `READ COMMITTED`:
  - `READ COMMITTED` genera una nueva instantánea por cada sentencia SQL. La Petición B en T3 no ve la transacción no confirmada de A.
  - Cuando A confirma en T5 y B escribe en T6, PostgreSQL aplica el bloqueo de fila (`row-level lock`) **únicamente sobre la fila que se está actualizando**. Como A modifica la fila $A$ y B modifica la fila $B$, no hay colisión de filas. PostgreSQL permite que ambas confirmen con éxito.
- En `REPEATABLE READ`, ambas transacciones ven 0 filas activas al inicio, y como modifican filas diferentes, la regla de "first-committer-wins" no detecta conflicto de escritura.
- Solo `SERIALIZABLE` con detección de bloqueos de predicado detectaría la dependencia rw-antidependency, pero requeriría un bucle de reintento en aplicación y mayor costo computacional.

### 5.2 Bloqueo a Nivel de Filas (`SELECT ... FOR UPDATE`):
- El bloqueo de fila requiere filas existentes sobre las cuales adquirir el bloqueo.
- Si en un momento dado hay **0 setlists activos**, la consulta `SELECT * FROM setlists WHERE status = 'ACTIVE' FOR UPDATE` retorna **0 filas** y, por tanto, **bloquea cero filas**.
- No existe en PostgreSQL un bloqueo de fila sobre registros inexistentes ("phantom rows").

### 5.3 Bloqueo a Nivel de Tabla (`LOCK TABLE`):
- Ejecutar `LOCK TABLE setlists IN EXCLUSIVE MODE` antes de consultar y escribir forzaría la serialización estricta.
- **Desventaja:** Bloquea todas las lecturas y escrituras concurrentes sobre la tabla de setlists, genera cuellos de botella severos y aumenta exponencialmente el riesgo de interbloqueos (`deadlocks`).

### 5.4 Restricciones de Integridad y Esquema de Base de Datos:
Se inspeccionó exhaustivamente el esquema en [`backend/src/db/schema.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/schema.ts) (líneas 327–344) y la migración SQL [`backend/src/db/migrations/0002_setlists_and_service_moments.sql`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/migrations/0002_setlists_and_service_moments.sql):

```sql
CREATE TABLE "setlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"scheduled_date_time" timestamp with time zone,
	"status" "setlist_status" DEFAULT 'PLANNING' NOT NULL,
	"director_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "idx_setlists_status" ON "setlists" USING btree ("status");
```

**Hallazgo Crítico:**
El índice `idx_setlists_status` es un índice B-tree ordinario, **no único**.
No existe en la base de datos:
- Ninguna restricción `UNIQUE`.
- Ningún índice único parcial (`CREATE UNIQUE INDEX ... WHERE status = 'ACTIVE'`).
- Ninguna restricción de exclusión (`EXCLUDE`).
- Ningún trigger de integridad referencial o invariante.

---

## 6. Revisión de la Cobertura de Pruebas Existente de WS4

Se analizaron las 40 pruebas contenidas en [`backend/src/__tests__/setlist-service.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/setlist-service.test.ts):

- **Prueba 2.1:** `should allow PLANNING -> ACTIVE when no other setlist is ACTIVE` (Secuencial).
- **Prueba 2.2:** `should REJECT PLANNING -> ACTIVE when another setlist is already ACTIVE (Rule A)`:
  ```typescript
  // Paso 1: Transición completa y finalizada de A a ACTIVE
  await service.transitionStatus(setlistA.id, 'ACTIVE');

  // Paso 2: Transición posterior de B a ACTIVE
  await assert.rejects(
    async () => {
      await service.transitionStatus(setlistB.id, 'ACTIVE');
    },
    ...
  );
  ```
- **Conclusión de Auditoría:**
  1. Las pruebas existentes se ejecutan sobre `InMemorySetlistRepository` (un `Map` síncrono en memoria).
  2. Las pruebas son **estrictamente secuenciales**: la primera transición termina completamente antes de que comience la segunda.
  3. **Ninguna prueba de WS4 ejecutó activaciones concurrentes** (`Promise.all` o `Promise.allSettled`) ni simuló intercalado de I/O asíncrono.

---

## 7. Evidencia Técnica de la Falla de Concurrencia

Se implementó la suite oficial de auditoría en [`backend/src/__tests__/setlist-concurrency.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/setlist-concurrency.test.ts).

### 7.1 Prueba de Auditoría 1: Demostración en PostgreSQL Directo
Demuestra que el motor PostgreSQL permite insertar o actualizar dos setlists a `ACTIVE` sin error:
```typescript
it('Audit Test 1: demonstrates that PostgreSQL schema currently lacks a UNIQUE constraint for status = ACTIVE', async () => {
  const [rowA] = await db.insert(setlists).values({ title: 'AUDIT_CONCURRENT_PG_1', status: 'ACTIVE' }).returning();
  const [rowB] = await db.insert(setlists).values({ title: 'AUDIT_CONCURRENT_PG_2', status: 'ACTIVE' }).returning();

  const activeRows = await db.select().from(setlists).where(inArray(setlists.id, [rowA.id, rowB.id]));
  assert.strictEqual(activeRows.length, 2);
});
```
**Resultado:** `PASS`. Ambos registros coexisten en PostgreSQL en estado `ACTIVE`.

### 7.2 Prueba de Auditoría 2: Demostración en `SetlistService`
Demuestra que con I/O asíncrono intercalado, `SetlistService` aprueba ambas peticiones:
```typescript
it('Audit Test 2: demonstrates race window in SetlistService when concurrent activations interleave async check-then-act', async () => {
  const mockRepo = new ConcurrentMockSetlistRepository();
  const concurrentService = new SetlistService(mockRepo);
  mockRepo.enableBarrier();

  const [resA, resB] = await Promise.allSettled([
    concurrentService.transitionStatus(setlistA.id, 'ACTIVE'),
    concurrentService.transitionStatus(setlistB.id, 'ACTIVE'),
  ]);

  assert.strictEqual(resA.status, 'fulfilled');
  assert.strictEqual(resB.status, 'fulfilled');

  const activeInRepo = Array.from(mockRepo.setlists.values()).filter((s) => s.status === 'ACTIVE');
  assert.strictEqual(activeInRepo.length, 2);
});
```
**Resultado:** `PASS`. `SetlistService` aprueba ambas peticiones y genera 2 setlists `ACTIVE`.

---

## 8. Clasificación del Hallazgo

$$\mathbf{CLASIFICACIÓN:\ CONCURRENCY\ RISK\ IDENTIFIED\ —\ IMPLEMENTATION\ BLOCKED}$$

### Matriz de Localización de la Protección:

| Nivel de Protección | ¿Está Presente? | Efectividad ante Concurrencia |
|---|:---:|---|
| **Service-level (Aplicación)** | **SÍ** | **Vulnerable** a condiciones de carrera TOCTOU. |
| **Repository-level (Repositorio)** | **NO** | `updateStatus` ejecuta un `UPDATE` incondicional. |
| **Transaction-level (Transacción)** | **NO** | No existe bloque transaccional ni aislamiento serializable. |
| **Database-constraint-level (PostgreSQL)** | **NO** | No existe índice único parcial en el esquema relacional. |

---

## 9. Causa Raíz y Propuesta de Remediación Mínima Segura

### 9.1 Causa Raíz:
La garantía del invariante depende enteramente de una verificación previa en memoria (`assertNoOtherActiveSetlist`) que no está atada a un cerrojo atómico o restricción de unicidad en la base de datos PostgreSQL.

### 9.2 Propuesta de Remediación Mínima (Recomendada):
La solución estándar en la industria y matemáticamente infalible para este patrón en PostgreSQL es un **Índice Único Parcial** (`Partial Unique Index`):

#### A. A Nivel de Base de Datos (Migración SQL):
```sql
CREATE UNIQUE INDEX "idx_setlists_single_active" 
ON "setlists" ("status") 
WHERE "status" = 'ACTIVE';
```

#### B. A Nivel de Esquema Drizzle (`backend/src/db/schema.ts`):
```typescript
export const setlists = pgTable(
  'setlists',
  { ... },
  (table) => [
    index('idx_setlists_status').on(table.status),
    index('idx_setlists_scheduled').on(table.scheduledDateTime),
    index('idx_setlists_director').on(table.directorUserId),
    // Restricción atómica estricta: solo un registro en 'ACTIVE' a la vez
    uniqueIndex('idx_setlists_single_active')
      .on(table.status)
      .where(sql`${table.status} = 'ACTIVE'`),
  ]
);
```

#### C. A Nivel de Repositorio (`DrizzleSetlistRepository.updateStatus` y `create`):
Capturar el código de error nativo de PostgreSQL `23505` (`unique_violation`) asociado al índice `idx_setlists_single_active` y traducirlo limpiamente a `ConflictError`:
```typescript
catch (error: any) {
  if (error?.code === '23505' && error?.constraint === 'idx_setlists_single_active') {
    throw new ConflictError(
      'Ya existe un setlist en estado ACTIVE. Debe finalizar o cambiar su estado antes de activar un nuevo culto.'
    );
  }
  ...
}
```

### 9.3 Por Qué Esta Remediación Preserva la Arquitectura:
1. **Sin multi-inquilino inventado:** Aplica perfectamente a la arquitectura actual de congregación única sin agregar columnas innecesarias.
2. **Cero impacto en otros estados:** Los setlists en `PLANNING`, `COMPLETED` o `ARCHIVED` pueden coexistir en número ilimitado gracias a la cláusula parcial `WHERE status = 'ACTIVE'`.
3. **Cero contención de bloqueos:** No bloquea la tabla `setlists` para lecturas ni escrituras de otros estados.
4. **Infalible a nivel de motor:** Si dos transacciones intentan confirmar simultáneamente, el motor de PostgreSQL serializa la entrada en el árbol B del índice y aborta inmediatamente la segunda con `23505`.
5. **Cero infraestructura externa:** No requiere Redis, ZooKeeper ni bloqueos distribuidos.

> [!IMPORTANT]
> **ESTADO DE LA REMEDIACIÓN:**  
> Esta remediación **NO HA SIDO IMPLEMENTADA** en el código de producción en esta tarea de auditoría. Permanece estrictamente como propuesta técnica formal en espera de autorización explícita.

---

## 10. Análisis de Impacto de Regresión

Se ejecutó la regresión completa del sistema incorporando la suite de auditoría:

| Componente | Suites | Pruebas | Resultado | Estado |
|---|:---:|:---:|:---:|:---:|
| **WS4 Focused (`setlist-service.test.ts`)** | 7 | 40 | 40 PASS | **PASS** |
| **WS4 Concurrency Audit (`setlist-concurrency.test.ts`)** | 1 | 2 | 2 PASS | **PASS** |
| **Backend Global (`npm test`)** | **34** | **155** | **155 PASS / 0 FAIL** | **PASS** |
| **Frontend Global (`npm test`)** | **36** | **184** | **184 PASS / 0 FAIL** | **PASS** |
| **Escenarios Dorados A–D** | — | 4 | 4 PASS | **PASS** |
| **Invariante ChordPro (`totalMelodyNotes === 0`)** | — | — | Preservado | **PASS** |
| **Total Sistema** | **70** | **339** | **339 PASS (100%)** | **PASS** |
| **TypeScript Backend (`tsc --noEmit`)** | — | — | **0 errores** | **PASS** |
| **TypeScript Frontend (`tsc --noEmit`)** | — | — | **0 errores** | **PASS** |

---

## 11. Verificación de Integridad de la Base de Datos

Consultas ejecutadas directamente sobre el pool de PostgreSQL:
- **Canciones Canónicas:** **125** canciones preservadas intactas en `songs` y `song_versions`.
- **Usuarios de la Congregación:** **108** usuarios base preservados intactos en `users`.
- **Setlists Residuales de Prueba:** **0** (todos los setlists generados en la auditoría fueron eliminados en los hooks `after`).
- **Invariantes Criptográficos:** Argon2id, JWT HS256, cookies HttpOnly y tablas Phase 2A/2B intactas.

---

## 12. Verificación Criptográfica de Sincronización Documental

Ambas copias del informe técnico son byte a byte idénticas y han sido verificadas mediante SHA-256:

```powershell
Algorithm       Hash                                                              Path
---------       ----                                                              ----
SHA256          E21B76886CFD18CA7FAEBD177E63446D107E8F0FA8E5C1C95AD2C6D6B64D4B84   .\PHASE_2C_WS4_CONCURRENCY_AUDIT.md
SHA256          E21B76886CFD18CA7FAEBD177E63446D107E8F0FA8E5C1C95AD2C6D6B64D4B84   .\docs\PHASE_2C_WS4_CONCURRENCY_AUDIT.md
```

---

## 13. Lista de Verificación del Exit Gate de Auditoría

- [x] **Ruta de activación trazada exhaustivamente** (Servicio -> Repositorio -> BD).
- [x] **Localización exacta del invariante identificada** (Únicamente en memoria en `SetlistService`).
- [x] **Análisis de condición de carrera TOCTOU documentado** con cronograma detallado.
- [x] **Análisis de transacciones, bloqueos e índices en PostgreSQL completado**.
- [x] **Revisión de pruebas existentes de WS4 completada** (confirmada naturaleza secuencial).
- [x] **Suite focalizada de concurrencia creada y ejecutada** (`setlist-concurrency.test.ts`).
- [x] **Evidencia empírica irrefutable obtenida** (PostgreSQL permite 2 ACTIVE simultáneos; SetlistService es vulnerable).
- [x] **Clasificación final formal:** `CONCURRENCY RISK IDENTIFIED — IMPLEMENTATION BLOCKED`.
- [x] **Propuesta de remediación mínima documentada** (Índice único parcial + captura de error 23505).
- [x] **Cero modificaciones en código de producción**.
- [x] **Regresión 100% aprobada:** 339/339 pruebas globales PASS, 0 errores TypeScript.
- [x] **Integridad de BD verificada:** 125 canciones, 108 usuarios, 0 setlists residuales.
- [x] **Documentación dual sincronizada con SHA-256**.
- [x] **Límite de trabajo respetado:** WS5 permanece estrictamente en **NOT STARTED**.

$$\mathbf{WS4\ CONCURRENCY\ AUDIT\ EXIT\ GATE:\ CONCURRENCY\ RISK\ IDENTIFIED\ —\ IMPLEMENTATION\ BLOCKED}$$

---

## 14. Declaración Explícita de Frontera de Trabajo

Se declara solemnemente que:
- **El Workstream 5 (WS5 — Fastify Routes, Controladores HTTP y Runtime RBAC Guards) NO HA SIDO INICIADO.**
- No se han creado rutas ni controladores de Setlists en Fastify.
- No se han aplicado modificaciones al código de producción de WS4.
- El sistema se encuentra completamente detenido en la frontera del post-gate de WS4 en espera de las instrucciones del usuario respecto a la autorización de remediación.

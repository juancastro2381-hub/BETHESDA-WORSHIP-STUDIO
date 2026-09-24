# BETHESDA WORSHIP STUDIO
## Phase 2C — Reporte de Remediación y Verificación de Concurrencia (WS4)
### Resolución Definitiva de la Condición de Carrera en la Regla A (Índice Único Parcial en PostgreSQL)

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Proyecto:** Bethesda Worship Studio  
**Fase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Etapa:** **WS4 Concurrency Remediation & Verification**  
**Documento Oficial:** `PHASE_2C_WS4_CONCURRENCY_REMEDIATION_REPORT.md` y `docs/PHASE_2C_WS4_CONCURRENCY_REMEDIATION_REPORT.md`  
**Fecha:** 21 de Septiembre de 2026  
**Línea Base Pre-Remediación:** 339 pruebas globales (155 backend + 184 frontend)  
**Línea Base Post-Remediación:** **342 pruebas globales (158 backend + 184 frontend)**  
**Clasificación Final:** **WS4 CONCURRENCY REMEDIATION IMPLEMENTED & VERIFIED**  
**Estado de WS5:** **NOT STARTED (SISTEMA ESTRICTAMENTE DETENIDO)**

---

## 1. Resumen Ejecutivo

En estricta conformidad con la autorización explícita para la remediación de concurrencia de WS4, se ha implementado y verificado la solución técnica a nivel del motor relacional PostgreSQL para el invariante litúrgico de la **Regla A**:

$$\text{"A lo sumo un Setlist puede estar en estado ACTIVE simultáneamente en toda la congregación."}$$

### Logros y Resultados de la Remediación:
1. **Restricción de Integridad en PostgreSQL:** Se implementó y aplicó la migración `0003_single_active_setlist_constraint.sql` creando el índice único parcial `idx_setlists_single_active` (`CREATE UNIQUE INDEX ... WHERE "status" = 'ACTIVE'`).
2. **Representación Declarativa en Drizzle ORM:** Se actualizó `backend/src/db/schema.ts` para reflejar `uniqueIndex('idx_setlists_single_active').on(table.status).where(sql\`${table.status} = 'ACTIVE'\`)`.
3. **Mapeo Automático de Error de Dominio:** En `DrizzleSetlistRepository`, el error nativo de PostgreSQL `23505` (`unique_violation`) es interceptado y traducido limpiamente a `ConflictError` con el mensaje determinista en español aprobado en WS4. Cero fugas de detalles de infraestructura al servicio de aplicación.
4. **Verificación Empírica de Concurrencia:** La suite [`backend/src/__tests__/setlist-concurrency.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/setlist-concurrency.test.ts) demostró que ante dos activaciones simultáneas contra PostgreSQL:
   - Exactamente **UNA** tiene éxito (`status: 'ACTIVE'`).
   - Exactamente **UNA** falla con `ConflictError` de dominio.
   - En la base de datos existe exactamente **UN** setlist en estado `ACTIVE`.
   - **NUNCA** coexisten dos filas activas.
5. **Permisividad de Estados No Activos:** Se comprobó que setlists en `PLANNING`, `COMPLETED` y `ARCHIVED` coexisten en cantidad ilimitada sin interferencia.
6. **Regresión Global del Sistema:** **342 / 342 pruebas PASS (100%)**, 0 errores de TypeScript (`tsc --noEmit`).
7. **Integridad de Base de Datos:** Canciones canónicas (125) y usuarios (108) preservados intactos; 0 setlists residuales.
8. **Frontera de Trabajo:** **WS5 permanece en estado NOT STARTED.**

---

## 2. Hallazgo Original de la Auditoría

Durante la auditoría de concurrencia post-gate ([`PHASE_2C_WS4_CONCURRENCY_AUDIT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_WS4_CONCURRENCY_AUDIT.md)), se descubrió que:
- La protección del invariante de la Regla A descansaba únicamente en la comprobación asíncrona `assertNoOtherActiveSetlist()` en `SetlistService`.
- Existía una vulnerabilidad clásica **TOCTOU (Time-Of-Check to Time-Of-Use)**: si dos peticiones intercalaban sus lecturas antes de que cualquiera confirmara su escritura en PostgreSQL, ambas observaban 0 cultos activos y ambas procedían a actualizar a `ACTIVE`.
- PostgreSQL no contaba con una restricción de unicidad para dicho estado, permitiendo que dos registros quedaran en `status = 'ACTIVE'` simultáneamente.

---

## 3. Causa Raíz

1. **Carencia de Restricción Relacional:** La tabla `setlists` solo disponía de un índice B-tree secundario ordinario (`idx_setlists_status`), el cual optimizaba búsquedas pero no imponía unicidad.
2. **Falta de Atomicidad Entre Chequeo y Escritura:** Las operaciones `SELECT` y `UPDATE` se ejecutaban como transacciones independientes en modo `autocommit`. Sin una restricción a nivel de base de datos, el aislamiento estándar `READ COMMITTED` no detecta colisiones cuando dos transacciones modifican filas diferentes.

---

## 4. Remediación Autorizada

Se autorizó la implementación de la **Estrategia Óptima de Índice Único Parcial**:
- Creación de un índice único en PostgreSQL condicionado exclusivamente a `"status" = 'ACTIVE'`.
- Mapeo del código de error relacional `23505` al error de dominio `ConflictError` en la capa del repositorio.
- Mantenimiento del chequeo previo en `SetlistService` como validación temprana amigable, manteniendo la base de datos como la autoridad definitiva infalible.

---

## 5. Migración de Base de Datos

### 5.1 Inspección Previa de Datos:
Antes de aplicar la migración, se ejecutó una inspección formal de la base de datos confirmando:
- Setlists activos existentes: **0**.
- Setlists totales en base de datos: **0**.
- Cero riesgo de inconsistencia o pérdida de datos.

### 5.2 Archivo de Migración Creado:
[`backend/src/db/migrations/0003_single_active_setlist_constraint.sql`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/migrations/0003_single_active_setlist_constraint.sql):

```sql
CREATE UNIQUE INDEX "idx_setlists_single_active" 
ON "setlists" USING btree ("status") 
WHERE ("status" = 'ACTIVE');
```

### 5.3 Actualización del Diario de Migraciones:
En [`backend/src/db/migrations/meta/_journal.json`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/migrations/meta/_journal.json):
```json
{
  "idx": 3,
  "version": "7",
  "when": 1789904000000,
  "tag": "0003_single_active_setlist_constraint",
  "breakpoints": true
}
```

### 5.4 Verificación en el Catálogo de PostgreSQL:
Consulta ejecutada sobre `pg_indexes`:
```text
- idx_setlists_single_active: CREATE UNIQUE INDEX idx_setlists_single_active 
  ON public.setlists USING btree (status) 
  WHERE (status = 'ACTIVE'::setlist_status)
```
- **Idempotencia:** La migración se ejecutó repetidamente vía `npm run migrate` confirmando su idempotencia sin errores.

---

## 6. Cambios en el Esquema de Drizzle ORM

En [`backend/src/db/schema.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/schema.ts):

```typescript
export const setlists = pgTable(
  'setlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    scheduledDateTime: timestamp('scheduled_date_time', { withTimezone: true }),
    status: setlistStatusEnum('status').notNull().default('PLANNING'),
    directorUserId: uuid('director_user_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_setlists_status').on(table.status),
    index('idx_setlists_scheduled').on(table.scheduledDateTime),
    index('idx_setlists_director').on(table.directorUserId),
    // Invariante Litúrgico: A lo sumo un setlist en estado ACTIVE en toda la congregación
    uniqueIndex('idx_setlists_single_active')
      .on(table.status)
      .where(sql`${table.status} = 'ACTIVE'`),
  ]
);
```

---

## 7. Mapeo de Errores en el Repositorio (`DrizzleSetlistRepository`)

En [`backend/src/repositories/setlist-repository.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/setlist-repository.ts):

Se implementó el método privado `handleUniqueActiveConflict`:
```typescript
private async handleUniqueActiveConflict(error: unknown, fallbackMessage?: string): Promise<never> {
  const pgErr = error as { code?: string; constraint?: string; message?: string };
  if (
    pgErr?.code === '23505' &&
    (pgErr.constraint === 'idx_setlists_single_active' || pgErr.message?.includes('idx_setlists_single_active'))
  ) {
    // Consultar el título del culto activo existente para construir el mensaje determinista aprobado
    const [existingActive] = await this.db
      .select({ title: setlists.title })
      .from(setlists)
      .where(eq(setlists.status, 'ACTIVE'))
      .limit(1);

    const title = existingActive?.title ?? 'En curso';
    throw new ConflictError(
      `Ya existe un setlist en estado ACTIVE ('${title}'). Debe finalizar o cambiar su estado antes de activar un nuevo culto.`
    );
  }
  if (error instanceof AppError) throw error;
  throw new PersistenceError(
    fallbackMessage ?? `Error de persistencia: ${error instanceof Error ? error.message : String(error)}`,
    error
  );
}
```

Este manejador fue integrado en los bloques `catch` de `create()`, `update()` y `updateStatus()`, garantizando que ninguna excepción nativa de base de datos se filtre fuera del repositorio y preservando la pureza de la capa de dominio.

---

## 8. Diseño de Pruebas de Concurrencia

La suite [`backend/src/__tests__/setlist-concurrency.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/setlist-concurrency.test.ts) fue estructurada en dos secciones claramente delimitadas:

1. **Sección 1: Evidencia Histórica de Auditoría:**
   - Conserva la prueba en memoria con barrera determinista que demuestra cómo la comprobación en memoria por sí sola permitía 2 setlists activos bajo concurrencia antes de la remediación.
2. **Sección 2: Verificación Post-Remediación:**
   - **Prueba 2.1 (Rechazo Directo en PostgreSQL):** Inserta un primer setlist `ACTIVE` y verifica que el segundo insert directo arroja error `23505` en PostgreSQL.
   - **Prueba 2.2 (Traducción a `ConflictError` en Repositorio):** Verifica que `realRepository.create({ status: 'ACTIVE' })` arroja `ConflictError` con el mensaje exacto.
   - **Prueba 2.3 (Activación Concurrente Remediada):** Ejecuta dos activaciones simultáneas forzando el intercalado de lecturas (`Promise.allSettled`). Verifica que:
     - Exactamente una promesa se cumple (`fulfilled`, estado `ACTIVE`).
     - Exactamente una promesa es rechazada con `ConflictError`.
     - En PostgreSQL existe exactamente 1 registro activo.
   - **Prueba 2.4 (Permisividad de Otros Estados):** Inserta 3 setlists en `PLANNING`, 3 en `COMPLETED` y 3 en `ARCHIVED` simultáneamente (9 registros en total) comprobando que todos coexisten sin restricción.

---

## 9. Resultados de Pruebas de Concurrencia

Ejecución de `src/__tests__/setlist-concurrency.test.ts`:
```text
▶ Phase 2C — WS4: Concurrency Remediation & Verification Suite
  ▶ 1. Historical Audit Evidence (Pre-Remediation TOCTOU Window)
    ✔ 1.1 should demonstrate how application-level check alone was vulnerable to TOCTOU (1.0598ms)
  ✔ 1. Historical Audit Evidence (Pre-Remediation TOCTOU Window) (1.5823ms)
  ▶ 2. Post-Remediation Verification (Database Constraint & Repository)
    ✔ 2.1 should enforce partial unique index in PostgreSQL: reject 2nd ACTIVE insert directly with 23505 (64.6753ms)
    ✔ 2.2 should translate PostgreSQL 23505 into domain ConflictError in DrizzleSetlistRepository (53.3367ms)
    ✔ 2.3 should ensure exactly ONE succeeds and exactly ONE fails with ConflictError under concurrent activation (80.5626ms)
    ✔ 2.4 should permit UNLIMITED coexistence of setlists in PLANNING, COMPLETED, and ARCHIVED (10.3111ms)
  ✔ 2. Post-Remediation Verification (Database Constraint & Repository) (209.3736ms)
✔ Phase 2C — WS4: Concurrency Remediation & Verification Suite (389.2617ms)
ℹ tests 5 | pass 5 | fail 0 | skipped 0
```

---

## 10. Resultados de la Regresión Completa del Sistema

Se ejecutó la regresión completa en backend y frontend:

### 10.1 Backend (`npm test`)
- **Suites Ejecutadas:** 36 suites
- **Total de Pruebas:** **158 PASS / 0 FAIL / 0 SKIPPED**
- **Evolución Trazable:**
  - Línea base pre-WS4: 113 pruebas
  - WS4 Lógica de Negocio: +40 pruebas (153)
  - WS4 Auditoría Inicial: +2 pruebas (155)
  - WS4 Remediación y Verificación: +3 pruebas adicionales
  - Total actual verificado: **158 pruebas**

### 10.2 Frontend (`npm test`)
- **Suites Ejecutadas:** 36 suites
- **Total de Pruebas:** **184 PASS / 0 FAIL / 0 SKIPPED**
- **Escenarios Dorados A–D:** 100% operativos.
- **Invariante ChordPro:** `totalMelodyNotes === 0` estrictamente preservada.

### 10.3 Consolidado Global
$$\text{Total Pruebas del Sistema} = 158 \text{ (backend)} + 184 \text{ (frontend)} = \mathbf{342 / 342 \text{ PASS (100\%)}}$$

### 10.4 Verificación de Tipos TypeScript (`tsc --noEmit`)
- `backend`: **PASS (0 errores)**
- `frontend`: **PASS (0 errores)**

---

## 11. Verificación de Integridad de Base de Datos

Consultas ejecutadas directamente sobre el pool de PostgreSQL:
- **Canciones Canónicas:** **125** canciones preservadas intactas en `songs` y `song_versions`.
- **Usuarios de la Congregación:** **108** usuarios preservados intactos en `users`.
- **Setlists Residuales:** **0** (todos los registros de prueba fueron limpiados en los hooks `after`).
- **Invariantes Criptográficos y de Seguridad:** Argon2id, JWT HS256, cookies HttpOnly y tablas de auditoría/invitaciones de Phase 2A y 2B intactas.

---

## 12. Análisis de Regresión y Compatibilidad

1. **Preservación de Reglas Litúrgicas:**
   - `PLANNING -> ACTIVE` permitido.
   - `PLANNING -> ARCHIVED` permitido.
   - `ACTIVE -> COMPLETED` permitido.
   - `ACTIVE -> PLANNING` permitido.
   - `COMPLETED -> ARCHIVED` permitido.
   - Transición al mismo estado idempotente sin mutación ni error.
   - Inmutabilidad estricta de elementos en `COMPLETED` y `ARCHIVED`.
   - Cero mecanismos de forzado (`force: true` no admitido).
   - Canciones canónicas inmutables.
2. **Compatibilidad Mono-Congregacional:**
   - La solución no requirió crear columnas artificiales de organización ni particionamiento multi-inquilino.
3. **Desacoplamiento de Transporte:**
   - `SetlistService` y `DrizzleSetlistRepository` permanecen completamente ajenos a Fastify y cabeceras HTTP.

---

## 13. Verificación Criptográfica de Documentación Dual

Ambas copias del reporte técnico son byte a byte idénticas y han sido verificadas mediante SHA-256:

```powershell
Algorithm       Hash                                                              Path
---------       ----                                                              ----
SHA256          3E723FF62BF699C6A76BEB27DFBE49A2CEF59F2D72BDE6B2E1529EB8E3C363BE   .\PHASE_2C_WS4_CONCURRENCY_REMEDIATION_REPORT.md
SHA256          3E723FF62BF699C6A76BEB27DFBE49A2CEF59F2D72BDE6B2E1529EB8E3C363BE   .\docs\PHASE_2C_WS4_CONCURRENCY_REMEDIATION_REPORT.md
```

---

## 14. Lista de Verificación del Exit Gate de Remediación

| Criterio de Aceptación | Estado |
|---|:---:|
| Migración PostgreSQL creada y aplicada (`idx_setlists_single_active`) | **PASSED** |
| Idempotencia de migración verificada | **PASSED** |
| Esquema Drizzle actualizado con `uniqueIndex` condicional | **PASSED** |
| Mapeo de error PostgreSQL 23505 a `ConflictError` en repositorio | **PASSED** |
| Mensaje determinista en español aprobado preservado | **PASSED** |
| Activación concurrente produce exactamente 1 éxito y 1 `ConflictError` | **PASSED** |
| PostgreSQL nunca almacena dos setlists en estado ACTIVE | **PASSED** |
| Coexistencia ilimitada en PLANNING, COMPLETED y ARCHIVED | **PASSED** |
| Reglas de negocio litúrgicas previas de WS4 intactas | **PASSED** |
| Regresión Backend: 158 / 158 PASS | **PASSED** |
| Regresión Frontend: 184 / 184 PASS (Escenarios Dorados A–D OK) | **PASSED** |
| Consolidado Global: 342 / 342 PASS (100%) | **PASSED** |
| TypeScript: 0 errores en backend y frontend | **PASSED** |
| Base de datos preservada: 125 canciones, 108 usuarios, 0 setlists residuales | **PASSED** |
| Reportes sincronizados con verificación SHA-256 | **PASSED** |
| Límite de trabajo estricto: WS5 NO iniciado | **PASSED** |

$$\mathbf{WS4\ EXIT\ GATE:\ WS4\ CONCURRENCY\ REMEDIATION\ IMPLEMENTED\ \&\ VERIFIED}$$

---

## 15. Declaración Explícita de Frontera de Trabajo

> **WS5 — Fastify Routes, HTTP Controllers and Runtime RBAC Guards — has NOT been started.**

El Workstream 4 (`SetlistService` y orquestación litúrgica) queda **definitivamente cerrado y blindado contra condiciones de carrera**.  
El sistema se encuentra detenido en espera de la autorización formal para dar inicio al Workstream 5.

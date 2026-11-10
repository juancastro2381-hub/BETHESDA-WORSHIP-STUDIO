# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.2
## Report 06: Test Execution & Count Reconciliation

**Objetivo de Certificación (Blocker R32-04):** Reconciliación matemática transparente e inequívoca del conteo de pruebas, resolución de la superposición de globbing de R3.1 y evidencia completa de ejecución.

---

### 1. Diagnóstico del Conteo en la Auditoría R3.1

Durante la auditoría de Phase 2A-R2.2.1-R3.1, se reportó una divergencia aparente entre "42 pruebas de certificación" y "137 ejecuciones totales".

#### Causa Raíz Identificada:
1. El patrón glob `backend/src/__tests__/conversion-*.test.ts` descubre **9 archivos de prueba** en el backend.
2. Uno de esos 9 archivos es precisamente `conversion-worker-certification.test.ts`, el cual contenía **42 pruebas** en R3.1.
3. Los otros 8 archivos sumaban un total de **53 pruebas**.
4. Por consiguiente, al ejecutar el comando global:
   ```bash
   npx tsx --env-file=backend/.env --test backend/src/__tests__/conversion-*.test.ts
   ```
   Node.js reportó `ℹ tests 95 (53 + 42)`.
5. Si un reporte sumaba la ejecución aislada de la suite de certificación (42) más la ejecución de la suite global (95), el resultado era `42 + 95 = 137 ejecuciones`. Sin embargo, esto representaba una **duplicación en el cómputo**, pues las 42 pruebas de certificación ya estaban incluidas dentro de las 95 pruebas del glob.

---

### 2. Cómputo Reconciliado en Phase 2A-R2.2.1-R3.2

En R3.2, la suite de certificación (`conversion-worker-certification.test.ts`) fue expandida de 42 a **50 pruebas unitarias y de integración**:
- **WS01 (Leak-Free Active Job Tracking):** 7 pruebas.
- **WS02 (Deterministic Shutdown & Isolation):** 26 pruebas (incluyendo R32-01 a R32-08).
- **WS03 (Real Periodic Recovery & Mutex):** 7 pruebas.
- **WS04 (Filesystem Classification & Reconciliation):** 10 pruebas.
- **Subtotal Certificación:** 50 pruebas.

Al sumar los 8 archivos complementarios (53 pruebas) más los 50 casos de certificación:
$$\text{Total Casos Únicos Descubiertos por Glob} = 53 + 50 = 103 \text{ pruebas}$$

---

### 3. Matriz Exhaustiva por Archivo (Ejecución Individual e Independiente)

Cada uno de los 9 archivos fue ejecutado de forma individual mediante `npx tsx --env-file=backend/.env --test`, registrando los siguientes valores idénticos y reproducibles:

| # | Archivo de Prueba | Tests | Pasados | Fallidos | Omitidos | Tecnología Subyacente |
|---|---|:---:|:---:|:---:|:---:|---|
| 1 | `conversion-api.test.ts` | 9 | 9 | 0 | 0 | Fastify HTTP + Real PostgreSQL |
| 2 | `conversion-audit-remediation.test.ts` | 8 | 8 | 0 | 0 | Service Layer + Real PostgreSQL |
| 3 | `conversion-cancellation.test.ts` | 9 | 9 | 0 | 0 | Real PostgreSQL (Transacciones y Leases) |
| 4 | `conversion-catalog-idempotency.test.ts` | 5 | 5 | 0 | 0 | Real PostgreSQL (Catalog Commitment) |
| 5 | `conversion-concurrency-leases.test.ts` | 6 | 6 | 0 | 0 | Real PostgreSQL (Fencing Tokens) |
| 6 | `conversion-pgboss-retry.test.ts` | 2 | 2 | 0 | 0 | Real pg-boss + Real PostgreSQL |
| 7 | `conversion-queue-lifecycle.test.ts` | 5 | 5 | 0 | 0 | Real pg-boss + Real PostgreSQL |
| 8 | `conversion-security.test.ts` | 9 | 9 | 0 | 0 | Fastify HTTP + Anti-IDOR Security |
| 9 | `conversion-worker-certification.test.ts` | 50 | 50 | 0 | 0 | Real pg-boss, Real PostgreSQL + Inyección Controlada |
| **TOTAL** | **9 Archivos de Prueba** | **103** | **103** | **0** | **0** | **100% Exitoso** |

---

### 4. Evidencia de Ejecución en Lote (Glob Completo)

Comando ejecutado:
```bash
npx tsx --env-file=backend/.env --test --test-concurrency=1 backend/src/__tests__/conversion-*.test.ts
```

Salida registrada en `docs/reports/phase-2a-r2.2.1-r3.2/logs/all_conversion_suites.log`:
```text
ℹ tests 103
ℹ suites 13
ℹ pass 103
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 49436.5844
```

#### Clasificación Transparente del Arnés de Pruebas:
- **Base de Datos Real (PostgreSQL):** Utilizada en el 100% de las pruebas que consultan tablas de Drizzle ORM (`background_jobs`, `songs`, `song_versions`, `song_sections`, `song_lines`, `song_chords`).
- **Cola Real (pg-boss):** Utilizada en `conversion-pgboss-retry.test.ts`, `conversion-queue-lifecycle.test.ts` y en las pruebas de integración de ciclo de vida (ej. `2.8 R32-08`, `2.1 R32-01`, `3.1`, `3.5`).
- **Mocks / Stubs de Interceptación Controlada:** Utilizados exclusivamente para simulación de condiciones de contorno adversas (ej. error `EACCES` en sistema de archivos, inyección de excepción en `Worker.prototype.stop`, validación de `boss.getWipData` ausente o no-array).


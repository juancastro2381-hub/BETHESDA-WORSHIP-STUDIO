# PHASE 2A-R2.2.1-R3.3.5 — SOURCE DOCUMENTATION CORRECTION

**Project:** Bethesda Worship Studio  
**Role:** Technical Documentation Auditor, Principal Backend Engineer  
**Source File:** `backend/src/application/conversion-worker.ts`  
**Target:** JSDoc preceding `ConversionWorker.validateWipData(raw: unknown)`  
**Status Date:** 2026-11-10  

---

## 1. STALE WORDING IDENTIFIED

In Phase 2A-R2.2.1-R3.3.4, the executable validation logic was hardened to strictly require all six nullable telemetry properties (`lastFetchedOn`, `lastJobStartedOn`, `lastJobEndedOn`, `lastJobDuration`, `lastError`, `lastErrorOn`) as own properties (`Object.prototype.hasOwnProperty.call(rec, prop)`), throwing `WorkerShutdownError` if any property was missing or `undefined`.

However, the JSDoc comment immediately preceding the method retained stale wording from R3.3.3:

```typescript
// STALE COMMENT IN R3.3.4 (DEFECTIVE EXPLANATION):
 * Telemetría nullable (debe ser null, undefined si se omite en payload parcial, o el tipo estricto):
 * - 'lastFetchedOn', 'lastJobStartedOn', 'lastJobEndedOn', 'lastJobDuration', 'lastErrorOn':
 *   null o número finito (Number.isFinite).
 * - 'lastError': null u objeto no nulo y no arreglo.
```

The clause `undefined si se omite en payload parcial` contradicted the implemented executable logic, creating documentation ambiguity.

---

## 2. CORRECTED CONTRACT DOCUMENTATION

The documentation was updated to state the exact invariant enforced by the runtime code:

```typescript
// CORRECTED COMMENT IN R3.3.5 (FAITHFUL TO RUNTIME INVARIANTS):
  /**
   * Validador estructural estricto e infalsificable para las respuestas de pg-boss.getWipData() (R3.3.3 & R3.3.4).
   *
   * Cumple con el contrato oficial de tipos de pg-boss 12.38.1 (WipData en types.d.ts y worker.toWipData()).
   *
   * Campos requeridos obligatorios (prohibido defaults o invención de metadatos):
   * 1. 'id': string no vacío y no solo espacios en blanco.
   * 2. 'workId': string no vacío y no solo espacios en blanco.
   * 3. 'name': nombre de cola no vacío y no solo espacios en blanco.
   * 4. 'options': objeto válido no nulo y no arreglo.
   * 5. 'state': estado soportado exacto ('created' | 'active' | 'stopping' | 'stopped').
   * 6. 'count': entero finito no negativo (Number.isInteger(count) && count >= 0).
   * 7. 'createdOn': timestamp numérico finito (Number.isFinite(createdOn)).
   *
   * Telemetría nullable requerida (las seis propiedades son propiedades propias obligatorias; prohibido omitirlas o asignarles undefined):
   * - Las seis propiedades ('lastFetchedOn', 'lastJobStartedOn', 'lastJobEndedOn', 'lastJobDuration', 'lastError', 'lastErrorOn')
   *   deben existir obligatoriamente como propiedades propias en cada entrada (Object.prototype.hasOwnProperty).
   * - Se aceptan valores explícitos 'null'.
   * - Se aceptan valores numéricos finitos para propiedades numéricas ('lastFetchedOn', 'lastJobStartedOn', 'lastJobEndedOn', 'lastJobDuration', 'lastErrorOn').
   * - Se acepta un objeto no nulo y no arreglo o 'null' para 'lastError'.
   * - Se rechazan terminantemente propiedades faltantes o ausentes (omisión).
   * - Se rechaza terminantemente el valor explícito 'undefined'.
   * - Prohibidos defaults o valores de telemetría fabricados.
   *
   * Se rechaza terminantemente: NaN, Infinity, -Infinity, conteos negativos, conteos fraccionarios,
   * campos faltantes, undefined, y telemetría malformada.
   * Si cualquier registro en el arreglo es inválido, se RECHAZA EL ARREGLO COMPLETO lanzando WorkerShutdownError.
   * Cero tolerancia a aceptación parcial.
   */
```

---

## 3. PROOF OF ZERO EXECUTABLE CODE MODIFICATIONS

Inspection of `git diff backend/src/application/conversion-worker.ts` confirms:
- **Modified Lines:** 11 additions, 6 deletions, located entirely within the JSDoc block (lines 558–585).
- **Executable Code:** 0 lines altered.
- **Validation Logic:** Unchanged.
- **Worker Lifecycle:** Unchanged.


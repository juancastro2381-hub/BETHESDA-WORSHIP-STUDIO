# PHASE 2A-R2.2.1-R3.3.4 — STRICT NULLABLE WIP VALIDATION CORRECTION

**Project:** Bethesda Worship Studio  
**Role:** Principal Backend Engineer, Distributed Systems Architect  
**Source File:** `backend/src/application/conversion-worker.ts`  
**Method Remediated:** `ConversionWorker.validateWipData(raw: unknown): ValidatedWipEntry[]`  
**Status Date:** 2026-11-10  

---

## 1. REMEDIATION DIFF (BEFORE VS AFTER)

### 1.1 Before (R3.3.3 Implementation with Defective Toleration of `undefined` / Missing Fields)

```typescript
// DEFECTIVE R3.3.3 IMPLEMENTATION:
if (
  entry.lastFetchedOn !== undefined &&
  entry.lastFetchedOn !== null &&
  (typeof entry.lastFetchedOn !== 'number' || !Number.isFinite(entry.lastFetchedOn))
) {
  throw new WorkerShutdownError(`Fallo de validación WIP: ...`);
}
// ...
validated.push({
  // ...
  lastFetchedOn: typeof entry.lastFetchedOn === 'number' ? entry.lastFetchedOn : null,
  lastJobStartedOn: typeof entry.lastJobStartedOn === 'number' ? entry.lastJobStartedOn : null,
  lastJobEndedOn: typeof entry.lastJobEndedOn === 'number' ? entry.lastJobEndedOn : null,
  lastJobDuration: typeof entry.lastJobDuration === 'number' ? entry.lastJobDuration : null,
  lastError: (entry.lastError !== null && typeof entry.lastError === 'object') ? entry.lastError : null,
  lastErrorOn: typeof entry.lastErrorOn === 'number' ? entry.lastErrorOn : null,
});
```

### 1.2 After (R3.3.4 Hardened Production-Grade Implementation)

```typescript
// HARDENED R3.3.4 IMPLEMENTATION:
public static validateWipData(raw: unknown): ValidatedWipEntry[] {
  if (!Array.isArray(raw)) {
    throw new WorkerShutdownError(
      'Fallo de validación WIP: la respuesta de getWipData() no es un arreglo.'
    );
  }

  const validated: ValidatedWipEntry[] = [];
  const validStates = ['created', 'active', 'stopping', 'stopped'];
  const hasOwn = (obj: object, prop: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, prop);

  for (let idx = 0; idx < raw.length; idx++) {
    const entry = raw[idx];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] no es un objeto válido.`
      );
    }

    const rec = entry as Record<string, unknown>;

    // 1. id (requerido, string no vacío)
    if (!hasOwn(rec, 'id') || rec.id === undefined || typeof rec.id !== 'string' || rec.id.trim().length === 0) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] tiene un 'id' inválido o faltante.`
      );
    }

    // 2. workId (requerido, string no vacío)
    if (!hasOwn(rec, 'workId') || rec.workId === undefined || typeof rec.workId !== 'string' || rec.workId.trim().length === 0) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] tiene un 'workId' inválido o faltante.`
      );
    }

    // 3. name (requerido, string no vacío)
    if (!hasOwn(rec, 'name') || rec.name === undefined || typeof rec.name !== 'string' || rec.name.trim().length === 0) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] tiene un 'name' (cola) inválido o faltante.`
      );
    }

    // 4. state (requerido, WorkerState)
    if (!hasOwn(rec, 'state') || rec.state === undefined || typeof rec.state !== 'string' || !validStates.includes(rec.state)) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] tiene un estado de worker desconocido o inválido: '${rec.state}'.`
      );
    }

    // 5. options (requerido, objeto no arreglo)
    if (!hasOwn(rec, 'options') || rec.options === undefined || rec.options === null || typeof rec.options !== 'object' || Array.isArray(rec.options)) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] tiene un objeto 'options' inválido o malformado.`
      );
    }

    // 6. count (requerido, entero finito no negativo - R3.3.3)
    if (
      !hasOwn(rec, 'count') ||
      rec.count === undefined ||
      typeof rec.count !== 'number' ||
      !Number.isFinite(rec.count) ||
      !Number.isInteger(rec.count) ||
      rec.count < 0
    ) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] tiene un 'count' numérico inválido (debe ser un entero finito no negativo, recibido: ${rec.count}).`
      );
    }

    // 7. createdOn (requerido, número finito - R3.3.3)
    if (
      !hasOwn(rec, 'createdOn') ||
      rec.createdOn === undefined ||
      typeof rec.createdOn !== 'number' ||
      !Number.isFinite(rec.createdOn)
    ) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] tiene un timestamp 'createdOn' inválido (debe ser un número finito, recibido: ${rec.createdOn}).`
      );
    }

    // Validación estricta de propiedades numéricas nullables requeridas por pg-boss 12.38.1 (R3.3.4):
    const validateRequiredNullableNumber = (propName: string): number | null => {
      if (!hasOwn(rec, propName)) {
        throw new WorkerShutdownError(
          `Fallo de validación WIP: la entrada [${idx}] carece de la propiedad requerida '${propName}'.`
        );
      }
      const val = rec[propName];
      if (val === undefined) {
        throw new WorkerShutdownError(
          `Fallo de validación WIP: la entrada [${idx}] tiene '${propName}' como undefined (debe ser número finito o null).`
        );
      }
      if (val === null) {
        return null;
      }
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new WorkerShutdownError(
          `Fallo de validación WIP: la entrada [${idx}] tiene '${propName}' inválido (debe ser número finito o null, recibido: ${val}).`
        );
      }
      return val;
    };

    // 8. lastFetchedOn
    const lastFetchedOn = validateRequiredNullableNumber('lastFetchedOn');

    // 9. lastJobStartedOn
    const lastJobStartedOn = validateRequiredNullableNumber('lastJobStartedOn');

    // 10. lastJobEndedOn
    const lastJobEndedOn = validateRequiredNullableNumber('lastJobEndedOn');

    // 11. lastJobDuration
    const lastJobDuration = validateRequiredNullableNumber('lastJobDuration');

    // 12. lastErrorOn
    const lastErrorOn = validateRequiredNullableNumber('lastErrorOn');

    // 13. lastError (propiedad requerida, objeto no arreglo o null - R3.3.4)
    if (!hasOwn(rec, 'lastError')) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] carece de la propiedad requerida 'lastError'.`
      );
    }
    const rawLastError = rec.lastError;
    if (rawLastError === undefined) {
      throw new WorkerShutdownError(
        `Fallo de validación WIP: la entrada [${idx}] tiene 'lastError' como undefined (debe ser objeto no arreglo o null).`
      );
    }
    let lastError: object | null = null;
    if (rawLastError !== null) {
      if (typeof rawLastError !== 'object' || Array.isArray(rawLastError)) {
        throw new WorkerShutdownError(
          `Fallo de validación WIP: la entrada [${idx}] tiene 'lastError' inválido (debe ser objeto no arreglo o null, recibido: ${typeof rawLastError}).`
        );
      }
      lastError = rawLastError;
    }

    validated.push({
      id: (rec.id as string).trim(),
      workId: (rec.workId as string).trim(),
      name: (rec.name as string).trim(),
      options: rec.options as Record<string, unknown>,
      state: rec.state as 'created' | 'active' | 'stopping' | 'stopped',
      count: rec.count as number,
      createdOn: rec.createdOn as number,
      lastFetchedOn,
      lastJobStartedOn,
      lastJobEndedOn,
      lastJobDuration,
      lastError,
      lastErrorOn,
    });
  }

  return validated;
}
```

---

## 2. ENGINEERING HIGHLIGHTS

1. **Safe Own-Property Checking:**
   Uses `Object.prototype.hasOwnProperty.call(rec, prop)` to guarantee that prototype properties cannot satisfy the presence check.
2. **Strict Rejection of Missing and `undefined`:**
   If a property is missing (`!hasOwn`) or has the value `undefined`, a descriptive `WorkerShutdownError` is raised immediately.
3. **Exact Value Preservation:**
   When a field is explicitly `null`, the validated entry retains `null`. When it is a finite number, the exact numeric value is passed through without floating-point conversion, rounding, or clamping. When `lastError` is an object, the reference is preserved.
4. **Preservation of All Prior Hardened Constraints:**
   The strictness implemented in R3.3.3 for `id`, `workId`, `name`, `options`, `state`, `count` (integer >= 0), and `createdOn` (finite timestamp) is 100% maintained.


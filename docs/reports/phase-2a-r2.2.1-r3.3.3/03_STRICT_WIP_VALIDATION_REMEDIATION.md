# PHASE 2A-R2.2.1-R3.3.3 — STRICT WIP VALIDATION REMEDIATION

**Project:** Bethesda Worship Studio  
**Role:** Principal Backend Engineer, Distributed Systems Architect  
**Source File:** `backend/src/application/conversion-worker.ts`  
**Method Remediated:** `ConversionWorker.validateWipData(raw: unknown): BossWipItem[]`  
**Status Date:** 2026-11-10  

---

## 1. REMEDIATION DIFF (BEFORE VS AFTER)

### 1.1 Before (R3.3.2 Implementation with Defective Fallbacks)

```typescript
// DEFECTIVE IMPLEMENTATION IN R3.3.2:
private validateWipData(raw: unknown): BossWipItem[] {
  if (!Array.isArray(raw)) {
    throw new WorkerShutdownError('MALFORMED_WIP_DATA', 'WIP data returned by pg-boss is not an array');
  }

  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} is not an object`);
    }

    const rawItem = item as Record<string, unknown>;
    if (typeof rawItem.id !== 'string' || !rawItem.id.trim()) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} missing valid 'id'`);
    }
    if (typeof rawItem.workId !== 'string' || !rawItem.workId.trim()) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} missing valid 'workId'`);
    }
    if (typeof rawItem.name !== 'string' || !rawItem.name.trim()) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} missing valid 'name'`);
    }
    if (!rawItem.options || typeof rawItem.options !== 'object' || Array.isArray(rawItem.options)) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} missing valid 'options' object`);
    }
    const validStates = ['created', 'active', 'stopping', 'stopped'];
    if (typeof rawItem.state !== 'string' || !validStates.includes(rawItem.state)) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} has invalid state: ${rawItem.state}`);
    }

    // AUDIT DEFECT: Fallback defaults fabricate state when metrics are missing or malformed
    return {
      id: rawItem.id,
      workId: rawItem.workId,
      name: rawItem.name,
      options: rawItem.options as Record<string, unknown>,
      state: rawItem.state as BossWipItem['state'],
      count: typeof rawItem.count === 'number' && Number.isFinite(rawItem.count) && rawItem.count >= 0 ? rawItem.count : 0,
      createdOn: typeof rawItem.createdOn === 'number' && Number.isFinite(rawItem.createdOn) ? rawItem.createdOn : Date.now(),
      lastFetchedOn: typeof rawItem.lastFetchedOn === 'number' && Number.isFinite(rawItem.lastFetchedOn) ? rawItem.lastFetchedOn : null,
      lastJobStartedOn: typeof rawItem.lastJobStartedOn === 'number' && Number.isFinite(rawItem.lastJobStartedOn) ? rawItem.lastJobStartedOn : null,
      lastJobEndedOn: typeof rawItem.lastJobEndedOn === 'number' && Number.isFinite(rawItem.lastJobEndedOn) ? rawItem.lastJobEndedOn : null,
      lastJobDuration: typeof rawItem.lastJobDuration === 'number' && Number.isFinite(rawItem.lastJobDuration) ? rawItem.lastJobDuration : null,
      lastError: rawItem.lastError && typeof rawItem.lastError === 'object' ? (rawItem.lastError as Record<string, unknown>) : null,
      lastErrorOn: typeof rawItem.lastErrorOn === 'number' && Number.isFinite(rawItem.lastErrorOn) ? rawItem.lastErrorOn : null,
    };
  });
}
```

### 1.2 After (R3.3.3 Production-Grade Hardened Implementation)

```typescript
// HARDENED IMPLEMENTATION IN R3.3.3:
private validateWipData(raw: unknown): BossWipItem[] {
  if (!Array.isArray(raw)) {
    throw new WorkerShutdownError('MALFORMED_WIP_DATA', 'WIP data returned by pg-boss is not an array');
  }

  const validStates = ['created', 'active', 'stopping', 'stopped'];

  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} is not an object`);
    }

    const rawItem = item as Record<string, unknown>;
    if (typeof rawItem.id !== 'string' || !rawItem.id.trim()) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} missing valid 'id'`);
    }
    if (typeof rawItem.workId !== 'string' || !rawItem.workId.trim()) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} missing valid 'workId'`);
    }
    if (typeof rawItem.name !== 'string' || !rawItem.name.trim()) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} missing valid 'name'`);
    }
    if (!rawItem.options || typeof rawItem.options !== 'object' || Array.isArray(rawItem.options)) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} missing valid 'options' object`);
    }
    if (typeof rawItem.state !== 'string' || !validStates.includes(rawItem.state)) {
      throw new WorkerShutdownError('MALFORMED_WIP_DATA', `WIP item at index ${idx} has invalid state: ${rawItem.state}`);
    }

    // STRICT VALIDATION OF MANDATORY METRICS: ZERO TOLERANCE FOR MISSING OR MALFORMED VALUES
    if (typeof rawItem.count !== 'number' || !Number.isInteger(rawItem.count) || rawItem.count < 0) {
      throw new WorkerShutdownError(
        'MALFORMED_WIP_DATA',
        `WIP item at index ${idx} has invalid 'count': expected non-negative integer, got ${rawItem.count}`,
      );
    }

    if (typeof rawItem.createdOn !== 'number' || !Number.isFinite(rawItem.createdOn)) {
      throw new WorkerShutdownError(
        'MALFORMED_WIP_DATA',
        `WIP item at index ${idx} has invalid 'createdOn': expected finite number timestamp, got ${rawItem.createdOn}`,
      );
    }

    // STRICT VALIDATION OF NULLABLE TELEMETRY FIELDS (pg-boss contract)
    const validateNullableTimestamp = (val: unknown, fieldName: string): number | null => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      throw new WorkerShutdownError(
        'MALFORMED_WIP_DATA',
        `WIP item at index ${idx} has invalid '${fieldName}': expected number or null, got ${typeof val}`,
      );
    };

    const lastFetchedOn = validateNullableTimestamp(rawItem.lastFetchedOn, 'lastFetchedOn');
    const lastJobStartedOn = validateNullableTimestamp(rawItem.lastJobStartedOn, 'lastJobStartedOn');
    const lastJobEndedOn = validateNullableTimestamp(rawItem.lastJobEndedOn, 'lastJobEndedOn');
    const lastJobDuration = validateNullableTimestamp(rawItem.lastJobDuration, 'lastJobDuration');
    const lastErrorOn = validateNullableTimestamp(rawItem.lastErrorOn, 'lastErrorOn');

    let lastError: Record<string, unknown> | null = null;
    if (rawItem.lastError !== null && rawItem.lastError !== undefined) {
      if (typeof rawItem.lastError !== 'object' || Array.isArray(rawItem.lastError)) {
        throw new WorkerShutdownError(
          'MALFORMED_WIP_DATA',
          `WIP item at index ${idx} has invalid 'lastError': expected object or null, got ${typeof rawItem.lastError}`,
        );
      }
      lastError = rawItem.lastError as Record<string, unknown>;
    }

    return {
      id: rawItem.id,
      workId: rawItem.workId,
      name: rawItem.name,
      options: rawItem.options as Record<string, unknown>,
      state: rawItem.state as BossWipItem['state'],
      count: rawItem.count,
      createdOn: rawItem.createdOn,
      lastFetchedOn,
      lastJobStartedOn,
      lastJobEndedOn,
      lastJobDuration,
      lastError,
      lastErrorOn,
    };
  });
}
```

---

## 2. KEY RECTIFICATIONS AND MATHEMATICAL RIGOR

1. **Integer and Non-Negative Guard for `count`:**
   - Evaluated via `Number.isInteger(rawItem.count) && rawItem.count >= 0`.
   - Explicitly rejects:
     - Negative numbers (`-1`, `-5`)
     - Floating point / fractional numbers (`0.5`, `3.14159`)
     - `NaN`, `+Infinity`, `-Infinity`
     - Non-number values (`"0"`, `null`, `undefined`, `{}`, `[]`)
2. **Finite Timestamp Guard for `createdOn`:**
   - Evaluated via `Number.isFinite(rawItem.createdOn)`.
   - Explicitly rejects `NaN`, `Infinity`, `undefined`, `null`, non-numbers.
3. **Telemetry Nullable Constraints:**
   - pg-boss initializes `lastFetchedOn`, `lastJobStartedOn`, `lastJobEndedOn`, `lastJobDuration`, and `lastErrorOn` to `null`.
   - When present, each must be a finite number. Strings (e.g. `"2026-01-01"`), booleans, or objects are strictly rejected.
   - `lastError` starts as `null`. When present, it must be a valid non-array object. Primitive types or arrays are rejected.
4. **All-or-Nothing Array Evaluation:**
   - If any single item in the `raw` array is malformed, `validateWipData` throws immediately.
   - No partial parsing, no sanitization by truncation, no fallback to default object attributes.
5. **Fail-Closed Lifecycle Protection:**
   - Throws `WorkerShutdownError('MALFORMED_WIP_DATA', ...)`.
   - In `ConversionWorker.stop()`, this error is caught, lifecycle is set to `ERROR`, error counter is incremented, and no false `STOPPED` state or `REMOVAL_CONFIRMED` event is emitted.


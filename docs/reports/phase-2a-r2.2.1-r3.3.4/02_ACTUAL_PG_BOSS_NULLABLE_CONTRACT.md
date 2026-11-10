# PHASE 2A-R2.2.1-R3.3.4 — ACTUAL PG-BOSS 12.38.1 NULLABLE WIP FIELD CONTRACT

**Project:** Bethesda Worship Studio  
**Role:** Principal Backend Engineer, PostgreSQL/pg-boss Specialist  
**Installed Library:** `pg-boss@12.38.1` (`backend/node_modules/pg-boss`)  
**Status Date:** 2026-11-10  

---

## 1. OFFICIAL TYPE DEFINITIONS FROM `pg-boss@12.38.1`

In `backend/node_modules/pg-boss/dist/types.d.ts`, the official interface for worker telemetry is declared:

```typescript
export interface WipData {
    id: string;
    workId: string;
    name: string;
    options: WorkOptions;
    state: WorkerState;
    count: number;
    createdOn: number;
    lastFetchedOn: number | null;
    lastJobStartedOn: number | null;
    lastJobEndedOn: number | null;
    lastJobDuration: number | null;
    lastError: object | null;
    lastErrorOn: number | null;
}
```

Notice the semantic distinction in TypeScript:
- None of the six telemetry fields are marked with `?` (e.g., `lastFetchedOn?: number | null`).
- They are **mandatory, required properties**.
- Their permitted values are either `number` / `object` or explicit `null`.
- The value `undefined` is **not permitted** by the type system.
- Omission of the property from the object is **not permitted** by the type system.

---

## 2. RUNTIME IMPLEMENTATION IN `pg-boss/dist/worker.js`

Inspection of `backend/node_modules/pg-boss/dist/worker.js` confirms that the JavaScript runtime constructor explicitly initializes every one of these six properties:

### 2.1 Worker Constructor Initialization

```javascript
constructor({ id, workId, name, options, resolveInterval, fetch, onFetch, onError, clock }) {
    this.id = id;
    this.workId = workId;
    this.name = name;
    this.options = options;
    // ...
    this.jobs = [];
    this.createdOn = clock.now();
    this.state = 'created';
    this.lastFetchedOn = null;
    this.lastJobStartedOn = null;
    this.lastJobEndedOn = null;
    this.lastJobDuration = null;
    this.lastError = null;
    this.lastErrorOn = null;
    // ...
}
```

### 2.2 `toWipData()` Runtime Output

```javascript
toWipData() {
    return {
        id: this.id,
        workId: this.workId,
        name: this.name,
        options: this.options,
        state: this.state,
        count: this.jobs.length,
        createdOn: this.createdOn,
        lastFetchedOn: this.lastFetchedOn,
        lastJobStartedOn: this.lastJobStartedOn,
        lastJobEndedOn: this.lastJobEndedOn,
        lastError: this.lastError,
        lastErrorOn: this.lastErrorOn,
        lastJobDuration: this.lastJobDuration
    };
}
```

Every object created by `toWipData()` **always** possesses all six keys as its own properties (`hasOwnProperty === true`).

---

## 3. STRICT PROPERTY CONTRACT SPECIFICATION

| Property Name | Required Own Property? | Permitted Values | Explicitly Prohibited Values |
| :--- | :---: | :--- | :--- |
| `lastFetchedOn` | **YES** | `null`, finite `number` (ms timestamp) | Missing property, `undefined`, `NaN`, `Infinity`, `-Infinity`, strings, booleans, objects, arrays |
| `lastJobStartedOn` | **YES** | `null`, finite `number` (ms timestamp) | Missing property, `undefined`, `NaN`, `Infinity`, `-Infinity`, strings, booleans, objects, arrays |
| `lastJobEndedOn` | **YES** | `null`, finite `number` (ms timestamp) | Missing property, `undefined`, `NaN`, `Infinity`, `-Infinity`, strings, booleans, objects, arrays |
| `lastJobDuration` | **YES** | `null`, finite `number` (ms duration) | Missing property, `undefined`, `NaN`, `Infinity`, `-Infinity`, strings, booleans, objects, arrays |
| `lastErrorOn` | **YES** | `null`, finite `number` (ms timestamp) | Missing property, `undefined`, `NaN`, `Infinity`, `-Infinity`, strings, booleans, objects, arrays |
| `lastError` | **YES** | `null`, non-null non-array `object` | Missing property, `undefined`, arrays (`[]`), strings, numbers, booleans, functions |

---

## 4. ARCHITECTURAL NECESSITY OF FAIL-CLOSED REJECTION

### 4.1 The Defect in R3.3.3
In R3.3.3, `validateWipData` contained:
```typescript
if (entry.lastFetchedOn !== undefined && entry.lastFetchedOn !== null && ...)
```
and:
```typescript
lastFetchedOn: typeof entry.lastFetchedOn === 'number' ? entry.lastFetchedOn : null,
```
This had two critical flaws:
1. If `lastFetchedOn` was completely missing or `undefined`, the validator skipped validation and silently fabricated `null` in the validated record.
2. If `lastError` was missing or `undefined`, it silently assigned `lastError: null`.

### 4.2 Why Fabrication Violates Distributed Systems Correctness
In a mission-critical distributed queue:
- A telemetry payload lacking required pg-boss telemetry properties indicates either data corruption, memory truncation, or a counterfeit mock object.
- Silently substituting `null` masks corruption, misleading the supervisor into treating an unverified or malfunctioning worker as a quiescent, healthy consumer.
- Under fail-closed governance, the supervisor must verify property existence via `Object.prototype.hasOwnProperty.call()` and reject missing or `undefined` properties immediately by throwing `WorkerShutdownError('MALFORMED_WIP_DATA', ...)`.


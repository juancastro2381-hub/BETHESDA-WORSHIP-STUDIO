# PHASE 2A-R2.2.1-R3.3.3 — ACTUAL PG-BOSS 12.38.1 WIP CONTRACT ANALYSIS

**Project:** Bethesda Worship Studio  
**Role:** Principal Backend Engineer, Distributed Systems Architect, PostgreSQL/pg-boss Specialist  
**Installed Library:** `pg-boss@12.38.1` (`backend/node_modules/pg-boss`)  
**Status Date:** 2026-11-10  

---

## 1. OFFICIAL TYPE DEFINITIONS FROM INSTALLED PG-BOSS

In `backend/node_modules/pg-boss/dist/types.d.ts`, the official TypeScript definitions for worker state and WIP telemetry are declared as follows:

```typescript
export type WorkerState = 'created' | 'active' | 'stopping' | 'stopped';

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

In `backend/node_modules/pg-boss/dist/worker.d.ts`:

```typescript
declare class Worker<T = unknown> {
    readonly id: string;
    readonly workId: string;
    readonly name: string;
    readonly options: types.WorkOptions;
    // ...
    jobs: types.Job<T>[];
    createdOn: number;
    state: types.WorkerState;
    lastFetchedOn: number | null;
    lastJobStartedOn: number | null;
    lastJobEndedOn: number | null;
    lastJobDuration: number | null;
    lastError: any;
    lastErrorOn: number | null;
    // ...
    toWipData(): types.WipData;
}
```

---

## 2. RUNTIME IMPLEMENTATION IN `pg-boss/dist/worker.js`

Inspection of the actual runtime code in `backend/node_modules/pg-boss/dist/worker.js` reveals:

### 2.1 Constructor Initialization

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

### 2.2 `toWipData()` Method

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

---

## 3. COMPREHENSIVE FIELD-BY-FIELD ANALYSIS

| Field Name | Type Contract | Nullable? | Source Expression in `Worker` | Invariant Constraints |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `string` | **No** | `this.id` | Non-empty string. |
| `workId` | `string` | **No** | `this.workId` | Non-empty string; matches subscription ID. |
| `name` | `string` | **No** | `this.name` | Non-empty string; queue name. |
| `options` | `object` | **No** | `this.options` | Non-null, non-array JavaScript object. |
| `state` | `string` | **No** | `this.state` | One of `'created'`, `'active'`, `'stopping'`, `'stopped'`. |
| `count` | `number` | **No** | `this.jobs.length` | Finite, non-negative integer (`Number.isInteger(c) && c >= 0`). |
| `createdOn` | `number` | **No** | `this.createdOn` | Finite number timestamp (`Number.isFinite(ts)`). |
| `lastFetchedOn` | `number \| null` | **Yes** | `this.lastFetchedOn` | `null` or finite number. |
| `lastJobStartedOn`| `number \| null` | **Yes** | `this.lastJobStartedOn` | `null` or finite number. |
| `lastJobEndedOn` | `number \| null` | **Yes** | `this.lastJobEndedOn` | `null` or finite number. |
| `lastJobDuration`| `number \| null` | **Yes** | `this.lastJobDuration` | `null` or finite number. |
| `lastErrorOn` | `number \| null` | **Yes** | `this.lastErrorOn` | `null` or finite number. |
| `lastError` | `object \| null` | **Yes** | `this.lastError` | `null` or non-array object. |

---

## 4. ARCHITECTURAL JUSTIFICATION: WHY DEFAULTING IS STRICTLY PROHIBITED

In Phase 2A-R2.2.1-R3.3.2, `validateWipData` contained default fallbacks:
```typescript
// DEFECT IN R3.3.2:
count: typeof rawItem.count === 'number' && Number.isFinite(rawItem.count) && rawItem.count >= 0 ? rawItem.count : 0,
createdOn: typeof rawItem.createdOn === 'number' && Number.isFinite(rawItem.createdOn) ? rawItem.createdOn : Date.now(),
```

### Why this fallback was defective and dangerous:
1. **Fabrication of Runtime Telemetry:**
   When an object lacks `count` or `createdOn`, it is NOT a valid `pg-boss` worker. By fabricating `count: 0`, the validator told the supervisor that the worker was quiescent (holding 0 active jobs), even if it was a corrupted object or an entirely foreign entity holding unacknowledged jobs.
2. **False Shutdown Certification Risk:**
   If `pg-boss.getWipData()` returns corrupted data, masking the corruption by supplying `count: 0` could cause `ConversionWorker.stop()` to prematurely believe that all jobs had finished, leading to unhandled job abandonment or uncommitted transactions during node termination.
3. **Strict Fail-Closed Distributed Systems Principle:**
   In distributed queues, any telemetry payload that fails schema validation must be treated as an unverified state. The supervisor must refuse to certify worker state transitions, reject the response, and raise an explicit `WorkerShutdownError`, keeping the worker in its existing guarded state until verified or escalated.

Therefore, `validateWipData` must require `count` to be an explicit, finite, non-negative integer and `createdOn` to be an explicit, finite timestamp number, rejecting any payload that deviates.


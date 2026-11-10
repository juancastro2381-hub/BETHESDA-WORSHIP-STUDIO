# PHASE 2A-R2.2.1-R3.3.6 — WORKER LIFECYCLE SEMANTIC REVIEW

**Project:** Bethesda Worship Studio  
**Role:** Principal Backend Engineer, Distributed Systems Architect, Senior QA Auditor  
**Date:** 2026-11-10T15:15:00-05:00  

---

## 1. PURPOSE AND RIGOR

A passing test suite proves that specified scenarios produce expected outputs under test conditions; it does not independently prove architectural or runtime correctness. This document provides a semantic code audit of `ConversionWorker` in `backend/src/application/conversion-worker.ts` to verify the actual invariants, failure boundaries, and distributed systems semantics.

---

## 2. ARCHITECTURAL BOUNDARY SEPARATION

To eliminate any ambiguity or unsupported claims regarding pg-boss internals, three distinct architectural tiers must be rigorously separated:

### Tier 1: Local In-Process Worker Telemetry (`boss.getWipData()`)
- **Scope:** Confined exclusively to the local Node.js process and memory space of the specific `PgBoss` instance.
- **Implementation in pg-boss 12.38.1:** `getWipData()` queries the local `Manager` instance's `workers` collection. It returns snapshots of in-flight workers currently registered *in this process*.
- **Authoritative Meaning:** Local `getWipData()` provides definitive proof that a worker on *this local process* has stopped receiving jobs and has been removed from the local dispatch queue.
- **Architectural Boundary:** **Local `getWipData()` DOES NOT prove distributed worker deregistration across other processes, containers, or nodes.** Claiming that local `getWipData()` guarantees cluster-wide consumer removal is architecturally false. Bethesda Worship Studio uses `getWipData()` strictly for *process-local* worker confirmation.

### Tier 2: PostgreSQL-Backed Job Coordination (`pgboss.job` & `background_jobs`)
- **Scope:** Distributed cluster-wide state persisted in PostgreSQL.
- **Mechanics:**
  - `pgboss.job`: Managed by pg-boss in the database schema; coordinates job state (`created`, `active`, `completed`, `failed`, `cancelled`), retry counts, backoff intervals, and job expiration (`expirein`).
  - `background_jobs`: Managed by Bethesda application logic with explicit leases (`lease_acquired_at`, `lease_expires_at`).
  - Worker mutual exclusion and fencing are enforced at the database row level via atomic conditional SQL queries:
    $$\text{UPDATE background\_jobs SET status = 'PROCESSING', lease\_acquired\_at = NOW(), ... WHERE id = :id AND (status = 'PENDING' OR (status = 'PROCESSING' AND lease\_expires\_at < NOW()))}$$
  - Stale job recovery (`recoverStaleJobs()`) recovers abandoned jobs independently of worker instance health.

### Tier 3: Cross-Process and Multi-Node Worker Behavior
- **Scope:** Multi-instance deployment (e.g., Kubernetes pods or Docker containers).
- **Semantics:**
  - Multiple nodes can register workers on the `music-conversion` queue simultaneously.
  - When Node A shuts down, it issues a targeted `boss.offWork(queue, { id })` for its own consumer ID. It does not touch Node B's consumer ID.
  - If Node A crashes abruptly (SIGKILL or power loss), its in-process worker terminates immediately. In-flight jobs being processed by Node A are abandoned; their leases in PostgreSQL will expire, and Node B's periodic recovery cycle (`recoverStaleJobs()`) will reclaim them safely without split-brain or data corruption.

---

## 3. AUDIT OF KEY LIFECYCLE INVARIANTS

### 3.1 Targeted `boss.offWork()` and Preservation of Unrelated Consumers
- **Invariant:** A shutting-down worker must NEVER invoke global `boss.offWork(queue)` without `{ id }`, as doing so would terminate all consumers on that queue across the entire local process.
- **Verification in Code (Lines 991–1006):**
  ```typescript
  if (!this.subscriptionId) {
    throw new WorkerShutdownError(
      'Fallo crítico de seguridad en desuscripción: la suscripción figura activa pero el identificador de suscripción es nulo. ' +
      'Se prohíbe terminantemente la invocación de offWork() global para preservar a otros consumidores en la cola.'
    );
  }
  const targetSubId = this.subscriptionId;
  await boss.offWork(CONVERSION_QUEUE_NAME, { id: targetSubId, wait: true });
  ```
  - **Result:** Strict fail-closed protection. Global `offWork()` is architecturally prevented.

### 3.2 Authoritative Verification of Removal Before `STOPPED`
- **Invariant:** A worker must NEVER report `STOPPED` or `success: true` unless removal of the consumer is authoritatively confirmed.
- **Verification in Code (Lines 1016–1044):**
  - Calls `rawWip = boss.getWipData()`.
  - Strictly validates structural schema via `validateWipData(rawWip)`.
  - Checks if `isTargetWorkerStillActive = validatedWorkers.some(...)`.
  - If target worker still exists in WIP: throws `WorkerShutdownError`.
  - If an error occurs: transitions to `ERROR`, sets `registrationState = 'UNRESOLVED_ERROR'`, and sets `success: false`.
  - **Result:** No false `STOPPED` states can be emitted.

### 3.3 Concurrent Operations, Lifecycle Generations, and Stale Async Resolution
- **Invariant:** If a shutdown operation times out or runs slowly, and a subsequent `recover()` or `start()` is initiated, late resolution of the old asynchronous task must not corrupt current state.
- **Verification in Code (Lines 999, 1032, 1046):**
  - Increments `taskGen = ++this.lifecycleGeneration`.
  - When the async task completes:
    ```typescript
    if (this.lifecycleGeneration !== taskGen) {
      return; // Discard stale state mutation
    }
    ```
  - **Result:** Concurrency fencing prevents stale asynchronous callbacks from overwriting active state.

### 3.4 Bounded Graceful Drain and Timeout Semantics
- **Invariant:** If active jobs cannot complete within the specified timeout, the worker must not hang indefinitely.
- **Verification in Code (Lines 1125–1137):**
  - Graceful drain loop has strict deadline check: `while (this.activeJobIds.size > 0 && Date.now() < deadline)`.
  - If deadline expires, remaining jobs remain in `PROCESSING` in PostgreSQL; their database leases will naturally expire and be recovered by peer workers.
  - **Result:** Strict bounded shutdown guaranteed.

---

## 4. CONCLUSION

The semantic audit confirms that the worker implementation enforces all core distributed systems requirements:
1. Targeted deregistration prevents peer consumer eviction.
2. Fail-closed verification prevents false `STOPPED` transitions.
3. Generation fencing eliminates race conditions from stale asynchronous tasks.
4. Local in-process assertions are strictly differentiated from PostgreSQL cluster coordination.


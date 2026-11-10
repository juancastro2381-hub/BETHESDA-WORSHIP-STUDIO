# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3
## Report 05: Lifecycle State Machine, Concurrency & Generation Tokens

**Audit Finding Reference:** WS-R33-03 / Blocker R33-03  
**Target Code:** `ConversionWorker` Lifecycle Coordination

---

### 1. Dual-Axis State Representation

The worker coordinates two distinct lifecycle axes to guarantee zero ghost workers:

```
+-----------------------------------------------------------------------------------+
| LIFECYCLE STATE:  IDLE -> STARTING -> RUNNING -> STOPPING -> STOPPED / ERROR      |
+-----------------------------------------------------------------------------------+
| REGISTRATION:     NEVER_ATTEMPTED -> REGISTERED -> REMOVAL_PENDING                |
|                                                  -> REMOVAL_CONFIRMED             |
|                   (On Anomaly: UNCERTAIN -> UNRESOLVED_ERROR)                     |
+-----------------------------------------------------------------------------------+
```

#### Transition Invariants:
1. `IDLE` -> `STARTING`: Requires `!hasUnresolvedRegistration()` and `lifecycleState !== 'ERROR'`.
2. `STARTING` -> `RUNNING`: Requires string `subscriptionId` and `registrationState = 'REGISTERED'`.
3. `STARTING` -> `ERROR`: If registration is incomplete or invalid; sets `registrationState = 'UNCERTAIN'`.
4. `RUNNING` -> `STOPPING`: Initiates atomic unsubscription task; sets `registrationState = 'REMOVAL_PENDING'`.
5. `STOPPING` -> `STOPPED`: Validated ONLY when `registrationState = 'REMOVAL_CONFIRMED'`.
6. `STOPPING` -> `ERROR`: If unsubscription times out, fails, or residual worker is detected in pg-boss WIP.

---

### 2. Atomic Generation Tokens (`lifecycleGeneration`)

When a shutdown operation times out, its underlying promise continues executing in background (`pendingUnsubscribePromise`).

To prevent race conditions where a late-resolving callback mutates state after a subsequent operation has taken place:
1. Each unsubscription task captures `const taskGen = ++this.lifecycleGeneration`.
2. Upon completion (success or error), the callback checks `if (this.lifecycleGeneration !== taskGen) return;`.
3. If a new `start()` or subsequent unsubscription was initiated, `this.lifecycleGeneration` has incremented, causing the stale callback to safely discard its mutation.
4. If a second caller (`recover()` or `stop()`) awaits the in-flight `pendingUnsubscribePromise`, the task completes within its generation without false discard.

---

### 3. Single-Flight Concurrency Controls

- **Concurrent `start()` Calls:** Multiple concurrent invocations share `this.startingPromise`. Exactly one `boss.work()` is executed.
- **Concurrent `stop()` Calls:** Multiple concurrent invocations share `this.stoppingPromise`. Both callers receive identical, consistent `WorkerStopResult`.
- **`start()` Awaiting In-Flight `stop()`:** If `start()` is invoked while `stop()` is active in `STOPPING`, `start()` awaits `stoppingPromise` completion before evaluating whether startup is permitted.


# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3
## Report 02: pg-boss Registration Failure & Vulnerability Forensic Analysis

**Audit Finding Reference:** WS-R33-01 / Blocker R33-01  
**Target Component:** `ConversionWorker.performStart()` and `ConversionWorker.performStop()`

---

### 1. Forensic Anatomy of the R3.2 Defect

In Phase 2A-R2.2.1-R3.2, strict subscription isolation was introduced by requiring that `boss.work()` return a valid non-empty string `subscriptionId`.

However, the independent audit discovered a critical fail-open vulnerability when `boss.work()` returns an invalid value (`null`, `undefined`, `""`, whitespace `"   "`, or a malformed non-string object):

#### The Defective Execution Path in R3.2:
1. `boss.work()` returns `null` or invalid data.
2. `performStart()` detects that `typeof subId !== 'string' || subId.trim().length === 0`.
3. It throws a `WorkerLifecycleError`, sets `this.lifecycleState = 'ERROR'`, and cleans up by setting:
   ```typescript
   this.isQueueSubscribed = false;
   this.subscriptionId = null;
   ```
4. The worker caller or supervisor catches the error and subsequently invokes `worker.stop()`.
5. In `performStop()`:
   ```typescript
   if (this.isQueueSubscribed || this.pendingUnsubscribePromise !== null) {
     // Targeted unsubscribe branch
   } else {
     // No active subscription detected
     offWorkSettledThisCall = true;
     this.unsubscribeSettled = true;
     this.pendingUnsubscribePromise = null;
     this.lastShutdownError = null; // Clears error!
     this.lifecycleState = 'STOPPED'; // False STOPPED transition!
   }
   ```
6. The `stop()` method returns `{ success: true, state: 'STOPPED' }` without throwing, and `worker.getLifecycleState()` transitions to `STOPPED`!

#### Why This is a Distributed Systems Hazard:
In real `pg-boss`, internal registration creates a `Worker` instance within the process Manager and adds it to the internal queue pool before `work()` resolves. If the return value is lost or malformed, the underlying consumer may **still be actively consuming jobs from PostgreSQL**.
Reporting `STOPPED` and `success: true` creates a "ghost consumer": the application believes the worker is idle or cleanly stopped, while in reality the worker continues receiving jobs and competing for database leases.

---

### 2. Failure Vectors Analyzed

| Vector | Return from `boss.work()` | Previous Behavior (R3.2) | Remediated Behavior (R3.3) |
|---|---|---|---|
| **Null Response** | `null` | Falsely transitioned to `STOPPED` on subsequent `stop()` | Transitions to `ERROR`, preserves `UNCERTAIN`/`UNRESOLVED_ERROR`, fails closed on `stop()` |
| **Undefined Response** | `undefined` | Falsely transitioned to `STOPPED` on subsequent `stop()` | Transitions to `ERROR`, preserves `UNCERTAIN`/`UNRESOLVED_ERROR`, fails closed on `stop()` |
| **Empty String** | `""` | Falsely transitioned to `STOPPED` on subsequent `stop()` | Transitions to `ERROR`, preserves `UNCERTAIN`/`UNRESOLVED_ERROR`, fails closed on `stop()` |
| **Whitespace String** | `"   "` | Falsely transitioned to `STOPPED` on subsequent `stop()` | Transitions to `ERROR`, preserves `UNCERTAIN`/`UNRESOLVED_ERROR`, fails closed on `stop()` |
| **Malformed Object** | `{ error: 500 }` | Falsely transitioned to `STOPPED` on subsequent `stop()` | Transitions to `ERROR`, preserves `UNCERTAIN`/`UNRESOLVED_ERROR`, fails closed on `stop()` |
| **Thrown Exception** | `throw new Error(...)` | `registrationState = UNCERTAIN`, restart blocked | Preserved `UNCERTAIN`, fail closed on `stop()`, restart blocked |

---

### 3. Conclusion

The worker lifecycle must treat any incomplete, anomalous, or unconfirmed registration as **authoritatively UNCERTAIN**, barring any transition to `STOPPED` unless verified by absence evidence or explicit reconciliation.


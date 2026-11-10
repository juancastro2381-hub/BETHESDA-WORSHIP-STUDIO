# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3
## Report 03: Invalid Subscription ID Remediation & Registration State Machine

**Audit Finding Reference:** Blocker R33-01  
**Target Code:** `backend/src/application/conversion-worker.ts`

---

### 1. Specification of Worker Registration States

To eliminate the conflation of "unregistered" with "safely stopped", `ConversionWorker` introduces an explicit, formal state machine for registration tracking:

```typescript
export type WorkerRegistrationState =
  | 'NEVER_ATTEMPTED'     // Worker instantiated, no start() attempted
  | 'REGISTERED'          // Subscribed to pg-boss with validated string subscriptionId
  | 'UNCERTAIN'           // Registration initiated but response missing, malformed, or threw
  | 'REMOVAL_PENDING'     // Targeted offWork({ id }) in flight
  | 'REMOVAL_CONFIRMED'   // Targeted offWork({ id }) settled AND confirmed absent in getWipData()
  | 'UNRESOLVED_ERROR';   // Shutdown attempted while in UNCERTAIN without successful reconciliation
```

---

### 2. Remediation Implementation in `performStart()`

When `performStart()` runs:
1. `this.registrationState` transitions immediately to `'UNCERTAIN'` before invoking `boss.work()`.
2. The return value `subId` is strictly verified:
   ```typescript
   if (typeof subId !== 'string' || subId.trim().length === 0) {
     this.registrationState = 'UNCERTAIN';
     this.isQueueSubscribed = false;
     this.subscriptionId = null;
     this.lifecycleState = 'ERROR';
     const subError = new WorkerLifecycleError(
       `Fallo crítico de registro en pg-boss: boss.work() no retornó un identificador de suscripción válido (recibido: ${JSON.stringify(subId)}). ` +
       'El resultado del registro permanece en estado INCIERTO (UNCERTAIN) y requiere reconciliación autoritativa.'
     );
     this.lastShutdownError = subError;
     if (this.recoveryTimer) {
       clearInterval(this.recoveryTimer);
       this.recoveryTimer = null;
     }
     throw subError;
   }
   ```
3. Only upon confirming a non-empty string does `this.registrationState` transition to `'REGISTERED'`.

---

### 3. Fail-Closed Remediation in `performStop()`

When `performStop()` is called on a worker whose registration is in an uncertain or unresolved state:
```typescript
} else if (this.hasUnresolvedRegistration()) {
  this.registrationState = 'UNRESOLVED_ERROR';
  throw new WorkerShutdownError(
    'Fallo autoritativo de shutdown: el worker se encuentra en estado de registro INCIERTO (UNCERTAIN) o ERROR NO RESUELTO. ' +
    'Se prohíbe la transición a STOPPED y la desuscripción global sin evidencia autoritativa de ausencia. ' +
    'Reconcilie la identidad exacta mediante recover({ reconciledSubscriptionId }) o reinicie el proceso.'
  );
} else if (this.registrationState === 'NEVER_ATTEMPTED' || this.registrationState === 'REMOVAL_CONFIRMED') {
  // Authoritative evidence of safe clean state
  this.lifecycleState = 'STOPPED';
}
```

#### Invariants Guaranteed:
1. **Never False STOPPED:** If registration is uncertain, calling `stop()` returns `{ success: false, state: 'ERROR' }` or throws `WorkerShutdownError`.
2. **Never Cleared Errors:** `this.lastShutdownError` is preserved and not overwritten with `null`.
3. **Never Bypassed via resetLifecycle():** `resetLifecycle()` checks `this.hasUnresolvedRegistration()` and throws `WorkerLifecycleError` immediately.
4. **Never Restarted into Ghost Consumers:** `start()` checks `this.hasUnresolvedRegistration()` and strictly rejects execution.


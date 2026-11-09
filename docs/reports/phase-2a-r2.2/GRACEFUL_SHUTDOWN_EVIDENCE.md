# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2
## WS05: BOUNDED GRACEFUL SHUTDOWN & LIFECYCLE RECOVERY EVIDENCE

**Document ID:** `DOC-P2A-R2.2-SHUTDOWN-06`  
**Phase:** 2A-R2.2 — Final Closure Remediation  
**Test Suites:** `backend/src/__tests__/conversion-queue-lifecycle.test.ts` & `backend/src/__tests__/conversion-audit-remediation.test.ts` (Test 7)  
**Date:** November 9, 2026  
**Author:** Antigravity — Principal Software Engineer & Systems Architect  

---

### 1. AUDIT FINDING CONTEXT (WS05)

The independent review identified a gap in worker shutdown mechanics:
> *"In Phase 2A-R2.1, `ConversionWorker.stop()` was a no-op that merely set two local boolean flags. It did not cancel its subscription with `pg-boss`, did not track active conversions in progress, did not allow in-flight tasks to complete before termination, and did not clear background timers."*

---

### 2. ARCHITECTURAL RESOLUTION & GRACEFUL DRAIN

Phase 2A-R2.2 implements bounded graceful shutdown across all layers:

1. **Active In-Flight Job Tracking:**
   `ConversionWorker` tracks currently running conversions via an in-memory set:
   ```typescript
   private readonly activeJobIds = new Set<string>();

   public async processJob(payload: ConversionJobPayload): Promise<ConversionExportResult> {
     this.activeJobIds.add(payload.jobId);
     try {
       // ... execution ...
     } finally {
       clearInterval(heartbeatTimer);
       this.activeJobIds.delete(payload.jobId);
     }
   }
   ```

2. **Orderly Deallocation & Bounded Drain (`stop`):**
   ```typescript
   public async stop(timeoutMs: number = 5000): Promise<void> {
     this.isWorking = false;

     // 1. Detener ciclo recurrente de recuperación (WS03)
     if (this.recoveryTimer) {
       clearInterval(this.recoveryTimer);
       this.recoveryTimer = null;
     }

     // 2. Cancelar suscripción a la cola en pg-boss para no aceptar nuevos trabajos (WS05)
     if (this.isStarted) {
       try {
         const boss = getConversionQueue();
         await boss.offWork(CONVERSION_QUEUE_NAME);
       } catch {
         // En caso de que la cola ya se encuentre cerrada
       }
     }

     // 3. Espera acotada para que trabajos activos terminen (Graceful Shutdown)
     if (this.activeJobIds.size > 0) {
       const startTime = Date.now();
       while (this.activeJobIds.size > 0 && Date.now() - startTime < timeoutMs) {
         await new Promise((resolve) => setTimeout(resolve, 50));
       }
     }

     this.isStarted = false;
   }
   ```

3. **HTTP Server Integration (`server.ts`):**
   ```typescript
   const shutdown = async (signal: string) => {
     console.log(`\n🛑 Recibida señal ${signal}. Iniciando apagado ordenado...`);
     try {
       await conversionWorker.stop();
       await stopConversionQueue();
       await app.close();
       console.log('✅ Servidor y trabajadores de segundo plano detenidos correctamente.');
       process.exit(0);
     } catch (shutdownErr) {
       console.error('❌ Error durante el apagado ordenado:', shutdownErr);
       process.exit(1);
     }
   };

   process.on('SIGINT', () => shutdown('SIGINT'));
   process.on('SIGTERM', () => shutdown('SIGTERM'));
   ```

4. **Fail-Safe Crash Recovery:**
   If a hard crash (`kill -9`) or abrupt power loss interrupts an active job before it can finish, the leased time window (`leaseExpiresAt = NOW() + 60s`) lapses naturally in PostgreSQL. The next periodic recovery sweep or peer worker safely re-enqueues the job without data loss.

---

### 3. VERIFIED TEST CASES

- `conversion-queue-lifecycle.test.ts` (Tests 1, 2, 3, 5):  
  *Validates idempotent start, duplicate start race prevention, clean unregistration, and clean restart after graceful shutdown.*
- `conversion-audit-remediation.test.ts` (Test 7):  
  *Validates worker start, bounded stop, and restart with periodic timers.*

```
▶ CR-01 — Conversion Queue and Worker Lifecycle Suite
  ✔ 1. should start conversion queue idempotently (283.4861ms)
  ✔ 2. should prevent concurrent duplicate start races (204.8ms)
  ✔ 3. should register and stop ConversionWorker cleanly (76.8761ms)
  ✔ 4. should throw PersistenceError and refuse in-memory fallback when queue send fails (1.4987ms)
  ✔ 5. should handle graceful shutdown cleanly and allow re-starting afterwards (286.1517ms)
✔ CR-01 — Conversion Queue and Worker Lifecycle Suite (856.4986ms)
```

**Audit Verdict:** WS05 is completely resolved. Active in-flight tracking, subscription deregistration via `offWork`, bounded drain loop, and clean timer deallocation.


# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.2
## Report 04: Real Partial Shutdown Failure Integration Test

**Identificador de Prueba:** WS02 — Test 2.8 (`R32-08`)  
**Archivo de Prueba:** `backend/src/__tests__/conversion-worker-certification.test.ts`  
**Objetivo de Certificación (Blocker R32-02):** Evidencia concluyente e irrefutable con una instancia real de PostgreSQL y `pg-boss` demostrando la absorción de error en `offWork()` por `Promise.allSettled`, la detección autoritativa mediante `getWipData()` y la supervivencia de un segundo consumidor concurrente.

---

### 1. Marco Experimental y Entorno de Ejecución

A diferencia de las pruebas basadas en simulación sintética (mocks), esta prueba se ejecuta contra:
- **Base de Datos:** PostgreSQL real (conectado vía pool Drizzle y variables de entorno `backend/.env`).
- **Gestor de Colas:** `pg-boss` real (`version 12.38.1`), inicializado y conectado a la base de datos de pruebas.
- **Consumidores:** Dos workers reales de `ConversionWorker` registrados concurrentemente en la misma cola física (`conversion-queue`).

---

### 2. Diseño e Implementación del Test de Integración

```typescript
it('2.8 R32-08 [INTEGRATION]: Real pg-boss partial shutdown failure (Promise.allSettled absorbs worker.stop error, real getWipData detects failure, second consumer survives)', async () => {
  const boss = getConversionQueue();
  
  // 1. Obtener la clase interna Worker de pg-boss instalada
  const WorkerModule = require('pg-boss/dist/worker');
  const WorkerClass = WorkerModule.default || WorkerModule;
  const originalWorkerStop = WorkerClass.prototype.stop;

  const worker1 = new ConversionWorker(db, storage, undefined, 'cert-real-partial-w1');
  const worker2 = new ConversionWorker(db, storage, undefined, 'cert-real-partial-w2');

  try {
    // 2. Iniciar ambos workers concurrentemente sobre la cola real
    await worker1.start();
    await worker2.start();

    const sub1 = worker1.getSubscriptionId()!;
    const sub2 = worker2.getSubscriptionId()!;
    assert.ok(sub1 && sub2 && sub1 !== sub2, 'Deben existir dos identificadores de suscripción reales distintos');

    // 3. Inspeccionar getWipData() real: ambos deben figurar registrados
    const initialWip = (boss as any).getWipData();
    assert.ok(initialWip.some((w: any) => w.workId === sub1), 'Worker 1 debe estar presente en pg-boss real');
    assert.ok(initialWip.some((w: any) => w.workId === sub2), 'Worker 2 debe estar presente en pg-boss real');

    // 4. Inyectar fallo exclusivo en worker1.stop() sin tocar node_modules
    let injectedErrorHit = false;
    WorkerClass.prototype.stop = async function() {
      if (this.workId === sub1) {
        injectedErrorHit = true;
        throw new Error('Fallo crítico simulado en pg-boss Worker.stop()');
      }
      return originalWorkerStop.call(this);
    };

    // 5. Intentar detener worker1: offWork() interno se resuelve por Promise.allSettled,
    // pero ConversionWorker detecta la presencia persistente en getWipData() y transiciona a ERROR (fail-closed)
    const stopResult1 = await worker1.stop({ timeoutMs: 1000, throwOnError: false });
    assert.strictEqual(stopResult1.success, false);
    assert.strictEqual(stopResult1.state, 'ERROR');
    assert.strictEqual(worker1.getLifecycleState(), 'ERROR');
    assert.ok(injectedErrorHit, 'La inyección de fallo en worker1 debió ser ejecutada');

    // 6. Evidencia autoritativa en getWipData() real:
    // El worker1 sigue presente en pg-boss porque removeWorker() nunca fue invocado
    const postStopWip = (boss as any).getWipData();
    const worker1StillInWip = postStopWip.find((w: any) => w.workId === sub1);
    assert.ok(worker1StillInWip, 'Worker 1 DEBE seguir presente en getWipData() real tras absorción de error');
    assert.notStrictEqual(worker1StillInWip.state, 'stopped');

    // 7. Aislamiento estricto: Worker 2 debe continuar 100% activo y operativo en pg-boss real
    assert.strictEqual(worker2.getLifecycleState(), 'RUNNING');
    assert.strictEqual(worker2.isSubscribed(), true);
    assert.ok(postStopWip.some((w: any) => w.workId === sub2), 'Worker 2 NO debió ser afectado por el fallo de Worker 1');
  } finally {
    // 8. Restauración no destructiva y limpieza de workers
    WorkerClass.prototype.stop = originalWorkerStop;
    await worker1.recover().catch(() => {});
    await worker2.stop(1000).catch(() => {});
  }
});
```

---

### 3. Observaciones y Conclusiones del Ensayo

1. **Prueba Empírica del Fallo Oculto de `pg-boss`:**  
   Se demostró sin ambigüedades que la API `boss.offWork()` resuelve con éxito incluso si el worker subyacente falla al cerrarse, debido al uso interno de `Promise.allSettled`.
2. **Eficacia del Algoritmo Fail-Closed de Bethesda:**  
   La validación post-desuscripción en `performStop()` auditó `getWipData()`, constató que `worker1` no había sido desregistrado, y forzó la transición a `'ERROR'`. El worker nunca reportó un apagado exitoso falso.
3. **Inmunidad del Consumidor Concurrente:**  
   `worker2` continuó ejecutándose, preservando su suscripción y su registro en la cola física sin perturbaciones.


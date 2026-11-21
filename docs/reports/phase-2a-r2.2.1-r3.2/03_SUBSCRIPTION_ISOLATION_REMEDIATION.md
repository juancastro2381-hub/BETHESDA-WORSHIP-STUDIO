# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.2
## Report 03: Subscription Isolation & Strict Identity Remediation

**Módulo Remediado:** `backend/src/application/conversion-worker.ts`  
**Problema Resuelto (Blocker R32-01):** Fallback peligroso de desuscripción global y ausencia de validación estricta de identidad de suscripción en `pg-boss`.  
**Nivel de Severidad Previo:** Crítico (Riesgo de cancelación en cascada de múltiples consumidores en entornos multi-worker o tests concurrentes).

---

### 1. Diagnóstico del Defecto en R3.1

En la versión R3.1, la implementación de detención del worker contenía un mecanismo de fallback:
```typescript
// Código vulnerable previo en R3.1:
const offWorkOptions = this.subscriptionId
  ? { id: this.subscriptionId, wait: true }
  : { wait: true }; // PELIGRO: Si subscriptionId es null/vacío, se invoca offWork globalmente
await boss.offWork(CONVERSION_QUEUE_NAME, offWorkOptions);
```

Si por cualquier condición anómala un worker intentaba detenerse sin haber capturado un `subscriptionId`, la llamada `boss.offWork(CONVERSION_QUEUE_NAME, { wait: true })` ordenaba a `pg-boss` terminar **todos los consumidores suscritos a la cola en el proceso**, desmantelando workers concurrentes ajenos a esta instancia.

Asimismo, durante la verificación en `getWipData()`:
```typescript
// Código laxo previo en R3.1:
const isTargetWorkerStillActive = activeWorkers.some((w: any) => {
  if (w.name !== CONVERSION_QUEUE_NAME) return false;
  if (!targetSubId) return true; // PELIGRO: Asumía que cualquier worker en la cola correspondía a esta instancia
  return w.workId === targetSubId || w.id === targetSubId;
});
```

---

### 2. Remediación Implementada en R3.2

#### A. Captura y Validación Estricta de Identidad en `performStart()`
En `backend/src/application/conversion-worker.ts`:
```typescript
const subId = await boss.work(CONVERSION_QUEUE_NAME, { ... }, handler);

if (typeof subId !== 'string' || subId.trim().length === 0) {
  this.isQueueSubscribed = false;
  this.subscriptionId = null;
  this.lifecycleState = 'ERROR';
  const subError = new WorkerLifecycleError(
    `Fallo crítico de registro en pg-boss: boss.work() no retornó un identificador de suscripción válido (recibido: ${JSON.stringify(subId)}). ` +
    'Se prohíbe el registro de un consumidor sin identidad autoritativa.'
  );
  this.lastShutdownError = subError;
  if (this.recoveryTimer) {
    clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }
  throw subError;
}

this.subscriptionId = subId.trim();
this.isQueueSubscribed = true;
this.lifecycleState = 'RUNNING';
```
- Se valida exhaustivamente que `subId` sea un `string` no vacío.
- Si la validación falla, **NO se asume suscripción activa**, se transiciona a `'ERROR'`, se cancelan temporizadores y se lanza `WorkerLifecycleError`.

#### B. Eliminación Total del Fallback Global en `performStop()`
Se eliminó de raíz la posibilidad de invocar `offWork()` sin un identificador de suscripción:
```typescript
if (this.isQueueSubscribed || this.pendingUnsubscribePromise !== null) {
  if (!this.pendingUnsubscribePromise) {
    if (!this.subscriptionId) {
      throw new WorkerShutdownError(
        'Fallo crítico de seguridad en desuscripción: la suscripción figura activa pero el identificador de suscripción es nulo. ' +
        'Se prohíbe terminantemente la invocación de offWork() global para preservar a otros consumidores en la cola.'
      );
    }

    const targetSubId = this.subscriptionId;
    const taskGen = ++this.lifecycleGeneration;
    this.unsubscribeSettled = false;
    this.lastShutdownError = null;

    const unsubscribeTask = (async () => {
      try {
        // Desuscripción dirigida exclusivamente a esta suscripción (NUNCA global)
        await boss.offWork(CONVERSION_QUEUE_NAME, { id: targetSubId, wait: true });
        ...
```

#### C. Verificación de Identidad Estricta en `getWipData()`
Se garantiza que la verificación audite únicamente el consumidor asignado a esta instancia específica:
```typescript
const isTargetWorkerStillActive = activeWorkers.some((w: any) => {
  if (w.name !== CONVERSION_QUEUE_NAME) return false;
  return w.workId === targetSubId || w.id === targetSubId;
});
```
Si otros workers concurrentes están operando en la misma cola (`w.workId !== targetSubId`), su presencia en `getWipData()` es ignorada de forma segura, garantizando el aislamiento absoluto entre instancias.

#### D. Comportamiento Fail-Closed ante Fallos de Verificación
Si la instancia de `pg-boss` no proporciona `getWipData()` o retorna una estructura no compatible, el worker **rechaza el apagado como no verificado**, transiciona inmediatamente a `'ERROR'` y registra el fallo autoritativo, prohibiendo futuros arranques hasta que se recupere la integridad.

---

### 3. Matriz de Pruebas Unitarias y de Integración Acreditadas (WS02)

| Prueba | Descripción del Escenario | Resultado |
|---|---|---|
| **2.1 R32-01** | `Valid subscription ID is captured on worker start` | APROBADO |
| **2.2 R32-02** | `Missing subscription ID is rejected safely without global unsubscription` | APROBADO |
| **2.3 R32-03** | `Empty subscription ID is rejected safely without claiming active subscription` | APROBADO |
| **2.4 R32-04** | `Malformed subscription ID is rejected safely and transitions to ERROR` | APROBADO |
| **2.5 R32-05** | `Missing ID never triggers global offWork() on shutdown or recovery` | APROBADO |
| **2.6 R32-06** | `Targeted shutdown isolates consumers and does not remove a second consumer on same queue` | APROBADO |
| **2.7 R32-07** | `Verification checks exact subscription identity without matching unrelated workers` | APROBADO |


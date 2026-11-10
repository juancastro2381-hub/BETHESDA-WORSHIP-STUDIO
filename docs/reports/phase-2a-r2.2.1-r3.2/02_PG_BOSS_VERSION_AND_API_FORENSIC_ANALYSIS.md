# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.2
## Report 02: pg-boss Version & API Forensic Analysis

**Componente Auditado:** `pg-boss` (Motor de cola transaccional en PostgreSQL)  
**Versión Instalada:** `12.38.1` (`backend/node_modules/pg-boss/package.json`)  
**Estructura de Distribución:** Código compilado en TypeScript ubicado bajo `backend/node_modules/pg-boss/dist/`  
**Módulos Clave Auditados:**  
- `dist/index.js` (Punto de entrada, exportación `{ PgBoss }`)  
- `dist/boss.js` (Clase `PgBoss`, orquestador y método `work()`)  
- `dist/manager.js` (Gestor de workers internos, métodos `offWork()`, `getWipData()`)  
- `dist/worker.js` (Clase interna `Worker`, ciclo de vida y método `stop()`)

---

### 1. Verificación de Versión y Distribución en Disco

La auditoría forense determinó que la librería `pg-boss` no contiene código fuente TypeScript bajo `src/` en el árbol instalado de dependencias en producción/desarrollo, sino artefactos compilados bajo `dist/`. La versión declarada en su manifiesto es:

```json
{
  "name": "pg-boss",
  "version": "12.38.1",
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

El punto de entrada `dist/index.js` exporta `PgBoss` como exportación con nombre (`export { PgBoss }`) además de una exportación por defecto.

---

### 2. Análisis del Contrato de `work()`

En `dist/boss.js`, el método `work(name, options, handler)` implementa la creación de consumidores:

```javascript
async work(name, ...args) {
  // Parsing de opciones y handler...
  const firstWorkerId = crypto.randomUUID();
  const worker = new Worker(this, name, options, handler, firstWorkerId);
  this.manager.addWorker(worker);
  await worker.start();
  return firstWorkerId; // Retorna un string UUID no vacío representativo de la suscripción
}
```

#### Hallazgos Críticos:
1. `boss.work()` siempre retorna un `string` UUID representativo del worker recién instanciado (`firstWorkerId`).
2. Si la creación o el inicio fallan a nivel de base de datos o validación, `work()` lanza una excepción.
3. En la arquitectura de Bethesda Worship Studio, este identificador retornado es la **identidad inmutable de suscripción** del worker. Si por alguna anomalía o mock mal configurado `work()` retornara un valor nulo, indefinido, vacío o no string, el worker no debe continuar ni asumir que tiene una suscripción válida.

---

### 3. Análisis Forense de `offWork()` y el Mecanismo de Falla Parcial

En `dist/manager.js`, el método `offWork(name, options = { wait: true })` gestiona la cancelación de suscripciones:

```javascript
async offWork(name, options = { wait: true }) {
  const workers = this.getWorkers().filter((i) => {
    return i.name === name && (options?.id ? (i.id === options.id || i.workId === options.id) : true);
  });

  if (!workers.length) {
    return;
  }

  const cleanupPromise = Promise.allSettled(
    workers.map(async (worker) => {
      await worker.stop();
      this.removeWorker(worker);
    })
  );

  if (options.wait) {
    await cleanupPromise;
  }
}
```

#### Descubrimientos de Alta Criticidad para la Seguridad de la Distribución:
1. **Comportamiento Global si se Omite `options.id`:**
   Si se invoca `offWork(name, { wait: true })` sin el parámetro `id`, el predicado `(options?.id ? ... : true)` evalúa a `true` para **todos** los workers suscritos a esa cola. Esto cancelaría inadvertidamente todos los consumidores concurrentes en el proceso.
2. **Absorción Silenciosa de Errores vía `Promise.allSettled`:**
   La terminación de workers se delega a `Promise.allSettled`. Si la llamada interna `worker.stop()` rechaza (por ejemplo, timeout de conexión a Postgres, socket roto, o excepción en la detención del polling), `Promise.allSettled` **no lanza el error**.
   - Como resultado, la promesa retornada por `boss.offWork(...)` **SE RESUELVE SATISFACTORIAMENTE (exitosa)**.
   - Sin embargo, dentro del callback `async (worker) => { await worker.stop(); this.removeWorker(worker); }`, al fallar `worker.stop()`, la instrucción `this.removeWorker(worker)` **NUNCA SE EJECUTA**.
   - Por tanto, el worker defectuoso **PERMANECE EN EL GESTOR INTERNO DE PG-BOSS** y continúa en estado activo/no detenido.

---

### 4. Estructura y Semántica Autoritativa de `getWipData()`

En `dist/manager.js`:

```javascript
getWipData() {
  return this.getWorkers()
    .map((i) => i.toWipData())
    .filter((i) => i.state !== 'stopped');
}
```

Cada elemento retornado por `getWipData()` expone:
- `name`: Nombre de la cola (ej. `'conversion-queue'`).
- `id`: Identificador interno de instancia del worker.
- `workId`: Identificador de suscripción original retornado al invocar `work()` (`subscriptionId`).
- `state`: Estado del worker (`'created'`, `'starting'`, `'running'`, `'stopping'`, `'stopped'`).

#### Conclusión Arquitectónica:
Dado que `offWork()` puede resolver con éxito debido a `Promise.allSettled` aun cuando un worker no logró detenerse, **`boss.offWork()` por sí solo NO es una prueba autoritativa de detención**.  
La única forma autoritativa y determinista de certificar que un worker fue removido y detenido es consultar `boss.getWipData()` y verificar exhaustivamente que ningún registro mantenga `workId === targetSubId` o `id === targetSubId`.

---

### 5. Mecanismo No Destructivo de Interceptación en Pruebas de Integración

Dado que `dist/worker.js` exporta la clase `Worker`:
```javascript
exports.default = Worker;
```

Es técnicamente posible en entornos de prueba Node.js interceptar selectivamente el método `Worker.prototype.stop` sin alterar archivos físicos en `node_modules`:
```typescript
const WorkerModule = require('pg-boss/dist/worker');
const WorkerClass = WorkerModule.default || WorkerModule;
const originalWorkerStop = WorkerClass.prototype.stop;

WorkerClass.prototype.stop = async function() {
  if (this.workId === targetSubscriptionId) {
    throw new Error('Fallo simulado de cierre en worker objetivo');
  }
  return originalWorkerStop.call(this);
};
```

Esto permite ejecutar pruebas de integración reales contra PostgreSQL y `pg-boss` real, reproduciendo fielmente la absorción de error por `Promise.allSettled` y validando la detección autoritativa de fallo de shutdown.


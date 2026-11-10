# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.2
## Report 09: Remaining Risks, Technical Limitations & Phase 2B Boundaries

**Objetivo:** Evaluación técnica honesta, objetiva y rigurosa de las limitaciones de diseño, condiciones de borde residuales y preservación estricta de las fronteras de Fase 2B.

---

### 1. Dependencia de la API Interna `getWipData()` de pg-boss

#### Condición Observada:
En la versión instalada `pg-boss@12.38.1`, el método `getWipData()` es implementado por la clase interna `Manager` (`dist/manager.js`). Si bien está disponible en tiempo de ejecución en la instancia `PgBoss`, no forma parte de las definiciones formales de TypeScript de primer nivel (`dist/index.d.ts`).

#### Evaluación de Riesgo y Mitigación Implementada:
- **Riesgo:** Una actualización futura mayor de `pg-boss` (ej. v13+) podría alterar el nombre, firma o formato de retorno de `getWipData()`.
- **Mitigación (Fail-Closed):** La implementación en `conversion-worker.ts` no asume ciegamente la presencia de este método. Si `getWipData()` no existe o si no retorna un arreglo, el worker rechaza el apagado como no verificado, transiciona a `ERROR` y prohíbe futuros arranques. Esto garantiza que una incompatibilidad de versión jamás causará un apagado silencioso o falso positivo.

---

### 2. Comportamiento en Despliegues Distribuidos Multi-Nodo vs Multi-Worker en Proceso Único

#### Condición Observada:
Las pruebas de aislamiento (`2.6 R32-06`, `2.8 R32-08`) validan que dos consumidores ejecutándose en el mismo proceso Node.js pueden registrarse y desuscribirse de forma independiente sin interferencias cruzadas en la misma cola.

#### Evaluación de Riesgo y Mitigación:
- En un clúster horizontalmente escalado (múltiples pods o instancias de backend), `pg-boss` coordina la concurrencia a través de PostgreSQL mediante bloqueos transaccionales y arrendamientos temporales (`lease_expires_at`).
- La suite WS03 valida que si un nodo colapsa abruptamente (SIGKILL o fallo de red), los trabajos no finalizados no quedan en limbo, sino que son recuperados por otro nodo una vez expirado el arrendamiento, sin violar la exclusión mutua de recuperación periódica.

---

### 3. Preservación Estricta de las Fronteras de Fase 2B

Se reitera categóricamente que esta fase correctiva (R3.2) **NO incorpora ni pre-implementa** ninguna característica correspondiente a la Fase 2B:

1. **Modelos de Audio e Inteligencia Artificial:**  
   No se incluye Demucs (separación de pistas), Basic Pitch (transcripción polifónica de audio a MIDI) ni WhisperX / Whisper.cpp (alineación de letra de audio). Cualquier solicitud con `AUDIO_RECORDING` es rechazada de inmediato.
2. **Reconocimiento Óptico de Música (OMR):**  
   No se incluye Audiveris ni librerías de inferencia sobre imágenes de partituras manuscritas o PDF escaneados.
3. **Servicios de Terceros Comerciales o Infraestructura No Autorizada:**  
   No se introducen dependencias de Cloudflare R2, Redis, BullMQ ni APIs de pago. Toda la arquitectura se mantiene 100% sobre PostgreSQL y almacenamiento de archivos local auditable.


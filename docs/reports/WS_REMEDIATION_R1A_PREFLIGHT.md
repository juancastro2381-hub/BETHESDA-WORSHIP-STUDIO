# Informe Preflight de Auditoría Independiente — Sprint R1-A
## Bethesda Worship Studio — Verificación Inicial, Evaluación de Hallazgos y Plan de Remediación

- **Repositorio**: `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO`
- **Rama**: `main`
- **Commit Base Inspeccionado**: `549a0f6532ba75dc8281e1f9205191123314d97e`
- **Fecha**: 18 de Octubre de 2026
- **Agente**: Antigravity
- **Estado de Trabajo**: Árbol de trabajo limpio previo a las correcciones.
- **Regla de Exclusión**: **CERO integración de pedales físicos (Bluetooth, WebHID, WebUSB, Gamepad)**.

---

## 1. Contexto de la Auditoría y Estado de Partida

Tras la conclusión del Sprint de Remediación R1, una revisión independiente determinó que, a pesar de las suites automatizadas previamente aprobadas, persisten seis aspectos críticos que requieren atención y corrección técnica antes de considerar el sistema completamente endurecido:

1. **Hallazgo A (Crítico — OMR)**: La ruta de producción de OMR aún puede retornar compases de prueba ("fixture data") cuando la variable de entorno `OMR_ENGINE_ENABLED === 'true'` está activa, en lugar de invocar un motor OMR real o devolver un estado veraz no configurado.
2. **Hallazgo B (Alto — Realtime)**: Falta de frescura en la autorización en tiempo real. Tokens JWT válidos pero con roles revocados o cuentas suspendidas en PostgreSQL pueden ejecutar comandos litúrgicos o acceder a sesiones de setlists restringidos.
3. **Hallazgo C (Alto — Audio Offline)**: Verificación de checksum confiable del lado del servidor. `expectedChecksumSha256` no siempre se obtiene de una fuente autoritativa en todos los puntos de llamada, y falta distinguir la verificación de transporte cliente-servidor de la corrupción local posterior.
4. **Hallazgo D (Medio-Alto — Multipistas)**: Aislamiento de acceso a nivel de API REST y repositorio. Las rutas HTTP de multipistas no estaban registradas o expuestas en `app.ts`, y faltaba validar la autorización por sesión/alcance y pruebas de rollback transaccional ante fallos parciales.
5. **Hallazgo E (Documentación)**: Falta de portabilidad en enlaces `file:///c:/Users/...` en los informes R1, que deben ser sustituidos por rutas relativas al repositorio.
6. **Hallazgo F (Archivos WAV en Commit)**: Inventario y determinación de origen de los archivos WAV incluidos en el commit `549a0f6`.

---

## 2. Inspección Técnica Detallada de los Hallazgos

### 2.1 Hallazgo A: OMR y Activación Ilícita de Fixtures en Producción
- **Ubicación**: `backend/src/domain/omr/omr-provider.ts` (Líneas 124-127 y 156-223).
- **Inspección de Código**:
  ```typescript
  const isEngineActive =
    process.env.OMR_ENGINE_ENABLED === 'true' ||
    this.options?.enableTestFixture === true;
  ```
- **Diagnóstico**: Si un administrador configura `OMR_ENGINE_ENABLED=true` en producción creyendo que activa el reconocimiento, el sistema retorna 4 compases fijos ("Gracia Sublime Es") con notas y acordes hardcodeados. Esto viola el principio rector: **CERO notas fabricadas en producción**.
- **Acción Planificada**:
  - `process.env.OMR_ENGINE_ENABLED === 'true'` NO debe retornar datos de prueba. Si no hay un motor OMR real configurado o instalado, debe retornar un estado explícito de indisponibilidad (`measures: []`, 0 notas inventadas).
  - La emisión de compases de prueba queda estrictamente restringida a `options?.enableTestFixture === true` en entornos de test explícitos (`NODE_ENV === 'test'`).

### 2.2 Hallazgo B: Frescura de Autorización en Rutas Realtime
- **Ubicación**: `backend/src/interfaces/http/routes/realtime.routes.ts` y `backend/src/application/realtime-session-manager.ts`.
- **Inspección de Código**:
  - En `POST /sessions`, `POST /sessions/:sessionId/actions` y `POST /sessions/:sessionId/ticket`, se utilizaba `authGuard.requirePermission('setlists:read', false)` con `verifyDatabaseRole = false`.
  - El rol se leía directamente de `request.user.role` (claim del JWT de acceso).
- **Diagnóstico**: Un token JWT con TTL vigente emitido a un usuario que posteriormente fue degradado de rol (ej. de `WORSHIP_LEADER` a `MUSICIAN`) o cuya cuenta fue suspendida (`accountStatus = 'SUSPENDED'`) en PostgreSQL, aún podía crear sesiones litúrgicas, emitir tickets SSE o mutar el estado litúrgico en vivo.
- **Acción Planificada**:
  - Integrar verificación obligatoria en tiempo real contra la base de datos PostgreSQL (`userRepository.findById`) en la creación de sesiones, despacho de acciones y emisión de tickets SSE.
  - Validar estado activo de la cuenta (`accountStatus === 'ACTIVE'`), bloqueo temporal y rol actual en base de datos.
  - Validar que el `sessionId` solicitado coincida con el recurso asociado y prevenir acceso cruzado (cross-scope).

### 2.3 Hallazgo C: Checksum Autorizado de Audio y Detección de Corrupción Local
- **Ubicación**: `frontend/src/core/offline/offline-manager.ts`, `frontend/src/core/offline/offline-context.tsx`, `frontend/src/components/workspace/AudioPlayerBar.tsx`, y `backend/src/interfaces/http/routes/audio.routes.ts`.
- **Inspección de Código**:
  - `GET /api/v1/audio/:id/download` no emitía encabezados estándar `ETag` ni `X-Checksum-Sha256`.
  - `offline-context.tsx` y `DownloadActionButton.tsx` invocaban `downloadAudio` sin proveer `expectedChecksumSha256`.
- **Diagnóstico**: Cuando el cliente no provee explícitamente el checksum como parámetro, la descarga no validaba contra la verdad autoritativa del servidor. Además, faltaba distinguir la verificación de transporte (al descargar) de la verificación de corrupción local en reposo (bit rot o manipulación en IndexedDB).
- **Acción Planificada**:
  - Backend: Emitir encabezados autoritativos `X-Checksum-Sha256` y `ETag` en `GET /api/v1/audio/:id/download`.
  - Frontend: Si `expectedChecksumSha256` no es provisto por el llamador, `downloadAudio` debe extraerlo de los encabezados de respuesta del servidor y validar estrictamente los bytes descargados.
  - Frontend: `getAudioObjectUrl` debe recalcular el hash sobre el blob almacenado en IndexedDB antes de la reproducción para detectar corrupción local posterior.

### 2.4 Hallazgo D: Aislamiento y Rutas HTTP de Multipistas
- **Ubicación**: `backend/src/interfaces/http/routes/`, `backend/src/app.ts`, `backend/src/repositories/multitrack-repository.ts`.
- **Inspección de Código**:
  - `app.ts` no registraba ningún plugin de rutas para multipistas (`multitrack.routes.ts`). Solo existía el servicio y repositorio a nivel de dominio.
- **Diagnóstico**: No existían endpoints HTTP REST autorizados y protegidos para que los clientes interactúen con sesiones multipista. Se requería verificar control de acceso server-side, validación de pertenencia por canción, autorización de anfitrión/líder y atomicidad transaccional con rollback ante fallos parciales.
- **Acción Planificada**:
  - Implementar esquemas Zod en `multitrack.schemas.ts`.
  - Implementar `multitrack.routes.ts` con endpoints CRUD (`POST /sessions`, `GET /sessions/:sessionId`, `PATCH /sessions/:sessionId/tracks/:trackId`, `DELETE /sessions/:sessionId`) y RBAC estricto (`songs:update` / `songs:read`).
  - Registrar las rutas en `app.ts`.
  - Agregar pruebas automatizadas de autorización, persistencia y rollback transaccional ante fallos parciales.

### 2.5 Hallazgo E: Portabilidad de Enlaces en Documentación
- **Ubicación**: Documentos en `docs/reports/` generados en R1.
- **Diagnóstico**: Existencia de enlaces absolutos con esquema `file:///c:/Users/...`.
- **Acción Planificada**: Reemplazar todas las rutas absolutas por enlaces relativos estándar del repositorio (ej. `docs/reports/...`, `backend/src/...`).

### 2.6 Hallazgo F: Inventario de Archivos WAV en el Commit 549a0f6
- **Ubicación**: `backend/storage/audio/`.
- **Inspección de Archivos**:
  - Doce archivos con extensión `.wav` de 31 y 69 bytes cada uno.
  - Análisis hexadecimal: Contienen textos como `RIFF_MOCK_WAV_DRUMS_DATA_BINARY`, `RIFF_MOCK_WAV_CLICK_DATA_BINARY`.
- **Diagnóstico**: Son artefactos temporales creados por la suite de pruebas unitarias `multitracks-omr.test.ts` que se guardaron en disco y fueron incluidos inadvertidamente en el commit por falta de una regla en `.gitignore`. No contienen datos de usuarios ni grabaciones reales.
- **Acción Planificada**:
  - Elaborar inventario detallado con nombre, tamaño, hash y fecha.
  - Preservar los archivos sin eliminarlos (en cumplimiento con la directiva).
  - Documentar la recomendación de ignorar la carpeta `backend/storage/audio/*` en la configuración de Git.

---

## 3. Plan de Remediación y Secuencia de Ejecución

1. **Fase 1 — OMR Veraz**:
   - Modificar `backend/src/domain/omr/omr-provider.ts`.
   - Agregar pruebas unitarias para `OMR_ENGINE_ENABLED` vs `enableTestFixture`.
2. **Fase 2 — Frescura de Autorización Realtime**:
   - Modificar `backend/src/interfaces/http/routes/realtime.routes.ts` y `realtime-session-manager.ts`.
   - Incorporar verificaciones en vivo en PostgreSQL (`userRepository.findById`) y validación de estado activo.
   - Agregar pruebas de degradación de rol, cuenta suspendida y acceso cruzado en `realtime-session.test.ts`.
3. **Fase 3 — Checksum Autoritativo de Audio Offline**:
   - Modificar `backend/src/application/audio-service.ts` y `backend/src/interfaces/http/routes/audio.routes.ts`.
   - Modificar `frontend/src/core/offline/offline-manager.ts`, `offline-context.tsx` y `DownloadActionButton.tsx`.
   - Agregar pruebas de validación con cabecera `X-Checksum-Sha256`, metadatos ausentes y corrupción local en reposo en `offline-manager.test.ts`.
4. **Fase 4 — API REST y Aislamiento de Multipistas**:
   - Crear `backend/src/interfaces/http/schemas/multitrack.schemas.ts`.
   - Crear `backend/src/interfaces/http/routes/multitrack.routes.ts`.
   - Registrar en `backend/src/app.ts`.
   - Extender `multitracks-omr.test.ts` con pruebas de integración HTTP, RBAC y rollback transaccional.
5. **Fase 5 — Portabilidad de Documentación e Inventario WAV**:
   - Normalizar enlaces en `docs/reports/`.
   - Documentar inventario completo de archivos WAV en el informe de implementación y cierre.
6. **Fase 6 — Verificación Integral**:
   - Ejecutar suites completas de backend y frontend.
   - Generar reportes finales (`IMPLEMENTATION`, `TEST_EVIDENCE`, `FINAL_HANDOFF`).

---

## 4. Garantía de Invariantes de Seguridad

- **Cero Pedales**: Sin integración de WebHID, Bluetooth, WebUSB o Gamepads.
- **No Mutación Canónica en Tiempo Real**: Las acciones en vivo no tocan las filas canónicas de `songs`.
- **Cero Commits / Push**: Todo el trabajo se conserva en el working tree sin staging ni commits.

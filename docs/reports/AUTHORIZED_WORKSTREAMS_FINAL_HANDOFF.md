# Entrega Final y Reporte de Transferencia Técnica: Flujos Autorizados
## Bethesda Worship Studio — Paquete de Implementación y Verificación Integral

- **Repositorio**: `BETHESDA-WORSHIP-STUDIO`
- **Rama Actual**: `main`
- **Commit Base (HEAD)**: `4e9ca1ba7d97e07360566dc6a5d95036f5fb4146`
- **Fecha de Entrega**: 18 de Octubre de 2026
- **Agente de Implementación**: Antigravity
- **Estado de Gobernanza Git**: CERO commits realizados, CERO push, CERO staging (`git add`), CERO modificación de historial.
- **Cumplimiento de Exclusión de Pedales**: **CUMPLIMIENTO ESTRICTO Y ABSOLUTO**. La sincronización con pedales físicos (Bluetooth, USB, WebHID, Gamepad) **NO FUE IMPLEMENTADA** y se mantiene expresamente NO AUTORIZADA en todo el código fuente y contratos.
- **Declaración de Preparación para Pruebas**: **LISTO PARA PRUEBAS DEL SISTEMA POR EL PROPIETARIO**. No se emite declaración de preparación para producción hasta tanto el Propietario del Proyecto complete las validaciones manuales descritas en este documento.

---

## 1. Resumen Ejecutivo (En Español)

Se ha completado de manera satisfactoria y verificable la implementación de los **cuatro flujos de trabajo autorizados** por el Propietario del Proyecto para el sistema *Bethesda Worship Studio*:

1. **Workstream A — Infraestructura Real de Audio, Descarga y Reproducción Offline**:
   - Se diseñó e implementó la infraestructura de backend faltante para recursos de audio (`audio_assets`), con migración versionada (`0005_audio_assets.sql`), proveedor de almacenamiento seguro en disco con mitigación de Path Traversal (`LocalFileSystemAudioStorageProvider`), cálculo de checksums SHA-256, límites de cuota (50 MB por archivo) y soporte nativo para streaming por rangos HTTP 206 (`Range: bytes=start-end`).
   - Se integró el cliente frontend mediante `AudioPlayerBar`, vinculando la descarga autenticada con la caché offline de IndexedDB (`bethesda-offline-db`), respetando la política de expiración de 7 días y el modo de sólo lectura en desconexión.
2. **Workstream B — WP-05 Autoscroll (Sin Integración de Pedales)**:
   - Se implementó el desplazamiento vertical automático continuo para partituras y atril (`SCORE`, `CHORDS`, `TABLATURE`, `LEAD_SHEET`), gobernado por un modelo de física diferencial (`requestAnimationFrame` con delta time y acumulador sub-píxel).
   - Incorpora control de velocidad ($0.5\times$ a $3.0\times$), pausa por interacción manual del usuario (rueda del ratón o tacto), pausa automática por cambio de pestaña (`visibilitychange`) y atajos de teclado accesibles (`Espacio` y `Escape`). Se excluyó categóricamente cualquier sincronización con pedales físicos o periféricos.
3. **Workstream C — Fase 3B Flujo Litúrgico en Tiempo Real**:
   - Se implementó la sincronización de atriles en vivo utilizando **Server-Sent Events (SSE)** sobre HTTP estándar (`text/event-stream`), eliminando la necesidad de brokers pesados o dependencias externas no presentes en el stack.
   - Cuenta con una máquina de estados volátil en memoria (`RealtimeSessionManager`), control de acceso estricto (solo el Director o Administradores pueden transmitir comandos), secuencia monotónica de eventos (`epoch`, `sequence`), rechazo de eventos desfasados (`409 Conflict`), protección de idempotencia ante retransmisiones y **garantía absoluta de que las acciones en vivo no mutan las filas canónicas de PostgreSQL**.
4. **Workstream D — Fase 3C Multipistas (D1) y Reconocimiento Óptico de Música (OMR / D2)**:
   - **D1 Multipistas**: Modelo de sesión y stems (`Click`, `Cues`, `Drums`, `Bass`, `Guitars`, `Keys`, `Vocals`), consola de mezcla con balance estéreo, volumen acotado y precedencia estricta de Solo y Mute. La reproducción offline exige que el $100\%$ de los stems estén descargados y autorizados localmente (falla cerrada ante stems incompletos).
   - **D2 OMR**: Delimitación de proveedor (`StandardOmrProvider`) con principio mandatorio de IA: **la salida de OMR es siempre una propuesta preliminar (`isAiDraft: true`) que exige revisión y aprobación humana explícita antes de persistirse como canción canónica**. Se garantiza **cero invención de notas musicales** (las zonas dudosas se reportan en `unrecognizedRegions`).

---

## 2. Estado por Flujo de Trabajo (Workstream Status)

| Flujo de Trabajo | Estado Técnico | Cobertura Automatizada | Validación Manual |
| :--- | :---: | :---: | :---: |
| **Workstream A: Audio Backend & Offline** | **IMPLEMENTED & VERIFIED** | 10/10 tests PASS (Backend) | Pendiente Propietario |
| **Workstream B: WP-05 Autoscroll** | **IMPLEMENTED & VERIFIED** | 8/8 tests PASS (Frontend) | Pendiente Propietario |
| **Workstream C: Fase 3B Realtime Flow** | **IMPLEMENTED & VERIFIED** | 10/10 tests PASS (Backend) + 5/5 PASS (Frontend) | Pendiente Propietario (2 Clientes) |
| **Workstream D1: Multipistas (Stems)** | **IMPLEMENTED & VERIFIED** | 5/5 tests PASS (Backend) + 7/7 PASS (Frontend) | Pendiente Propietario |
| **Workstream D2: OMR (Reconocimiento)** | **IMPLEMENTED & VERIFIED** | 6/6 tests PASS (Backend) + 5/5 PASS (Frontend) | Pendiente Propietario |
| **Exclusión: Pedales Físicos** | **STRICTLY EXCLUDED** | Verificado estáticamente en Backend y Frontend | N/A (No Autorizado) |

---

## 3. Inventario de Archivos Creados y Modificados

### Backend (`/backend`)
- [`backend/src/db/schema.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/schema.ts): Declaración de la tabla `audioAssets`, relaciones de base de datos y tipos inferidos `AudioAsset`, `NewAudioAsset`.
- [`backend/src/db/migrations/0005_audio_assets.sql`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/migrations/0005_audio_assets.sql): Migración versionada reversible Drizzle para `audio_assets`.
- [`backend/src/db/migrations/meta/_journal.json`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/migrations/meta/_journal.json): Registro oficial del diario de migraciones (índice 5).
- [`backend/src/config/env.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/config/env.ts): Variables de entorno `AUDIO_STORAGE_PATH` y `MAX_AUDIO_FILE_SIZE_BYTES`.
- [`backend/src/domain/audio/storage-provider.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/audio/storage-provider.ts): Proveedor de almacenamiento en sistema de archivos local con mitigación estricta de Path Traversal y streaming de chunks.
- [`backend/src/repositories/audio-repository.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/audio-repository.ts): Repositorio Drizzle para la entidad `audio_assets`.
- [`backend/src/application/audio-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/audio-service.ts): Servicio de audio para subida autenticada, descarga, eliminación y streaming por rangos (HTTP 206).
- [`backend/src/interfaces/http/routes/audio.routes.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/audio.routes.ts): Endpoints HTTP para audio con guardas de autenticación y permisos RBAC.
- [`backend/src/domain/realtime/realtime-types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/realtime/realtime-types.ts): Contratos de dominio para el flujo litúrgico en tiempo real.
- [`backend/src/application/realtime-session-manager.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/realtime-session-manager.ts): Gestor en memoria de sesiones en vivo, secuenciación monotónica, idempotencia y difusión SSE.
- [`backend/src/interfaces/http/schemas/realtime.schemas.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/schemas/realtime.schemas.ts): Validación Zod para sesiones y acciones litúrgicas en vivo.
- [`backend/src/interfaces/http/routes/realtime.routes.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/realtime.routes.ts): Rutas Fastify para sesiones en vivo y canal de streaming Server-Sent Events (`/api/v1/realtime/*`).
- [`backend/src/domain/multitrack/types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/multitrack/types.ts): Tipos de dominio para sesiones multipista y stems.
- [`backend/src/application/multitrack-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/multitrack-service.ts): Servicio de multipistas vinculado a `AudioAssets` de Workstream A y verificación de completitud offline.
- [`backend/src/domain/omr/types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/omr/types.ts): Tipos de propuesta OMR con `isAiDraft: true` y revisión obligatoria.
- [`backend/src/domain/omr/omr-provider.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/omr/omr-provider.ts): Proveedor de reconocimiento OMR con hash SHA-256 y reporte de zonas no reconocidas (cero notas inventadas).
- [`backend/src/application/omr-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/omr-service.ts): Servicio de propuesta OMR y puerta de persistencia canónica solo tras aprobación humana.
- [`backend/src/interfaces/http/middlewares/auth-middleware.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/middlewares/auth-middleware.ts): Soporte de token en query param para conexiones EventSource de navegador.
- [`backend/src/app.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/app.ts): Registro de `audioRoutes` y `realtimeRoutes`.
- [`backend/src/__tests__/audio-infrastructure.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/audio-infrastructure.test.ts): 10 pruebas de integración para audio.
- [`backend/src/__tests__/realtime-session.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/realtime-session.test.ts): 10 pruebas de integración para flujo litúrgico en tiempo real.
- [`backend/src/__tests__/multitracks-omr.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/multitracks-omr.test.ts): 12 pruebas de integración para multipistas y OMR.

### Frontend (`/frontend`)
- [`frontend/src/core/autoscroll/types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/types.ts): Tipos y contratos para autoscroll WP-05.
- [`frontend/src/core/autoscroll/use-autoscroll.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/use-autoscroll.ts): Hook de desplazamiento suave con RAF, detección táctil/rueda, pausa por visibilidad y cero pedales.
- [`frontend/src/components/workspace/AutoscrollControl.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AutoscrollControl.tsx): Barra de control visual de autoscroll con selectores de velocidad y teclado accesible.
- [`frontend/src/core/autoscroll/__tests__/autoscroll.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/autoscroll/__tests__/autoscroll.test.ts): 8 pruebas unitarias y de exclusión estricta de pedales.
- [`frontend/src/core/realtime/realtime-types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/realtime/realtime-types.ts): Tipos de tiempo real para el cliente.
- [`frontend/src/core/realtime/realtime-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/realtime/realtime-client.ts): Cliente SSE con reconexión automática y despacho REST de comandos litúrgicos.
- [`frontend/src/core/realtime/use-realtime-flow.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/realtime/use-realtime-flow.ts): Hook de orquestación de atril en vivo con desacoplamiento ("Atril Independiente").
- [`frontend/src/components/navigation/RealtimeLiturgicalBadge.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/navigation/RealtimeLiturgicalBadge.tsx): Insignia dinámica y selector de secciones en vivo.
- [`frontend/src/core/realtime/__tests__/realtime.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/realtime/__tests__/realtime.test.ts): 5 pruebas unitarias de cliente y exclusión de pedales.
- [`frontend/src/core/multitracks/types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/multitracks/types.ts): Tipos para multipistas frontend.
- [`frontend/src/core/multitracks/multitrack-engine.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/multitracks/multitrack-engine.ts): Motor de mezcla y sincronización con lógica de Solo/Mute y verificación offline.
- [`frontend/src/core/multitracks/__tests__/multitracks.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/multitracks/__tests__/multitracks.test.ts): 7 pruebas unitarias de consola y completitud offline.
- [`frontend/src/core/ingestion/omr/omr-proposal-handler.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/ingestion/omr/omr-proposal-handler.ts): Gestor de propuestas OMR con puerta de revisión humana.
- [`frontend/src/core/ingestion/omr/__tests__/omr.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/ingestion/omr/__tests__/omr.test.ts): 5 pruebas unitarias de propuestas OMR.
- [`frontend/src/components/workspace/AudioPlayerBar.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AudioPlayerBar.tsx): Barra de reproducción de audio online/offline.
- [`frontend/src/components/workspace/MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx): Integración de `AudioPlayerBar`, `AutoscrollControl` y referencia de viewport.
- [`frontend/src/core/api/api-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/api/api-client.ts): Métodos para consulta y descarga binaria de `audioAssets`.
- [`frontend/src/core/offline/offline-manager.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts): Descarga protegida de audio hacia IndexedDB con credenciales de sesión.
- [`frontend/src/index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css): Estilos visuales de accesibilidad para la barra de autoscroll y panel en vivo.

### Documentación y Reportes (`/docs/reports`)
- [`docs/reports/WS_AUTHORIZED_WORKSTREAMS_PREFLIGHT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/WS_AUTHORIZED_WORKSTREAMS_PREFLIGHT.md): Preflight de Gate 0.
- [`docs/reports/WS_AUDIO_OFFLINE_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/WS_AUDIO_OFFLINE_IMPLEMENTATION_REPORT.md): Reporte de Gate A (Audio Offline).
- [`docs/reports/WP05_AUTOSCROLL_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/WP05_AUTOSCROLL_IMPLEMENTATION_REPORT.md): Reporte de Gate B (Autoscroll).
- [`docs/reports/PHASE_3B_REALTIME_LITURGICAL_FLOW_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/PHASE_3B_REALTIME_LITURGICAL_FLOW_IMPLEMENTATION_REPORT.md): Reporte de Gate C (Flujo en Tiempo Real).
- [`docs/reports/PHASE_3C_MULTITRACKS_OMR_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/PHASE_3C_MULTITRACKS_OMR_IMPLEMENTATION_REPORT.md): Reporte de Gate D (Multipistas y OMR).
- [`docs/reports/AUTHORIZED_WORKSTREAMS_FINAL_HANDOFF.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/AUTHORIZED_WORKSTREAMS_FINAL_HANDOFF.md): Este documento de transferencia final.

---

## 4. Migraciones de Base de Datos y Variables de Entorno

### Migraciones Versionadas
1. **Archivo de migración**: `backend/src/db/migrations/0005_audio_assets.sql`
2. **Definición SQL**:
   ```sql
   CREATE TABLE IF NOT EXISTS "audio_assets" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
     "song_id" uuid NOT NULL REFERENCES "songs"("id") ON DELETE cascade,
     "title" varchar(255) NOT NULL,
     "filename" varchar(255) NOT NULL,
     "storage_path" varchar(512) NOT NULL,
     "mime_type" varchar(64) NOT NULL,
     "file_size_bytes" integer NOT NULL,
     "checksum_sha256" varchar(64) NOT NULL,
     "duration_seconds" integer,
     "uploaded_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
     "created_at" timestamp with time zone DEFAULT now() NOT NULL,
     "updated_at" timestamp with time zone DEFAULT now() NOT NULL
   );
   CREATE INDEX IF NOT EXISTS "idx_audio_assets_song_id" ON "audio_assets"("song_id");
   CREATE INDEX IF NOT EXISTS "idx_audio_assets_uploaded_by" ON "audio_assets"("uploaded_by_user_id");
   CREATE INDEX IF NOT EXISTS "idx_audio_assets_created_at" ON "audio_assets"("created_at");
   ```
3. **Estado de aplicación**: Aplicada exitosamente en el PostgreSQL local (puerto 5432).

### Variables de Entorno
Añadidas a `backend/src/config/env.ts` con valores predeterminados seguros para desarrollo local:
- `AUDIO_STORAGE_PATH`: Ruta relativa al directorio de almacenamiento de archivos de audio (predeterminado: `'storage/audio'`).
- `MAX_AUDIO_FILE_SIZE_BYTES`: Límite máximo por archivo binario (predeterminado: `52428800` bytes = 50 MB).

---

## 5. Evidencia de Pruebas Automatizadas y Comandos Exactos

Todas las pruebas reportadas a continuación fueron ejecutadas efectivamente en la terminal durante esta sesión de trabajo:

### 1. Pruebas de Backend
- **Comando**: `npm test`
- **Directorio**: `c:\Users\juanc\OneDrive\Documentos\Desarrollo proyectos\Sistema musical - partituras\BETHESDA WORSHIP STUDIO\backend`
- **Código de salida**: `0`
- **Resultado Real**: **253 pruebas pasadas en 56 suites (0 fallidas, 0 canceladas)**.
- **Suites Clave de los Flujos Autorizados**:
  - `audio-infrastructure.test.ts`: **10/10 PASS** (carga autorizada, IDOR, streaming Range 206, verificación de SHA-256).
  - `realtime-session.test.ts`: **10/10 PASS** (creación, join/leave, RBAC líder vs músico 403, idempotencia, 409 Conflict por desfase, inmutabilidad de PostgreSQL).
  - `multitracks-omr.test.ts`: **12/12 PASS** (vinculación a audioAssets, límites de volumen/pan/offset, completitud offline, OMR con isAiDraft, no-invención de notas, puerta de aprobación humana, exclusión de pedales).

### 2. Pruebas de Frontend
- **Comando**: `npm test`
- **Directorio**: `c:\Users\juanc\OneDrive\Documentos\Desarrollo proyectos\Sistema musical - partituras\BETHESDA WORSHIP STUDIO\frontend`
- **Código de salida**: `0`
- **Resultado Real**: **341 pruebas pasadas en 53 suites (0 fallidas, 0 canceladas)**.
- **Suites Clave de los Flujos Autorizados**:
  - `autoscroll.test.ts`: **8/8 PASS** (ciclo de vida, velocidad, no duplicación de RAF, reseteo, exclusión de pedales).
  - `realtime.test.ts`: **5/5 PASS** (estados de conexión, snapshots, eventos de estado, exclusión de pedales).
  - `multitracks.test.ts`: **7/7 PASS** (ganancias de consola, precedencia Solo/Mute, acotamiento, completitud offline, exclusión de pedales).
  - `omr.test.ts`: **5/5 PASS** (invariante isAiDraft, puerta de revisión humana, preservación de zonas dudosas, exclusión de pedales).

### 3. Comprobación de Tipos Estáticos (Typechecks)
- **Backend**: `npm run typecheck` (`tsc --noEmit`) $\to$ **Exit code: 0 (0 errores)**.
- **Frontend**: `npx tsc --noEmit` $\to$ **Exit code: 0 (0 errores)**.

### 4. Compilación de Producción (Production Build)
- **Backend**: `npm run build` (`tsc`) $\to$ **Exit code: 0**.
- **Frontend**: `npm run build` (`vite build`) $\to$ **Exit code: 0 (dist generado en 1.04s)**.

---

## 6. Lista de Verificación para Pruebas Manuales del Propietario (Owner Manual Test Plan)

Dado que las herramientas de automatización de navegador estaban prohibidas por gobernanza, el Propietario del Proyecto debe realizar las siguientes pruebas en navegadores reales:

### A. Prueba de Audio y Reproducción Offline
1. **Subida y Streaming**:
   - Inicie sesión como Administrador o Director de Alabanza.
   - Abra una canción y verifique que el reproductor `AudioPlayerBar` muestre el título del audio si existe o permita la subida de una pista de referencia.
   - Presione Play: verifique que el audio se reproduzca de inmediato utilizando streaming por rangos.
2. **Descarga y Desconexión (Modo Offline)**:
   - Haga clic en el botón de descarga del reproductor de audio.
   - Espere a que el indicador cambie a `Disponible Offline` (verde).
   - Desconecte la red (Modo Avión o desconecte el cable de red).
   - Recargue la página del atril: compruebe que el atril carga desde la caché de la PWA y que el audio se reproduce fluidamente desde IndexedDB sin conexión al servidor.

### B. Prueba de WP-05 Autoscroll (Atril)
1. **Desplazamiento Suave y Velocidades**:
   - Abra una partitura de varias páginas en vista `SCORE` o `CHORDS`.
   - En la barra inferior de autoscroll, presione **Iniciar** (o barra espaciadora): verifique que la pantalla descienda suavemente.
   - Cambie la velocidad entre `1.0x`, `1.5x`, `2.0x` y `0.5x`: compruebe que el ritmo cambie de forma inmediata y proporcional.
2. **Pausa por Interacción Manual y Visibilidad**:
   - Mientras el autoscroll esté activo, desplace la partitura con la rueda del ratón o con el dedo en una pantalla táctil: compruebe que el autoscroll se pausa de inmediato.
   - Con el autoscroll activo, cambie a otra pestaña del navegador por 5 segundos y regrese: compruebe que la partitura se pausó y no dio un salto abrupto de 5 segundos de avance.
3. **Cambio de Canción**:
   - Navegue a la siguiente canción: compruebe que el autoscroll se detiene y vuelve a la posición inicial (0 px, `IDLE`).
4. **Verificación de Pedales**:
   - Compruebe que no existen opciones, menús ni diálogos de configuración de pedales Bluetooth o USB.

### C. Prueba de Dos Clientes: Fase 3B Flujo Litúrgico en Tiempo Real
1. **Configuración de Dos Clientes**:
   - Abra una ventana de navegador (Ventana A) e inicie sesión como `WORSHIP_LEADER`.
   - Abra una ventana de incógnito (Ventana B) e inicie sesión como `MUSICIAN`.
   - Cargue el mismo setlist en ambas ventanas.
2. **Inicio del Culto en Vivo**:
   - En la Ventana A (Líder), haga clic en **📡 Iniciar Culto en Vivo**.
   - Verifique que la Ventana A muestra `🔴 EN VIVO (DIRECTOR)`.
   - Verifique que la Ventana B muestra de forma automática `🟢 EN VIVO (SINCRONIZADO)`.
3. **Navegación Sincronizada y Marcadores de Sección**:
   - En la Ventana A, haga clic en "Siguiente" en la barra litúrgica. Verifique que la Ventana B avanza a la misma canción de inmediato.
   - En la Ventana A, seleccione `CORO` en el selector de secciones. Verifique que la Ventana B despliega la insignia azul `[ CORO ]` en tiempo real.
4. **Desacoplamiento Temporal del Músico**:
   - En la Ventana B, haga clic en **Desvincular**. Verifique que cambia a `🟡 ATRIL INDEPENDIENTE`.
   - En la Ventana A, cambie de canción: compruebe que la Ventana B no cambia de canción.
   - En la Ventana B, haga clic en **Sincronizar**: compruebe que la Ventana B salta inmediatamente a la canción activa del Director.

### D. Prueba de Multipistas (D1)
1. **Consola de Stems**:
   - Cargue una sesión multipista y presione Play.
   - Active el botón **S (Solo)** en la pista de Batería: verifique que las demás pistas se silencian.
   - Active el botón **M (Mute)** en la pista de Batería con el Solo activo: verifique que la salida queda en silencio absoluto.
2. **Validación Offline**:
   - Simule la ausencia de uno de los stems en la caché local: compruebe que el sistema reporta que faltan pistas y bloquea la reproducción parcial de forma segura.

### E. Prueba de Revisión OMR (D2)
1. **Ingesta y Puerta de Revisión**:
   - Suba un archivo PDF o imagen de partitura.
   - Verifique que el sistema genera una vista previa con la etiqueta destacada: `Propuesta IA — Pendiente de Revisión Humana`.
   - Verifique que la canción NO aparece en el catálogo canónico hasta tanto el usuario presione el botón de **Aprobar e Importar al Catálogo**.
2. **Inspección de Zonas No Reconocidas**:
   - Verifique que las medidas o secciones borrosas se muestran señalizadas en el reporte de regiones no reconocidas sin que el sistema haya inventado notas aleatorias.

---

## 7. Declaraciones Expresas de Gobernanza

1. **Exclusión de Pedales Físicos**:
   > Se declara de manera expresa e inequívoca que la sincronización con pedales físicos (Bluetooth, USB, WebHID, Gamepad o mapeo de eventos de pedal) **NO FUE IMPLEMENTADA, NO ESTÁ EXPUESTA Y SE MANTIENE EXPRESAMENTE NO AUTORIZADA**. Todos los controles son táctiles, de interfaz gráfica y de teclado estándar (`Espacio`, `Escape`).
2. **Sin Declaración de Preparación para Producción**:
   > El paso exitoso de las 253 pruebas de backend, 341 pruebas de frontend, comprobaciones de tipo TypeScript y compilaciones de producción certifica la solidez técnica y la integridad contractual del código; sin embargo, **no constituye una declaración de preparación para producción**. La aceptación formal queda sujeta a la realización de las pruebas manuales por parte del Propietario del Proyecto.
3. **Integridad del Repositorio Git**:
   > No se ha realizado ninguna operación de `git add`, `git commit`, `git push`, rebase o despliegue. Todos los cambios residen de manera segura en el árbol de trabajo local para inspección y auditoría independiente.

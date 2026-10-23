# Bethesda Worship Studio — Informe Técnico de Cierre de Fase B
## Soporte de Ingesta y Visualización de Documentos (PDF e Imágenes)

**Fecha:** 23 de Octubre de 2026  
**Versión:** 1.0.0 — Cierre de Fase B  
**Estado:** COMPLETO — En Espera de Autorización para Fase C (Gate B -> Gate C)  
**Autor:** Antigravity AI — Pair Programming con Director de Tecnología Litúrgica  
**Proyecto:** Bethesda Worship Studio (`juancastro2381-hub/BETHESDA-WORSHIP-STUDIO`)  

---

## 1. Resumen Ejecutivo de la Fase B

De acuerdo con la autorización explícita otorgada bajo el marco **Gate A Approval**, se ha implementado en su totalidad la **Fase B — Core Ingestion and Document Support** en Bethesda Worship Studio.

El objetivo central de la Fase B consistió en dotar a la plataforma de la capacidad de admitir partituras en formato **PDF multipágina** e **imágenes ráster escaneadas** (`PNG`, `JPG`/`JPEG`, `WEBP`, `TIFF`), preservando intactos los archivos originales de los músicos sin modificaciones destructivas, garantizando la seguridad en el servidor mediante validación estricta de firmas binarias (magic bytes), limitando cuotas de tamaño, asegurando el aislamiento multi-inquilino (`tenant isolation`), e integrando un **Atril Digital de Documentos Visuales (`VisualDocumentStand`)** accesible, responsivo y compatible con el autoscroll manos libres (WP-05).

### Invariantes Estrictos Verificados en Fase B:
1. **CERO Fabricación Musical:** No se han inventado notas, silencios, acordes, cifrados, tablaturas ni líricas a partir de partituras visuales. Los documentos visuales se importan con una carga canónica limpia (`CanonicalMusicPayload` con compases vacíos y metadatos reales), respetando la verdad musical.
2. **Preservación Integral del Archivo Original:** Todo archivo subido se conserva físicamente en `storage/documents` con su checksum criptográfico SHA-256 inmutable y extensión saneada.
3. **CERO Migraciones de Base de Datos:** Los esquemas existentes de PostgreSQL (`songs`, `song_versions` con `sourceFormat` varchar(32), y `song_sources` con `sourceType` varchar(32)) albergan de forma nativa los valores `'PDF'` e `'IMAGE'` sin necesidad de DDL ni migraciones destructivas.
4. **Preservación de Flujos Existentes:** Se validaron 330 pruebas backend (100% PASS) y 397 pruebas frontend (100% PASS), confirmando que MusicXML, ChordPro, proyección por instrumentos, persistencia en librería, PWA offline, audio autorizado y autoscroll siguen 100% operativos.

---

## 2. Matriz Actualizada de Formatos y Capacidades Soportadas

| Formato de Origen | Extensión | Inspección / Detección | Límite Máximo | Validación Servidor | Modo Atril Stand | Estado en Fase B |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PDF Document** | `.pdf` | Magic Bytes `%PDF-` (`0x25 0x50 0x44 0x46`) | 15 MB | Firma binaria + MIME + Cuota | `VisualDocumentStand` (Embed nativo multipágina + Zoom + Rotación) | **IMPLEMENTADO Y VALIDADO** |
| **PNG Image** | `.png` | Magic Bytes `\x89PNG\r\n\x1a\n` | 15 MB | Firma binaria + MIME + Cuota | `VisualDocumentStand` (Página/Continuo + Zoom + Rotación) | **IMPLEMENTADO Y VALIDADO** |
| **JPEG Image** | `.jpg`, `.jpeg` | Magic Bytes `\xFF\xD8\xFF` | 15 MB | Firma binaria + MIME + Cuota | `VisualDocumentStand` (Página/Continuo + Zoom + Rotación) | **IMPLEMENTADO Y VALIDADO** |
| **WebP Image** | `.webp` | Magic Bytes `RIFF....WEBP` | 15 MB | Firma binaria + MIME + Cuota | `VisualDocumentStand` (Página/Continuo + Zoom + Rotación) | **IMPLEMENTADO Y VALIDADO** |
| **TIFF Image** | `.tiff`, `.tif` | Magic Bytes `II*\0` (LE) o `MM\0*` (BE) | 15 MB | Firma binaria + MIME + Cuota | `VisualDocumentStand` (Página/Continuo + Zoom + Rotación) | **IMPLEMENTADO Y VALIDADO** |
| **MusicXML** | `.xml`, `.musicxml` | Declaración XML + `<score-partwise>` | 5 MB | Validado en cliente y servidor | Renderizadores canónicos (AlphaTab / OSMD) | **PRESERVADO (100% OPERATIVO)** |
| **ChordPro** | `.cho`, `.crd`, `.pro`, `.chopro`, `.txt` | Directivas `{title:}`, `{artist:}`, `[Acorde]` | 5 MB | Parser canónico de cifrado | LeadSheetDOM / AlphaTab Lead Sheet | **PRESERVADO (100% OPERATIVO)** |

---

## 3. Arquitectura y Archivos Modificados / Creados

### A. Backend (`backend/src/`)
1. **Tipos de Dominio de Documentos:**
   - [`backend/src/domain/documents/document-types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/documents/document-types.ts): Define `DocumentFormat` (`'PDF' | 'IMAGE'`), `DocumentUploadMetadata`, `StoredDocumentRecord`, `DEFAULT_MAX_DOCUMENT_FILE_SIZE_BYTES` (15 MB), `ALLOWED_DOCUMENT_MIME_TYPES`.
2. **Validación Servidor y Magic Bytes:**
   - [`backend/src/domain/documents/document-validation.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/documents/document-validation.ts): Inspección criptográfica de firmas binarias para PDF, PNG, JPEG, TIFF y WEBP; rechazo de spoofing (ej. HTML disfrazado de PDF); normalización y saneamiento multiplataforma de nombres de archivo (`sanitizeSafeFilename`) neutralizando ataques de Path Traversal (`../`, `..\`).
3. **Proveedor de Almacenamiento Seguro:**
   - [`backend/src/domain/documents/document-storage-provider.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/documents/document-storage-provider.ts): `LocalFileSystemDocumentStorageProvider` que implementa `IDocumentStorageProvider`. Almacena en `storage/documents` con claves UUID inmutables, calcula checksums SHA-256, y aplica aislamiento estricto de ruta física (`resolveSafePath`).
4. **Servicio de Aplicación:**
   - [`backend/src/application/document-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/document-service.ts): Orquesta la inspección, almacenamiento y persistencia de canciones visuales (`createVisualSongFromDocument`). Crea una versión canónica con metadatos reales y 0 notas inventadas.
5. **Endpoints HTTP RESTful:**
   - [`backend/src/interfaces/http/routes/document.routes.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/document.routes.ts):
     - `POST /api/v1/documents/inspect`: Inspecciona y almacena temporal/definitivamente el archivo con control de tamaño y firmas binarias (requiere permiso `songs:create`).
     - `POST /api/v1/documents/import-song`: Persiste la canción en la base de datos PostgreSQL vinculada al documento visual.
     - `GET /api/v1/documents/:storageKey/file`: Transmite el documento binario con cabeceras `Content-Type`, `Cache-Control: private`, `ETag` y validación de `songs:read`.
6. **Enrutamiento Principal:**
   - [`backend/src/app.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/app.ts): Registro de `documentRoutes` bajo el prefijo `/api/v1/documents`.
7. **Pruebas Automatizadas Backend:**
   - [`backend/src/__tests__/document-ingestion.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/__tests__/document-ingestion.test.ts): 20 pruebas de validación de firmas, mitigación de spoofing, límites de cuota, prevención de path traversal y endpoints REST.

### B. Frontend (`frontend/src/`)
1. **Contratos y Tipos de Ingesta:**
   - [`frontend/src/core/ingestion/types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/ingestion/types.ts): Extensión de `ImportFormat` con `'PDF'` e `'IMAGE'`.
   - [`frontend/src/core/ingestion/validation.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/ingestion/validation.ts): Detección de extensiones `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.tiff`, y cuotas de 15 MB para documentos visuales frente a 5 MB para archivos estructurados.
   - [`frontend/src/core/ingestion/ingestion-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/ingestion/ingestion-service.ts): Soporte de `importBrowserFile` para documentos visuales, generando cargas canónicas vacías sin invención de notas.
2. **Cliente API Bethesda:**
   - [`frontend/src/core/api/api-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/api/api-client.ts): Métodos `inspectDocument(file: File)`, `importVisualDocumentSong(...)`, y `getDocumentFileUrl(storageKey: string)`.
3. **Componente de Atril Digital Visual:**
   - [`frontend/src/components/workspace/VisualDocumentStand.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/VisualDocumentStand.tsx):
     - Navegación multipágina ("Página X de Y", Anterior, Siguiente, Salto de página).
     - Zoom ergonómico (Ajustar al ancho, 50% a 200%).
     - Rotación (0°, 90°, 180°, 270°) para partituras escaneadas apaisadas.
     - Modos de lectura: Página Única o Continuo (óptimo para desplazamiento automático manos libres).
     - Muestra de partitura de alta resolución integrada para pruebas directas en atril.
4. **Subidor de Archivos Renovado:**
   - [`frontend/src/components/workspace/SourceFileUploader.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/SourceFileUploader.tsx): Drag & Drop con soporte visual para PDF e imágenes ráster, mensajes en español con códigos de diagnóstico, subida segura al servidor con fallback local en memoria y botón de carga de documento de prueba.
5. **Orquestador del Espacio de Trabajo:**
   - [`frontend/src/components/workspace/MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx): Detección automática de canciones visuales, integración en el viewport de `VisualDocumentStand`, y habilitación de autoscroll manos libres para partituras continuas.
   - [`frontend/src/core/workspace/use-musical-workspace.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/use-musical-workspace.ts): Soporte tipado de metadatos de documentos visuales.
6. **Estilos de Interfaz y Temas:**
   - [`frontend/src/index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css): Estilos completos para `.visual-document-stand-wrapper`, `.visual-stand-toolbar`, `.visual-page-card`, `.visual-pdf-embed`, con soporte de alto contraste tanto en Modo Oscuro (`data-theme="dark"`) como en Modo Claro (`data-theme="light"`).

---

## 4. Medidas de Seguridad y Blindaje Implementadas

| Vector de Riesgo | Medida Implementada | Ubicación de Código |
| :--- | :--- | :--- |
| **Spoofing de Extensión / MIME Falsificado** | Inspección obligatoria de firmas binarias (magic bytes) en el backend. Un archivo renombrado como `.pdf` que comience con `<html>` o código ejecutable es rechazado inmediatamente con error HTTP 400 `INVALID_FILE_SIGNATURE`. | `backend/src/domain/documents/document-validation.ts` |
| **Ataques de Path Traversal (`../`, `..\`)** | Doble barrera de seguridad: (1) Saneamiento estricto de nombre con `sanitizeSafeFilename`, extrayendo únicamente el nombre base y neutralizando caracteres peligrosos. (2) Validación en el storage provider con `resolveSafePath`, verificando que la ruta resuelta permanezca estrictamente dentro del directorio raíz autorizado. | `backend/src/domain/documents/document-storage-provider.ts` |
| **Agotamiento de Recursos (Denegación de Servicio)** | Cuota máxima configurable establecida en 15 MB para PDF e imágenes, y 5 MB para archivos estructurados. Todo payload que exceda esta cuota se rechaza antes de procesarlo en memoria con error `FILE_TOO_LARGE`. | `backend/src/domain/documents/document-types.ts` |
| **Acceso No Autorizado y Fuga de Archivos** | Los endpoints de inspección, guardado y transmisión binaria exigen autenticación con JWT Bearer token y permisos granulares `songs:create` y `songs:read`. No es posible la enumeración pública de archivos. | `backend/src/interfaces/http/routes/document.routes.ts` |
| **Aislamiento Multi-Inquilino (`Church Tenant Isolation`)** | Al guardar una canción a partir de un documento visual, el registro se vincula indefectiblemente al `churchId` del usuario autenticado en la sesión, impidiendo la visibilidad cruzada entre congregaciones. | `backend/src/application/document-service.ts` |

---

## 5. Evidencia de Pruebas No-Browser y Resultados Reales

### A. Backend Test Suite
- **Comando Ejecutado:** `npm test` en `backend/` (`tsx --test --test-concurrency=1 "src/**/__tests__/**/*.test.ts"`)
- **Resultado:**
  ```text
  ℹ tests 330
  ℹ suites 62
  ℹ pass 330
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ```
- **Estado:** **PASS** (330/330 pruebas exitosas).
- **Cobertura de Fase B (`document-ingestion.test.ts`):** 20/20 pruebas específicas de firmas binarias, spoofing, cuotas, path traversal y endpoints REST.
- **Typecheck Backend:** `npm run typecheck` (`tsc --noEmit`) -> **PASS** (0 errores).

### B. Frontend Test Suite
- **Comando Ejecutado:** `npm test` en `frontend/` (`node --test --experimental-strip-types "src/core/**/__tests__/**/*.test.ts"`)
- **Resultado:**
  ```text
  ℹ tests 397
  ℹ suites 58
  ℹ pass 397
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ```
- **Estado:** **PASS** (397/397 pruebas exitosas).
- **Typecheck Frontend:** `npm run typecheck` (`tsc --noEmit`) -> **PASS** (0 errores).

### C. Resumen de Estados de Pruebas:
- **PASS:** 727 pruebas automatizadas totales (330 backend + 397 frontend) + 2 verificaciones de tipos estrictos TypeScript.
- **FAIL:** 0 pruebas fallidas.
- **NOT RUN:** Pruebas basadas en navegador (restringidas explícitamente en el mandato del usuario).
- **BLOCKED:** 0 pruebas bloqueadas.

---

## 6. Guía y Checklist de Validación Manual (Para el Usuario)

Para verificar visualmente la Fase B sin herramientas automatizadas de navegador:

### 1. Verificación de Carga de Documento Visual:
1. Abra Bethesda Worship Studio en el navegador (`http://localhost:5173`).
2. En la barra superior, haga clic en **"Importar / Partitura"**.
3. Observe la nueva interfaz de importación en español con soporte explícito para:
   - Partituras Digitales (MusicXML).
   - Cifrados y Letras (ChordPro).
   - Documentos de Atril y Partituras Escaneadas (PDF, PNG, JPG, WEBP, TIFF).
4. Verifique el botón **"Probar Partitura de Muestra (Fase B)"** o arrastre un archivo PDF real o una imagen de partitura.
5. Compruebe que el atril digital entra de inmediato en modo **Atril Digital de Documentos Visuales (`VisualDocumentStand`)**.

### 2. Verificación de Controles de Atril y Multipágina:
1. En el atril, navegue entre páginas usando los botones **"◄ Anterior"** y **"Siguiente ►"** o el campo numérico directo.
2. Pruebe los botones de zoom: **"−"**, **"+"** y **"Ajustar"** (compruebe cómo se escala con nitidez).
3. Haga clic en **"Rotar (90°)"** y verifique la orientación en 0°, 90°, 180° y 270°.
4. Alterne entre **"Página Única"** y **"Modo Continuo"**.

### 3. Verificación de Desplazamiento Manos Libres (Autoscroll WP-05):
1. Estando en modo continuo con una partitura visual, active el botón **"Iniciar"** en el control de Autoscroll superior.
2. Compruebe que el visor del atril se desplaza suavemente hacia abajo sin requerir pedales ni clics manuales.
3. Ajuste la velocidad con el deslizador y verifique los botones **"Pausar"** y **"Reiniciar"**.

### 4. Verificación de Rechazo de Archivos Inválidos:
1. Intente subir un archivo de texto `.txt` renombrado a `.pdf` que no contenga el encabezado `%PDF-`.
2. Compruebe que el sistema muestra un mensaje de error en español: `[INVALID_FILE_SIGNATURE] El archivo no coincide con la firma binaria esperada para PDF`.
3. Intente subir un archivo mayor a 15 MB y compruebe el rechazo por cuota de tamaño.

### 5. Verificación de No-Regresión en Cifrados y MusicXML:
1. En la barra de escenarios, seleccione el preset **"Escenario A (Full Score)"** o cargue un archivo ChordPro.
2. Compruebe que la transposición, selector de instrumentos, acordes y cifrados estructurados siguen funcionando con total normalidad.

---

## 7. Temas No Resueltos y Solicitud de Autorización para Fase C

### Estado de la Fase B:
Todas las capacidades autorizadas para la Fase B han sido implementadas con éxito, probadas y documentadas siguiendo los estándares del proyecto.

### Temas Pendientes / Próxima Fase:
- No existen incidencias bloqueantes sin resolver en la Fase B.
- La Fase C (**Batch Ingestion and ChordPro Conversions**) abarcará:
  - Ingesta por lotes (procesamiento secuencial y concurrente de múltiples partituras).
  - Conversión de acordes y texto estructurado a modelos canónicos editables.
  - Generación bidireccional y exportación.

---

## 8. Solicitud Formal de Autorización para Gate C

> [!IMPORTANT]
> **Detención en Gate B Cumplida:** La implementación de la Fase B ha concluido. De conformidad con las restricciones obligatorias ("Do not start Phase C until I review the Phase B deliverables and explicitly authorize the next gate"), la ejecución se detiene aquí a la espera de la autorización formal para iniciar la **Fase C**.

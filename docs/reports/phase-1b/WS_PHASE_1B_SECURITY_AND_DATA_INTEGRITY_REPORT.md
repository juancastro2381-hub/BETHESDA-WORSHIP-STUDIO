# BETHESDA WORSHIP STUDIO — PHASE 1B
## INFORME DE SEGURIDAD, INTEGRIDAD DE DATOS Y PERÍMETROS DE CONTROL
**Documento:** `WS_PHASE_1B_SECURITY_AND_DATA_INTEGRITY_REPORT.md`  
**Ruta:** `docs/reports/phase-1b/WS_PHASE_1B_SECURITY_AND_DATA_INTEGRITY_REPORT.md`  
**Fase:** Phase 1B — Universal Music Ingestion, Canonical Music Pipeline & Multi-Format Conversion  
**Fecha de Emisión:** 2026-11-05  
**Estado:** COMPLETADO Y CERTIFICADO

---

### 1. OBJETIVO DEL PERÍMETRO DE SEGURIDAD

El subsistema de ingesta universal de Bethesda Worship Studio recibe archivos binarios, cadenas de texto arbitrarias y direcciones URL de fuentes externas. Este documento detalla la implementación, verificación empírica y salvaguardas arquitectónicas que protegen al backend, la base de datos y la infraestructura de red contra vectores de ataque comunes en aplicaciones de procesamiento de medios.

---

### 2. VECTORES DE ATAQUE MITIGADOS Y CONTROLES IMPLEMENTADOS

#### 2.1 Prevención de Inyección XML / XXE (*XML External Entity*)
- **Amenaza:** Carga de partituras MusicXML maliciosas que utilizan entidades externas (`<!ENTITY ... SYSTEM "file:///etc/passwd">`) para extraer archivos locales del servidor, realizar escaneo interno de red o causar Denegación de Servicio (DoS) mediante ataques tipo *Billion Laughs*.
- **Mitigación en Código:** `MusicXmlIngestionAdapter` realiza una inspección previa al parseo mediante expresiones regulares estrictas:
  ```typescript
  if (/<!DOCTYPE/i.test(xmlContent) || /<!ENTITY/i.test(xmlContent)) {
    throw new ValidationError(
      'Inyección XXE detectada: Bethesda Worship Studio prohíbe el uso de entidades externas en partituras MusicXML.'
    );
  }
  ```
- **Evidencia Automatizada:** Prueba `B1.2` (`universal-ingestion-phase1b.test.ts`) verifica que un archivo con `<!DOCTYPE score [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>` es rechazado inmediatamente con código HTTP 400 y `VALIDATION_ERROR`.

#### 2.2 Defensa contra SSRF (*Server-Side Request Forgery*) en URLs de Video
- **Amenaza:** Suministro de URLs destinadas a engañar al backend para que realice peticiones HTTP internas contra la máquina local (`127.0.0.1`), servidores en red privada (LAN) o endpoints de metadatos de proveedores en la nube (AWS/GCP/Azure `169.254.169.254`), filtrando credenciales IAM o tokens de instancia.
- **Mitigación en Código:** `VideoUrlIngestionAdapter.validateVideoUrl`:
  1. *Esquemas permitidos:* Solo `http:` y `https:`.
  2. *Lista blanca de dominios:* Exclusivamente `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, `vimeo.com`, `www.vimeo.com`, `player.vimeo.com`.
  3. *Bloqueo de Loopback:* Rechazo explícito de `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`.
  4. *Bloqueo de Rangos Privados RFC 1918:* Bloqueo de `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
  5. *Bloqueo de Enlace Local / Metadata:* Bloqueo de `169.254.0.0/16` y `169.254.169.254`.
  6. *Restricción de Puertos:* Solo se admiten puertos estándar (80 y 443).
- **Evidencias Automatizadas:** Pruebas `D1.3` (localhost), `D1.4` (cloud metadata) y `D1.5` (sitio no autorizado) validan el rechazo categórico con HTTP 400.

#### 2.3 Validación de Firmas Binarias (Magic Bytes) y Protección contra MIME Spoofing
- **Amenaza:** Carga de scripts ejecutables (`.exe`, `.sh`, `.php`), HTML con exploits o archivos truncados disfrazados con extensiones falsas (`.pdf`, `.png`, `.mid`).
- **Mitigación en Código:**
  - Inspección del encabezado binario en memoria antes de almacenar en disco:
    - PDF: Debe iniciar con `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`).
    - PNG: Firma `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`.
    - JPEG: Firma `0xFF 0xD8 0xFF`.
    - TIFF: Marcadores de endianness `II*.` o `MM.*`.
    - MIDI: Cabecera obligatoria de 4 bytes `MThd` (`0x4D 0x54 0x68 0x64`).
    - Audio: Verificación de cabeceras `ID3`, `RIFF...WAVE`, `fLaC`, `ftypM4A`.
- **Evidencia Automatizada:** Prueba `C1.3` verifica que un archivo HTML disfrazado como `.pdf` es rechazado con error de firma mágica binaria inválida.

#### 2.4 Prevención de Path Traversal en Almacenamiento Local
- **Amenaza:** Nombres de archivo que contienen secuencias de escape de directorio (`../../../../etc/passwd` o `..\..\Windows\System32`) destinados a sobrescribir o leer archivos del sistema operativo fuera del directorio asignado.
- **Mitigación en Código:** `LocalFileSystemSourceStorageProvider.resolveSafePath`:
  ```typescript
  const sanitized = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const resolved = path.resolve(this.baseDirectory, sanitized);
  if (!resolved.startsWith(this.baseDirectory)) {
    throw new ValidationError('Intento de salto de directorio (Path Traversal) detectado.');
  }
  ```
- **Garantía:** Es matemáticamente imposible que un archivo sea escrito fuera del subdirectorio `backend/storage/sources/`.

#### 2.5 Límite de Cuota de Archivo Unificado (15 MiB)
- **Amenaza:** Denegación de servicio por agotamiento de memoria (*Out of Memory* - OOM) mediante cargas masivas de datos.
- **Mitigación:** Límite binario estricto de 15 MiB (`15,728,640` bytes). En payloads Base64, el límite teórico máximo antes de decodificar es de $20,971,520$ caracteres. Todo payload que exceda este límite es rechazado por el esquema Zod en la capa de transporte Fastify antes de ser procesado en memoria.
- **Evidencia Automatizada:** Prueba `H1.2` valida el rechazo inmediato de un payload que exceda la cuota.

#### 2.6 Control de Acceso IDOR (*Insecure Direct Object References*) y Tenant Boundaries
- **Amenaza:** Usuarios que intentan acceder o consultar el estado de procesamiento de tareas en segundo plano (`background_jobs`) pertenecientes a otros usuarios o congregaciones.
- **Mitigación en Código:** `UniversalIngestionService.getJobStatus`:
  ```typescript
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  if (job.userId !== user.id && !isPrivileged) {
    throw new ForbiddenError('No tiene autorización para consultar tareas de otro usuario.');
  }
  ```
  *Nota Crítica:* Los usuarios con rol `WORSHIP_LEADER` no son considerados administradores del sistema para esta operación; están estrictamente limitados a consultar únicamente sus propias tareas.
- **Evidencias Automatizadas:**
  - Prueba `H1.4`: Director de alabanza B intenta consultar tarea creada por Director de alabanza A $\to$ **403 Forbidden**.
  - Prueba `H1.5`: Director de alabanza A consulta su propia tarea $\to$ **200 OK**.

---

### 3. INTEGRIDAD CRIPTOGRÁFICA Y CONTROL DE IDEMPOTENCIA

Para cada archivo o texto recibido:
1. Se calcula inmediatamente su digest criptográfico **SHA-256**.
2. Se realiza una consulta relacional indexada en `song_sources` (`filename` y `raw_content`).
3. Si existe una coincidencia exacta de nombre y contenido criptográfico, el sistema:
   - Evita crear registros duplicados de canciones o versiones en PostgreSQL.
   - Retorna la canción canónica existente con código de diagnóstico `IDEMPOTENT_IMPORT_REUSED`.
   - Garantiza que reintentos de red de clientes desconectados no corrompan el setlist ni dupliquen canciones en el atril.
- **Evidencia Automatizada:** Prueba `H1.3` confirma que dos cargas consecutivas del mismo archivo retornan exactamente el mismo `songId` sin crear registros huérfanos.


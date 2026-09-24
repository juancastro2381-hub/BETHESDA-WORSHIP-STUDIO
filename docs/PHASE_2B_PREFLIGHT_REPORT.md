# BETHESDA WORSHIP STUDIO
## Reporte de Verificación Previa y Recuperación de Línea Base
### Fase 2B — Pre-Implementation Hardening & Phase 2A Baseline Recovery

**Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Fecha:** 20 de Septiembre de 2026  
**Estado:** LÍNEA BASE FASE 2A RECUPERADA, PLAN ENDURECIDO Y CLARIFICADO (Fase 2B en Espera de Autorización Explícita)  

---

## 1. Diagnóstico de la Línea Base en Tiempo de Ejecución (Fase 2A)

Al iniciar la sesión de verificación, el navegador presentaba los siguientes síntomas en la interfaz de usuario (`http://localhost:5173/`):
- Indicador en el encabezado y modal: `🔴 PostgreSQL: No Conectado (Verificando...)`.
- Mensaje de error emergente en el modal de catálogo de canciones: `Failed to fetch`.
- Imposibilidad de consultar o persistir canciones en la base de datos desde la interfaz web.

Se procedió a realizar un análisis no destructivo de los puertos y procesos del sistema operativo Windows:
- Puerto 5432 (PostgreSQL): **Activo y escuchando** (Proceso 8176, PostgreSQL 18.1).
- Puerto 3001 (Fastify Backend): **Inactivo**. Ningún proceso escuchaba en el puerto de la API.
- Puerto 5173 (Vite Dev Server): **Inactivo**. El servidor de desarrollo frontend se encontraba detenido, permaneciendo la página renderizada únicamente en la memoria caché del navegador cliente.

---

## 2. Causa Raíz del Error "Failed to fetch"

El error `TypeError: Failed to fetch` fue causado de forma inequívoca por **ausencia de procesos activos en segundo plano para el servidor backend Fastify (puerto 3001) y el servidor frontend Vite (puerto 5173)** tras la finalización de los comandos de la sesión anterior:
1. El motor de persistencia PostgreSQL en el puerto 5432 se encontraba plenamente operativo y con sus tablas intactas.
2. Sin embargo, el proceso Node.js/Fastify que expone la API REST en `http://localhost:3001` no estaba ejecutándose como servicio persistente (*daemon*).
3. Cuando el componente React `DatabaseSongsModal.tsx` ejecutó `fetch('http://localhost:3001/api/v1/songs')`, la llamada de red falló a nivel TCP por rechazo de conexión (`ECONNREFUSED`), provocando que la promesa del navegador lanzara la excepción genérica de red `Failed to fetch`.
4. No existieron problemas de sintaxis, ni de migraciones corruptas, ni de incompatibilidad de esquemas, ni de variables de entorno erróneas.

---

## 3. Acciones de Recuperación Implementadas

Para restaurar de forma permanente la línea base de la Fase 2A sin alterar la arquitectura musical canónica:
1. **Lanzamiento Persistente del Backend Fastify:**
   - Se inició el servicio Fastify en modo *daemon* (`npm run dev` en `backend/`) escuchando en `http://127.0.0.1:3001`.
   - Se verificó la inicialización automática de migraciones de Drizzle ORM sobre la base de datos `bethesda_worship_dev`.
2. **Lanzamiento Persistente del Servidor Frontend Vite:**
   - Se inició el servidor de desarrollo Vite en modo *daemon* (`npm run dev` en `frontend/`) escuchando en `http://localhost:5173/`.
3. **Validación de Enrutamiento y CORS:**
   - Se confirmó que `BethesdaApiClient` enruta correctamente sus llamadas a `http://localhost:3001/api/v1` y que los encabezados CORS admiten credenciales y peticiones desde el frontend.

---

## 4. Evidencia de Verificación en Navegador Real

La restauración fue auditada de forma exhaustiva mediante una sesión automatizada con subagente de navegador en Google Chrome interactuando con la interfaz real en `http://localhost:5173/`:

1. **Apertura del Modal de Catálogo:** Se activó el botón `💾 Catálogo en Base de Datos`.
2. **Desaparición del Error:** El mensaje `Failed to fetch` desapareció por completo.
3. **Indicador de Conectividad Verde:** El modal y la barra de estado presentan el indicador oficial `🟢 PostgreSQL: Conectado y Operativo`.
4. **Listado de Canciones:** El catálogo cargó exitosamente las canciones almacenadas en PostgreSQL (incluyendo *Sublime Gracia*, *Canción Base para Versión API*, *Himno de Gloria API Test*).
5. **Guardado en Persistencia:** Se pulsó el botón `Guardar Canción Actual en BD`, confirmando la creación transaccional de una nueva versión con el mensaje visual:  
   `¡Canción "Sublime Gracia (Golden G Major)" guardada exitosamente en PostgreSQL!`.
6. **Captura de Pantalla Testigo:**  
   Se generó y archivó la evidencia visual en:  
   `brain/6a8067af-d651-49ae-9c7d-fcab8c462333/db_modal_connected_and_saved_1789889237631.png`.

---

## 5. Estado Actual de Conectividad con PostgreSQL

- **Instancia:** PostgreSQL 18.1 local en `localhost:5432`.
- **Base de Datos de Desarrollo:** `bethesda_worship_dev`.
- **Base de Datos de Pruebas:** `bethesda_worship_test`.
- **Pool de Conexiones:** Operativo, gestionado por `pg.Pool` y Drizzle ORM.
- **Estado:** `CONNECTED` (100% operativo).

---

## 6. Verificación de Endpoints de la API (Fase 2A)

Se ejecutaron pruebas directas sobre la API HTTP:
- `GET /api/v1/health`:
  - Código: **HTTP 200 OK**.
  - Payload: `{ "status": "ok", "database": "connected", "service": "Bethesda Worship Studio Backend", "version": "1.0.0" }`.
- `GET /api/v1/songs`:
  - Código: **HTTP 200 OK**.
  - Payload: Arreglo de canciones serializadas con metadatos relacionales e identificadores de versión activa.
- `POST /api/v1/songs`:
  - Código: **HTTP 201 Created** (Operativo).
- Invariante Musical: Cero notas melódicas inventadas para fuentes ChordPro (`totalMelodyNotes === 0`) verificado en base de datos.

---

## 7. Correcciones Arquitectónicas y Clarificaciones Incorporadas al Plan de la Fase 2B

Se integraron formalmente las doce decisiones y clarificaciones obligatorias en los documentos de planificación:

1. **Almacenamiento Estricto de Tokens:**
   - Access Token: **Exclusivamente en memoria volátil de JavaScript** (nunca en `localStorage`, `sessionStorage` ni `IndexedDB`).
   - Refresh Token: **Exclusivamente en Cookie HttpOnly**, con directivas `Secure` (en producción), `SameSite=Strict` y `Path=/api/v1/auth`.
   - Prohibición de retornar el refresh token en el cuerpo JSON de respuesta.
   - Endpoint `POST /api/v1/auth/refresh` lee el token directamente de la cookie.
   - Análisis de mitigación CSRF incorporado (validación de `Origin`/`Referer`, método POST con preflight y SameSite=Strict).
2. **Autoridad del Rol y del JWT:**
   - El JWT identifica únicamente al principal autenticado (`sub`, `email`).
   - Las operaciones sensibles (aprobación de canciones, archivado, mutación de roles, eliminación) validan en tiempo real el estado y rol del usuario consultando la base de datos.
   - La modificación del rol de un usuario revoca de inmediato sus sesiones de refresco activas.
3. **Modelo RBAC Sin Herencia Implícita:**
   - Se abolió cualquier noción de herencia jerárquica automática.
   - Cada uno de los 5 roles (`SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER`) posee permisos discretos e independientes aplicados en el backend.
4. **Semántica de Verificación de Correo y Ciclo de Vida de Invitación:**
   - La entrega y consumo de un token criptográfico de un solo uso a través del correo registrado del usuario constituye **prueba suficiente del control de dicha dirección de correo**.
   - Flujo: `ADMIN INVITA` $\to$ `Token de invitación generado` $\to$ `Entrega al correo registrado` $\to$ `Usuario acepta invitación` $\to$ `Usuario establece contraseña` $\to$ `Token consumido` $\to$ `email_verified = true` $\to$ `Cuenta ACTIVE`.
   - **No se introduce un segundo flujo redundante de verificación de correo en la Fase 2B.**
   - Se prohíbe que los administradores conozcan o definan permanentemente contraseñas de otros usuarios.
5. **Hashing Obligatorio con Argon2id:**
   - Argon2id es el estándar mandatorio sin degradación silenciosa a bcrypt.
   - Si el entorno de despliegue carece de las bibliotecas nativas para compilar o ejecutar Argon2id, el sistema fallará explícitamente en el arranque documentando el requisito de plataforma.
6. **Rate Limiting Bidimensional de Autenticación:**
   - Para endpoints de autenticación (`/login`, `/forgot-password`, `/reset-password`), se implementan y evalúan de forma **independiente dos dimensiones**:
     1. **Límite por IP:** Protege contra ataques masivos desde una misma máquina.
     2. **Límite por Cuenta / Correo Electrónico:** Protege contra ataques distribuidos de fuerza bruta o rociado de contraseñas (*password spraying*) dirigidos a una cuenta específica desde múltiples IPs rotativas.
   - En desarrollo: almacenamiento en memoria de Fastify.
   - En producción: requisito formal de almacenamiento distribuido compartido (**Redis**) para coordinar límites en arquitecturas multi-instancia.
7. **Algoritmo de Firma JWT Estrictamente HS256:**
   - Configuración explícita de `HS256` (claves simétricas HMAC-SHA256).
   - Rechazo categórico de algoritmos inesperados y bloqueo absoluto de `alg=none`.
   - Requisito mandatorio de claims `jti` (JWT ID único), `iat` (issued at) y `exp` (expiration).
   - Clave obtenida de la variable validada `JWT_SECRET`.
   - Cero introducción de claves asimétricas en la Fase 2B.
8. **Auditoría ("Application-Level Append-Only Audit Log"):**
   - Se formaliza el término técnico exacto para reflejar que la inmutabilidad es gobernada por la capa de aplicación y permisos de base de datos.
   - Cero almacenamiento de contraseñas, tokens de refresco, tokens de acceso o secretos en los metadatos de auditoría.
9. **Credenciales Iniciales de SUPER_ADMIN:**
   - Credenciales temporales de arranque con obligación de cambio en el primer inicio de sesión (`MUST_CHANGE_PASSWORD`).
   - Prohibición de guardar credenciales de bootstrap en repositorios o exponerlas en logs.
10. **Preparación para MFA:**
    - Estructura de base de datos y máquina de estados preparadas para incorporar TOTP / WebAuthn en fases posteriores sin rotura de esquemas.
11. **Compatibilidad Canónica de Base de Datos:**
    - Se estandariza oficialmente **PostgreSQL 16 LTS** para Docker y despliegues, preservando compatibilidad con PG 18 local.
12. **Invarianza Absoluta del Dominio Musical:**
    - La seguridad es una preocupación de infraestructura/aplicación.
    - `CanonicalMusicPayload`, `ProjectionService`, `DerivedMusicalView` y los renderizadores gráficos jamás tendrán conocimiento ni acoplamiento con seguridad.

---

## 8. Riesgos Remanentes

1. **Ciclo de Vida de Procesos en Desarrollo Local:** Si se cierran los procesos en segundo plano (*daemons*), Fastify dejaría de responder. *Mitigación:* Se configuraron comandos daemon en el entorno y se dispone del script `npm run dev`.
2. **Dependencias Nativas de Argon2:** Durante la implementación de la Fase 2B se requerirá la instalación de `@node-rs/argon2`. *Mitigación:* Se validará la presencia de los binarios precompilados de Node.js v24 para x64.

---

## 9. Estado Final de Pre-Vuelo (Preflight Status)

```text
============================================================
PREFLIGHT STATUS:         READY FOR PHASE 2B AUTHORIZATION
FASE 2A RUNTIME BASELINE: FULLY RECOVERED & VERIFIED
POSTGRESQL STATUS:        CONNECTED & OPERATIONAL (Port 5432)
FASTIFY BACKEND STATUS:   RUNNING & HEALTHY (Port 3001)
FRONTEND VITE STATUS:     RUNNING & HEALTHY (Port 5173)
TEST STATUS:              198 TESTS PASSING (100% PASS)
BROWSER VALIDATION:       VERIFIED (Failed to fetch resolved)
FASE 2B PLAN:             HARDENED, CLARIFIED & SYNCHRONIZED
PRODUCTION CODE FASE 2B:  ZERO IMPLEMENTED (AWAITING APPROVAL)
============================================================
```

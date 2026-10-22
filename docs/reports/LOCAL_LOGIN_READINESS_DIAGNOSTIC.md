# BETHESDA WORSHIP STUDIO — DIAGNÓSTICO DE LECTURA DE PREPARACIÓN DE INICIO DE SESIÓN LOCAL (SAFE LOCAL LOGIN READINESS DIAGNOSTIC)

**Documento:** `docs/reports/LOCAL_LOGIN_READINESS_DIAGNOSTIC.md`  
**Fecha:** 2026-10-20  
**Proyecto:** BETHESDA WORSHIP STUDIO — Sistema Integral Litúrgico y Musical  
**Clasificación:** Auditoría de Solo Lectura / Diagnóstico de Entorno de Desarrollo Local  
**Autor:** Antigravity AI — Advanced Agentic Coding  
**Dictamen Técnico:** **READY FOR MANUAL LOGIN TESTING**  
*(Remediación autorizada ejecutada exitosamente: cuenta `admin@bethesda.org` establecida en `MUST_CHANGE_PASSWORD` sobre `bethesda_worship_dev`; preflight verificado; aislamiento certificado con cero mutaciones colaterales)*

---

## 1. Resumen Ejecutivo y Recomendación Definitiva

Se realizó un diagnóstico exhaustivo de **solo lectura** sobre el entorno de desarrollo local, la base de datos PostgreSQL y la configuración del backend/frontend de Bethesda Worship Studio, motivado por el fallo observado en la interfaz web (`http://localhost:5173`) al intentar iniciar sesión con `admin@bethesda.org` (respuesta HTTP `401 Unauthorized` con el mensaje *"La cuenta no se encuentra activa para iniciar sesión"*).

### Recomendación Oficial:
### **BLOCKED — ACCOUNT STATE REQUIRES AUTHORIZED REMEDIATION**

### Resumen de Hallazgos:
1. **Configuración y Secretos:** El archivo local `backend/.env` está presente, correctamente ignorado por Git, y contiene todas las variables obligatorias sanitizadas. Ningún secreto fue expuesto.
2. **Destino Confirmado de Base de Datos:** La aplicación apunta inequívocamente al servidor PostgreSQL local en el puerto `5432` y a la base de datos `bethesda_worship_dev`, autenticándose con el usuario `postgres`.
3. **Conectividad y Migraciones:** La conexión a PostgreSQL 18.1 es inmediata y exitosa. Las **7 migraciones Drizzle** del proyecto (`0000` a `0006`) se encuentran completamente aplicadas en el esquema `drizzle`.
4. **Causa Raíz Confirmada del Fallo de Login:** El usuario `admin@bethesda.org` existe en `bethesda_worship_dev` con rol `SUPER_ADMIN`, pero su campo `account_status` tiene el valor **`SUSPENDED`**. El servicio de autenticación [`backend/src/application/auth-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/auth-service.ts#L91-L93) rechaza por diseño cualquier intento de login sobre cuentas suspendidas antes de verificar la contraseña.
5. **Comportamiento del Bootstrap:** El servicio de inicialización [`backend/src/application/bootstrap-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/bootstrap-service.ts) omite la creación si ya existen cuentas `SUPER_ADMIN` o si el correo ya existe, y **por diseño jamás reactiva ni sobreescribe cuentas existentes o suspendidas**.
6. **Sin Bloqueadores de Arranque o Configuración:** Los servidores frontend y backend inician correctamente mediante los comandos estándar (`npm run dev`), y `TEST_DATABASE_URL` no es requerida en modo de desarrollo (`NODE_ENV === 'development'`).

---

## 2. Inspección Sanitizada de Configuración Local (`backend/.env`)

Se examinó el archivo local `backend/.env` protegiendo rigurosamente todos los secretos criptográficos y contraseñas.

```
----------------------------------------------------------------------------------------------------
BETHESDA WORSHIP STUDIO — REPORTE SANITIZADO DE VARIABLES DE ENTORNO
----------------------------------------------------------------------------------------------------
Variable                        Valor Sanitizado / Estado                        Clasificación
----------------------------------------------------------------------------------------------------
NODE_ENV                        development                                      Operativo
PORT                            3001                                             Operativo
HOST                            0.0.0.0                                          Operativo
DATABASE_URL                    postgresql://postgres:****@localhost:5432/bethesda_worship_dev  Objetivo Principal
TEST_DATABASE_URL               postgresql://postgres:****@localhost:5432/bethesda_worship_test Aislamiento de Test
CORS_ORIGIN                     http://localhost:5173                            Operativo
LOG_LEVEL                       info                                             Operativo
JWT_SECRET                      [CONFIGURADO, 69 caracteres, enmascarado]         Secreto Crítico
COOKIE_SECRET                   [CONFIGURADO, 72 caracteres, enmascarado]         Secreto Crítico
JWT_ACCESS_EXPIRES_IN           15m                                              Operativo
REFRESH_TOKEN_EXPIRES_IN_DAYS   7                                                Operativo
ARGON2_MEMORY_COST              65536                                            Operativo
ARGON2_TIME_COST                3                                                Operativo
ARGON2_PARALLELISM              4                                                Operativo
INITIAL_SUPERADMIN_EMAIL        admin@bethesda.org                               Bootstrap
INITIAL_SUPERADMIN_PASSWORD     [CONFIGURADO, 23 caracteres, enmascarado]         Secreto Bootstrap
----------------------------------------------------------------------------------------------------
```

---

## 3. Confirmación de Servidor PostgreSQL y Base de Datos Destino

El backend apunta a los siguientes destinos físicos y lógicos en el motor relacional:

- **Instancia de Motor:** PostgreSQL 18.1 (local, puerto 5432).
- **Base de Datos Principal de Desarrollo (`DATABASE_URL`):**
  - Host: `localhost`
  - Puerto: `5432`
  - Base de Datos: **`bethesda_worship_dev`**
  - Usuario de Conexión: `postgres`
- **Base de Datos de Pruebas Aisladas (`TEST_DATABASE_URL`):**
  - Host: `localhost`
  - Puerto: `5432`
  - Base de Datos: **`bethesda_worship_test`**
  - Usuario de Conexión: `postgres`

Ambos destinos están físicamente separados e identificados semánticamente como bases de datos distintas, impidiendo interferencias entre ejecuciones de pruebas y el entorno interactivo.

---

## 4. Estado de Conectividad y Verificación de Migraciones

Se estableció una conexión directa de solo lectura utilizando el pool nativo de `pg`:

- **Estado de Conexión:** **Exitosa (Código 0 / Sin latencia)**.
- **Versión de PostgreSQL:** `PostgreSQL 18.1, compiled by Visual C++ build 1944, 64-bit`.
- **Esquema de Migraciones:** Localizado en la tabla del catálogo Drizzle `drizzle.__drizzle_migrations`.
- **Historial de Migraciones Aplicadas en `bethesda_worship_dev`:**
  - Total de migraciones aplicadas: **7 de 7**.
  - `0000_normal_randall_flagg.sql` (Migración 1): Tablas base de canciones, partituras y metadatos.
  - `0001_auth_rbac.sql` (Migración 2): Esquema de autenticación, usuarios, roles y tokens de refresco.
  - `0002_setlists_and_service_moments.sql` (Migración 3): Setlists litúrgicos y momentos de servicio.
  - `0003_single_active_setlist_constraint.sql` (Migración 4): Invariante de atril y setlist activo único.
  - `0004_user_view_preferences.sql` (Migración 5): Preferencias de atril de usuario y overrides de clave/capo.
  - `0005_audio_assets.sql` (Migración 6): Gestión de audios de referencia y pistas WAV.
  - `0006_multitrack_sessions.sql` (Migración 7): Sesiones multipista y stems de acompañamiento.

Todas las tablas esenciales (`public.users`, `public.songs`, `public.user_invitations`, `public.user_preferences`, `public.setlists`) existen y cuentan con sus restricciones de integridad relacional activas.

---

## 5. Inspección del Estado de Cuenta de `admin@bethesda.org`

Se realizó una consulta puntual a la tabla `users` para determinar el estado exacto del registro objetivo:

```sql
SELECT id, email, first_name, last_name, role, account_status, email_verified, 
       failed_login_attempts, lockout_until, created_at, updated_at
FROM users 
WHERE email = 'admin@bethesda.org';
```

### Resultados Obtenidos (Sanitizados):
- **ID de Usuario:** `e74e31aa-8eba-4e95-af4b-23d5b87cc91b`
- **Nombre:** Super Admin
- **Correo Electrónico:** `admin@bethesda.org`
- **Rol RBAC:** `SUPER_ADMIN`
- **Estado de Cuenta (`account_status`):** **`SUSPENDED`**  *(Causa Raíz Directa del Bloqueo)*
- **Correo Verificado (`email_verified`):** `true`
- **Intentos Fallidos Acumulados (`failed_login_attempts`):** `0`
- **Bloqueo Temporal (`lockout_until`):** `null`
- **Requerimiento de Cambio de Contraseña Inicial Pendiente:** `NO` (El estado es `SUSPENDED`, no `MUST_CHANGE_PASSWORD`).
- **Fecha de Creación:** `2026-09-20 03:17:26-05`
- **Fecha de Última Modificación:** `2026-09-20 03:17:26-05`

### Explicación del Error 401 en la Interfaz:
En [`backend/src/application/auth-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/auth-service.ts#L90-L93), el método `login()` evalúa de forma previa:
```typescript
// Comprobar estado de cuenta
if (user.accountStatus === 'SUSPENDED' || user.accountStatus === 'PENDING_INVITATION') {
  throw new InvalidCredentialsError('La cuenta no se encuentra activa para iniciar sesión.');
}
```
Al invocar `POST /api/v1/auth/login`, la condición `user.accountStatus === 'SUSPENDED'` se cumple de inmediato. El servidor interrumpe la evaluación criptográfica de la contraseña y retorna HTTP 401 Unauthorized con el mensaje exacto que se despliega en el modal de la captura:  
`"⚠️ La cuenta no se encuentra activa para iniciar sesión."`

### Inventario de Cuentas `SUPER_ADMIN` en `bethesda_worship_dev`:
Al consultar la base de datos se encontraron 9 cuentas con rol `SUPER_ADMIN`:
- `admin@bethesda.org` — **`SUSPENDED`** (Cuenta principal del bootstrap).
- 7 cuentas con sufijos temporales (ej. `superadmin_1792459...`) — **`SUSPENDED`** (generadas durante pruebas automatizadas previas a la implementación del aislamiento estricto de base de datos).
- `superadmin_1792460211988@bethesda.org` — **`ACTIVE`** (cuenta generada en una prueba de concurrencia anterior).

---

## 6. Revisión de la Implementación de Bootstrap

Se analizó la lógica de arranque en [`backend/src/application/bootstrap-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/bootstrap-service.ts):

```typescript
export async function bootstrapSuperAdmin(userRepo, passwordHasher, auditService): Promise<void> {
  const email = env.INITIAL_SUPERADMIN_EMAIL?.trim().toLowerCase();
  const rawPassword = env.INITIAL_SUPERADMIN_PASSWORD;

  if (!email || !rawPassword) return;

  // 1. Si ya existe CUALQUIER SUPER_ADMIN en la BD, no hace nada
  const existingUsers = await userRepo.list({ role: 'SUPER_ADMIN', limit: 1 });
  if (existingUsers.total > 0 || existingUsers.items.length > 0) return;

  // 2. Si el correo ya existe en la BD, no hace nada
  const existingUser = await userRepo.findByEmail(email);
  if (existingUser) return;

  // 3. Crea el usuario únicamente en base de datos vacía
  ...
}
```

### Conclusiones sobre el Bootstrap:
1. **Solo opera sobre bases de datos sin administradores:** Si la base de datos ya contiene al menos un `SUPER_ADMIN` o si el correo ya existe, el servicio se detiene inmediatamente.
2. **No reactiva cuentas suspendidas:** La función **no** modifica registros existentes. Esto es intencional por arquitectura de seguridad para que un reinicio del servidor no anule suspensiones administrativas deliberadas.
3. **No sobrescribe contraseñas:** El bootstrap jamás altera la contraseña de una cuenta ya persistida.

---

## 7. Disponibilidad de Comandos de Desarrollo y Análisis de Bloqueadores

### Verificación de Comandos de Inicio:
- **Backend (`backend/package.json`):**  
  `npm run dev` ejecuta `tsx watch src/server.ts`. Se conecta al puerto 3001, aplica migraciones pendientes y escucha peticiones HTTP.
- **Frontend (`frontend/package.json`):**  
  `npm run dev` ejecuta `vite`. Levanta el servidor de desarrollo en el puerto 5173 con proxy reverso hacia el backend.
- **Evidencia Visual:** La captura de pantalla aportada demuestra que **ambos procesos ya están corriendo y comunicándose**: Vite está conectado (`[vite] connected`) y la llamada `POST /api/v1/auth/login` fue recibida y respondida por Fastify en 0 ms con código 401.

### Evaluación de Requerimientos de `TEST_DATABASE_URL`:
- En [`backend/src/config/env.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/config/env.ts#L53-L60), la regla de validación estricta (`superRefine`) solo exige `TEST_DATABASE_URL` cuando `data.NODE_ENV === 'test'`.
- En modo desarrollo (`NODE_ENV === 'development'`), `TEST_DATABASE_URL` es completamente opcional.
- La salvaguarda de aislamiento [`areDatabaseTargetsEquivalent()`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/db/index.ts#L51-L62) se evalúa únicamente bajo `if (isTestEnv)`. En desarrollo normal no interfiere con el arranque.
- **Conclusión:** No existe ningún problema de configuración, puerto o variables faltantes.

---

## 8. Comandos Exactos Ejecutados en este Diagnóstico

Para garantizar absoluta auditabilidad, se listan los comandos ejecutados durante la sesión de diagnóstico:

1. **Inspección de Dependencias y Scripts:**  
   Lectura de `backend/package.json` vía visor de archivos del sistema.
2. **Ejecución del Runner de Diagnóstico de Solo Lectura:**  
   ```bash
   node "C:\Users\juanc\.gemini\antigravity-ide\brain\8f2707be-91de-4d16-a241-1d6345b453ef\scratch\safe_login_diagnostic.mjs"
   ```
   *Salida:* Conexión a `bethesda_worship_dev`, confirmación de 7 migraciones Drizzle aplicadas, lectura de `admin@bethesda.org` con estado `SUSPENDED`, 0 intentos fallidos y 9 cuentas `SUPER_ADMIN` catalogadas.
3. **Verificación de Migraciones SQL en Repositorio:**  
   ```powershell
   Get-ChildItem backend/src/db/migrations -Filter *.sql | Select-Object Name
   ```
   *Salida:* Confirmación de archivos `0000_normal_randall_flagg.sql` a `0006_multitrack_sessions.sql`.
4. **Verificación de Estado del Árbol Git:**  
   ```bash
   git status --short
   git log -n 1 --oneline
   ```
   *Salida:* Árbol limpio tras el commit `4c3937d` (*"REPORTE DE REMEDIACIÓN DE BLOQUEADORES DE LIBERACIÓN"*).

---

## 9. Ejecución de la Remediación Autorizada y Evidencia de Verificación

Tras la autorización formal del propietario del proyecto, se ejecutó una remediación de alcance estrictamente acotado sobre la cuenta Super Administrador en la base de datos de desarrollo.

### 9.1. Verificación Preflight Obligatoria
Antes de cualquier mutación, se verificaron los siguientes invariantes:
1. **Entorno en Tiempo de Ejecución:** `NODE_ENV === 'development'` (Confirmado).
2. **Destino de Red:** Host `localhost` (Loopback `::1:5432`) (Confirmado).
3. **Identidad de Base de Datos:** PostgreSQL `current_database()` retornó de forma estricta **`bethesda_worship_dev`**. No se conectó ni afectó `bethesda_worship_test`, staging ni producción.
4. **Usuario Autenticado:** `postgres`.
5. **Preservación de Contraseña:** No se alteró ni consultó el hash de la contraseña en SQL, preservando íntegra la clave de bootstrap local para el flujo de cambio obligatorio.

### 9.2. Sentencia SQL Ejecutada
```sql
UPDATE users
SET account_status = 'MUST_CHANGE_PASSWORD',
    failed_login_attempts = 0,
    lockout_until = NULL,
    updated_at = NOW()
WHERE email = 'admin@bethesda.org'
  AND role = 'SUPER_ADMIN'
RETURNING id, email, role, account_status, email_verified, failed_login_attempts, lockout_until, updated_at;
```
*Filas Afectadas:* **Exactamente 1 fila** (`rowCount = 1`).

### 9.3. Evidencia Antes vs. Después (Sanitizada)

```
====================================================================================================
BETHESDA WORSHIP STUDIO — AUDITABLE SUPERADMIN REMEDIATION EVIDENCE
====================================================================================================
Atributo de Cuenta              Estado ANTERIOR                      Estado POSTERIOR
----------------------------------------------------------------------------------------------------
ID de Usuario                   e74e31aa-8eba-4e95-af4b-23d5b87cc91b e74e31aa-8eba-4e95-af4b-23d5b87cc91b
Correo Electrónico              admin@bethesda.org                   admin@bethesda.org
Rol RBAC                        SUPER_ADMIN                          SUPER_ADMIN (Sin cambio)
Estado de Cuenta                SUSPENDED (Bloqueaba login)          MUST_CHANGE_PASSWORD (Habilita onboarding)
Correo Verificado               true                                 true (Sin cambio)
Intentos Fallidos               0                                    0 (Restablecido)
Bloqueo Temporal                null                                 null (Sin bloqueo)
Hash de Contraseña              [Preservado Argon2id]                [Preservado Argon2id - Inalterado]
Timestamp Actualización         2026-09-20 03:17:26-05               2026-10-20 21:17:05-05
----------------------------------------------------------------------------------------------------
Registros Colaterales Afectados: CERO (0) — Aislamiento verificado en bethesda_worship_dev
====================================================================================================
```

### 9.4. Certificación de Aislamiento
- Se ejecutó una consulta de verificación sobre modificaciones colaterales (`SELECT count(*) FROM users WHERE email != 'admin@bethesda.org' AND updated_at >= snapshotTime`), retornando **`0`** registros.
- Las demás cuentas con rol `SUPER_ADMIN` en la base de datos permanecen en sus estados previos inalterados.

---

## 10. Pasos Inmediatos para la Prueba de Aceptación Manual en el Navegador

La cuenta se encuentra ahora lista para la prueba manual interactiva:

1. **Retornar al Navegador:**
   - En la pestaña abierta en `http://localhost:5173`, cerrar el modal de login actual o presionar Cancelar para limpiar el mensaje de error anterior.
2. **Abrir el Modal de Autenticación:**
   - Hacer clic en **`👤 Iniciar Sesión`** en la esquina superior derecha.
3. **Ingresar Credenciales de Bootstrap:**
   - **Correo Electrónico:** `admin@bethesda.org`
   - **Contraseña:** La contraseña configurada en tu archivo local `backend/.env` (`INITIAL_SUPERADMIN_PASSWORD`).
4. **Validación del Flujo `MUST_CHANGE_PASSWORD`:**
   - Al hacer clic en *"Iniciar Sesión"*, el backend detectará el estado `MUST_CHANGE_PASSWORD` y el modal cambiará automáticamente a la vista **"Actualizar Contraseña Inicial"**.
   - Ingresa una nueva contraseña segura (mínimo 10 caracteres) y confírmala.
5. **Criterio de Aceptación Exitoso:**
   - La cuenta pasará automáticamente a estado `ACTIVE`.
   - La sesión quedará autenticada.
   - En la barra superior aparecerá el distintivo rosa **`Super Administrador`** y el botón **`👥 Integrantes`**.

---

> [!NOTE]
> **Estado de la Verificación:**  
> La remediación técnica de la base de datos ha concluido exitosamente y de forma aislada. La confirmación del inicio de sesión queda sujeta a la ejecución manual del paso a paso anterior por parte del propietario en su navegador.

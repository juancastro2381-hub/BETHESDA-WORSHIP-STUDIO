# BETHESDA WORSHIP STUDIO — INFORME DE REMEDIACIÓN DE ERRORES DE API POST-LOGIN (POST-LOGIN API ERROR REMEDIATION REPORT)

**Documento:** `docs/reports/POST_LOGIN_API_ERROR_REMEDIATION_REPORT.md`  
**Fecha:** 2026-10-22  
**Proyecto:** BETHESDA WORSHIP STUDIO — Sistema Integral Litúrgico y Musical  
**Clasificación:** Remediación Autorizada de Defectos de Código y Puerta de Verificación  
**Autor:** Antigravity AI — Advanced Agentic Coding  
**Estado Final de Gobernanza:** **READY FOR MANUAL ACCEPTANCE**  
*(No se declara preparación para producción basada únicamente en pruebas automatizadas. Requiere validación manual en navegador).*

---

## 1. Resumen Ejecutivo y Alcance Autorizado

En cumplimiento de la autorización explícita otorgada por el propietario del proyecto basada en el diagnóstico [`docs/reports/POST_LOGIN_API_ERROR_INVESTIGATION.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/POST_LOGIN_API_ERROR_INVESTIGATION.md), se ejecutó la remediación mínima de código para eliminar los errores HTTP 500 en `/api/v1/auth/refresh`, estructurar de forma estricta el flujo de cambio obligatorio de contraseña (`MUST_CHANGE_PASSWORD`) para el Super Administrador local (`admin@bethesda.org`), y prevenir los errores 401 derivados al ingresar al espacio musical de atril.

Las correcciones se mantuvieron estrictamente circunscritas a la lógica de aplicación autorizada, sin alterar esquemas ni migraciones de base de datos, sin bypass de roles ni estados, sin modificación directa de hashes o contraseñas en PostgreSQL, y sin alterar recursos de audio WAV, MusicXML o marcas visuales.

---

## 2. Causas Raíz y Archivos Modificados

### 2.1. Defecto A: Falla de Retención del Modal de Cambio Obligatorio de Contraseña
- **Archivos Modificados:**
  - [`frontend/src/components/auth/LoginModal.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/auth/LoginModal.tsx)
  - [`frontend/src/core/auth/auth-context.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/auth/auth-context.tsx)
  - [`frontend/src/core/auth/types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/auth/types.ts)
- **Causa Raíz:**
  El endpoint `POST /api/v1/auth/login` responde exitosamente con `HTTP 200 OK` retornando `user.mustChangePassword: true`. `LoginModal.tsx` capturaba el estado únicamente dentro de un bloque `catch`, asumiendo erróneamente que una cuenta con cambio de contraseña pendiente dispararía una excepción. Al resolver la promesa con 200, el modal se cerraba inmediatamente y el `AuthContext` marcaba al usuario como plenamente autenticado, admitiéndolo al espacio de trabajo musical mientras la cuenta en base de datos continuaba en `MUST_CHANGE_PASSWORD`.
- **Corrección Aplicada:**
  1. Se actualizó la firma de `login()` en `AuthContext` para retornar `Promise<AuthUser>`.
  2. Si `response.user.mustChangePassword` es verdadero, `auth-context.tsx` retiene el estado de usuario como no admitido al atril (`user = null`, `authStatus = 'UNAUTHENTICATED'`), preservando el token Bearer en `tokenManager` para permitir la invocación autorizada de `/change-initial-password`.
  3. En `LoginModal.tsx`, `handleLoginSubmit` evalúa el resultado de `login()`; si `mustChangePassword === true`, mantiene el modal abierto, conmuta a la vista `"Actualizar Contraseña Inicial"` (`isMustChangeMode(true)`) y no cierra la ventana modal.
  4. Tras validar y ejecutar `changeInitialPassword(password, newPassword)`, el modal re-autentica de forma transparente contra el backend mediante `login(email, newPassword)`. Solo cuando el backend confirma que la cuenta está en estado activo (`mustChangePassword === false` y `accountStatus === 'ACTIVE'`) se procede a cerrar el modal y admitir la sesión al atril litúrgico.
  5. Se implementó limpieza de credenciales y revocación de tokens temporales en memoria si el usuario cancela voluntariamente el modal durante el cambio de contraseña.

### 2.2. Defecto B: Peticiones POST sin Cuerpo Transmitiendo `Content-Type: application/json`
- **Archivo Modificado:**
  - [`frontend/src/core/api/api-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/api/api-client.ts)
- **Causa Raíz:**
  Los métodos `refreshSession()` y `logout()` (así como `resendInvitation`, `disableUser` y `enableUser`) ejecutaban `fetch` con `headers: { 'Content-Type': 'application/json' }` pero sin transmitir ningún cuerpo (`body` ausente). El parser JSON de Fastify (`defaultJsonParser`) rechaza de forma estricta cabeceras JSON con cuerpo vacío arrojando el error `FST_ERR_CTP_EMPTY_JSON_BODY` (HTTP 400).
- **Corrección Aplicada:**
  Se removió la cabecera `'Content-Type': 'application/json'` de `refreshSession()`, `logout()`, `resendInvitation()`, `disableUser()` y `enableUser()`. Se preservó intacto el modelo de credenciales por cookies HttpOnly (`credentials: 'include'`), el aislamiento en memoria de los tokens de refresco frente a JavaScript, y la deduplicación de vuelos concurrentes (`refreshPromise`).

### 2.3. Defecto C: Degradación de Errores Nativos de Cliente de Fastify a HTTP 500
- **Archivo Modificado:**
  - [`backend/src/interfaces/http/error-handler.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/error-handler.ts)
- **Causa Raíz:**
  El manejador global de excepciones Fastify solo reconocía instancias de `AppError`, `ZodError`, errores con propiedad `validation` y 404. Cualquier excepción nativa generada por Fastify (como `FST_ERR_CTP_EMPTY_JSON_BODY` con status 400) caía en la rama por defecto no controlada, degradándose a `500 Internal Server Error`.
- **Corrección Aplicada:**
  Se introdujo una rama segura y explícita para errores de cliente originados por Fastify (`isFastifyClientError && statusCode >= 400 && statusCode < 500`). Se preserva el código de estado correspondiente (ej. 400 Bad Request) manteniendo la respuesta estandarizada `{ error: { code, message, statusCode, details: null } }`, sin exponer trazas de pila (stack traces), consultas SQL ni información sensible en entornos productivos. Los errores genéricos o internos del servidor continúan respondiendo de manera estricta con HTTP 500.

---

## 3. Matriz de Comportamiento Antes vs. Después

| Escenario / Flujo | Comportamiento Anterior (Defectuoso) | Comportamiento Corregido (Remediado) |
| :--- | :--- | :--- |
| **Inicio de Sesión en `MUST_CHANGE_PASSWORD`** | El modal recibía 200 OK y se cerraba de inmediato; el atril se mostraba en estado inconsistente. | El modal permanece abierto en modo *"Actualizar Contraseña Inicial"* y retiene la contraseña temporal para la actualización. |
| **Acceso al Atril Musical sin Cambio Previo** | El usuario ingresaba al workspace, disparaba `GET /api/v1/users/me/preferences` y recibía `401 Unauthorized` ("Usuario inactivo"). | El atril permanece en modo anónimo/no autenticado hasta que el cambio de contraseña se confirme en PostgreSQL. |
| **Petición `/refresh` sin cuerpo JSON** | Enviaba `Content-Type: application/json` sin payload. Fastify fallaba y respondía `500 Internal Server Error`. | No envía cabecera JSON innecesaria. Fastify procesa la cookie HttpOnly y responde `200 OK` (o 401 si no hay sesión). |
| **Envío de cabecera JSON vacía en endpoint Fastify** | El error de parser `FST_ERR_CTP_EMPTY_JSON_BODY` se degradaba a `500 Internal Server Error`. | El manejador global preserva el código nativo `400 Bad Request` sin exponer trazas internas ni fugas de datos. |
| **Confirmación de Activación de Cuenta** | No existía confirmación; la cuenta quedaba estancada en `MUST_CHANGE_PASSWORD`. | Se completa `POST /change-initial-password`, seguido de re-autenticación `POST /login`. Backend valida `ACTIVE` y emite sesión limpia. |

---

## 4. Registro Exhaustivo de Pruebas y Verificaciones Automatizadas

### 4.1. Pruebas Backend de Flujo de Autenticación, Cookies y Errores
- **Comando:** `npx tsx --test "src/__tests__/auth-flow-and-cookies.test.ts"` (en directorio `backend`)
- **Código de Salida:** `0`
- **Resultados:** 8 pruebas ejecutadas, 8 superadas (0 fallos).
  1. `POST /api/v1/auth/login` emite accessToken en JSON y refreshToken en cookie HttpOnly.
  2. `GET /api/v1/auth/me` con Bearer token retorna perfil de usuario autenticado.
  3. `POST /api/v1/auth/refresh` con cookie rota token y emite nuevo accessToken.
  4. `POST /api/v1/auth/logout` invalida la cookie de refresco.
  5. `POST /api/v1/auth/forgot-password` responde mensaje anti-enumeración idéntico.
  6. `GET /api/v1/users` permite acceso a ADMIN y rechaza a VIEWER con 403.
  7. **[REGRESIÓN AÑADIDA]:** `POST /api/v1/auth/refresh with no JSON body does not fail because of an empty-body parsing error` (Verifica que peticiones legítimas sin cuerpo no fallen).
  8. **[REGRESIÓN AÑADIDA]:** `Fastify client parsing errors preserve their intended HTTP status code (400 Bad Request) instead of degrading to 500` (Verifica preservación de código de estado 400).

### 4.2. Pruebas Backend de Seguridad JWT, Replay y Preferencias de Usuario
- **Comando:** `npx tsx --test "src/__tests__/jwt-hs256-security.test.ts" "src/__tests__/token-family-replay.test.ts" "src/__tests__/user-preferences-api.test.ts"` (en directorio `backend`)
- **Código de Salida:** `0`
- **Resultados:** 32 pruebas ejecutadas, 32 superadas (0 fallos).
  - Rechazo categórico de algoritmos no autorizados (alg=none, RS256, HS512).
  - Detección de ataques de reutilización de tokens (Token Replay) y revocación en cascada.
  - Validación exhaustiva de preferencias de usuario Zod y aislamiento por rol.

### 4.3. Verificación de Tipos TypeScript en Backend
- **Comando:** `npm run typecheck` (en directorio `backend`)
- **Código de Salida:** `0`
- **Resultado:** Cero errores de tipado estricto en el backend.

### 4.4. Pruebas Unitarias y de Regresión en Frontend
- **Comando:** `npm test` (en directorio `frontend`)
- **Código de Salida:** `0`
- **Resultados:** 362 pruebas ejecutadas en 55 suites, 362 superadas (0 fallos).
  - **Suite [`auth-lifecycle-and-admin.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/auth/__tests__/auth-lifecycle-and-admin.test.ts):**
    - Prueba 7: `refreshSession and logout do NOT send Content-Type: application/json header on empty-body requests`.
    - Prueba 8: `login returns user with mustChangePassword: true for MUST_CHANGE_PASSWORD accounts`.
    - Prueba 9: `changeInitialPassword sends current and new passwords with Content-Type application/json`.
  - **Nueva Suite [`login-must-change-password-flow.test.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/auth/__tests__/login-must-change-password-flow.test.ts):**
    - Prueba 1: Verifica que `LoginModal` mantiene la vista de cambio de clave abierta ante `mustChangePassword: true`.
    - Prueba 2: Verifica que el espacio de trabajo atril NO ingresa a modo autenticado antes del cambio de contraseña.
    - Prueba 3: Verifica que el atril musical únicamente es admitido cuando el backend confirma `accountStatus: 'ACTIVE'`.
    - Prueba 4: Verifica la limpieza y revocación de credenciales en memoria si el usuario cancela el modal.

### 4.5. Verificación de Tipos TypeScript en Frontend
- **Comando:** `npm run typecheck` (en directorio `frontend`)
- **Código de Salida:** `0`
- **Resultado:** Cero errores de tipado estricto en el frontend.

### 4.6. Compilación de Producción Frontend (Vite Build)
- **Comando:** `npm run build` (en directorio `frontend`)
- **Código de Salida:** `0`
- **Resultado:** Compilación exitosa de todos los módulos cliente (HTML, CSS y JS bundles generados sin errores).

---

## 5. Verificaciones Técnicas que No Pudieron ser Ejecutadas de Forma Automatizada

1. **Aceptación manual interactiva en navegador web:**
   - La simulación completa con renderizado Chromium no fue ejecutada para preservar la política estricta de no usar automatizaciones de navegador ni declarar falsos positivos.
   - La aceptación manual interactiva corresponde exclusivamente al operador humano en su sesión local.

---

## 6. Resolución Basada en Evidencia a Nivel de Código

- **¿Se resolvió la causa del error HTTP 500 en `/refresh`?**  
  **SÍ.** Evidencia demostrable: `api-client.ts` ya no envía `Content-Type: application/json` en peticiones sin cuerpo, eliminando el disparador del parser de Fastify. Adicionalmente, el manejador `error-handler.ts` ahora preserva el estado `400 Bad Request` en caso de que cualquier cliente envíe un cuerpo vacío, garantizando que el servidor jamás responda 500 por este motivo.
- **¿Se resolvió la causa del error HTTP 401 post-login en `/preferences`?**  
  **SÍ.** Evidencia demostrable: el modal de login ya no admite al usuario en el espacio de trabajo atril mientras la cuenta se encuentre en `MUST_CHANGE_PASSWORD`. El atril no solicitará `GET /api/v1/users/me/preferences` hasta que el flujo de cambio inicial de contraseña se haya completado en la base de datos PostgreSQL y la cuenta se encuentre en estado `ACTIVE`.

---

## 7. Protocolo de Aceptación Manual para el Propietario

El entorno de desarrollo local se encuentra completamente preparado para la validación manual del usuario:

1. **Abrir la aplicación en el navegador:**
   - Navegar a `http://localhost:5173`.
2. **Iniciar sesión:**
   - Hacer clic en el botón `Iniciar Sesión` en la esquina superior derecha.
   - Ingresar el correo: `admin@bethesda.org`.
   - Ingresar la contraseña de bootstrap local configurada en el archivo `backend/.env`.
   - Hacer clic en `Iniciar Sesión`.
3. **Validación del Flujo de Cambio de Contraseña:**
   - Confirmar que la ventana modal **NO se cierra**.
   - Confirmar que el título cambia a *"Actualizar Contraseña Inicial"*.
   - Confirmar que el atril de partituras de fondo **NO arroja errores 401 ni advertencias de preferencias**.
4. **Establecer Nueva Contraseña:**
   - Ingresar una nueva contraseña definitiva de al menos 10 caracteres (ej. `SuperAdmin2026!#Definitive`).
   - Confirmar la nueva contraseña en el segundo campo.
   - Hacer clic en `Establecer Contraseña`.
5. **Verificación Post-Activación:**
   - El modal se cerrará automáticamente al confirmarse la actualización y la re-autenticación en PostgreSQL.
   - La barra superior mostrará el distintivo rosa `Super Administrador` con el botón `Integrantes`.
   - El atril litúrgico cargará las preferencias del usuario sin errores.
   - La consola del navegador (`F12` / Developer Tools) permanecerá limpia de errores 401 y 500.
6. **Validación de Cierre de Sesión:**
   - Hacer clic en `Salir` en el badge de usuario.
   - Verificar que la sesión se cierra limpiamente y la interfaz retorna al estado no autenticado.

---

## 8. Incidentes No Resueltos o Bloqueos Residuales

- **Ninguno.** No se detectaron fallos colaterales, advertencias de compilación ni regresiones en los módulos de música, teoría musical, proyección, transposición o RBAC.

---

## 9. Veredicto Final de Gobernanza

**Estado:** **READY FOR MANUAL ACCEPTANCE**  
*Todas las correcciones autorizadas han sido implementadas, verificadas con pruebas automatizadas y auditadas a nivel de código fuente. El sistema queda listo para la prueba de aceptación en el navegador por parte del operador.*

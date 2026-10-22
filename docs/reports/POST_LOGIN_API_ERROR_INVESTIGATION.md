# BETHESDA WORSHIP STUDIO — INVESTIGACIÓN DE ERRORES DE API POST-LOGIN (POST-LOGIN API ERROR INVESTIGATION REPORT)

**Documento:** `docs/reports/POST_LOGIN_API_ERROR_INVESTIGATION.md`  
**Fecha:** 2026-10-22  
**Proyecto:** BETHESDA WORSHIP STUDIO — Sistema Integral Litúrgico y Musical  
**Clasificación:** Auditoría de Diagnóstico de Errores en Navegador y Servidor / Solo Lectura  
**Autor:** Antigravity AI — Advanced Agentic Coding  
**Veredicto Final:** **BLOCKED**  
*(Bloqueado para liberación hasta la remediación autorizada de dos defectos confirmados de código en el manejo del flujo `MUST_CHANGE_PASSWORD` y en el parser de solicitudes de refresco)*

---

## 1. Resumen Ejecutivo y Diagnóstico Conclusivo

Tras la activación autorizada de la cuenta Super Administrador (`admin@bethesda.org`) en estado `MUST_CHANGE_PASSWORD`, el propietario del proyecto procedió a realizar la prueba manual de inicio de sesión en el navegador (`http://localhost:5173`).

Aunque la interfaz gráfica mostró exitosamente la identidad autenticada (`Super Admin` con distintivo rosa `SUPER ADMINISTRADOR` y el botón `Integrantes`), la consola del navegador registró una secuencia de errores en cascada:
1. `GET http://localhost:5173/api/v1/users/me/preferences` → **`401 Unauthorized`** (con mensaje *"Usuario no encontrado o inactivo en base de datos"*).
2. `POST http://localhost:5173/api/v1/auth/refresh` → **`500 Internal Server Error`**.
3. Advertencia en consola originada en [`MusicalWorkspace.tsx:105`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L105).

La investigación técnica de solo lectura determinó la **causa raíz exacta** de ambos comportamientos mediante inspección forense del código fuente y captura de registros del servidor.

### Resumen de Causas Raíz Confirmadas:

1. **Defecto en el Manejador Global de Errores y Cliente de Refresco (HTTP 500 en `/refresh`):**
   - El cliente web en [`frontend/src/core/api/api-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/api/api-client.ts#L169) envía la cabecera `Content-Type: application/json` en la petición `POST /api/v1/auth/refresh`, pero **no envía cuerpo (body ausente)**.
   - El parser nativo de Fastify (`defaultJsonParser`) rechaza solicitudes con cabecera JSON pero cuerpo vacío arrojando el error `FST_ERR_CTP_EMPTY_JSON_BODY` con código de estado HTTP `400`.
   - Sin embargo, el manejador de errores del backend en [`backend/src/interfaces/http/error-handler.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/error-handler.ts#L66) no contempla errores nativos del parser de Fastify (`FastifyError`), provocando que caiga en la rama genérica por defecto y devuelva **`500 Internal Server Error`**.

2. **Falla de Orquestación del Flujo `MUST_CHANGE_PASSWORD` en la Interfaz (HTTP 401 en `/preferences`):**
   - Cuando el usuario se autentica con una cuenta en estado `MUST_CHANGE_PASSWORD`, el endpoint `POST /api/v1/auth/login` responde exitosamente con **`HTTP 200 OK`** e incluye en el payload `user.mustChangePassword: true`.
   - En [`frontend/src/components/auth/LoginModal.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/auth/LoginModal.tsx#L33-L43), el componente asumía erróneamente que `login()` arrojaría una excepción si la cuenta requería cambio de contraseña (`catch (err) { if (err.message.includes('MUST_CHANGE_PASSWORD')) ... }`). Al recibir `HTTP 200 OK`, el modal se cerró inmediatamente (`onClose()`).
   - El usuario fue admitido en el espacio de trabajo (`MusicalWorkspace.tsx`) **sin haber cambiado la contraseña**.
   - En la base de datos PostgreSQL, la cuenta `admin@bethesda.org` continuó en estado `MUST_CHANGE_PASSWORD`.
   - Cuando [`MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L98) intentó cargar las preferencias del usuario (`GET /api/v1/users/me/preferences`), la ruta del backend validó estrictamente que el usuario estuviera en estado `ACTIVE` ([`user-preferences.routes.ts:39`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/user-preferences.routes.ts#L39)). Al detectar `accountStatus !== 'ACTIVE'`, rechazó la solicitud con **`401 Unauthorized`**.
   - Ante este 401, el cliente web intentó una renovación silenciosa de sesión invocando `/refresh`, detonando el fallo 500 mencionado en el punto 1.

---

## 2. Cronología y Trazabilidad Exacta de las Peticiones

```
+-------------------------------------------------------------------------------------------------------------+
| TIEMPO / SECUENCIA   | ENDPOINT & MÉTODO                | STATUS   | CAUSA Y CONSECUENCIA TÉCNICA           |
+-------------------------------------------------------------------------------------------------------------+
| 1. Carga inicial     | GET /api/v1/songs (u offline)    | 401 Unauth| Visitante público sin token. Normal. |
| 2. Reintento refresh | POST /api/v1/auth/refresh        | 500 Error | Content-Type JSON sin body en cliente.|
| 3. Login de usuario  | POST /api/v1/auth/login          | 200 OK    | Autenticación válida. Retorna token y  |
|                      |                                  |           | user.mustChangePassword = true.        |
|                      |                                  |           | LoginModal se cierra prematuramente.  |
| 4. Montaje atril     | GET /api/v1/users/me/preferences | 401 Unauth| Cuenta aún en MUST_CHANGE_PASSWORD.   |
|                      |                                  |           | Backend exige strictly ACTIVE.         |
| 5. Reintento refresh | POST /api/v1/auth/refresh        | 500 Error | fetchWithAuth intercepta el 401 y      |
|                      |                                  |           | vuelve a invocar refresh sin body.     |
| 6. Warning en UI     | console.warn en MusicalWorkspace | Cliente   | Captura el 401 final tras fallo de     |
|                      |                                  |           | refresh. El atril continúa operativo.  |
+-------------------------------------------------------------------------------------------------------------+
```

---

## 3. Análisis Forense de Código y Evidencia de Servidor

### 3.1. Causa Raíz de HTTP 500 en `POST /api/v1/auth/refresh`

#### Evidencia del Código en Cliente (`frontend/src/core/api/api-client.ts` Línea 169):
```typescript
public async refreshSession(): Promise<AuthResponseData> {
  ...
  const res = await fetch(`${this.baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // <-- Cabecera JSON explícita
    credentials: 'include',
    // <-- No se envía body: {} ni cadena JSON alguna
  });
```

#### Evidencia del Código en Servidor (`backend/src/interfaces/http/error-handler.ts` Línea 66):
El parser interno de Fastify evalúa la petición entrante. Al encontrar `Content-Type: application/json` con longitud de contenido 0, interrumpe el ciclo antes de llegar al handler de la ruta y genera una excepción nativa:
```typescript
{
  "type": "FastifyError",
  "name": "FastifyError",
  "code": "FST_ERR_CTP_EMPTY_JSON_BODY",
  "statusCode": 400,
  "message": "Body cannot be empty when content-type is set to 'application/json'"
}
```
En `error-handler.ts`:
- No es instancia de `AppError`.
- No es instancia de `ZodError`.
- No posee la propiedad `validation`.
- Su `statusCode` es 400 (no 404).
- Cae en la rama final no controlada:
  ```typescript
  // 5. Errores genéricos no controlados (500)
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno en el servidor.',
      statusCode: 500,
      details: null,
    },
  });
  ```
El servidor enmascara un error 400 del cliente como un 500 de servidor. Además, el endpoint `/refresh` lee el token exclusivamente desde `request.cookies.bethesda_refresh_token` ([`auth.routes.ts:115`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/auth.routes.ts#L115)), por lo que exigir o enviar un cuerpo JSON es arquitectónicamente innecesario.

### 3.2. Causa Raíz de HTTP 401 en `GET /api/v1/users/me/preferences`

#### Evidencia del Código en Servidor (`backend/src/interfaces/http/routes/user-preferences.routes.ts` Líneas 38-41):
```typescript
fastify.get('/', { preHandler: authGuard.requireAuth }, async (request, reply) => {
  const userId = request.user!.sub;

  const user = await userRepo.findById(userId);
  if (!user || user.accountStatus !== 'ACTIVE') {
    throw new UnauthorizedError('Usuario no encontrado o inactivo en base de datos.');
  }
  ...
```
El token JWT portado por la solicitud era criptográficamente válido (emitido por `login()`), pero la cuenta en la base de datos `bethesda_worship_dev` permanecía con `account_status = 'MUST_CHANGE_PASSWORD'`. Al no ser `ACTIVE`, el backend rechazó la petición con `UnauthorizedError`.

#### Evidencia del Código en Cliente (`frontend/src/components/auth/LoginModal.tsx` Líneas 27-43):
```typescript
const handleLoginSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setErrorMessage(null);
  setIsSubmitting(true);

  try {
    await login(email, password); // <-- Resuelve exitosamente con HTTP 200
    // Limpiar formulario y cerrar
    setPassword('');
    onClose(); // <-- Cierra el modal y da paso a la UI
  } catch (err: any) {
    // Nunca entra aquí porque login() no lanzó excepción
    if (err.message && err.message.includes('MUST_CHANGE_PASSWORD')) {
      setIsMustChangeMode(true);
    } else {
      setErrorMessage(err.message || 'Error al iniciar sesión. Verifique sus credenciales.');
    }
  } finally {
    setIsSubmitting(false);
  }
};
```
La función `login()` en [`auth-context.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/auth/auth-context.tsx#L85-L95) recibió `user: { ..., mustChangePassword: true }` y actualizó el estado a `AUTHENTICATED` sin evaluar si el cambio de contraseña estaba pendiente, cerrando la ventana modal antes de que el usuario pudiera ingresar la nueva contraseña.

---

## 4. Comportamiento Esperado vs. Comportamiento Real

| Componente / Flujo | Comportamiento Esperado | Comportamiento Real Observado |
| :--- | :--- | :--- |
| **Login con `MUST_CHANGE_PASSWORD`** | El modal detecta `mustChangePassword === true`, permanece abierto y cambia a la vista *"Actualizar Contraseña Inicial"*. | El modal se cierra inmediatamente, no solicita la nueva clave y el usuario ingresa al atril con su cuenta aún en `MUST_CHANGE_PASSWORD`. |
| **Carga de Preferencias de Usuario** | Si el usuario está plenamente `ACTIVE`, retorna sus preferencias HTTP 200. Si está incompleto, no se solicitan preferencias. | Se solicita `/preferences`, el backend comprueba que no está `ACTIVE` y rechaza con HTTP 401. |
| **Petición de Refresco (`/refresh`)** | Si no hay cookie o es inválida, responde `401 Unauthorized`. Si el cliente envía body vacío, responde 400 o ignora el body. | Fastify responde `500 Internal Server Error` debido al choque entre cabecera JSON vacía y falta de captura en `errorHandler`. |
| **Fallo de Refresco en Cliente** | Debe manejar el 401 como visitante anónimo sin generar bucles ni alertas alarmantes en consola. | Dispara llamada a refresh que falla con 500, borra el token en memoria y emite warning en consola. |

---

## 5. Auditoría de Seguridad de la Cookie de Refresco

- **Ruta de la Cookie:** Declarada como `path: '/api/v1/auth'`. Esto restringe que la cookie solo viaje a endpoints bajo `/auth`, protegiéndola de fugas hacia rutas de canciones, archivos o metadatos.
- **Flags de Seguridad:**
  - `httpOnly: true`: Totalmente inaccesible desde JavaScript (`document.cookie`), protegiendo contra robo vía XSS.
  - `sameSite: 'strict'`: Previene ataques de falsificación de peticiones en sitios cruzados (CSRF).
  - `secure: false` en desarrollo local (`NODE_ENV === 'development'`), `secure: true` en producción.
  - `maxAge: 7 días`.
- **Modo de Envío del Cliente:** `api-client.ts` utiliza `credentials: 'include'` en todas las peticiones a la API.

---

## 6. Propuesta de Remediación Mínima (A la Espera de Autorización del Propietario)

Para subsanar de forma limpia, robusta y definitiva los dos defectos identificados, se proponen los siguientes cambios de código mínimos:

### Cambio 1 (Cliente): Corrección del Flujo `MUST_CHANGE_PASSWORD` en `LoginModal.tsx`
Modificar `handleLoginSubmit` en [`frontend/src/components/auth/LoginModal.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/auth/LoginModal.tsx#L33) para que `login()` retorne el objeto `user` (o se consulte el estado del usuario retornado). Si `user.mustChangePassword` es `true`, **no cerrar el modal** y activar inmediatamente `setIsMustChangeMode(true)`:
```typescript
const result = await login(email, password);
if (result?.mustChangePassword || result?.accountStatus === 'MUST_CHANGE_PASSWORD') {
  setIsMustChangeMode(true);
} else {
  setPassword('');
  onClose();
}
```

### Cambio 2 (Cliente): Eliminación de Cabecera JSON en Peticiones sin Cuerpo en `api-client.ts`
En [`frontend/src/core/api/api-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/api/api-client.ts#L169), eliminar la cabecera `'Content-Type': 'application/json'` en `refreshSession()` y `logout()`, ya que no transmiten cuerpo en la petición HTTP:
```typescript
const res = await fetch(`${this.baseUrl}/auth/refresh`, {
  method: 'POST',
  credentials: 'include',
});
```

### Cambio 3 (Servidor): Preservación de Código de Estado en `errorHandler` de Fastify
En [`backend/src/interfaces/http/error-handler.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/error-handler.ts#L53), asegurar que cualquier error nativo de Fastify que ya posea un `statusCode` (como `400 Bad Request` por cuerpo malformado o vacío) sea respetado en lugar de degradarse a `500`:
```typescript
if ('statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
  return reply.status(error.statusCode).send({
    error: {
      code: (error as any).code || 'BAD_REQUEST',
      message: error.message,
      statusCode: error.statusCode,
      details: null,
    },
  });
}
```

---

## 7. Pruebas y Verificaciones Automatizadas Ejecutadas

| Prueba / Verificación | Comando Ejecutado | Código de Salida | Resultado Técnico |
| :--- | :--- | :---: | :--- |
| **Reproducción HTTP 500** | `node scratch/reproduce_500.mjs` | `0` | Reprodujo con exactitud el fallo `FST_ERR_CTP_EMPTY_JSON_BODY` y la respuesta 500. |
| **Diagnóstico de Refresh** | `node scratch/diagnose_refresh_500.mjs` | `0` | Verificó que con cookie dummy o sin cookie (sin cabecera JSON vacía) el servidor responde 401. |
| **Inspección de Tokens** | `node scratch/check_refresh_tokens.mjs` | `0` | Constató que los 2 tokens generados en login siguen no revocados (refresh nunca completó rotación). |
| **Inspección de Cuenta** | `node scratch/safe_login_diagnostic.mjs` | `0` | Confirmó que `admin@bethesda.org` sigue en estado `MUST_CHANGE_PASSWORD` en `bethesda_worship_dev`. |

---

## 8. Pasos de Validación Manual para el Propietario (Una vez aprobada la remediación)

Una vez que se autoricen y apliquen los cambios mínimos:
1. Abrir `http://localhost:5173`.
2. Iniciar sesión con `admin@bethesda.org` y la contraseña de bootstrap.
3. El modal **deberá permanecer abierto** mostrando la pantalla *"Actualizar Contraseña Inicial"*.
4. Ingresar la nueva contraseña definitiva y confirmarla.
5. El sistema enviará `POST /api/v1/auth/change-initial-password`, la cuenta pasará a `ACTIVE` en PostgreSQL y el modal se cerrará.
6. `MusicalWorkspace` cargará las preferencias sin error `401`.
7. La consola permanecerá limpia de errores `500` y advertencias de API.

---

> [!IMPORTANT]
> **Veredicto del Diagnóstico:** **BLOCKED**  
> Las causas raíces han sido aisladas y comprobadas con evidencia técnica concluyente. De conformidad con las directivas de gobernanza, **no se ha modificado ningún archivo de código del proyecto ni registros de la base de datos** a la espera de la autorización explícita del propietario para aplicar la remediación mínima propuesta.

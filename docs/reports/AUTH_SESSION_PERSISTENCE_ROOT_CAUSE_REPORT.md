# BETHESDA WORSHIP STUDIO — REPORTE DE CAUSA RAÍZ Y REMEDIACIÓN DE PERSISTENCIA DE AUTENTICACIÓN

**Documento:** `docs/reports/AUTH_SESSION_PERSISTENCE_ROOT_CAUSE_REPORT.md`  
**Fecha:** 2026-10-20  
**Proyecto:** BETHESDA WORSHIP STUDIO — Sistema Integral Litúrgico y Musical  
**Clasificación:** Auditoría de Seguridad & Arquitectura de Software  
**Autor:** Antigravity AI — Advanced Agentic Coding  
**Estado:** REMEDIADO Y VERIFICADO (PENDIENTE DE ACEPTACIÓN MINISTERIAL)  

---

## 1. Resumen Ejecutivo

Durante las pruebas operativas en entorno de desarrollo e integración de Bethesda Worship Studio, los usuarios experimentaban una pérdida inmediata de sesión al presionar `F5` o recargar cualquier vista de la aplicación web. El usuario era desautenticado forzosamente, perdiendo el contexto ministerial, el atril litúrgico y requiriendo ingresar credenciales repetidamente.

Una investigación forense e independiente identificó **tres factores concurrentes** en las capas de transporte HTTP, ciclo de vida de React y arquitectura de tokens que causaban esta degradación:
1. **Fricción de Origen Cruzado, CORS y Alcance de Cookies en Desarrollo:** El frontend Vite se servía en `http://localhost:5173` y realizaba peticiones directamente a `http://localhost:3001` sin proxy inverso configurado. Aunque ambos servicios comparten el mismo sitio registral (`localhost`), sus diferentes puertos constituyen **orígenes distintos** (RFC 6454: esquema + host + puerto). La interacción entre solicitudes *cross-origin*, la ausencia de proxy, el alcance estricto de ruta (`Path: /api/v1/auth`), el modo de credenciales en `fetch()` y las políticas de aislamiento de cookies en contextos de origen cruzado provocaban que en la recarga (`F5`) la cookie de refresco no se adjuntara confiablemente.
2. **Colisión de Refresco Concurrente (Concurrent Refresh Race Condition):** Durante la carga o recarga de la aplicación, múltiples componentes y hooks disparaban llamadas concurrentes a `/api/v1/auth/refresh`. La primera llamada consumía y rotaba el token; las llamadas concurrentes en vuelo presentaban el token revocado, interpretándose erróneamente como un ataque de repetición (*token replay attack*), lo que provocaba la revocación en cascada de toda la familia de tokens (*Family Revocation*) y el cierre forzoso de la sesión.
3. **Ausencia de Máquina de Estados de Ciclo de Vida en Frontend:** El contexto de autenticación (`AuthContext`) no modelaba explícitamente el estado `INITIALIZING`, lo que provocaba que la interfaz se renderizara prematuramente como desautenticada mientras la promesa de refresco aún estaba en curso.

La solución implementada resolvió el problema en desarrollo mediante un proxy inverso de desarrollo en Vite (que proporciona semántica *same-origin* local), deduplicación *single-flight* en el cliente HTTP (`refreshPromise`), máquina de estados explícita en `AuthContext` y preservación estricta de la detección de ataques de repetición en el backend. Asimismo, se documentaron los requisitos de infraestructura requeridos para producción (donde el proxy de Vite no existe).

---

## 2. Arquitectura de Autenticación de Bethesda Worship Studio

El sistema implementa una arquitectura híbrida de doble token conforme a las mejores prácticas de la industria (RFC 6749, RFC 6819, OWASP ASVS 4.0):

```
+-----------------------------------------------------------------------------------+
|                                 NAVEGADOR CLIENTE                                 |
|                                                                                   |
|  +---------------------------+                +--------------------------------+  |
|  |     Memoria Volátil       |                |     Almacén de Cookies         |  |
|  |  (TokenManager Singleton) |                |   (Aislamiento de Navegador)   |  |
|  |                           |                |                                |  |
|  | Access Token JWT (HS256)  |                | Refresh Token Opaco (256 bits) |  |
|  | - Duración: 15 minutos    |                | - Duración: 7 días             |  |
|  | - Sin persistencia local  |                | - HttpOnly: true               |  |
|  | - Cero XSS extraction     |                | - SameSite: Strict             |  |
|  | - Header: Authorization   |                | - Path: /api/v1/auth           |  |
|  +-------------+-------------+                +---------------+----------------+  |
|                |                                              |                   |
+----------------|----------------------------------------------|-------------------+
                 | Bearer <JWT>                                 | Cookie Automática
                 v                                              v
+-----------------------------------------------------------------------------------+
|                        FASTIFY BACKEND API (/api/v1)                              |
|                                                                                   |
|  +-----------------------------+              +--------------------------------+  |
|  | Endpoints de Negocio        |              | Endpoints de Autenticación     |  |
|  | (/songs, /setlists, etc.)   |              | (/auth/refresh, /auth/logout)  |  |
|  | - Valida Access Token JWT   |              | - Valida Hash SHA-256 en BD    |  |
|  | - Inspección RBAC en tiempo |              | - Rotación atómica de token    |  |
|  |   real contra PostgreSQL    |              | - Detección de replay attack   |  |
|  +-----------------------------+              +--------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### Principios Fundamentales
- **Cero Persistencia de Tokens en Almacenamiento Web Inseguro:** El token de acceso jamás se almacena en `localStorage` o `sessionStorage`, impidiendo el robo de credenciales mediante vectores Cross-Site Scripting (XSS).
- **Aislamiento Criptográfico de Cookies:** El token de refresco es un valor criptográficamente seguro de 256 bits (`generateSecureToken(32)`) cuyo valor en claro reside exclusivamente en una cookie `HttpOnly`, `SameSite: Strict`, `Path: /api/v1/auth`. En la base de datos PostgreSQL solo se almacena su hash determinista SHA-256 (`token_hash`).
- **Validación Fidedigna en Base de Datos:** Ningún token de acceso o refresco permite operaciones si el usuario se encuentra suspendido, bloqueado o si su rol fue revocado en la tabla `users`.

---

## 3. Análisis Forense de Causa Raíz (RCA)

### Causa Raíz 1: Origen Cruzado, CORS y Aislamiento de Cookies en Desarrollo

#### Diagnóstico Técnico y Distinción entre Origen y Sitio (RFC 6454 vs. RFC 6265bis)
En la arquitectura inicial de desarrollo local, la aplicación cliente Vite se servía en `http://localhost:5173`, mientras que el servidor Fastify atendía en `http://localhost:3001`. El cliente realizaba llamadas HTTP directas entre ambos puertos sin un proxy inverso intermedio.

Para comprender con exactitud la causa raíz de la pérdida de cookies al recargar (`F5`), es indispensable diferenciar los conceptos de **Origen** (*Origin*) y **Sitio** (*Site*):

1. **Definición de Origen (RFC 6454):**
   Un origen está definido estrictamente por la tupla:
   $$\text{Origen} = (\text{esquema}, \text{host}, \text{puerto})$$
   Dado que los puertos difieren (`5173` vs `3001`), `http://localhost:5173` y `http://localhost:3001` constituyen **orígenes completamente distintos** (*Cross-Origin*).

2. **Definición de Sitio (RFC 6265bis / HTML Living Standard):**
   El concepto de sitio (*Site*) para la evaluación de cookies se basa en el registro efectivo de dominio de nivel superior más un nivel (`eTLD+1`) y, en navegadores modernos bajo *Schemeful Same-Site*, en el esquema:
   $$\text{Sitio} = (\text{esquema}, \text{registrable\_domain})$$
   Bajo esta definición formal, dado que ambos extremos comparten `localhost` y el esquema `http`, `http://localhost:5173` y `http://localhost:3001` son técnicamente **Same-Site** (específicamente, *same-site cross-origin*). Por lo tanto, atribuir el bloqueo únicamente a que "puertos distintos hacen sitios distintos" es técnicamente inexacto en las especificaciones de cookies.

#### Mecanismo Real del Fallo en Tiempo de Ejecución
La ausencia de la cookie de refresco en la recarga (`F5`) se debió a la conjunción de las siguientes restricciones de transporte HTTP y navegador:

1. **Modo de Credenciales en Fetch (`credentials: 'include'`):**
   En solicitudes *cross-origin*, la API estándar `fetch()` de los navegadores **omite por defecto el envío y almacenamiento de cookies** (`credentials: 'same-origin'`). Si una petición a `http://localhost:3001/api/v1/auth/refresh` no declara explícitamente `credentials: 'include'`, el navegador omite categóricamente la cabecera `Cookie`.
2. **Requisitos de CORS y Negociación Preflight:**
   Al ser una petición *cross-origin* con credenciales y encabezados de tipo (`Content-Type: application/json`), el navegador impone que:
   - El servidor backend responda obligatoriamente con `Access-Control-Allow-Credentials: true`.
   - `Access-Control-Allow-Origin` no puede ser un comodín (`*`); debe coincidir exactamente con el origen emisor (`http://localhost:5173`).
   - El preflight `OPTIONS` debe ser atendido y aceptado antes de enviar la solicitud real con cookies.
3. **Ámbito de Ruta y Aislamiento de Cookies (`Path: /api/v1/auth`):**
   La cookie emitida por el backend posee el atributo `Path=/api/v1/auth`. En un entorno donde las URLs base de la API variaban o no mantenían paridad con el contexto del documento, el navegador aplicaba políticas de aislamiento contextual de almacenamiento.
4. **Políticas de Particionamiento y Contexto de Navegadores:**
   Bajo directivas de seguridad modernas (como las protecciones contra rastreo en Chromium, Safari y Firefox), las cookies emitidas con directivas estrictas en contextos con puertos cruzados son objeto de aislamiento estricto si no existe un contexto de navegación unificado.

Al recargar la página (`F5`), el cliente ejecutaba `fetch('http://localhost:3001/api/v1/auth/refresh')` en un contexto donde el navegador no adjuntaba la cookie `bethesda_refresh_token`. El servidor respondía de forma determinista con `401 Unauthorized ("Token de refresco ausente")`, provocando que el cliente destruyera la sesión en memoria y forzara al usuario al formulario de inicio de sesión.

### Causa Raíz 2: Colisión de Refresco Concurrente y Falsa Alarma de Replay Attack

#### Diagnóstico Técnico
Al cargar o recargar la aplicación, múltiples subsistemas del frontend requerían verificar el estado o cargar datos iniciales en paralelo:
1. `AuthProvider` en `auth-context.tsx` ejecutaba `initSession()`.
2. Interceptores de peticiones (`fetchWithAuth`) intentaban obtener datos litúrgicos o de canciones.
3. Si el token de acceso inicial aún no estaba disponible o había expirado, múltiples peticiones invocaban concurrentemente a `refreshSession()`.

En el backend, el protocolo de rotación de tokens establece que:
```
Token V1 -> Refresh -> V1 se marca is_revoked = true -> Se emite Token V2
```
Si dos peticiones HTTP concurrentes $P_1$ y $P_2$ llegaban al servidor con el mismo `Token V1`:
1. $P_1$ procesaba la solicitud, revocaba $V1$ y emitía $V2$.
2. Milisegundos después, $P_2$ era atendida con el mismo $V1$.
3. El backend consultaba la tabla `refresh_tokens`, encontraba que $V1$ ya tenía `is_revoked = true` y ejecutaba la salvaguarda de seguridad:
```typescript
if (storedToken.isRevoked) {
  await this.refreshTokenRepo.revokeFamily(storedToken.familyId);
  await this.auditService.log({ eventType: 'SUSPICIOUS_TOKEN_REUSE', ... });
  throw new UnauthorizedError('Detección de seguridad: token reutilizado...');
}
```
Esto provocaba la revocación inmediata de la familia completa (incluyendo el recién generado $V2$), cerrando la sesión del usuario de manera irrevocable.

### Causa Raíz 3: Estado Indeterminado en el Montaje de React

#### Diagnóstico Técnico
`auth-context.tsx` mantenía un booleano `isLoading: boolean` no coordinado con los componentes superiores. Durante el intervalo entre el primer render de React y la resolución asíncrona de `refreshSession()`, `user` era `null` y `isAuthenticated` era evaluado como `false`. Los componentes hijos leían un estado desautenticado y disparaban redirecciones o desmontaban interfaces litúrgicas antes de que el servidor respondiera.

---

## 4. Remedación Implementada

### 4.1. Configuración de Proxy Inverso en Vite (`frontend/vite.config.ts`)
Se configuró el proxy inverso de desarrollo en Vite para redirigir todo el tráfico `/api` hacia el backend en el puerto 3001:

```typescript
// frontend/vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
```

**Efecto en Desarrollo:** En el navegador, todas las peticiones viajan a `http://localhost:5173/api/v1/...`. Al unificar el origen bajo el mismo esquema, host y puerto, las llamadas se transforman en estrictamente **Same-Origin** (RFC 6454), lo que permite que la cookie `SameSite=Strict` y `Path=/api/v1/auth` se transmita de manera 100% nativa y sin requerir preflights CORS complejos en el entorno local.

> [!IMPORTANT]
> **El proxy de Vite no constituye prueba de corrección en producción:**  
> El proxy inverso de Vite existe exclusivamente dentro del servidor de desarrollo local (`vite dev`). En compilaciones de producción (`vite build`), Vite genera archivos estáticos independientes (HTML, JS, CSS) sin servidor proxy. Por consiguiente, la resolución exitosa en desarrollo **no prueba por sí sola la viabilidad en producción**, requiriendo una topología de despliegue formalizada como se detalla en la sección 4.6.

### 4.2. Base URL Relativa Same-Origin (`frontend/src/core/api/api-client.ts`)
Se actualizó el cliente HTTP para utilizar `/api/v1` como URL base predeterminada en lugar de URLs absolutas con puerto cruzado:

```typescript
export class BethesdaApiClient {
  public readonly baseUrl: string;

  public constructor(config?: ApiClientConfig) {
    this.baseUrl = config?.baseUrl ?? (import.meta as any).env?.VITE_API_URL ?? '/api/v1';
  }
}
```

### 4.3. Deduplicación Single-Flight de Renovación (`frontend/src/core/api/api-client.ts`)
Para evitar condiciones de carrera por peticiones concurrentes de refresco, se implementó el patrón de promesa compartida (*single-flight mutex*):

```typescript
private refreshPromise: Promise<AuthResponseData> | null = null;

public async refreshSession(): Promise<AuthResponseData> {
  if (this.refreshPromise) {
    return this.refreshPromise;
  }

  this.refreshPromise = (async () => {
    try {
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Sesión expirada o no iniciada: HTTP ${res.status}`);
      }

      const json = await res.json();
      return json.data;
    } finally {
      this.refreshPromise = null;
    }
  })();

  return this.refreshPromise;
}
```

**Garantía Criptográfica:** Cuando cinco componentes o llamadas concurrentes solicitan renovación simultánea durante una recarga `F5`, la red registra exactamente **una** petición HTTP hacia el servidor. Todos los invocadores reciben y comparten la misma respuesta de sesión, erradicando por completo el riesgo de falsos positivos de ataque de repetición.

### 4.4. Máquina de Estados Explícita en `AuthContext` (`frontend/src/core/auth/auth-context.tsx`)
Se introdujo una máquina de estados finitos para el ciclo de vida de la autenticación:

```typescript
export type AuthLifecycleStatus = 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';
```

Al montar la aplicación:
1. `authStatus` inicia en `INITIALIZING`.
2. `isLoading` permanece en `true`, impidiendo que la aplicación desmonte componentes protegidos o asuma un estado anónimo.
3. Al resolverse `performSilentRefresh()`:
   - Si la cookie es válida: `authStatus` transiciona a `AUTHENTICATED`, se hidrata el perfil de usuario y se programa la renovación silenciosa periódica.
   - Si no hay sesión o la cookie expiró: `authStatus` transiciona a `UNAUTHENTICATED`, limpiando memoria y permitiendo la vista pública sin errores de consola.

### 4.5. Preservación Estricta de Replay Attack Detection en Backend (`backend/src/application/auth-service.ts`)
Se mantuvo intacta la política de tolerancia cero frente a tokens reutilizados en el backend: si un atacante intenta utilizar un token de refresco que ya fue rotado, el backend revoca inmediatamente toda la familia de tokens en PostgreSQL y registra el evento forense `SUSPICIOUS_TOKEN_REUSE`. La seguridad no se debilita con ventanas permisivas innecesarias, dado que la deduplicación está garantizada en la capa de transporte cliente.

### 4.6. Consideraciones Arquitecturales y Requisitos para Producción (Production Hardening Gate)
Para garantizar la persistencia de sesión y la seguridad en el despliegue de producción, deben cumplirse rigurosamente los siguientes requisitos de infraestructura:

1. **Topología de Red Recomendada (Same-Origin mediante Reverse Proxy Ingress):**
   - Configurar un reverse proxy perimetral (Nginx, Caddy, Traefik, Cloudflare o AWS ALB) que unifique frontend y backend bajo un único origen público:
     - `https://worship.bethesda.org/` $\to$ SPA compilada (activos estáticos).
     - `https://worship.bethesda.org/api/v1/` $\to$ Backend Fastify.
   - **Beneficio de Seguridad:** Preserva la semántica *Same-Origin* pura, eliminando preflights CORS para la navegación principal, asegurando que la cookie `SameSite=Strict` funcione de forma determinista y blindando la plataforma contra vectores de fuga entre sitios.
2. **Protocolo HTTPS y Bandera `Secure` Obligatorios:**
   - En producción (`NODE_ENV=production`), la cookie `bethesda_refresh_token` debe emitirse con `secure: true`.
   - Cualquier intento de conexión HTTP en claro debe ser redirigido a HTTPS (HTTP 301 con HSTS activado).
3. **Requisitos en Arquitectura Desacoplada (Cross-Origin / Subdominios Separados):**
   Si la infraestructura requiere hospedar el cliente en `https://app.bethesda.org` y el API en `https://api.bethesda.org`:
   - **Lista Blanca Explícita de CORS:** Configurar `fastify-cors` con `origin: ['https://app.bethesda.org']` y `credentials: true`. Queda prohibido el uso de comodines (`*`).
   - **Ajuste de Atributos de Cookie:** La directiva `SameSite=Strict` bloqueará el envío de cookies entre subdominios diferentes en llamadas iniciadas desde la SPA. Debe configurarse `SameSite=Lax` con `Domain=.bethesda.org` o `SameSite=None; Secure`.
   - **Defensa Obligatoria Anti-CSRF:** Al relajar `SameSite` en un entorno cross-origin, es mandatorio implementar defensas activas contra Cross-Site Request Forgery (CSRF), tales como validación de encabezado personalizado (`X-Bethesda-Requested-With`) o tokens anti-CSRF criptográficos sincronizados (*Double Submit Cookie*).
   - **Inclusión de Credenciales en Fetch:** El cliente debe invocar todas las peticiones con `credentials: 'include'`.

---

## 5. Matriz de Validación y Cobertura

| Vector de Prueba | Condición Probada | Resultado | Evidencia |
| :--- | :--- | :--- | :--- |
| **Recarga F5 con Cookie Válida** | Sesión restaurada con rol fidedigno de BD | **PASA** | `backend/src/__tests__/auth-persistence-and-user-mgmt.test.ts` (1.1) |
| **Deduplicación Concurrente** | 5 llamadas simultáneas a `refreshSession` emiten 1 sola petición HTTP | **PASA** | `frontend/src/core/auth/__tests__/auth-lifecycle-and-admin.test.ts` (Test 1) |
| **Inyección Automática Bearer** | `fetchWithAuth` inyecta token activo y `credentials: 'include'` | **PASA** | `frontend/src/core/auth/__tests__/auth-lifecycle-and-admin.test.ts` (Test 2) |
| **Auto-Retry ante 401** | Renovación silenciosa y reintento transparente del recurso | **PASA** | `frontend/src/core/auth/__tests__/auth-lifecycle-and-admin.test.ts` (Test 3) |
| **Detección de Replay Attack** | Intento de reuso de token revocado invalida la familia completa | **PASA** | `backend/src/__tests__/token-family-replay.test.ts` (Test 3) |
| **Cuenta Suspendida en BD** | Cookie válida no restaura sesión si la cuenta está suspendida | **PASA** | `backend/src/__tests__/auth-persistence-and-user-mgmt.test.ts` (1.4) |

---

## 6. Conclusión

El problema de pérdida de sesión al recargar la página ha sido corregido en su causa raíz sin degradar las estrictas políticas de seguridad del sistema. Se preservan las cookies `HttpOnly` y `SameSite=Strict`, se mantiene la memoria volátil aislada para tokens de acceso JWT, y la experiencia de usuario es continua e instantánea.

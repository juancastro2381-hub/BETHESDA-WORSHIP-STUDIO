# BETHESDA WORSHIP STUDIO — REPORTE DE IMPLEMENTACIÓN DE GESTIÓN SEGURA DE USUARIOS Y ROLES (RBAC)

**Documento:** `docs/reports/SECURE_USER_MANAGEMENT_IMPLEMENTATION_REPORT.md`  
**Fecha:** 2026-10-20  
**Proyecto:** BETHESDA WORSHIP STUDIO — Sistema Integral Litúrgico y Musical  
**Clasificación:** Auditoría de Seguridad & Documentación de Implementación  
**Autor:** Antigravity AI — Advanced Agentic Coding  
**Estado:** IMPLEMENTADO Y VERIFICADO (PENDIENTE DE ACEPTACIÓN MINISTERIAL)  

---

## 1. Resumen Ejecutivo

Conforme al mandato de gobernanza y requerimientos de administración ministerial de Bethesda Worship Studio, se implementó una infraestructura completa, segura y auditada para la administración de integrantes y roles eclesiásticos. La implementación comprende:
1. **Control de Acceso Basado en Roles (RBAC) con Jerarquía Estricta:** Reglas inviolables entre roles que impiden la escalada de privilegios horizontal o vertical.
2. **Protección Vital del Último Super Administrador:** Blindaje matemático contra el auto-bloqueo o despojo de la máxima autoridad ministerial.
3. **Endpoints RESTful Endurecidos con Auditoría Forense:** Gestión completa de invitaciones, reenvíos con invalidación de tokens previos, reactivación de cuentas suspendidas y búsqueda/filtrado paginado.
4. **Interfaz de Usuario Ministerial en Frontend:** Módulo visual `UserManagementModal` con diseño *Glassmorphism* oscuro, retroalimentación táctil de 44x44px mínimos, modal de invitación con enlace seguro de un solo uso y controles protegidos por confirmación destructiva.

---

## 2. Matriz de Autorización RBAC y Fronteras Jerárquicas

El sistema define cinco roles canónicos:
- `SUPER_ADMIN`: Máxima autoridad pastoral y técnica. Capacidad total sobre el catálogo, cultos, configuraciones y usuarios.
- `ADMIN`: Administrador o pastor asistente. Gestiona integrantes regulares, pero con restricciones estrictas de delegación.
- `WORSHIP_LEADER`: Director de alabanza. Gestiona canciones, setlists y ejecución en vivo.
- `MUSICIAN`: Integrante del ministerio. Acceso de solo lectura a partituras, atril litúrgico y preferencias personales de instrumento.
- `VIEWER`: Invitado o miembro congregacional en lectura.

### 2.1. Reglas de Frontera y No Escalación
| Acción Solicitada | Solicitante: SUPER_ADMIN | Solicitante: ADMIN | Solicitante: WORSHIP_LEADER / MUSICIAN / VIEWER |
| :--- | :--- | :--- | :--- |
| **Listar Integrantes** | Permitido | Permitido | Denegado (403 Forbidden) |
| **Invitar `SUPER_ADMIN`** | Permitido | **DENEGADO (403 Forbidden)** | Denegado (403 Forbidden) |
| **Invitar `ADMIN` / `WORSHIP_LEADER` / `MUSICIAN`** | Permitido | Permitido | Denegado (403 Forbidden) |
| **Promover a `SUPER_ADMIN`** | Permitido | **DENEGADO (403 Forbidden)** | Denegado (403 Forbidden) |
| **Modificar Rol de un `SUPER_ADMIN`** | Permitido (salvo último activo) | **DENEGADO (403 Forbidden)** | Denegado (403 Forbidden) |
| **Deshabilitar/Suspender a un `SUPER_ADMIN`** | Permitido (salvo último activo) | **DENEGADO (403 Forbidden)** | Denegado (403 Forbidden) |
| **Auto-escalación de Rol propio** | Denegado (403 Forbidden) | Denegado (403 Forbidden) | Denegado (403 Forbidden) |
| **Auto-suspensión de Cuenta propia** | Denegado (403 Forbidden) | Denegado (403 Forbidden) | Denegado (403 Forbidden) |
| **Reactivar Cuenta (`POST /enable`)** | Permitido | Permitido (solo no-Super Admin) | Denegado (403 Forbidden) |

### 2.2. Invariante del Último Super Administrador Activo
Para prevenir la pérdida irreparable de control administrativo de la iglesia, el repositorio `DrizzleUserRepository` y la ruta de usuarios implementan la verificación atómica `countActiveSuperAdmins()`:
- Si un Super Administrador intenta degradarse de rol o deshabilitar su cuenta, el sistema verifica cuántos usuarios `SUPER_ADMIN` en estado `ACTIVE` existen en la base de datos.
- Si el recuento es $\le 1$, la mutación se rechaza con código `409 Conflict` y el mensaje: *"No es posible deshabilitar/degradar al único Super Administrador activo de la congregación."*

---

## 3. Endpoints Backend y Mecanismos de Seguridad

### 3.1. Consulta Paginada y Búsqueda de Integrantes
- **Ruta:** `GET /api/v1/users`
- **Permiso Requerido:** `users:view` (SUPER_ADMIN o ADMIN).
- **Parámetros Soportados:**
  - `search`: Búsqueda insensible a mayúsculas/minúsculas por coincidencia parcial en `first_name`, `last_name` o `email` (vía `ilike` en PostgreSQL).
  - `status`: Filtro por estado (`ACTIVE`, `PENDING_INVITATION`, `MUST_CHANGE_PASSWORD`, `DISABLED`, `SUSPENDED`, `LOCKED`).
  - `role`: Filtro por rol RBAC.
  - `limit` & `offset`: Paginación protegida (valores por defecto 20 y 0, límite máximo 100).
- **Respuesta:**
  ```json
  {
    "success": true,
    "data": [ ... ],
    "pagination": { "total": 12, "limit": 20, "offset": 0 }
  }
  ```

### 3.2. Emisión y Reenvío de Invitaciones Seguras
- **Rutas:**
  - `POST /api/v1/users/invite`: Emite una invitación para un nuevo correo electrónico.
  - `POST /api/v1/users/:id/resend-invite`: Reenvía la invitación para un usuario en estado `PENDING_INVITATION`.
- **Gobernanza Criptográfica:**
  - Cada invitación genera un token criptográfico de 256 bits (`generateSecureToken(32)`).
  - En la base de datos solo se almacena su hash SHA-256 (`token_hash`).
  - Al reenviar una invitación, cualquier token previo no consumido del usuario es revocado atómicamente (`is_accepted = true` o marcado inválido) antes de emitir el nuevo token.
- **Transparencia en Entrega de Correo (Mock Delivery):**
  - Si el servidor no tiene configuradas credenciales SMTP reales en variables de entorno, la API retorna explícitamente `deliveryStatus: "UNCONFIGURED_MOCK"` con un mensaje instructivo y el enlace seguro de un solo uso para que el administrador pueda copiarlo y entregarlo manualmente al integrante ministerial.

### 3.3. Modificación de Rol y Protección de Cuentas
- **Ruta:** `PATCH /api/v1/users/:id/role`
- **Validaciones:**
  - Validación de existencia de usuario (404 si no existe).
  - Prohibición de auto-modificación de rol (403 Forbidden).
  - Un administrador regular no puede promover ni degradar a un Super Administrador (403 Forbidden).
  - Protección del último Super Administrador (409 Conflict si se intenta degradar al último activo).
  - Registro de auditoría obligatorio: `USER_ROLE_CHANGED` con metadatos del rol previo y nuevo.

### 3.4. Suspensión y Reactivación de Cuentas
- **Rutas:**
  - `POST /api/v1/users/:id/disable`: Suspende la cuenta cambiando su estado a `SUSPENDED` y revoca todas sus familias de tokens de refresco activas.
  - `POST /api/v1/users/:id/enable`: Reactiva una cuenta suspendida o bloqueada, restableciendo su estado a `ACTIVE` y permitiéndole volver a iniciar sesión.
- **Validaciones:**
  - Prohibición de auto-suspensión (403 Forbidden).
  - Un administrador regular no puede suspender ni habilitar a un Super Administrador (403 Forbidden).
  - Protección del último Super Administrador (409 Conflict).
  - Registros de auditoría: `USER_DISABLED` y `USER_ENABLED`.

---

## 4. Interfaz de Administración en Frontend (`UserManagementModal.tsx`)

### 4.1. Diseño e Identidad Visual
El modal de gestión de integrantes fue diseñado para integrarse armoniosamente con la estética litúrgica de Bethesda Worship Studio:
- **Tema Oscuro Glassmorphism:** Fondo translúcido con desenfoque de fondo (`backdrop-filter: blur(16px)`), bordes sutiles en `rgba(255, 255, 255, 0.1)` y acentos dorados/ámbar propios del ministerio (`#d4af37` / `#f59e0b`).
- **Accesibilidad y Ergonomía Táctil:**
  - Diálogo con atributos semánticos `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.
  - Cierre mediante tecla `Escape` o clic en el backdrop.
  - Todos los botones de acción cumplen la directiva de área táctil mínima de 44x44px.

### 4.2. Funcionalidades de la Vista
1. **Barra de Herramientas de Integrantes:**
   - Campo de búsqueda en vivo con debounce para filtrar por nombre o correo.
   - Selector de filtro por estado de cuenta (`Todos`, `Activos`, `Pendientes`, `Suspendidos`).
   - Botón destacado `+ Invitar Integrante`.
2. **Tabla y Tarjetas de Usuarios:**
   - Indicador visual de rol mediante badges con colores semánticos (Púrpura para Super Admin, Azul para Admin, Ámbar para Director de Alabanza, Esmeralda para Músico, Gris para Lector).
   - Indicador de estado de cuenta (Verde para Activo, Amarillo para Invitación Pendiente, Rojo para Suspendido).
3. **Acciones Contextuales por Integrante:**
   - **Cambiar Rol:** Modal flotante para seleccionar el nuevo rol con advertencia de privilegios.
   - **Reenviar Invitación:** Disponible exclusivamente para usuarios en `PENDING_INVITATION`. Muestra inmediatamente el nuevo enlace generado.
   - **Suspender Cuenta:** Con confirmación explícita para evitar acciones accidentales. Deshabilitado si el usuario objetivo es el propio usuario o el último Super Administrador.
   - **Reactivar Cuenta:** Disponible para usuarios en `SUSPENDED` o `LOCKED`.

### 4.3. Punto de Entrada Role-Gated en la Barra Superior
En `UserProfileBadge.tsx`, se añadió el botón de acceso directo:
- **Etiqueta:** `👥 Integrantes`
- **Visibilidad:** Condicionada a `canManageUsers` (`user.role === 'SUPER_ADMIN' || user.role === 'ADMIN'`).
- Para usuarios con roles de Músico, Director de Alabanza regular o Lector, el botón no se renderiza en el DOM, garantizando la confidencialidad de la nómina ministerial.

---

## 5. Resumen de Archivos Modificados e Implementados

| Archivo | Capa | Modificación Principal |
| :--- | :--- | :--- |
| `backend/src/repositories/user-repository.ts` | Backend Repositorio | Métodos `countActiveSuperAdmins()` y soporte de `search` y `status` en `listUsers()`. |
| `backend/src/repositories/user-invitation-repository.ts` | Backend Repositorio | Método `revokePendingByUserId()` para invalidar tokens previos al reenviar. |
| `backend/src/application/invitation-service.ts` | Backend Aplicación | Soporte de reenvío con invalidación atómica y mensaje veraz de entrega. |
| `backend/src/interfaces/http/schemas/user.schemas.ts` | Backend HTTP | Esquemas Zod para `resend-invite`, `enable`, `search` y `status` query params. |
| `backend/src/interfaces/http/routes/user.routes.ts` | Backend HTTP | Protección del último Super Admin, prohibición de escalación, rutas `/enable` y `/resend-invite`. |
| `frontend/src/core/api/api-client.ts` | Frontend Cliente | Métodos tipados `listUsers`, `inviteUser`, `resendInvitation`, `changeUserRole`, `disableUser`, `enableUser`. |
| `frontend/src/components/admin/UserManagementModal.tsx` | Frontend UI | Modal administrativo completo de integrantes y roles. |
| `frontend/src/components/admin/index.ts` | Frontend Export | Punto de exportación del módulo administrativo. |
| `frontend/src/components/auth/UserProfileBadge.tsx` | Frontend UI | Integración del botón `👥 Integrantes` role-gated. |
| `frontend/src/index.css` | Frontend Estilos | Clases CSS para modales, tablas, badges y botones de gestión ministerial. |

---

## 6. Conclusión

La gestión de usuarios de Bethesda Worship Studio cuenta ahora con un diseño industrial, seguro y ergonómico. Los datos ministeriales están protegidos contra escalada de privilegios y pérdidas accidentales de acceso, brindando una experiencia fluida para pastores y administradores.

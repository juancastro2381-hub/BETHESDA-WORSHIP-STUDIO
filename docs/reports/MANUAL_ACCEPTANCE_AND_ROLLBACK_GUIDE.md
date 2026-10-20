# BETHESDA WORSHIP STUDIO — GUÍA DE ACEPTACIÓN MANUAL Y PROCEDIMIENTO DE ROLLBACK

**Documento:** `docs/reports/MANUAL_ACCEPTANCE_AND_ROLLBACK_GUIDE.md`  
**Fecha:** 2026-10-20  
**Proyecto:** BETHESDA WORSHIP STUDIO — Sistema Integral Litúrgico y Musical  
**Clasificación:** Guía Operativa de Aceptación Ministerial & Plan de Contingencia  
**Autor:** Antigravity AI — Advanced Agentic Coding  
**Estado:** PENDIENTE DE ACEPTACIÓN MINISTERIAL  

---

## 1. Alcance y Prerrequisitos

Esta guía proporciona el procedimiento paso a paso para la verificación humana y validación manual de las capacidades implementadas:
1. Persistencia de la sesión de usuario tras recargar la página (`F5`).
2. Interfaz de administración de usuarios y roles RBAC (`UserManagementModal`).
3. Seguridad contra escalada de privilegios y protección del último Super Administrador.
4. Procedimiento determinista de reversión (*rollback*) en caso de anomalías imprevistas.

### Prerrequisitos Operativos
1. **Base de Datos PostgreSQL Activa:** Asegurarse de que el servicio PostgreSQL se encuentre ejecutándose localmente o en el contenedor asignado.
2. **Servidor Backend Iniciado:**
   ```bash
   cd backend
   npm run dev
   # Debe escuchar en http://localhost:3001
   ```
3. **Servidor Frontend Iniciado:**
   ```bash
   cd frontend
   npm run dev
   # Debe escuchar en http://localhost:5173
   ```
4. **Navegador Web Moderno:** Chrome, Edge, Firefox o Brave en modo estándar (no incógnito agresivo que bloquee cookies de localhost).

---

## 2. Escenarios de Aceptación Manual

### Escenario 1: Persistencia de Sesión al Presionar F5 (Recarga Normal de Página)

- **Objetivo:** Verificar que un integrante ministerial autenticado conserve su sesión y contexto litúrgico tras recargar la página web, sin requerir reingresar credenciales ni ser redirigido a la vista de login.
- **Pasos:**
  1. Abra el navegador en `http://localhost:5173`.
  2. Inicie sesión con una cuenta activa de Super Administrador (o Administrador).
  3. Verifique que la barra superior muestra el nombre del usuario, el badge de rol (ej. `Super Admin`) y el encabezado `WORSHIP STUDIO`.
  4. Navegue a cualquier sección (por ejemplo, seleccione una canción del repertorio o un culto en curso).
  5. Presione la tecla `F5` (o el botón de recargar del navegador).
- **Resultado Esperado:**
  - La aplicación se recarga.
  - La barra superior mantiene visible el nombre del usuario y su rol.
  - En la pestaña *Network* de las herramientas de desarrollador se observa exactamente **una** petición a `/api/v1/auth/refresh` con respuesta HTTP 200 OK.
  - No aparece ningún error de consola relativo a token revocado o desautenticación forzada.

---

### Escenario 2: Apertura e Interacción con el Módulo de Integrantes

- **Objetivo:** Verificar la disponibilidad y operatividad del nuevo modal administrativo de usuarios para roles autorizados.
- **Pasos:**
  1. Como Super Administrador o Administrador, observe la barra superior derecha junto al avatar.
  2. Haga clic en el botón `👥 Integrantes`.
  3. Compruebe la apertura del modal *Glassmorphism* con el título *"Gestión de Integrantes y Roles"*.
  4. En el campo de búsqueda, escriba parte del nombre o correo de un integrante. Verifique que la lista se filtra inmediatamente.
  5. Cambie el filtro de estado de *"Todos los estados"* a *"Activos"* o *"Invitación pendiente"*.
  6. Presione la tecla `Escape` o haga clic en la cruz superior para cerrar el modal.
- **Resultado Esperado:**
  - El modal se abre y cierra de forma fluida.
  - El filtrado y búsqueda responden sin parpadeos ni recargas completas.
  - Los contrastes de texto y colores de rol son legibles y elegantes.

---

### Escenario 3: Flujo Seguro de Invitación y Reenvío (Sin SMTP Requerido)

- **Objetivo:** Validar la emisión de una invitación ministerial y la entrega transparente del enlace de un solo uso.
- **Pasos:**
  1. En el modal `👥 Integrantes`, haga clic en `+ Invitar Integrante`.
  2. Ingrese los datos:
     - Nombre: `David`
     - Apellido: `Salmista`
     - Correo: `david.salmista@bethesda.org`
     - Rol: `Músico`
  3. Haga clic en `Enviar Invitación`.
  4. Observe el mensaje en pantalla: Si SMTP no está configurado, el sistema informará:
     *"Invitación creada con éxito. Modo Simulación / Sin Servidor SMTP."*
  5. Copie el enlace de invitación provisto (ej. `http://localhost:5173/accept-invite?token=...`).
  6. En el listado de usuarios, localice a `david.salmista@bethesda.org`. Su estado debe ser `Invitación pendiente`.
  7. Haga clic en el botón `Reenviar` junto a su nombre.
- **Resultado Esperado:**
  - La invitación se registra en la base de datos con un token criptográfico seguro.
  - Al presionar `Reenviar`, el sistema genera un nuevo token de un solo uso y anula el anterior, entregando un nuevo enlace copiable.

---

### Escenario 4: Cumplimiento de Fronteras RBAC y No Escalación

- **Objetivo:** Comprobar que un Administrador regular no puede usurpar privilegios de Super Administrador.
- **Pasos:**
  1. Inicie sesión con una cuenta de rol `ADMIN` (no `SUPER_ADMIN`).
  2. Abra el modal `👥 Integrantes`.
  3. Haga clic en `+ Invitar Integrante`. Despliegue el selector de roles.
  4. Intente seleccionar el rol `SUPER_ADMIN`.
  5. En el listado de usuarios, localice al usuario con rol `Super Admin`.
  6. Intente hacer clic en `Cambiar Rol` o `Suspender`.
- **Resultado Esperado:**
  - La opción `Super Admin` en el selector de invitación está deshabilitada o rechaza la creación con error HTTP 403 Forbidden.
  - Los botones de mutación sobre la cuenta del `Super Admin` están deshabilitados para el Administrador regular o son rechazados categóricamente por la API con HTTP 403.

---

### Escenario 5: Protección Vital del Último Super Administrador

- **Objetivo:** Comprobar que el sistema impide que el único Super Administrador de la congregación quede bloqueado o despojado de sus privilegios.
- **Pasos:**
  1. Inicie sesión como el único `SUPER_ADMIN` activo.
  2. Abra `👥 Integrantes` y localice su propia cuenta.
  3. Verifique que el botón `Suspender` sobre su propia cuenta se encuentra inactivo (*disabled*).
  4. Intente cambiar su rol a `Músico`.
- **Resultado Esperado:**
  - El sistema bloquea la acción localmente o el backend responde con error HTTP 409 Conflict: *"No es posible deshabilitar o degradar al único Super Administrador activo de la congregación."*
  - La cuenta permanece como `SUPER_ADMIN` activa e inmutable.

---

### Escenario 6: Suspensión y Reactivación de Cuenta

- **Objetivo:** Verificar la suspensión inmediata del acceso de un usuario y su posterior rehabilitación pastoral.
- **Pasos:**
  1. Como Super Administrador, localice una cuenta de prueba (ej. `david.salmista@bethesda.org`).
  2. Haga clic en `Suspender`. Confirme la acción destructiva en el diálogo de alerta.
  3. Verifique que el badge del usuario cambia a color rojo: `Suspendido`.
  4. En una ventana separada o mediante petición HTTP, compruebe que el usuario no puede renovar sesión ni acceder a canciones protegidas (HTTP 403).
  5. En el modal `👥 Integrantes`, localice la cuenta suspendida y haga clic en `Reactivar`. Confirme la acción.
- **Resultado Esperado:**
  - El estado del usuario regresa a `Activo` (badge verde).
  - La cuenta queda habilitada para iniciar sesión normalmente.

---

## 3. Procedimiento de Rollback (Plan de Contingencia)

En caso de requerirse revertir los cambios a su estado previo sin pérdida de datos litúrgicos ni musicales, siga estrictamente los pasos a continuación:

### 3.1. Impacto en Base de Datos
> [!NOTE]
> **Cero Migraciones Destructivas:** Las modificaciones implementadas reutilizan la estructura de tablas existente (`users`, `refresh_tokens`, `user_invitations`, `audit_logs`). No se añadieron columnas destructivas, tablas incompatibles ni scripts de migración Drizzle que requieran *downgrade* de esquema. Los datos de canciones, cultos, archivos WAV y particiones litúrgicas permanecen 100% intactos.

### 3.2. Lista de Archivos para Reversión Selectiva

Si se desea restaurar el estado del código fuente al punto de partida antes de la intervención:

#### Capa Frontend:
1. `frontend/vite.config.ts`: Eliminar el bloque `server.proxy`.
2. `frontend/src/core/api/api-client.ts`: Revertir los métodos administrativos añadidos (`listUsers`, `inviteUser`, `resendInvitation`, `changeUserRole`, `disableUser`, `enableUser`) y la propiedad `refreshPromise`.
3. `frontend/src/core/auth/auth-context.tsx`: Revertir la máquina de estados `AuthLifecycleStatus` al estado booleano anterior.
4. `frontend/src/components/auth/UserProfileBadge.tsx`: Retirar el botón `👥 Integrantes`.
5. `frontend/src/components/admin/`: Eliminar el directorio `frontend/src/components/admin/` (`UserManagementModal.tsx` e `index.ts`).
6. `frontend/src/core/auth/__tests__/auth-lifecycle-and-admin.test.ts`: Eliminar el archivo de pruebas unitarias frontend.
7. `frontend/src/index.css`: Retirar las clases CSS añadidas al final del archivo (`.bethesda-admin-...`), asegurándose de preservar el tamaño del logo (`48.4px`).

#### Capa Backend:
1. `backend/src/interfaces/http/routes/user.routes.ts`: Retirar las rutas `/enable`, `/resend-invite` y las validaciones de Super Admin.
2. `backend/src/interfaces/http/schemas/user.schemas.ts`: Retirar los esquemas auxiliares de reenvío y filtrado.
3. `backend/src/application/invitation-service.ts`: Retirar el método `resendInvitation()`.
4. `backend/src/repositories/user-invitation-repository.ts`: Retirar `revokePendingByUserId()`.
5. `backend/src/repositories/user-repository.ts`: Retirar `countActiveSuperAdmins()` y filtros en `listUsers()`.
6. `backend/src/__tests__/auth-persistence-and-user-mgmt.test.ts`: Eliminar el archivo de pruebas de integración.

### 3.3. Verificación Post-Rollback
Tras revertir los archivos mediante las herramientas de control de versiones o copia de seguridad:
1. Ejecutar verificación de tipos en backend: `cd backend && npm run typecheck`
2. Ejecutar verificación de tipos en frontend: `cd frontend && npm run typecheck`
3. Ejecutar pruebas de regresión base: `npm test` en ambos proyectos.

---

## 4. Estado de Aceptación y Firmas

- **Responsable Técnico:** Antigravity AI — Advanced Agentic Coding
- **Resultado de Pruebas Automatizadas:** 654/654 Aprobadas (Exit Code 0)
- **Aceptación Ministerial:** PENDIENTE DE REVISIÓN Y VALIDACIÓN HUMANA POR PARTE DEL USUARIO.

# BETHESDA WORSHIP STUDIO — REPORTE DE ENTREGA DE AUDITORÍA Y DOCUMENTACIÓN DE USUARIO (HANDOFF)

**Fecha de Entrega:** 18 de octubre de 2026  
**Rama del Repositorio:** `main`  
**Commit Base:** `e89f5a9`  
**Estado:** AUDITORÍA COMPLETADA — GOBERNANZA DE ESTRICTA LECTURA (READ-ONLY)  
**Documentos Producidos:**
1. [BETHESDA_WORSHIP_STUDIO_USER_GUIDE_ES.md](../user-guide/BETHESDA_WORSHIP_STUDIO_USER_GUIDE_ES.md) (Entregable A — Manual de Usuario en Español)
2. [ROLE_IMPLEMENTATION_STATUS_AUDIT.md](ROLE_IMPLEMENTATION_STATUS_AUDIT.md) (Entregable B — Auditoría de Roles y Control de Acceso)
3. [USER_DOCUMENTATION_AND_ROLES_AUDIT_HANDOFF.md](USER_DOCUMENTATION_AND_ROLES_AUDIT_HANDOFF.md) (Entregable C — Presente Informe de Entrega)

---

## 1. Declaración de Cumplimiento de Gobernanza y Estado del Repositorio

- **Condición de Solo Lectura:** Se ha cumplido de manera absoluta con la directriz de no modificar el código fuente de la aplicación, esquemas de bases de datos, migraciones, dependencias, variables de entorno ni lógica de negocio.
- **Operaciones Git:** No se ha ejecutado ninguna operación de `git add`, `git commit`, `git push`, despliegue ni reescritura de historial.
- **Hardware Excluido:** Ninguna integración con pedales físicos, Bluetooth, WebHID, WebUSB ni Gamepad ha sido implementada ni descrita como funcional en la documentación.
- **No Aprobación de Producción:** No se declara el sistema como listo para producción (*production-ready*). La validación litúrgica humana en el templo por parte del Director de Alabanza permanece pendiente.
- **Estado del Árbol de Trabajo:**
  - **Rama:** `main`
  - **Commit:** `e89f5a9` (idéntico al origen `origin/main`).
  - **Archivos creados (sin rastrear / untracked):**
    - `docs/user-guide/BETHESDA_WORSHIP_STUDIO_USER_GUIDE_ES.md`
    - `docs/reports/ROLE_IMPLEMENTATION_STATUS_AUDIT.md`
    - `docs/reports/USER_DOCUMENTATION_AND_ROLES_AUDIT_HANDOFF.md`
  - **Archivos temporales no rastreados generados por pruebas previas:**
    - `backend/storage/audio/837ce292-45ae-409e-92b6-0db0822a1540.wav`
    - `backend/storage/audio/847cf04f-9098-4643-bab0-e7736daffc22.wav`
    - `backend/storage/audio/adf91c4c-951a-4481-8dcb-a0fa716504e9.wav`

---

## 2. Respuestas Mandatorias a las 6 Preguntas de la Misión

### 1. ¿Puede un usuario distinto a Super Admin ser creado e iniciar sesión hoy?
**SÍ, pero únicamente a través del API REST del Backend, no desde la interfaz web.**
- **En el Frontend:** **NO existe interfaz gráfica** para listar usuarios, enviar invitaciones ni registrar nuevas cuentas. No hay botones de "Invitar usuario" ni formularios de gestión de usuarios en el navegador.
- **En el Backend:** El flujo completo de aprovisionamiento por invitación está implementado y probado:
  1. Un `SUPER_ADMIN` o `ADMIN` emite una invitación vía `POST /api/v1/users/invite` con un token de 256 bits.
  2. El nuevo integrante acepta la invitación y establece su contraseña vía `POST /api/v1/auth/accept-invite`, pasando a estado `ACTIVE` con correo verificado.
  3. **Inicio de sesión en la Web:** Una vez completado el paso 2, el usuario puede ingresar inmediatamente en `http://localhost:5173` usando el botón **👤 Iniciar Sesión** y sus credenciales funcionarán plenamente.

### 2. ¿Cuáles roles están genuinamente implementados?
Los **5 roles** definidos en el sistema están genuinamente modelados en el código y en la base de datos:
- `SUPER_ADMIN`: Implementado en su totalidad. Se aprovisiona automáticamente por bootstrap y posee los 18 permisos del sistema.
- `ADMIN`: Implementado en backend y base de datos (17 permisos; solo excluye eliminación física de canciones). En frontend cuenta con badge distintivo y privilegios de administración y eliminación de repertorios.
- `WORSHIP_LEADER`: Implementado en backend y base de datos (10 permisos). En frontend puede crear y modificar repertorios litúrgicos, pero el botón de eliminación se encuentra bloqueado y oculto.
- `MUSICIAN`: Implementado en backend y base de datos (4 permisos). En frontend puede visualizar repertorios y cargar canciones en el atril, pero los controles de edición están ocultos.
- `VIEWER`: Implementado en backend y base de datos (3 permisos). Rol estrictamente de lectura.

### 3. ¿Cuáles permisos se hacen cumplir en el servidor?
El servidor hace cumplir de manera estricta los **18 permisos** definidos en `ROLE_PERMISSIONS` a través de la clase [AuthGuard](../../backend/src/interfaces/http/middlewares/auth-middleware.ts):
- **En Repertorios Litúrgicos (`/api/v1/setlists`):** Valida `setlists:list`, `setlists:read`, `setlists:create`, `setlists:update`, `setlists:reorder`, `setlists:activate` y `setlists:delete`. En operaciones de mutación, el servidor ejecuta una consulta directa a PostgreSQL (`verifyDatabaseRole = true`) para comprobar en tiempo real que la cuenta no esté suspendida, bloqueada ni haya sufrido una degradación de rol posterior a la emisión del JWT.
- **En Gestión de Usuarios (`/api/v1/users`):** Valida `users:list`, `users:invite`, `users:change_role` y `users:disable` con verificación obligatoria en base de datos.
- **En Recursos de Audio (`/api/v1/audio`):** Valida `songs:create` para subida de audio y `songs:read` para streaming y descarga.
- **En Sesiones Multipista (`/api/v1/multitrack`):** Valida `songs:update_draft` para creación de sesiones y pistas, y `songs:read` para lectura.
- **Excepción / Hallazgo:** Los endpoints en `song.routes.ts` (`/api/v1/songs`) no tienen conectadas las guardas RBAC a nivel HTTP.

### 4. ¿Qué puede hacer el usuario en la aplicación en este momento?
Un usuario que ejecute la aplicación localmente puede realizar de inmediato las siguientes operaciones verificadas:
1. **Acceder a la aplicación web** en `http://localhost:5173`.
2. **Iniciar sesión como Super Administrador** con las credenciales de entorno y cambiar la clave inicial requerida.
3. **Explorar el Catálogo Canónico:** Consultar las canciones disponibles, buscar por título o tonalidad y abrir cualquier obra en el atril.
4. **Utilizar el Atril Musical:**
   - Alternar entre las representaciones disponibles (Cifrado con Acordes / Lead Sheet, Partitura Completa con OSMD, Tablatura con AlphaTab).
   - Seleccionar entre los 12 instrumentos preconfigurados (Voz, Piano, Guitarra, Bajo, Batería, Sintetizador, Saxofón, Trompeta, Violín, Cello, Flauta, Coro).
   - Transportar la tonalidad en tiempo real (+1, -1 semitono o transposición a tonalidad destino).
   - Configurar y aplicar Cejilla / Capo virtual para instrumentos de cuerda.
   - Alternar entre tono de concierto (*Concert Pitch*) y tono transportado (*Written Pitch*).
   - Cambiar entre sistemas de acordes (Americano C-D-E y Latino Do-Re-Mi).
   - Iniciar, pausar y ajustar la velocidad del desplazamiento automático (*Autoscroll* de 5 a 120 px/s).
5. **Gestionar Repertorios Litúrgicos (Setlists):**
   - Abrir el modal de repertorios y revisar la lista de servicios.
   - Si tiene rol `SUPER_ADMIN`, `ADMIN` o `WORSHIP_LEADER`: crear un nuevo repertorio litúrgico, agregar canciones del catálogo, ajustar tonalidades específicas para el servicio, reordenar el flujo litúrgico y guardar notas pastorales.
   - Si tiene rol `SUPER_ADMIN` o `ADMIN`: eliminar repertorios litúrgicos.
   - Cargar un repertorio completo en el atril para navegar entre canciones consecutivas.
6. **Reproducir y Descargar Audio:**
   - Reproducir pistas de audio vinculadas a la canción mediante la barra estéreo inferior.
   - Descargar pistas de audio para disponibilidad local y consultar el inventario sin conexión (*Offline Manager*).

### 5. ¿Qué se encuentra parcialmente implementado o no disponible?
1. **Interfaz Gráfica de Administración de Usuarios:** **NO DISPONIBLE.** No hay pantallas para invitar usuarios, asignar roles o ver integrantes.
2. **Consola de Mezcla Multipista en Frontend:** **NO DISPONIBLE.** El backend dispone de la estructura relacional y endpoints `/api/v1/multitrack/sessions`, pero el frontend no tiene un mezclador multicanal con faders ni controles de silencio (*mute*) o solo por pista. Solo está disponible el reproductor estéreo `AudioPlayerBar`.
3. **Motor de Reconocimiento Óptico de Partituras (OMR):** **NO DISPONIBLE.** El proveedor de producción `StandardOmrProvider` está configurado para retornar 0 compases y advertir que el motor de visión no está configurado, garantizando la política de *cero invención de notas*. No hay interfaz en el frontend para subir partituras escaneadas.
4. **Sincronización por Pedales Físicos:** **EXCLUIDA EXPLÍCITAMENTE.** No existe compatibilidad con Bluetooth, WebHID, WebUSB ni mandos de juego.

### 6. ¿Cuáles pruebas manuales deben ejecutarse a continuación?
Se han establecido **5 pruebas manuales prioritarias** que el Director de Alabanza o responsable técnico debe realizar:
1. **Primer Inicio de Sesión y Cambio de Clave de Super Admin:** Verificar que el sistema exija cambiar la contraseña de arranque y que la sesión se mantenga tras recargar el navegador (`F5`).
2. **Navegación Litúrgica en Atril durante un Ensayo Real:** Cargar un repertorio con 4 canciones, verificar la transposición por instrumento y comprobar la legibilidad del atril a 1.5 metros de distancia con iluminación de auditorio.
3. **Prueba de Autoscroll con Instrumentista en Vivo:** Activar el desplazamiento automático a 20 px/s en una canción de 4 páginas y comprobar que el flujo permita tocar sin interrupción manual.
4. **Aprovisionamiento de un Músico vía API e Inicio de Sesión Web:** Ejecutar las llamadas `curl` de invitación y aceptación detalladas en la Sección 8 del informe de auditoría, e iniciar sesión en el navegador verificando que los controles de autoría queden ocultos.
5. **Simulación de Corte de Internet en el Templo:** Desconectar la red del portátil/tablet y verificar que las canciones y audios descargados previamente en el inventario sigan abriéndose en el atril musical.

---

## 3. Registro de Archivos, Rutas y Componentes Inspeccionados

### 3.1 Documentación y Guías Creadas
- `docs/user-guide/BETHESDA_WORSHIP_STUDIO_USER_GUIDE_ES.md` (740+ líneas; 20 secciones estructuradas con pasos, errores comunes y glosario).
- `docs/reports/ROLE_IMPLEMENTATION_STATUS_AUDIT.md` (350+ líneas; matriz de 8 columnas, comprobaciones de seguridad y análisis arquitectónico).
- `docs/reports/USER_DOCUMENTATION_AND_ROLES_AUDIT_HANDOFF.md` (Informe de entrega consolidado).

### 3.2 Código Fuente Backend Inspeccionado
- `backend/src/domain/auth-types.ts` (Tipos `UserRole`, `AccountStatus`, `Permission`, `ROLE_PERMISSIONS`).
- `backend/src/domain/crypto/password-hasher.ts` (Implementación de hashing con Argon2id).
- `backend/src/application/token-service.ts` (Firma y verificación de JWT HS256).
- `backend/src/application/bootstrap-service.ts` (Lógica de arranque del Super Admin).
- `backend/src/application/invitation-service.ts` (Emisión y consumo de invitaciones de usuario).
- `backend/src/application/setlist-service.ts` (Gestión litúrgica y validaciones anti-IDOR).
- `backend/src/application/multitrack-service.ts` (Validaciones de pistas multipista y pertenencia de audio).
- `backend/src/db/schema.ts` (Definición de tablas relacionales `users`, `refresh_tokens`, `setlists`, `audio_assets`, etc.).
- `backend/src/interfaces/http/middlewares/auth-middleware.ts` (Guardas `requireAuth` y `requirePermission`).
- `backend/src/interfaces/http/routes/auth.routes.ts` (Endpoints de login, refresh, logout, accept-invite, forgot-password).
- `backend/src/interfaces/http/routes/user.routes.ts` (Endpoints de usuarios, invitaciones y roles).
- `backend/src/interfaces/http/routes/song.routes.ts` (Endpoints del catálogo de canciones).
- `backend/src/interfaces/http/routes/setlist.routes.ts` (Endpoints de repertorios litúrgicos).
- `backend/src/interfaces/http/routes/multitrack.routes.ts` (Endpoints de sesiones multipista).
- `backend/src/interfaces/http/routes/realtime.routes.ts` (Endpoints de SSE y quema de tickets).

### 3.3 Código Fuente Frontend Inspeccionado
- `frontend/src/core/auth/types.ts` (Tipos de datos de autenticación del cliente).
- `frontend/src/core/auth/auth-context.tsx` (Proveedor de estado `AuthProvider`, renovación silenciosa y `hasRole`).
- `frontend/src/components/auth/LoginModal.tsx` (Formulario interactivo de inicio de sesión y cambio de clave).
- `frontend/src/components/auth/UserProfileBadge.tsx` (Indicador visual de perfil y distintivo de color por rol).
- `frontend/src/components/workspace/MusicalWorkspace.tsx` (Espacio de trabajo principal y atril musical).
- `frontend/src/components/workspace/SetlistsModal.tsx` (Catálogo y gestión de repertorios con restricciones RBAC).
- `frontend/src/components/workspace/SetlistDetailEditor.tsx` (Editor de repertorio y autoría de canciones).
- `frontend/src/components/workspace/AtrilControls.tsx` (Controles de transposición, instrumentos y autoscroll).

### 3.4 Suites de Prueba Ejecutadas y Verificadas
- `backend/src/__tests__/rbac-permission-guards.test.ts` (Guardas de permisos y verificación en tiempo real en BD).
- `backend/src/__tests__/user-invitation-lifecycle.test.ts` (Ciclo de vida de tokens de invitación y verificación de email).
- `backend/src/__tests__/auth-flow-and-cookies.test.ts` (Cookies HttpOnly y rotación de sesiones).
- `backend/src/__tests__/argon2-hasher.test.ts` (Resistencia de parámetros Argon2id).
- `backend/src/__tests__/jwt-hs256-security.test.ts` (Firma y verificación de JWT).
- `backend/src/__tests__/token-family-replay.test.ts` (Detección de ataques de reutilización de refresh tokens).
- `backend/src/__tests__/setlist-api.test.ts` (Operaciones CRUD y autorización en repertorios).
- `backend/src/__tests__/multitracks-omr.test.ts` (Persistencia de multipistas y diagnósticos de OMR).
- `frontend/src/core/workspace/__tests__/setlist-authoring-remed.test.ts` (Restricciones visuales de autoría en frontend).

---

## 4. Estado de Verificación y Compilación del Código

Previo a la generación documental, se ejecutaron las pruebas automatizadas completas del repositorio:
- **Frontend Tests (Vitest):** 349 / 349 pruebas superadas (53 suites de prueba).
- **Backend Tests (Node.js Test Runner):** 274 / 274 pruebas superadas (56 suites de prueba).
- **Total Repositorio:** **623 / 623 pruebas exitosas (100% PASS).**
- **Verificación de Tipos TypeScript:**
  - `npm run typecheck` en `frontend/`: 0 errores de tipo.
  - `npm run typecheck` en `backend/`: 0 errores de tipo.

---

## 5. Cuadro Comparativo: Implementación Real vs. Expectativas

| Característica / Flujo | Lo que el usuario común espera | Lo que realmente existe hoy | Evidencia Técnica |
| :--- | :--- | :--- | :--- |
| **Crear cuenta de músico** | Un botón de "Registrarse" o "Invitar músico" en la web. | Solo invocable por API REST (`/api/v1/users/invite`). | [user.routes.ts](../../backend/src/interfaces/http/routes/user.routes.ts#L88) |
| **Inicio de sesión** | Modal en la esquina superior para ingresar credenciales. | **Totalmente funcional.** Soporta los 5 roles y cambio obligatorio de clave. | [LoginModal.tsx](../../frontend/src/components/auth/LoginModal.tsx) |
| **Atril musical y transposición** | Cambiar tonalidad y ver acordes según el instrumento. | **Totalmente funcional.** 12 instrumentos, Cejilla, Concierto/Escrito, Do-Re-Mi y C-D-E. | [AtrilControls.tsx](../../frontend/src/components/workspace/AtrilControls.tsx) |
| **Desplazamiento automático** | Autoscroll ajustable mientras se toca el instrumento. | **Totalmente funcional.** Slider de 5 a 120 px/s, play, pausa y reinicio. | [AtrilControls.tsx](../../frontend/src/components/workspace/AtrilControls.tsx#L248) |
| **Repertorios de culto** | Armar la lista de canciones para el domingo. | **Totalmente funcional** para `SUPER_ADMIN`, `ADMIN` y `WORSHIP_LEADER`. | [SetlistsModal.tsx](../../frontend/src/components/workspace/SetlistsModal.tsx) |
| **Mezclador multipista** | Faders para subir o bajar el volumen de bajo, batería, guitarra. | **Inexistente en UI.** Solo existe reproductor estéreo general en el navegador. | [AudioPlayerBar.tsx](../../frontend/src/components/workspace/AudioPlayerBar.tsx) |
| **Escaneo de partituras (OMR)** | Subir una foto o PDF de una partitura y que se digitalice sola. | **No operativo en producción.** Requiere carga de MusicXML canónico pre-existente. | [StandardOmrProvider.ts](../../backend/src/domain/omr/standard-omr-provider.ts) |
| **Pedales inalámbricos de pie** | Pasar página con un pedal Bluetooth o USB. | **Excluido por arquitectura.** Solo se permite interacción táctil o ratón. | [MusicalWorkspace.tsx](../../frontend/src/components/workspace/MusicalWorkspace.tsx) |

---

## 6. Firma de Entrega

La auditoría técnica y la documentación en español han sido generadas y validadas con estricto apego al código fuente y al comportamiento verificable del sistema. 

Los documentos quedan a disposición del usuario y del equipo de liderazgo para su revisión, sin alteraciones en el árbol de trabajo de Git ni declaraciones anticipadas de disponibilidad para producción.

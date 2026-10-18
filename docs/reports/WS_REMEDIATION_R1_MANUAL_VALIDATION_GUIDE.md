# Guía de Validación Litúrgica Manual — Sprint de Remediación R1
## Bethesda Worship Studio — Protocolo de Validación en Atril y Escenario

- **Organización**: Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia
- **Destinatario**: Pastor / Director de Alabanza / Administrador del Sistema
- **Fecha**: 18 de Octubre de 2026
- **Propósito**: Proveer un instructivo paso a paso para que el Propietario del Proyecto y su equipo ministerial ejecuten la validación funcional y litúrgica de las capacidades remediadas en el Sprint R1 antes de su adopción en servicios en vivo.
- **Regla de Exclusión**: **CERO sincronización de pedales físicos (Bluetooth, WebHID, WebUSB, Gamepad)**.

---

## 1. Preparación del Entorno Local

### 1.1 Requisitos Previos
1. Base de datos PostgreSQL en ejecución (`localhost:5432`, base de datos configurada en `.env`).
2. Node.js versión 20 o 22 instalada.
3. Dos navegadores modernos (por ejemplo, Google Chrome y Mozilla Firefox, o dos perfiles independientes en Chrome) para simular roles concurrentes en el escenario.

### 1.2 Inicio de Servicios

Abra dos consolas de terminal en la raíz del proyecto:

**Terminal 1 — Backend Fastify**:
```powershell
cd "backend"
npm run dev
```
*Verifique en el log que indique:*  
`Server listening on http://0.0.0.0:3000` (o puerto configurado) y `Database connected`.

**Terminal 2 — Frontend Vite**:
```powershell
cd "frontend"
npm run dev
```
*Verifique en el log que indique:*  
`Local: http://localhost:5173/`

---

## 2. Casos de Prueba Manual

---

### Caso 1: Autorización de Sesión en Vivo y Sincronización SSE
**Objetivo**: Verificar que los usuarios sin privilegios no puedan iniciar sesiones en vivo, que la sincronización SSE no exponga tokens JWT en la URL y que el avance litúrgico sea instantáneo.

1. **Ventana 1 (Músico sin privilegios)**:
   - Abra `http://localhost:5173` e inicie sesión con una cuenta de rol `MUSICIAN` o `VIEWER`.
   - Abra las Herramientas de Desarrollador (`F12`) y vaya a la pestaña **Network (Red)**.
   - Intente iniciar una sesión litúrgica en vivo desde la barra de setlists.
   - **Resultado Esperado**: El sistema rechaza la acción mostrando un mensaje claro: *"No posee privilegios suficientes para iniciar o dirigir una sesión litúrgica en vivo"*. La petición a `POST /api/v1/realtime/sessions` devuelve **HTTP 403 Forbidden**.

2. **Ventana 2 (Director de Alabanza)**:
   - En una ventana de incógnito o navegador secundario, inicie sesión con una cuenta de rol `WORSHIP_LEADER` o `ADMIN`.
   - Inicie la sesión litúrgica en vivo para el culto activo.
   - **Resultado Esperado**: La sesión se crea exitosamente (**HTTP 200 OK**). En la pestaña Red se observa:
     1. Petición `POST /api/v1/realtime/sessions/:sessionId/ticket` que devuelve un `ticket` efímero de 64 caracteres hex.
     2. Petición `GET /api/v1/realtime/sessions/:sessionId/stream?ticket=<ticket>` que establece la conexión SSE (`text/event-stream`).
     3. **Inspección de Seguridad**: Verifique que la URL del stream **NO CONTIENE** ningún parámetro `token=` con el JWT del usuario, garantizando que el token maestro no quede registrado en proxies ni logs.

3. **Sincronización en Vivo**:
   - En la Ventana 1 (Músico), únase a la sesión activa (`POST .../join`).
   - En la Ventana 2 (Director), cambie de canción, avance de momento o aplique una transposición armónica en vivo (+1 semitono).
   - **Resultado Esperado**: La partitura y el atril de la Ventana 1 se actualizan inmediatamente sin parpadeos ni recarga de página.
   - Verifique en la base de datos PostgreSQL que la canción original no fue alterada (inmutabilidad canónica).

---

### Caso 2: Streaming de Audio y Búsqueda Continua (HTTP Range RFC 7233)
**Objetivo**: Verificar que las pistas de audio se reproduzcan fluidamente, permitan búsqueda temporal sin fallos de autenticación y bloqueen archivos falsificados.

1. **Subida de Archivo de Audio**:
   - En la interfaz de canciones, suba un archivo de audio real (`.mp3` o `.wav`).
   - **Resultado Esperado**: La subida completa exitosamente con HTTP 201 y se genera el checksum SHA-256.

2. **Prueba de Prevención de Falsificación MIME**:
   - Tome un archivo de texto o un PDF, cámbiele la extensión a `.mp3` e intente subirlo.
   - **Resultado Esperado**: El backend rechaza de inmediato el archivo con **HTTP 400 Bad Request** y el mensaje: *"El archivo no posee una firma válida de audio MP3 (posible falsificación MIME)"*.

3. **Reproducción y Búsqueda (Seeking/Scrubbing)**:
   - Abra el reproductor de audio inferior (`AudioPlayerBar`) para la pista cargada.
   - Presione Play.
   - En la pestaña Red (`Network`), observe la petición `POST /api/v1/audio/:id/ticket` y la posterior solicitud de stream con `?ticket=...`.
   - Haga clic en diferentes partes de la barra de progreso (ej. minuto 2:30, segundo 45, etc.).
   - **Resultado Esperado**: El audio salta instantáneamente al punto seleccionado. En la pestaña Red, las peticiones responden con **HTTP 206 Partial Content** y encabezados `Content-Range: bytes START-END/TOTAL`. No se producen errores 401 ni cortes en la reproducción.

---

### Caso 3: Almacenamiento Offline y Verificación Criptográfica Binaria
**Objetivo**: Garantizar que el audio descargado para culto offline sea íntegro y resistente a cortes de internet.

1. **Descarga Offline**:
   - En `AudioPlayerBar`, haga clic en el botón **"Descargar para uso offline"**.
   - Abra la Consola de Desarrollador (`Console`).
   - **Resultado Esperado**: Se observa el log de descarga autenticada con `Authorization: Bearer` y la confirmación:  
     `[OfflineManager] Checksum SHA-256 binario verificado exitosamente para audio <id>`.

2. **Inspección de Almacenamiento**:
   - En las Herramientas de Desarrollador, vaya a **Application (Aplicación) -> Storage -> IndexedDB -> bethesda-offline-db -> audio_cache**.
   - Verifique que existe el registro con `status: "READY"`, `checksumSha256` y los bytes del Blob intactos.

3. **Simulación de Corte de Internet**:
   - En la pestaña **Network (Red)** del navegador, cambie el selector de velocidad a **"Offline"**.
   - Presione Play en el reproductor.
   - **Resultado Esperado**: El reproductor reproduce la pista de forma completamente fluida desde el Blob local de IndexedDB. No se envían peticiones a la red ni se generan errores de conexión.

---

### Caso 4: Ingesta OMR y Compuerta de Aprobación Humana
**Objetivo**: Validar que el reconocimiento óptico de partituras nunca invente notas y requiera autorización explícita antes de ingresar al repositorio canónico.

1. **Carga de Partitura**:
   - Diríjase al módulo de ingesta de partituras y cargue un archivo PDF o imagen de partitura.
   - En el entorno sin motor comercial de IA configurado, observe la respuesta del sistema.
   - **Resultado Esperado**: El sistema reporta honestamente el estado del motor: *"Motor OMR no configurado en el servidor"*, devolviendo 0 notas fabricadas y marcando el estado de propuesta en borrador.

2. **Revisión y Aprobación**:
   - Ante una propuesta con compases reconocidos, el sistema la presenta con la etiqueta destacada **`BORRADOR IA — PENDIENTE DE REVISIÓN`**.
   - Ninguna nota se guarda en la biblioteca de canciones hasta que el usuario presione el botón **"Aprobar y Persistir Propuesta"**.
   - Al aprobar, verifique que la canción aparece en la biblioteca general con la estructura de compases, cifrados y letras traducida fielmente.

---

### Caso 5: Consola Multipistas y Persistencia Relacional PostgreSQL
**Objetivo**: Confirmar que las configuraciones de volumen, paneo, mute y solo sobrevivan a reinicios del servidor y aíslen los stems por canción.

1. **Creación de Sesión Multipistas**:
   - En una canción con pistas asociadas (`Click`, `Batería`, `Bajo`, `Guitarras`, `Voz`), abra la consola multitrack.
   - Cree una nueva sesión de mezcla (ej. *"Culto Domingo Mañana"*).
   - Ajuste los faders: baje la Batería a $0.7$, panee las Guitarras a $+0.5$ (derecha), active `Solo` en el `Click`.

2. **Prueba de Persistencia ante Reinicio**:
   - Vaya a la Terminal 1 (Backend) y detenga el servidor con `Ctrl + C`.
   - Vuelva a iniciar el servidor (`npm run dev`).
   - En el navegador, recargue la página (`F5`).
   - **Resultado Esperado**: La consola multitrack recarga exactamente los mismos niveles de volumen, paneo y estados de mute/solo. Los datos fueron persistidos en PostgreSQL (`multitrack_sessions` y `multitrack_tracks`).

3. **Verificación Anti-IDOR**:
   - Verifique que el selector de pistas únicamente lista archivos de audio pertenecientes a la canción actual. Si se intenta asociar un archivo perteneciente a otra canción, la API rechaza la petición con validación de pertenencia.

---

### Caso 6: Verificación de Exclusión de Pedales Físicos
**Objetivo**: Ratificar el cumplimiento de la restricción obligatoria de cero pedales físicos.

1. **Navegación General en Atril y Partituras**:
   - Navegue por todas las vistas de la aplicación: lectura de partitura (`SCORE`), cifrado (`CHORDS`), tablatura (`TABLATURE`), letras (`LEAD_SHEET`), y atril litúrgico.
   - Active el Autoscroll litúrgico continuo (teclas `Espacio` o botón play).
2. **Resultado Esperado**:
   - El navegador **JAMÁS** solicita permisos de Bluetooth (`navigator.bluetooth`), WebHID (`navigator.hid`), WebUSB (`navigator.usb`) ni detecta mandos Gamepad.
   - El avance de página y el scroll operan exclusivamente mediante eventos de teclado estándar (`Espacio`, `Flechas`), controles táctiles de pantalla y rueda del ratón.

---

## 3. Formato de Registro de Resultados para el Propietario

Al completar las pruebas manuales, el Propietario del Proyecto registrará sus observaciones en la siguiente tabla:

| Caso de Prueba | Funcionalidad Evaluada | Resultado Observado | Estado (APROBADO / OBSERVACIONES) | Firma / Fecha |
| :--- | :--- | :--- | :--- | :--- |
| **Caso 1** | Autorización Realtime y SSE Tickets | | | |
| **Caso 2** | Streaming de Audio y HTTP Range 206 | | | |
| **Caso 3** | Audio Offline e Integridad SHA-256 | | | |
| **Caso 4** | Ingesta OMR y Aprobación Canónica | | | |
| **Caso 5** | Multipistas y Persistencia en PostgreSQL | | | |
| **Caso 6** | Exclusión de Pedales Físicos | | | |

> **Nota Final:**  
> Tras la aprobación satisfactoria de esta guía por el Propietario del Proyecto, el sistema se considerará listo para su despliegue en entornos de ensayo y servicios de adoración en vivo.

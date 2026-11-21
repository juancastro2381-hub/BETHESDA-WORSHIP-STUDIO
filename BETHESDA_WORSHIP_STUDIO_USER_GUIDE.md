# GUÍA DE USUARIO Y MANUAL PRÁCTICO — BETHESDA WORSHIP STUDIO

**Versión verificada en el código fuente:** Rama `feature/phase-1a-core-foundation` (`ceb28aa`, `2026-11-20`)  
**Nota de honestidad:** Esta guía describe **únicamente lo que hoy existe y funciona** en la aplicación actual, indicando con claridad las funciones no disponibles, errores conocidos y controles que aún carecen de ayuda contextual en pantalla.

---

## 1. ¿Qué es Bethesda Worship Studio y qué puedes hacer hoy?
**Bethesda Worship Studio** es una plataforma web gratuita para equipos de alabanza que centraliza canciones litúrgicas en un modelo musical único e inmutable y las proyecta en un **Atril Digital**.

Hoy puedes:
- **Leer canciones en el Atril Digital** en distintos formatos (*Partitura / Gran Pentagrama*, *Cifrado con Letra*, *Letra Sola* o *Tablatura*) cuando la canción contiene los datos necesarios.
- **Adaptar la vista a tu instrumento sin alterar la canción original** (instrumento, cejilla/capo, transposición por semitonos y cifrado Americano `C D G` o Latino `Do Re Sol`).
- **Usar desplazamiento automático (*Autoscroll*)** manos libres durante ensayos o cultos (sin pedales).
- **Importar archivos** en MusicXML (`.musicxml`/`.xml`), ChordPro (`.cho`/`.chordpro`/`.pro`/`.crd`), documentos visuales (`.pdf`, `.png`, `.jpg`, `.webp`) y conservar archivos de audio de referencia (`.mp3`, `.wav`, etc.) para generar borradores asistidos en el Centro de Conversión.
- **Organizar Servicios de Culto y Repertorios (*Setlists*)** con orden secuencial, cambios de tono por canción y momentos litúrgicos (oración, lectura bíblica, predicación, etc.).
- **Completar formatos faltantes** en canciones aprobadas o en borrador enviando letra, cifrado, notación o posiciones de tablatura para revisión del líder.

---

## 2. Cómo está organizado el espacio de trabajo
Al abrir la aplicación ves, de arriba hacia abajo:
1. **Cabecera superior:** Emblema *WORSHIP STUDIO*, selector de tema (**Modo Claro / Modo Oscuro**), tu insignia de usuario (**Iniciar Sesión** / perfil + **Gestión de Usuarios** si eres administrador) y la barra de estado de conexión / almacenamiento sin conexión (**Inventario Offline**).
2. **Herramientas principales (encima del atril):**
   - **Repertorios de Culto (Setlists)** *(solo visible cuando inicias sesión)*.
   - **Catálogo en Base de Datos** *(canciones guardadas en el servidor)*.
   - **Centro de Conversión** *(para convertir formatos o analizar audio de referencia)*.
   - **Importar Archivo (MusicXML / ChordPro / PDF / Imagen)**.
   *(Deficiencia UX actual: estos 4 botones no muestran un texto de ayuda explicando la diferencia entre "Importar Archivo" y "Centro de Conversión" antes de hacer clic).*
3. **Encabezado de la canción activa:** Muestra título, estado (**APROBADO** o **BORRADOR**), formato activo, tonalidad de concierto (o *"Sin tonalidad"* si falta), tempo, métrica, selector de versiones guardadas, botón **Guardar Offline** *(etiquetado como descarga local en el navegador, no descarga de PDF/archivo)* y acceso directo **Completar Formatos**.
4. **Panel de Controles del Atril (`MusicalControls`):**
   - **Arriba:** Las 4 tarjetas de **Formato de Lectura del Atril** (*Partitura*, *Cifrado con Letra*, *Letra Sola*, *Tablatura*) + **Capas adicionales** (*+ Acordes*, *+ Letra*, *+ Secciones*) + botón **Guardar Mis Preferencias**.
   - **Debajo:** Barra unificada de **Instrumento de Atril** y adaptaciones (**Cejilla/Capo** solo si tu instrumento es de cuerda, **Transposición de Banda** y **Sistema de Cifrado**).
5. **Estado del Motor de Renderizado (`RendererStatus`):** Indicador técnico (*AlphaTab*, *OSMD*, *LeadSheetDOM*). *(Deficiencia UX: usa términos técnicos para músicos sin formación en software).*
6. **Controles de Autoscroll** y **Área Principal del Atril** (la partitura, letra o documento visual).
7. **Debajo del atril:** Un cajón cerrado llamado **Vistas rápidas y canciones de prueba (QA / previsualización no destructiva)** pensado para pruebas internas y demostración.

---

## 3. Cómo iniciar sesión y gestionar usuarios
1. Haz clic en **Iniciar Sesión** arriba a la derecha.
2. Ingresa tu correo y contraseña. *(No existe registro público: un administrador debe crear tu cuenta primero).*
3. Si es tu primer ingreso con contraseña temporal, la ventana cambiará a **Actualizar Contraseña Inicial** (mínimo 10 caracteres con mayúscula, minúscula, número y símbolo).
4. **Administradores (`ADMIN` / `SUPER_ADMIN`):** Desde tu insignia de usuario arriba a la derecha, abre **Gestión de Usuarios** para invitar miembros, cambiar roles o suspender/reactivar cuentas.
   - **Limitación importante actual:** No hay correo electrónico automático (SMTP) configurado, y **el enlace `/accept-invite?...` que copia el botón de invitación actualmente no abre ninguna pantalla de registro en la web** (falta enrutamiento cliente para aceptar invitaciones).

---

## 4. Cómo preparar y leer una canción en el Atril

### Paso 1: Elegir una canción
- Desde **Catálogo en Base de Datos**: busca canciones guardadas en el servidor y haz clic para abrirlas en el atril.
- Desde **Importar Archivo**: carga un `.musicxml`, `.cho`/`.chordpro`/`.pro`, `.txt` o un documento `.pdf`/`.png`/`.jpg` directamente.
- Desde **Repertorios de Culto (Setlists)**: abre un repertorio preparado para el servicio dominical y pulsa **Cargar en Atril**.

### Paso 2: Elegir tu Instrumento y Adaptaciones
- En **Instrumento de Atril**, usa el menú desplegable o las pastillas rápidas. *(Nota: las pastillas rápidas de **Bajo** y **Batería** actualmente no aparecen por un fallo de nombres internos, pero sí puedes elegirlos en la lista desplegable).*
- **Cejilla (Capo):** Aparece únicamente si elegiste guitarra o bajo. Cambia la digitación mostrada manteniendo intacta la tonalidad real de concierto.
- **Transposición de Banda (`-1 st` / `+1 st` / `Reset`):** Sube o baja semitonos temporalmente en tu atril.
  - **Advertencia actual verificada:** Si la canción vino de ChordPro con acordes incrustados en las sílabas o estás leyendo **Tablatura**, la transposición y la cejilla presentan fallos conocidos y podrían seguir mostrando acordes/trastes en el tono original.
- **Sistema de Cifrado:** Elige entre **Americano (`C, D, G`)** o **Latino (`Do, Re, Sol`)**. *(Deficiencia UX: no hay descripción emergente explicando cuándo usar cada sistema).*

### Paso 3: Elegir tu Formato de Lectura del Atril
El sistema evalúa el contenido real de la canción (**Principio de Cero Fabricación**: nunca inventa notas ni letra que no existan):
- **Partitura / Gran Pentagrama:** Requiere notas melódicas reales.
  - **Advertencia actual:** Al elegir `Partitura` en instrumentos distintos al Piano (por ejemplo Saxofón, Voz o Guitarra sin tablatura), puede renderizarse con el motor erróneo mostrando cuerdas al aire (`0.1`) si no se selecciona manualmente el renderizador OSMD en *Estado del Motor*.
- **Cifrado con Letra:** Requiere acordes **y** letra alineada.
- **Letra Sola:** Requiere texto lírico verificado.
- **Tablatura:** Requiere instrumento de cuerda (guitarra/bajo) **y** notas melódicas reales.
- **Capas adicionales:** Debajo de los 4 formatos aparecen chips compactos (*+ Acordes*, *+ Letra*, *+ Secciones*) según lo que realmente tenga esa canción.
- Si un formato aparece bloqueado (`FALTA CONTENIDO`, `PARCIAL` o `REVISIÓN REQUERIDA`), haz clic en **Completar** para abrir el **Asistente de Completitud Musical** e ingresar la letra, acordes o XML faltantes.
- Si estás autenticado, puedes pulsar **Guardar Mis Preferencias** para recordar tu formato predilecto.

### Paso 4: Leer con el Atril Digital (Setlists, Modo Atril y Autoscroll)
- **Autoscroll:** Pulsa **Iniciar / Reanudar**, ajusta la velocidad (`0.5x`, `0.75x`, `1x`, `1.5x`, `2x`, `3x`), pausa o vuelve al inicio (`Inicio`). Solo se desplaza el área musical, dejando quietos los controles.
- **Setlists en vivo:** Al cargar un repertorio, arriba aparece la barra del repertorio con botones **Anterior / Siguiente**, momentos litúrgicos (`ServiceMomentCard`), **Modo Atril** (oculta menús para leer a pantalla más limpia), **Zoom (`75%–160%`)** y **Alto Contraste**.
  - **Limitación importante:** Los botones de **Modo Atril**, **Zoom** y **Alto Contraste** hoy solo aparecen cuando cargas un Setlist; no están disponibles al abrir una canción suelta.
  - **Cuidado con el teclado en Setlists:** La barra espaciadora (`Espacio`) actualmente **choca** entre pausar/reanudar Autoscroll y pasar a la siguiente canción del repertorio; las flechas también chocan al pasar páginas de un PDF dentro de un setlist. Usa clic/táctil hasta que se corrija.

---

## 5. Importar archivos, Centro de Conversión y Audio de Referencia

### ¿Qué pasa cuando importas un archivo?
1. El sistema valida tamaño y firma real del archivo (bloquea XML inseguros o archivos corruptos).
2. El archivo original queda preservado sin alterarse (`storage/sources` o `storage/documents`).
3. Para archivos de música estructurados (**MusicXML** y **ChordPro**), puedes visualizarlos inmediatamente o enviarlos como propuesta para aprobación del líder.

### ¿Qué hace hoy el Centro de Conversión?
- **Conversión determinista (funcional hoy):** Convierte entradas válidas en **MusicXML / ChordPro / ASCII Tab** hacia archivos descargables `.musicxml`, `.cho`, `.mid` (solo si tiene notas reales), `.tab` o `.txt`. *(No exporta PDF grabado todavía).*
- **Flujo de Audio de Referencia (`.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`):**
  1. Preserva el archivo original en el servidor de forma inmutable con huella SHA-256.
  2. El motor local en Python analiza de forma automática (heurística DSP): **BPM aproximado**, **tonalidad sugerida**, **progresión de acordes estimada** y **melodía únicamente si es monofónica** (un solo instrumento/voz; en mezclas completas de banda devuelve `0` notas para no inventar).
  3. **NO transfiere/extrae letra automáticamente (sin ASR)** y divide secciones de manera sintética cada 4 u 8 compases, por lo que un músico/líder **debe revisar, corregir la letra/acordes en el borrador y aprobarlo** antes de convertirlo en versión oficial del atril.
- **Deficiencias UX actuales en esta pantalla:** El indicador superior de servidor/cola aparece en verde fijo aunque no haya conexión real, y hay textos heredados que hablan de *"streaming en Atril Digital"*, lo cual **no existe**.

---

## 6. Limitaciones Actuales y Funciones No Disponibles Hoy
Para evitar sorpresas durante ensayos o cultos, ten en cuenta que hoy **NO está disponible** o **presenta fallos bloqueantes**:
1. **NO hay reproductor de audio ni streaming en el atril:** Aunque algunas pantallas vacías todavía muestran por error el texto *"El audio original está disponible en el reproductor superior"*, el reproductor fue retirado intencionalmente y no reproduce pistas.
2. **NO hay botón de Imprimir (`Ctrl+P` optimizado) ni exportación a PDF:** El formato `ENGRAVED_PDF` está bloqueado como pendiente de fase futura (`ENGRAVED_PDF_DEFERRED_PHASE`). Tampoco puedes descargar archivos `.musicxml`/`.cho`/`.txt` directamente desde la cabecera de la canción (debes ir al **Centro de Conversión**).
3. **El botón de descarga en canciones (`DownloadActionButton`) solo guarda caché en este navegador (no descarga un archivo a tu carpeta de Descargas).**
4. **Modo Sin Conexión (*Offline*) defectuoso al abrir:** Aunque puedes guardar canciones/setlists en caché offline y verlos listados, abrir una canción o setlist sin internet falla actualmente porque la app vuelve a pedirlos al servidor por red en lugar de leerlos de IndexedDB, y la ventana **Inventario Offline** no tiene botón de **Abrir**.
5. **No hay reconocimiento automático de partituras escaneadas/PDF (OMR real):** Si subes un PDF escaneado como imagen, no se convierte en partitura editable; solo los PDF con texto seleccionable extraen acordes básicos en texto. Tampoco hay enlaces compartidos ni vista de sincronización en vivo activa entre celulares/tablets conectada al atril.

---

## 7. ¿Qué hacer cuando algo falla?
- **"No me aparece ningún botón de Play aunque subí un MP3":** Normal en esta versión — el audio se guarda solo como referencia para generar un borrador de acordes/BPM en el **Centro de Conversión**, no como reproductor.
- **Un formato (ej. `Tablatura` o `Partitura`) aparece deshabilitado:** Significa que la canción cargada solo tiene acordes o letra y faltan notas reales. Usa el botón **Completar** junto al formato para agregar MusicXML, notas o digitación manual.
- **Subiste un archivo `.tab` en el asistente y da error:** Hay un fallo conocido en validación cliente de ASCII Tab en navegador; impórtalo desde **Centro de Conversión** usando un trabajo del servidor autenticado o en formato MusicXML/ChordPro.
- **Aparece un SVG de "GRANDE ES TU FIDELIDAD" en un documento visual que no era esa canción:** Es un fallo conocido cuando falla la carga de la imagen original del servidor; verifica tu sesión/conexión y recarga la canción desde el catálogo.
- **Error de conexión / 503 al abrir una canción ya guardada offline:** Por ahora es necesario contar con conexión al servidor al momento de abrir la canción o repertorio hasta que se corrija la lectura directa desde IndexedDB.

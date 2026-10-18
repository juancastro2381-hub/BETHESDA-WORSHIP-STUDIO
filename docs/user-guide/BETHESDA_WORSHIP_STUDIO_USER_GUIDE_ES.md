# MANUAL DE USUARIO Y GUÍA DE OPERACIÓN DEL ATRIL LITÚRGICO
## BETHESDA WORSHIP STUDIO
**Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia**  
*Versión del Sistema: 0.1.0 (Auditoría Posterior a Remediación R1-A)*  
*Fecha de Emisión: 18 de octubre de 2026*  
*Audiencia: Equipo Pastoral, Líderes de Alabanza, Músicos, Directores de Coro y Operadores Técnicos*

---

## 1. PROPÓSITO DEL DOCUMENTO, AUDIENCIA Y VISIÓN GENERAL

### 1.1 Propósito
El presente manual proporciona una guía práctica, exhaustiva y paso a paso para la operación cotidiana de **Bethesda Worship Studio**. Su objetivo es permitir que cualquier integrante del ministerio musical de la Iglesia Cristiana Bethesda —incluso sin formación técnica en informática— comprenda cómo acceder a la aplicación, seleccionar canciones, ajustar su atril digital interactivo según su instrumento particular, preparar repertorios de culto (setlists) y operar de forma segura durante las reuniones de congregación, tanto con conexión a internet como en modo totalmente desconectado (*offline*).

### 1.2 Audiencia Objetivo
Este documento está redactado en español claro y accesible, dirigido a:
- **Pastores y Directores Generales:** Para supervisar la liturgia y la gobernanza del ministerio.
- **Líderes de Alabanza (*Worship Leaders*):** Para planificar, ordenar, transportar tonalmente y ejecutar los repertorios de culto.
- **Músicos Instrumentistas (Guitarristas, Bajistas, Pianistas, Saxofonistas, Trompetistas, Bateristas):** Para configurar su atril personal (tablaturas, pentagramas, cifrados, transporte instrumental o cejilla) y ejecutar las obras en vivo.
- **Vocalistas y Coristas:** Para leer letras formateadas y acordes de apoyo armónico.
- **Operadores de Sonido y Medios:** Para coordinar audios de ensayo, secuencias y verificar el inventario sin conexión.

### 1.3 Visión General de la Aplicación
Bethesda Worship Studio es una estación de trabajo musical litúrgica web diseñada para centralizar el catálogo de alabanza y adoración de la congregación. Sus pilares de diseño son:
1. **Modelo Musical Canónico Único:** Cada canción se almacena como una estructura matemática pura inmutable. Ningún cambio de instrumento, transporte o cejilla altera la obra original en el servidor.
2. **Proyección Multimúsico Dinámica:** A partir de una sola partitura, el sistema proyecta en tiempo real la vista óptima para cada ejecutante: tablatura para la guitarra, gran pentagrama para el piano, notas transpuestas para el saxofón alto en Mi bemol (Eb), o solo letra y cifrado para la voz.
3. **Atril Digital Manos Libres:** Incorpora desplazamiento automático (*Autoscroll*) suave con control de velocidad por software y teclado, **sin requerir pedales físicos ni hardware externo**.
4. **Resiliencia Litúrgica sin Conexión (*Offline First*):** Permite descargar canciones, repertorios completos y pistas de audio en la memoria local del navegador (IndexedDB), garantizando que el culto dominical continúe sin interrupciones aun si se pierde la conexión a internet o falla la red eléctrica local.

---

## 2. REQUISITOS PREVIOS Y ACCESO A LA APLICACIÓN

### 2.1 Requisitos del Dispositivo y Navegador
- **Dispositivos soportados:** Computadores portátiles (Windows, macOS, Linux), tabletas (iPad, Android) y pantallas táctiles instaladas en los atriles del presbiterio.
- **Navegadores recomendados:** Google Chrome (versión 120 o superior), Mozilla Firefox (versión 120 o superior), Microsoft Edge o Apple Safari (versión 17 o superior).
- **Resolución sugerida:** Pantalla con resolución mínima de 1024x768 píxeles en orientación horizontal (*landscape*) para visualización óptima de partituras y tablaturas.

### 2.2 Cómo Acceder a la Aplicación
1. Abra el navegador web de su preferencia.
2. Ingrese a la dirección configurada para su congregación:
   - **En entorno de desarrollo / red local del templo:** `http://localhost:5173` (o la dirección IP local del servidor de la iglesia, ej. `http://192.168.1.50:5173`).
3. Al cargar, observará la cabecera institucional:
   - Emblema dorado del saxofón de Bethesda.
   - Título: **BETHESDA WORSHIP STUDIO**.
   - Subtítulo: *Iglesia Cristiana Bethesda — Madrid, Cundinamarca*.
   - Botón de estado de usuario a la derecha.

---

## 3. INICIO DE SESIÓN, CIERRE DE SESIÓN Y GESTIÓN DE CUENTA

### 3.1 Procedimiento de Inicio de Sesión (*Login*)
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/auth/LoginModal.tsx`  
**Ruta API:** `POST /api/v1/auth/login`

- **Propósito:** Identificarse ante el sistema para desbloquear funciones protegidas según su rol asignado (crear repertorios, editar canciones, guardar preferencias de atril).
- **Cuándo usarlo:** Al comenzar su turno ministerial o antes del ensayo/culto.
- **Pasos:**
  1. En la esquina superior derecha de la cabecera, haga clic en el botón **👤 Iniciar Sesión** (`#open-login-modal-button`).
  2. Se abrirá la ventana emergente *"Acceso a Bethesda Worship Studio"*.
  3. En el campo **Correo Electrónico**, escriba su dirección de correo registrada (ej. `admin@bethesda.org`).
  4. En el campo **Contraseña**, escriba su clave personal.
  5. Haga clic en el botón azul **Iniciar Sesión**.
- **Resultado esperado:** La ventana emergente se cerrará. En la esquina superior derecha aparecerá su nombre completo y un distintivo de color con su rol (ej. *"Super Administrador"* en rosa o *"Músico"* en verde).
- **Problemas comunes:**
  - *Mensaje "Credenciales inválidas":* Verifique que no tenga activadas las mayúsculas involuntariamente o que el correo no tenga espacios en blanco al inicio o final.
  - *Mensaje de bloqueo temporal:* Si introduce 5 contraseñas erróneas consecutivas, el sistema bloqueará temporalmente la cuenta por 15 minutos para prevenir ataques automatizados.
- **Limitaciones actuales:** No existe formulario de registro público autónomo (*Sign Up*). Todas las cuentas deben ser invitadas previamente por un administrador.

### 3.2 Primer Inicio de Sesión: Cambio Obligatorio de Clave
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `LoginModal.tsx` (Modo `isMustChangeMode`)  
**Ruta API:** `POST /api/v1/auth/change-initial-password`

- **Propósito:** Forzar al usuario que ingresa por primera vez con una clave provisional (como el Super Administrador inicial de arranque) a establecer una contraseña personal definitiva y robusta.
- **Cuándo ocurre:** Automáticamente tras hacer clic en *"Iniciar Sesión"* si la cuenta está en estado `MUST_CHANGE_PASSWORD`.
- **Pasos:**
  1. La ventana cambiará su título a: **Actualizar Contraseña Inicial**.
  2. Aparecerá la advertencia: *"Por motivos de seguridad, debe definir una contraseña personal definitiva antes de continuar"*.
  3. En el campo **Nueva Contraseña**, escriba una clave segura de mínimo 10 caracteres.
  4. En el campo **Confirmar Nueva Contraseña**, repita exactamente la misma clave.
  5. Haga clic en **Establecer Contraseña**.
- **Resultado esperado:** El sistema confirma la actualización, activa la cuenta (`ACTIVE`) e inicia la sesión inmediatamente.

### 3.3 Cierre de Sesión (*Logout*) y Purga de Privacidad
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/auth/UserProfileBadge.tsx`  
**Ruta API:** `POST /api/v1/auth/logout`

- **Propósito:** Terminar la sesión de forma segura, invalidando el token en el servidor y limpiando los datos privados de la memoria.
- **Cuándo usarlo:** Al retirarse del atril o si comparte el dispositivo con otro hermano de la iglesia.
- **Pasos:**
  1. Diríjase a la esquina superior derecha sobre su distintivo de usuario.
  2. Haga clic en el botón gris **Salir** (`#logout-button`).
- **Resultado esperado:**
  - El distintivo de usuario vuelve a mostrar **👤 Iniciar Sesión**.
  - Se eliminan las cookies seguras de sesión y el token JWT en memoria.
  - El sistema ejecuta automáticamente la purga de descargas y cachés privadas asociadas a su usuario en el almacenamiento local IndexedDB (requisito de confidencialidad WP-04).

---

## 4. ORIENTACIÓN DE LA PANTALLA PRINCIPAL

Al ingresar a Bethesda Worship Studio, la pantalla principal se estructura en las siguientes zonas funcionales:

```
+---------------------------------------------------------------------------------------+
| [Emblema] BETHESDA WORSHIP STUDIO — Iglesia Cristiana Bethesda     [Usuario: Rol] [Salir] |
+---------------------------------------------------------------------------------------+
| [● En Línea / Modo Sin Conexión]                               [📦 Inventario Offline]  |
+---------------------------------------------------------------------------------------+
| [Escenario A: Guitarra] [Escenario B: Piano] [Escenario C: Saxo] [Escenario D: Voz]   |
+---------------------------------------------------------------------------------------+
| [Canción Canónica Activa] | [📋 Repertorios] | [💾 Catálogo BD] | [📥 Importar Archivo] |
+---------------------------------------------------------------------------------------+
| [Barra de Navegación de Repertorio / Setlist] (Visible solo cuando hay un setlist cargado)|
+---------------------------------------------------------------------------------------+
| [Cabecera de Canción: Título, Tonalidad de Concierto, Compás, BPM, Estado Canónico]     |
+---------------------------------------------------------------------------------------+
| [Barra de Audio: Reproductor, Pistas Disponibles, Streaming / Descarga Local]         |
+---------------------------------------------------------------------------------------+
| [Controles de Formato de Lectura: Partitura | Cifrado con Letra | Letra Sola | Tab]    |
| [Selectores: Instrumento | Capas Secundarias | Cejilla (Capo) | Transporte | Cifrado]   |
+---------------------------------------------------------------------------------------+
| [Estado del Renderizador: OSMD / AlphaTab / LeadSheetDOM]                             |
+---------------------------------------------------------------------------------------+
| [Control de Autoscroll: ▶ Iniciar | ⏸ Pausar | ⏹ Detener | ⏮ Inicio | Velocidad]     |
+---------------------------------------------------------------------------------------+
|                                                                                       |
|                             ÁREA DEL VISOR MUSICAL                                    |
|             (Partitura OSMD / Tablatura AlphaTab / Cifrado DOM / Tarjeta de Culto)    |
|                                                                                       |
+---------------------------------------------------------------------------------------+
| [▼ Diagnósticos del Modelo Canónico (Colapsable)]                                     |
+---------------------------------------------------------------------------------------+
```

1. **Cabecera Institucional (`header.app-header`):** Contiene la identidad de la congregación y el distintivo de usuario autenticado (`UserProfileBadge`).
2. **Barra de Estado de Conectividad (`OfflineStatusBar`):** Indica con un punto verde o ámbar si el sistema está conectado al servidor central o en modo autónomo sin conexión. Incluye el acceso directo al inventario offline.
3. **Selector de Escenarios Dorados (`ScenarioPresets`):** Cuatro botones de calibración instantánea para los instrumentos habituales del grupo de alabanza.
4. **Barra de Catálogo e Ingesta (`catalog-and-import-bar`):** Permite cambiar entre canciones de muestra, consultar el catálogo en PostgreSQL (`DatabaseSongsModal`), abrir los repertorios de culto (`SetlistsModal`) o importar fuentes MusicXML/ChordPro (`SourceFileUploader`).
5. **Barra de Navegación Litúrgica (`SetlistNavigationToolbar`):** Se activa al cargar un culto programado. Muestra el número de elemento (ej. `Elemento 2 de 5`), botones Anterior/Siguiente y el botón para volver al repertorio si se desvió a otra canción.
6. **Cabecera de Canción (`SongHeader`):** Presenta el título de la canción, tonalidad de concierto original, métrica y estado en base de datos (`APPROVED` o `DRAFT`).
7. **Barra de Audio (`AudioPlayerBar`):** Permite escuchar pistas de referencia o secuencias asociadas a la canción activa.
8. **Controles Musicales y Formatos de Lectura (`MusicalControls` & `ReadingFormatSelector`):** La consola principal donde cada músico define qué instrumento toca y cómo desea ver la partitura.
9. **Estado del Motor de Renderizado (`RendererStatus`):** Muestra qué tecnología gráfica está dibujando la música (`OSMD` para pentagramas, `AlphaTab` para mástiles y cuerdas, `LeadSheetDOM` para letra y acordes).
10. **Barra de Desplazamiento Automático (`AutoscrollControl`):** Controles manos libres para avanzar la partitura mientras se tocan los instrumentos.
11. **Visor de Partitura / Momento de Servicio (`workspace-viewport-area`):** El lienzo central donde se dibuja la música o la ficha del momento litúrgico (oración, ofrenda, prédica).
12. **Panel de Diagnóstico (`DiagnosticPanel`):** Registro colapsable al pie de página que confirma que no hay compases corruptos ni notas inventadas.

---

## 5. MAPA DE NAVEGACIÓN

Dado que Bethesda Worship Studio es una aplicación web de atril diseñada para evitar recargas completas de página durante el servicio, la navegación se realiza mediante transiciones fluidas y paneles emergentes accesibles:

```
[Pantalla Principal: MusicalWorkspace]
   │
   ├──▶ Clic en "👤 Iniciar Sesión" ──────▶ Modal de Autenticación (LoginModal)
   │                                          └─▶ Si es 1ª vez: Formulario de cambio de clave
   │
   ├──▶ Clic en "📦 Inventario Offline" ──▶ Modal de Inventario Local (OfflineInventoryModal)
   │                                          ├─▶ Reproducir audios guardados en memoria
   │                                          └─▶ Eliminar copias locales de canciones/setlists
   │
   ├──▶ Clic en "💾 Catálogo en BD" ─────▶ Modal de Catálogo PostgreSQL (DatabaseSongsModal)
   │                                          ├─▶ Explorar canciones guardadas en el servidor
   │                                          ├─▶ Cargar canción al atril
   │                                          ├─▶ Descargar canción para uso offline
   │                                          └─▶ Guardar canción activa en el servidor
   │
   ├──▶ Clic en "📥 Importar Archivo" ───▶ Panel de Ingesta (SourceFileUploader)
   │                                          ├─▶ Arrastrar archivo .musicxml o .chordpro
   │                                          └─▶ Probar muestras preconfiguradas
   │
   └──▶ Clic en "📋 Repertorios de Culto" ▶ Modal de Setlists (SetlistsModal)
        (Solo usuarios autenticados)          ├─▶ Filtrar: Activos / Planificación / Historial
                                              ├─▶ "+ Nuevo Repertorio" (Líderes y Administradores)
                                              ├─▶ "Cargar en Atril" (Ejecución litúrgica)
                                              ├─▶ "Descargar Repertorio" (Paquete completo offline)
                                              └─▶ "⚙️ Administrar / Ver Ítems"
                                                   │
                                                   ▼
                                       [Editor de Detalle: SetlistDetailEditor]
                                          ├─▶ Modificar título, fecha y notas pastorales
                                          ├─▶ Agregar Canción del catálogo con tono meta
                                          ├─▶ Agregar Momento Litúrgico (Oración, Ofrenda, etc.)
                                          ├─▶ Reordenar elementos (Subir / Bajar con guardado atómico)
                                          ├─▶ Cambiar estado (PLANNING ➔ ACTIVE ➔ COMPLETED)
                                          └─▶ Eliminar elemento o repertorio (Solo Administradores)
```

---

## 6. SELECCIÓN DE CANCIONES Y CATÁLOGO CANÓNICO

### 6.1 Canciones Rápidas del Catálogo Local
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/SongSelector.tsx`

En la barra superior encontrará botones tipo píldora (*pills*) para acceso instantáneo a las canciones canónicas de fábrica:
1. **Sublime Gracia (Notación Completa — Sol Mayor):** Contiene partitura melódica completa, compases, armonía y letra silábica.
2. **Sublime Gracia (ChordPro — Solo Cifrado y Letra):** Versión en texto plano estructurado con acordes sobre las sílabas, sin notas melódicas fijas.
3. **Canción Vacía (Caso de Borde):** Modelo en blanco para pruebas del sistema.

### 6.2 Exploración y Carga desde el Catálogo Central (PostgreSQL)
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/DatabaseSongsModal.tsx`  
**Ruta API:** `GET /api/v1/songs`, `GET /api/v1/songs/:id`

- **Propósito:** Explorar la base de datos central de canciones aprobadas de la iglesia y abrir una obra en el atril.
- **Cuándo usarlo:** Cuando la canción que se va a ensayar o ministrar no está en los botones rápidos de muestra.
- **Pasos:**
  1. Haga clic en el botón **💾 Catálogo en Base de Datos** (`#btn-toggle-db-modal`).
  2. Se abrirá la ventana emergente con el listado de canciones almacenadas en el servidor.
  3. En la lista observará el título, la tonalidad por defecto, la métrica y la cantidad de compases.
  4. Localice la canción deseada y haga clic en el botón azul **Cargar en Atril**.
- **Resultado esperado:** La ventana se cerrará automáticamente. La partitura se proyectará en el atril conservando todos los datos del compositor y la versión canónica.
- **Problemas comunes:** Si el servidor está apagado o no hay red, la ventana advertirá el estado sin conexión y mostrará únicamente las canciones previamente descargadas en su dispositivo.

---

## 7. DATOS DE LA CANCIÓN, NOTACIÓN MUSICAL Y CAPAS DE INFORMACIÓN

Bethesda Worship Studio distingue rigurosamente el contenido musical que una canción posee de la manera en que se visualiza:

1. **Compases y Métrica:** Cada compás respeta la signatura de compás definida (ej. 4/4, 6/8, 3/4) y el mapa de *tempo* en pulsaciones por minuto (BPM).
2. **Eventos Musicales:**
   - **Notas Melódicas:** Poseen tono absoluto (ej. Sol4), duración canónica en pulsos (*ticks* a 960 TPQN) y ligaduras.
   - **Silencios (*Rests*):** Marcan pausas rítmicas obligatorias. **Invariante:** Los silencios jamás son tratados ni contabilizados como notas melódicas.
3. **Acordes de Cifrado Armónico:** Ubicados en tiempos precisos del compás para guiar la armonía del piano, guitarras y bajo.
4. **Texto Lírico (*Lyrics*):** Cada sílaba está anclada al tiempo musical o nota correspondiente, permitiendo lectura fluida para los cantantes.
5. **Marcadores de Sección:** Etiquetas canónicas que identifican las partes del himno o coro: `[Intro]`, `[Verso 1]`, `[Coro]`, `[Puente]`, `[Solo]`, `[Final]`.

---

## 8. ATRIL MUSICAL E INTERFAZ DE LECTURA

Esta es la sección de mayor interacción para el músico durante el servicio. Permite personalizar el atril según su necesidad técnica sin alterar lo que ven sus compañeros.

### 8.1 Selección de Instrumento
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/InstrumentSelector.tsx`  
**Catálogo de perfiles:** `frontend/src/core/projection/instrument-profile.ts`

- **Propósito:** Informar al sistema qué instrumento está ejecutando para que este restrinja las vistas incompatibles y aplique las transposiciones de fábrica necesarias.
- **Pasos:**
  1. En el bloque de controles, localice la sección **Instrumento**.
  2. Despliegue el selector desplegable.
  3. Elija uno de los **12 instrumentos soportados**:
     - *Guitarra Acústica:* Habilita tablatura, cejilla y cifrado con letra.
     - *Guitarra Eléctrica:* Habilita tablatura, cejilla y pentagrama.
     - *Bajo Eléctrico:* Habilita tablatura de 4 cuerdas (E-A-D-G), pentagrama en clave de Fa y cifrado.
     - *Piano Acústico:* Habilita Gran Pentagrama (clave de Sol + clave de Fa conectadas por llave).
     - *Teclado / Sintetizador:* Habilita Gran Pentagrama y cifrado armónico.
     - *Batería / Percusión:* Habilita pentagrama en clave neutral de percusión y marcadores de sección.
     - *Saxofón Alto en Mi bemol (Eb):* Instrumento transpositor (+9 semitonos automáticos).
     - *Saxofón Tenor en Si bemol (Bb):* Instrumento transpositor (+2 semitonos automáticos).
     - *Trompeta en Si bemol (Bb):* Instrumento transpositor (+2 semitonos automáticos).
     - *Voz Principal:* Habilita letra sincronizada, acordes y pentagrama melódico.
     - *Voz Coros / Armonía:* Habilita letra y acordes.
     - *Instrumento General:* Configuración estándar en clave de Sol.

### 8.2 Formatos de Lectura Rápida (*Reading Formats*)
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/ReadingFormatSelector.tsx`

Para evitar configurar capas manualmente una por una, el sistema ofrece 4 formatos estándar de un solo clic:
1. **𝄞 Partitura / Gran Pentagrama:** Muestra notas y compases en pentagrama tradicional (mediante el motor OSMD).
   - *Nota:* Si la canción no contiene notas melódicas (ej. fue importada desde ChordPro puro), este botón se deshabilitará automáticamente informando: *"La canción no contiene notas melódicas (Lead Sheet Puro)"*. Cero invención de pentagramas vacíos.
2. **𝄢 Cifrado con Letra (*Lead Sheet*):** Muestra los acordes ubicados con exactitud sobre las palabras de la letra y los marcadores de sección (mediante el motor LeadSheetDOM).
3. **📝 Letra Sola:** Elimina acordes y notas, dejando el texto limpio y de gran tamaño para el predicador o vocalista de apoyo.
4. **🎸 Tablatura:** Dibuja el mástil y las líneas de cuerdas con los números de traste exactos (mediante el motor AlphaTab). Solo está disponible para Guitarra y Bajo cuando la canción contiene notas melódicas.

### 8.3 Ajuste de Cejilla (*Capo*)
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/CapoControl.tsx`

- **Propósito:** Simular la colocación de un capodastro en la guitarra para tocar digitaciones cómodas mientras el tono real sonante se mantiene idéntico al del resto de la banda.
- **Cuándo usarlo:** Guitarristas que desean usar formas de acordes abiertas (ej. posición de Sol Mayor) cuando la banda toca en tonos con bemoles (ej. Si bemol Mayor, colocando Capo en traste 3).
- **Pasos:** En el control **Cejilla (Capo)**, presione los botones `+` o `-` para seleccionar el traste (de 0 a 12).
- **Resultado esperado:** Los acordes y números de traste en la tablatura se recalculan de inmediato. La cabecera indicará el acorde digitado y el tono real resultante.
- **Invariante:** Si el instrumento seleccionado no es una guitarra (ej. Piano o Saxofón), este control se bloquea automáticamente mostrando: *"No aplicable para este instrumento"*.

### 8.4 Transposición Armónica General
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/TranspositionControl.tsx`

- **Propósito:** Subir o bajar el tono de toda la canción en semitonos para adaptarlo al registro vocal del líder de alabanza.
- **Pasos:** Utilice los botones de semitonos (rango de -11 a +11 semitonos).
- **Resultado esperado:** Todos los acordes, armaduras de clave y notas del pentagrama se trasladan armónicamente respetando las reglas de enarmonía musical.

### 8.5 Sistemas de Cifrado Armónico
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/ChordNotationControl.tsx`

Permite alternar al instante entre 4 sistemas de nomenclatura de acordes:
1. **Estándar / Americano:** C, D, E, F, G, A, B (con extensiones: G7, Asus4, C#m).
2. **Latino / Solfeo:** Do, Re, Mi, Fa, Sol, La, Si (ej. Do Mayor, Sol7, Re menor).
3. **Grados Romanos:** I, ii, iii, IV, V, vi, vii° (para análisis armónico y dirección musical independiente del tono).
4. **Sistema Nashville:** 1, 2m, 3m, 4, 5, 6m (muy utilizado por directores de banda contemporánea).

### 8.6 Selección de Motor de Renderizado
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/RendererStatus.tsx`

El sistema selecciona automáticamente el mejor motor gráfico, pero el músico puede forzar uno específico si lo prefiere:
- **OSMD (OpenSheetMusicDisplay):** Motor vectorial SVG/Canvas para pentagramas formales.
- **AlphaTab:** Motor especializado en tablaturas, números de traste y cuerdas de guitarra.
- **LeadSheetDOM:** Motor HTML nativo ultrarrápido y responsivo para texto y acordes.

### 8.7 Desplazamiento Automático Manos Libres (*Autoscroll*)
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/AutoscrollControl.tsx`  
**Hook:** `frontend/src/core/autoscroll/use-autoscroll.ts`

- **Propósito:** Desplazar la partitura suavemente hacia abajo a velocidad constante para que el músico no tenga que quitar las manos de su instrumento para pasar la página.
- **Controles en pantalla:**
  - **▶ Iniciar / Reanudar:** Comienza el desplazamiento continuo.
  - **⏸ Pausar:** Detiene momentáneamente el avance en la posición actual.
  - **⏹ Detener:** Cancela el desplazamiento y lo congela.
  - **⏮ Inicio:** Regresa instantáneamente al compás 1 al tope de la partitura.
  - **Selector de Velocidad:** `0.5x`, `0.75x`, `1.0x` (velocidad normal), `1.5x`, `2.0x`, `3.0x`.
  - **Barra de Progreso:** Indica el porcentaje recorrido de la obra (0% a 100%).
- **Atajos de Teclado Universales:**
  - **Barra Espaciadora (*Space*):** Alterna entre Iniciar, Pausar y Reanudar.
  - **Tecla Escape (*Esc*):** Detiene el desplazamiento de inmediato.
- **Restricción Mandatoria:** Esta función opera exclusivamente mediante software y teclado. **No se implementa ni requiere ningún pedal físico, Bluetooth, WebHID ni Gamepad**.

### 8.8 Guardar Preferencias Personales de Visualización
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `ReadingFormatSelector.tsx`  
**Ruta API:** `PUT /api/v1/users/me/preferences`

- **Propósito:** Guardar su instrumento habitual, formato de lectura y cifrado favorito en su cuenta de PostgreSQL.
- **Cuándo usarlo:** Cuando haya configurado su atril a su gusto y desee que la próxima vez que inicie sesión, cualquier canción se abra automáticamente con esa misma configuración.
- **Pasos:** En la barra de formatos de lectura, haga clic en el botón con ícono de estrella: **Guardar como preferencia predeterminada**.
- **Resultado esperado:** El botón confirmará el guardado. Sus preferencias quedarán vinculadas a su usuario en la base de datos central.

---

## 9. REPERTORIOS DE CULTO (SETLISTS) Y LITURGIA

Los repertorios organizan el flujo espiritual y musical de una reunión congregacional (ej. *Culto Dominical de Alabanza y Adoración*).

### 9.1 Exploración de Repertorios
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/SetlistsModal.tsx`  
**Ruta API:** `GET /api/v1/setlists`

- **Propósito:** Consultar los cultos programados por el liderazgo.
- **Pasos:**
  1. En la barra de catálogo, haga clic en **📋 Repertorios de Culto (Setlists)** (`#btn-toggle-setlists-modal`).
     *(Nota: Este botón solo es visible si ha iniciado sesión).*
  2. Utilice las pestañas superiores para filtrar:
     - **Todos:** Muestra el archivo general.
     - **Activo / En Curso:** Muestra el setlist que se está ministrando en el momento presente en la congregación.
     - **En Planificación:** Cultos futuros que los líderes están preparando.
     - **Historial:** Cultos completados o archivados en fechas anteriores.
  3. Para abrir el culto en su atril, haga clic en el botón azul **Cargar en Atril**.

### 9.2 Creación de un Nuevo Repertorio
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO (Roles: `SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`)  
**Componente:** `SetlistsModal.tsx`  
**Ruta API:** `POST /api/v1/setlists`

- **Pasos:**
  1. En la parte superior del modal de repertorios, haga clic en el botón verde **+ Nuevo Repertorio**.
  2. En el formulario emergente, diligencie:
     - **Título del Culto:** Ej. *"Culto Dominical Matutino - 25 de Octubre"*.
     - **Fecha y Hora Programada:** Seleccione fecha y hora del servicio.
     - **Notas Litúrgicas / Pastorales:** Instrucciones espirituales para el equipo (ej. *"Comenzar en espíritu de gratitud, énfasis en la oración por las familias"*).
  3. Haga clic en **Crear Repertorio**.
- **Resultado esperado:** El nuevo setlist se crea en estado inicial `PLANNING` (Planificación) y aparece inmediatamente en la lista.

### 9.3 Edición, Adición de Canciones y Momentos Litúrgicos
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/SetlistDetailEditor.tsx`  
**Ruta API:** `POST /api/v1/setlists/:id/items`, `PUT /api/v1/setlists/:id/reorder`

- **Propósito:** Estructurar el orden del culto combinando alabanzas y momentos devocionales.
- **Pasos para Agregar una Canción:**
  1. En el setlist deseado, haga clic en **⚙️ Administrar / Ver Ítems**.
  2. En la sección *Agregar Elemento*, seleccione la pestaña **Canción del Catálogo**.
  3. Elija la canción en el desplegable.
  4. Opcionalmente defina una **Tonalidad para este Culto** (ej. si la canción original está en Sol, pero la líder cantará en La) y el **Tipo de Transición** (`SEGUE` para encadenado directo sin pausa, `STOP` para parada seca, `CROSSFADE` o `MEDLEY`).
  5. Haga clic en **Agregar Canción**.
- **Pasos para Agregar un Momento Litúrgico:**
  1. Seleccione la pestaña **Momento Litúrgico**.
  2. Escriba el título del momento: ej. *"Bienvenida y Oración Inicial"*, *"Momento de Diezmos y Ofrendas"*, *"Ministración Pastoral"*.
  3. Ingrese la duración estimada en minutos (ej. 5 min).
  4. Opcionalmente defina la **Tonalidad de Acompañamiento / Pad Sugerido** (ej. *"Re Mayor"* para que el tecladista mantenga una atmósfera armónica suave durante la oración).
  5. Escriba notas pastorales específicas para ese momento.
  6. Haga clic en **Agregar Momento**.
- **Reordenamiento Atómico:** Utilice los botones de flecha **▲ Subir** y **▼ Bajar** en cada fila. Cada movimiento se guarda de forma atómica y transaccional en PostgreSQL, garantizando que el orden nunca se desorganice si dos músicos consultan a la vez.

### 9.4 Activación del Culto y Regla de Unicidad Litúrgica
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Ruta API:** `POST /api/v1/setlists/:id/status`

- **Regla Estricta:** En la congregación **solo puede existir un único repertorio en estado `ACTIVE` simultáneamente**.
- **Procedimiento:** Cuando el servicio dominical va a comenzar, el líder o pastor hace clic en **Activar Culto**. Si existía otro culto activo anterior, el sistema exigirá finalizarlo (`COMPLETED`) o archivarlo (`ARCHIVED`) antes de activar el nuevo, previniendo confusiones en el altar.

### 9.5 Navegación en el Atril durante el Culto en Vivo
**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/SetlistNavigationToolbar.tsx`  
**Tarjeta de Momento:** `frontend/src/components/workspace/ServiceMomentCard.tsx`

Cuando un setlist está cargado en el atril:
1. En la parte superior aparecerá la barra dorada de navegación litúrgica.
2. Muestra: `Elemento X de Y`, título del ítem actual y el siguiente ítem por venir.
3. **Botones de Navegación:**
   - **◀ Anterior:** Retrocede al elemento previo.
   - **Siguiente ▶:** Avanza al siguiente elemento.
4. **Diferenciación Inteligente de Vistas:**
   - Si el elemento es una **CANCIÓN**: Se dibuja la partitura o tablatura completa, aplicando automáticamente el transporte del culto.
   - Si el elemento es un **MOMENTO LITÚRGICO**: El visor oculta la partitura y muestra la tarjeta devocional (`ServiceMomentCard`) con el tiempo estimado, las notas pastorales y el tono sugerido de fondo para el teclado. **Invariante:** Cero inicialización de motores de partitura durante momentos de oración o predicación.
5. **Modo Canción Espontánea (*Off-Setlist*):**
   - Si durante el culto el Espíritu Santo guía a entonar un coro espontáneo fuera del programa, el músico puede abrir el catálogo y seleccionar cualquier otra canción.
   - La barra litúrgica detectará este desvío y mostrará una alerta ámbar: *"Viendo canción fuera de repertorio: [Título]"*.
   - Para regresar exactamente al punto donde iba el culto, basta hacer clic en el botón azul **↩ Volver al Culto**.

---

## 10. IMPORTACIÓN DE FUENTES (MUSICXML Y CHORDPRO)

**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componente:** `frontend/src/components/workspace/SourceFileUploader.tsx`  
**Servicio:** `frontend/src/core/ingestion/ingestion-service.ts`

### 10.1 Formatos Aceptados y Límites
- **MusicXML:** Archivos con extensión `.musicxml` o `.xml`. Estándar de la industria musical generado por programas como Finale, Sibelius, MuseScore o Dorico.
- **ChordPro / Cifrados en Texto:** Archivos con extensión `.chordpro`, `.pro`, `.chopro`, `.crd`, `.txt`. Formato estándar de letra con acordes entre corchetes (ej. `[Sol]Alabaré a mi [Do]Señor`).
- **Límite de tamaño:** Máximo 5 MB por archivo.

### 10.2 Procedimiento de Ingesta Paso a Paso
1. En la barra superior, haga clic en el botón **📥 Importar Archivo (MusicXML / ChordPro)** (`#btn-toggle-source-uploader`).
2. Se desplegará la zona de carga con borde discontinuo e ícono musical.
3. Puede arrastrar y soltar el archivo directamente desde el explorador de su computador hacia el recuadro, o hacer clic en **examinar desde tu dispositivo** para seleccionarlo.
4. Si solo desea realizar una prueba rápida de funcionamiento, haga clic en uno de los dos botones de muestra integrados:
   - `📄 Muestra MusicXML (.musicxml)`: Carga el himno *"Cántico Nuevo"*.
   - `📝 Muestra ChordPro (.chordpro)`: Carga el coro *"Alabad al Señor"*.
5. El sistema procesará el archivo en milisegundos:
   - Validará la sintaxis XML o la estructura de directivas ChordPro.
   - Verificará que las sumas de tiempos por compás coincidan con la métrica.
   - Convertirá el documento al modelo canónico inmutable.
6. **Resultado exitoso:** Aparecerá un mensaje verde con el título detectado y el número de compases reconocidos. La partitura se proyectará de inmediato en el visor musical.
7. **Si el archivo está dañado:** Aparecerá un cuadro rojo detallando el código y la causa exacta del error (ej. compás incompleto, etiqueta XML no cerrada, archivo superior a 5MB).

---

## 11. REPRODUCCIÓN DE AUDIO, DESCARGAS E INVENTARIO OFFLINE

**Estado:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO  
**Componentes:** `AudioPlayerBar.tsx`, `OfflineStatusBar.tsx`, `OfflineInventoryModal.tsx`, `DownloadActionButton.tsx`  
**Rutas API:** `GET /api/v1/songs/:id/audio`, `POST /api/v1/audio/:id/ticket`, `GET /api/v1/audio/:id/stream`, `GET /api/v1/audio/:id/download`

### 11.1 Reproducción de Pistas de Audio en el Atril
1. En la barra de reproducción (`AudioPlayerBar`), si la canción activa tiene pistas de referencia grabadas por el ministerio, aparecerá el selector desplegable con los audios disponibles.
2. Al presionar el botón de reproducción nativo:
   - **Si está conectado a internet:** El sistema solicita un boleto de transmisión seguro (*ticket* temporal de 60 segundos) que permite reproducir el audio con avance y retroceso instantáneo (*Range requests HTTP 206*) sin exponer tokens de acceso en URLs públicas.
   - **Si está sin conexión:** El reproductor carga de forma transparente el archivo binario almacenado en la memoria local IndexedDB de su dispositivo mediante una URL de objeto segura.

### 11.2 Descarga de Material para Uso sin Conexión (*Offline*)
1. En cualquier listado (en el catálogo de canciones o en el modal de repertorios), observará el botón de descarga con ícono de nube: **Descargar Offline**.
2. Al hacer clic:
   - El sistema descarga la estructura de la canción o el paquete completo del repertorio con todas sus obras asociadas.
   - Si la canción tiene audio de referencia, descarga el archivo binario.
   - **Verificación Criptográfica Estricta (R1-A):** El cliente compara los bytes recibidos contra el resumen criptográfico SHA-256 enviado por el servidor (`X-Checksum-Sha256`). Si los bytes no coinciden exactamente, la descarga se descarta para evitar archivos corruptos en el atril.
3. El botón cambiará su estado a: **✓ Guardado Offline**.

### 11.3 Gestión del Inventario Offline
1. En la barra de conectividad superior, haga clic en el botón **📦 Inventario Offline (N)** (`#btn-open-offline-inventory`).
2. Se abrirá la ventana de gestión de almacenamiento local, donde podrá:
   - Ver la lista de canciones, repertorios y audios guardados en ese dispositivo.
   - Consultar el espacio total ocupado en disco (en Megabytes o Kilobytes).
   - Probar y escuchar audios locales directamente con el botón de vista previa.
   - Liberar espacio en su tableta o computador haciendo clic en el ícono de papelera **Eliminar Copia Local**. *(Nota: Esta acción solo borra el archivo de ese dispositivo; jamás borra nada de la base de datos central de la iglesia).*

---

## 12. SESIONES MULTIPISTA (MULTITRACK) Y PISTAS INDIVIDUALES

**Estado:** PARCIALMENTE IMPLEMENTADO / REQUIERE VALIDACIÓN MANUAL  
**Backend:** IMPLEMENTADO Y VERIFICADO EN CÓDIGO (`backend/src/interfaces/http/routes/multitrack.routes.ts`, `multitrack-service.ts`)  
**Frontend UI:** NO IMPLEMENTADO EN INTERFAZ GRÁFICA

### 12.1 Qué Existe Actualmente en el Sistema
- **Base de Datos y API del Servidor:**
  El servidor dispone de tablas relacionales dedicadas (`multitrack_sessions` y `multitrack_tracks`) y rutas REST completas (`/api/v1/multitrack/sessions`) para crear sesiones multipista, asociar pistas de audio individuales (*stems*: batería, bajo, guitarras, teclados, metales, coros, voz guía), ajustar volumen individual, paneo estéreo, silenciamiento (*mute*) y solo (*solo*).
- **Protección de Seguridad R1-A:** Se encuentra verificado que no es posible asociar pistas de audio de una canción a la sesión de otra diferente (*Anti-IDOR / Cross-Song Isolation*).
- **Motor Lógico en Cliente:** Existe la clase `MultitrackEngine` que implementa la matemática de mezcla y verificación de completitud offline.

### 12.2 Limitación Operativa para el Usuario Ordinario
- **Actualmente NO existe una consola gráfica de mezcla (mezclador de faders / pistas) en la pantalla de la aplicación.**
- La barra de audio actual (`AudioPlayerBar`) reproduce **únicamente pistas estéreo individuales o mezclas maestras completas**.
- Los líderes y músicos no deben buscar controles de balance individual de multipistas en la interfaz visual hasta que la interfaz de consola sea incorporada en un sprint posterior.

---

## 13. RECONOCIMIENTO ÓPTICO DE MÚSICA (OMR)

**Estado:** NO IMPLEMENTADO EN PRODUCCIÓN / DELIMITADO Y PROTEGIDO EN CÓDIGO  
**Módulo:** `backend/src/domain/omr/omr-provider.ts`, `omr-service.ts`

### 13.1 Realidad del Flujo de Reconocimiento
Es fundamental que el equipo de alabanza conozca la verdad técnica sobre la digitalización de partituras escaneadas o fotos en PDF:

1. **Estado del Motor:** En el servidor **NO existe instalado actualmente un motor ejecutable de reconocimiento óptico real** (como Audiveris de código abierto o un servicio de visión artificial en la nube).
2. **Cero Invención de Notas (Remediación R1-A):**
   - En versiones preliminares existía el riesgo de que el sistema generara compases prefabricados simulados para hacer parecer que reconocía partituras.
   - **Esto fue totalmente corregido y bloqueado.** Si se envía un archivo para reconocimiento OMR, el sistema devuelve obligatoriamente **cero compases (0 notas)** y un informe explícito: *"Motor de reconocimiento OMR no configurado en este servidor. Se requiere instalar y configurar un motor OMR real para extraer partituras automáticamente"*.
3. **Requisito Mandatorio de Aprobación Humana:**
   - Aun cuando se configure un motor real en el futuro, la arquitectura del sistema exige que cualquier salida de IA sea tratada estrictamente como **borrador preliminar (`isAiDraft: true`) en estado de revisión (`PENDING_REVIEW`)**.
   - Ninguna partitura escaneada puede entrar al catálogo canónico de la iglesia sin que un músico humano revise compás por compás y apruebe explícitamente la transcripción (`APPROVED_FOR_IMPORT`).
4. **Instrucción Práctica para el Músico:**
   Para ingresar nuevas canciones al sistema hoy, utilice siempre la importación de archivos digitales en formato **MusicXML** o **ChordPro** a través del botón *Importar Archivo*. No intente subir imágenes o fotografías de partituras en papel.

---

## 14. ROLES DE USUARIO Y PERMISOS DE ACCESO

Bethesda Worship Studio implementa un control de acceso basado en roles (RBAC) estricto. La siguiente tabla resume lo que cada integrante de la congregación puede y no puede hacer:

| Rol Litúrgico | Distintivo UI | Puede ver partituras | Puede cambiar atril | Crear/Editar Repertorios | Activar Culto en Vivo | Invitar Usuarios / Cambiar Roles | Eliminar Repertorios |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Super Administrador (`SUPER_ADMIN`)** | Rosa | Sí | Sí | Sí | Sí | Sí (por API) | Sí |
| **Administrador (`ADMIN`)** | Púrpura | Sí | Sí | Sí | Sí | Sí (por API) | Sí |
| **Líder de Alabanza (`WORSHIP_LEADER`)** | Azul | Sí | Sí | Sí | Sí | No | **No** (Bloqueado) |
| **Músico (`MUSICIAN`)** | Verde | Sí | Sí | No (Solo lectura) | No | No | No |
| **Lector / Espectador (`VIEWER`)** | Gris | Sí (Solo letra) | Sí | No (Solo lectura) | No | No | No |

*(Para una auditoría técnica profunda y trazabilidad de código de cada rol, consulte el informe complementario: [ROLE_IMPLEMENTATION_STATUS_AUDIT.md](../reports/ROLE_IMPLEMENTATION_STATUS_AUDIT.md)).*

---

## 15. ERRORES COMUNES Y RESOLUCIÓN DE PROBLEMAS

### 15.1 "Sesión expirada o no iniciada (HTTP 401)"
- **Causa:** Su sesión ha caducado por inactividad o ha abierto la aplicación en un navegador nuevo.
- **Solución:** Haga clic en **👤 Iniciar Sesión** e introduzca sus credenciales.

### 15.2 "No tiene los permisos suficientes para ejecutar esta acción (HTTP 403)"
- **Causa:** Intentó realizar una acción que su rol no tiene autorizada (ej. un músico intentando editar un repertorio o un líder intentando eliminarlo).
- **Solución:** Solicite a un Administrador o Pastor que realice la operación o que actualice su rol ministerial si fue promovido.

### 15.3 "Ya existe un setlist en estado ACTIVE (HTTP 409 Conflicto)"
- **Causa:** Intentó activar un culto cuando el culto anterior aún sigue marcado como activo en la base de datos.
- **Solución:** Abra el modal de repertorios, busque el setlist en curso y cámbielo a `COMPLETED` (Finalizado). Luego podrá activar el nuevo servicio.

### 15.4 "Esta canción no ha sido descargada para uso sin conexión"
- **Causa:** El dispositivo perdió el internet o está en modo desconectado e intentó abrir una canción que no había descargado previamente.
- **Solución:** Conecte el dispositivo momentáneamente a internet o a la red Wi-Fi de la iglesia, abra el catálogo y presione **Descargar Offline**. Una vez descargada, podrá desconectarse con total tranquilidad.

### 15.5 "El archivo supera el límite máximo seguro de 5 MB"
- **Causa:** El archivo MusicXML contiene imágenes incrustadas de alta resolución o datos redundantes excesivos.
- **Solución:** Exporte la partitura desde su editor musical (MuseScore/Finale) seleccionando compresión estándar MusicXML (`.musicxml` comprimido) o como archivo de texto plano ChordPro.

---

## 16. GUÍA DE PRIMER USO PASO A PASO (WALKTHROUGH)

Siga esta secuencia segura de 6 pasos para familiarizarse con el sistema desde cero:

### Paso 1: Acceso e Inicio de Sesión
1. Abra el navegador en `http://localhost:5173`.
2. Haga clic en **👤 Iniciar Sesión**.
3. Ingrese las credenciales suministradas por el equipo técnico. Si es el primer ingreso con clave provisional, defina su nueva clave personal de al menos 10 caracteres.
4. Verifique que en la cabecera aparezca su nombre y distintivo de rol.

### Paso 2: Apertura de una Canción Canónica
1. En la barra de catálogo, haga clic en el botón de píldora: **Sublime Gracia (Notación Completa — Sol Mayor)**.
2. Observe cómo la cabecera se actualiza indicando: *Tono de Concierto: Sol Mayor, Métrica: 4/4, BPM: 104*.

### Paso 3: Configuración del Atril para su Instrumento
1. Vaya a la sección **Instrumento** y seleccione su instrumento real (ej. *Guitarra Acústica*).
2. En los formatos de lectura rápida, haga clic en **🎸 Tablatura** o en **𝄢 Cifrado con Letra**.
3. Si es guitarrista, aumente la **Cejilla (Capo)** a traste 2 y observe cómo la tablatura se adapta al instante.
4. Cambie el cifrado a **Latino / Solfeo** y compruebe que los acordes ahora se leen como *Sol, Do, Re, Mi menor*.

### Paso 4: Ensayo con Desplazamiento Automático Manos Libres
1. En la barra de autoscroll, seleccione la velocidad `1.0x`.
2. Presione la **Barra Espaciadora** de su teclado.
3. Observe cómo la partitura comienza a descender de forma suave y continua.
4. Presione la **Barra Espaciadora** nuevamente para pausar, o presione **Escape** para detener.

### Paso 5: Preparación de un Repertorio Litúrgico (Si es Líder o Administrador)
1. Haga clic en **📋 Repertorios de Culto (Setlists)**.
2. Haga clic en **+ Nuevo Repertorio**, asigne el nombre *"Servicio de Prueba"* y guarde.
3. Haga clic en **⚙️ Administrar / Ver Ítems**.
4. Agregue *"Sublime Gracia"* con tono de culto en La Mayor (+2 semitonos).
5. Agregue un momento devocional: *"Oración Pastoral"* (5 minutos, Pad en La Mayor).
6. Haga clic en **Cargar en Atril**.
7. Compruebe cómo la barra dorada de navegación le permite avanzar de la alabanza al momento de oración con un solo clic.

### Paso 6: Verificación de Resiliencia sin Conexión
1. En el modal de repertorios, haga clic en **Descargar Repertorio**.
2. Abra el **📦 Inventario Offline** y compruebe que el setlist y sus canciones figuren con visto bueno verde.
3. Si está en un portátil o tableta, desconecte el Wi-Fi.
4. Navegue entre las canciones del repertorio: el atril responderá con la misma velocidad sin requerir internet.

---

## 17. LISTA DE CHEQUEO PARA VALIDACIÓN MANUAL

Imprima o mantenga a mano esta lista para validar el funcionamiento del atril en su iglesia:

- [ ] **Acceso y Seguridad:**
  - [ ] El modal de inicio de sesión abre y cierra con teclado (`Esc`) y ratón.
  - [ ] Al iniciar sesión, el distintivo muestra el nombre y rol correcto.
  - [ ] El botón de cerrar sesión limpia la pantalla y purga la sesión.
- [ ] **Atril y Notación:**
  - [ ] Al seleccionar *Guitarra Acústica*, se habilita la tablatura y la cejilla.
  - [ ] Al seleccionar *Saxofón Alto*, las notas se transportan automáticamente a Mi Mayor escrito.
  - [ ] Al alternar entre Cifrado Americano y Latino, los acordes cambian correctamente de C/D/G a Do/Re/Sol.
  - [ ] El autoscroll avanza fluidamente y responde a la barra espaciadora.
- [ ] **Liturgia y Repertorios:**
  - [ ] Los repertorios solo son accesibles para usuarios autenticados.
  - [ ] Se puede crear un setlist, agregar canciones y momentos de servicio.
  - [ ] El reordenamiento (Subir/Bajar) persiste el orden tras recargar la pantalla.
  - [ ] La barra de atril litúrgico avanza determinísticamente ítem por ítem.
  - [ ] Al desviarse a una canción fuera del repertorio, el botón *"Volver al Culto"* restaura la posición exacta.
- [ ] **Modo Offline:**
  - [ ] El botón *"Descargar Offline"* guarda canciones en IndexedDB.
  - [ ] Al apagar la red Wi-Fi, la barra superior muestra *"Modo Sin Conexión — Solo Lectura"*.
  - [ ] Las canciones descargadas se pueden abrir y tocar en el atril sin internet.

---

## 18. MATRIZ DE DISPONIBILIDAD DE FUNCIONALIDADES

| Funcionalidad / Módulo | Estado Oficial de Implementación | Componente / Referencia de Código | Observaciones Operativas |
| :--- | :---: | :--- | :--- |
| **Autenticación JWT y RBAC** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `LoginModal.tsx`, `auth.routes.ts` | 5 roles definidos, Argon2id, cookies HttpOnly, rate limiting dual. |
| **Gestión de Usuarios en UI** | **NO IMPLEMENTADO O NO VERIFICADO** | N/A (Solo backend `/api/v1/users/invite`) | Invitaciones y altas de nuevos roles deben realizarse por API o base de datos. |
| **Catálogo Canónico Local** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `presets.ts`, `SongSelector.tsx` | Presets dorados para guitarra, piano, saxo alto y voz. |
| **Catálogo en PostgreSQL** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `DatabaseSongsModal.tsx`, `song.routes.ts` | Listado, búsqueda, carga y persistencia en base de datos central. |
| **Atril: Instrumentos (12 perfiles)** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `instrument-profile.ts`, `InstrumentSelector.tsx` | Guitarras, bajo, pianos, vientos, percusión, voces y general. |
| **Atril: Transporte y Cejilla** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `CapoControl.tsx`, `TranspositionControl.tsx` | Cejilla 0-12 trastes, transposición ±11 semitonos con enarmonía. |
| **Atril: Cifrados (4 sistemas)** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `ChordNotationControl.tsx` | Americano, Latino/Solfeo, Grados Romanos, Nashville. |
| **Atril: Desplazamiento Manos Libres** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `AutoscrollControl.tsx`, `use-autoscroll.ts` | Desplazamiento suave por software y teclado. Cero pedales físicos. |
| **Persistencia de Preferencias** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `reading-format-selector-component.ts` | Persiste instrumento y vista en PostgreSQL `/users/me/preferences`. |
| **Gestión de Repertorios (Setlists)** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `SetlistsModal.tsx`, `SetlistDetailEditor.tsx` | Creación, edición, adición polimórfica, reordenamiento atómico. |
| **Atril Litúrgico en Vivo** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `SetlistNavigationToolbar.tsx`, `ServiceMomentCard.tsx` | Secuencia guiada, momentos de oración sin partituras, retorno al culto. |
| **Ingesta MusicXML y ChordPro** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `SourceFileUploader.tsx`, `ingestion-service.ts` | Normalización canónica estricta, validación de compases, límite 5MB. |
| **Almacenamiento Offline (IndexedDB)** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `offline-manager.ts`, `indexeddb-storage.ts` | Paquetes de culto y canciones completas para uso sin internet. |
| **Audio: Streaming con Tickets** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `AudioPlayerBar.tsx`, `audio.routes.ts` | Streaming con Range requests (HTTP 206) mediante boletos temporales de 60s. |
| **Audio: Descarga con Checksum SHA-256** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `offline-manager.ts`, `audio-service.ts` | Verificación criptográfica estricta contra `X-Checksum-Sha256` y `ETag`. |
| **Sesiones Multipista (Backend API)** | **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | `multitrack.routes.ts`, `multitrack-service.ts` | Rutas REST completas con aislamiento anti-IDOR y transacciones. |
| **Consola Gráfica Multipista (UI)** | **NO IMPLEMENTADO O NO VERIFICADO** | N/A en `frontend/src/components` | Solo existe motor lógico; no hay interfaz gráfica de faders/mezclador. |
| **Reconocimiento OMR en Producción** | **NO IMPLEMENTADO O NO VERIFICADO** | `omr-provider.ts` | Sin motor real configurado; devuelve 0 compases para garantizar cero invención. |
| **Sincronización por Pedales Físicos** | **NO IMPLEMENTADO O NO VERIFICADO** | N/A (Exclusión mandatoria) | Prohibida expresamente por diseño y arquitectura en toda la plataforma. |

---

## 19. GLOSARIO DE TERMINOLOGÍA TÉCNICA Y MUSICAL

- **AlphaTab:** Motor informático especializado en dibujar tablaturas de guitarra y bajo, mástiles y posiciones de dedos en cuerdas.
- **Armadura de Clave (*Key Signature*):** Conjunto de sostenidos (#) o bemoles (b) al inicio del pentagrama que indican la tonalidad principal de la obra.
- **Atril Digital:** Pantalla interactiva que proyecta la música y se adapta a las preferencias individuales del músico.
- **BPM (*Beats Per Minute*):** Pulsaciones por minuto; unidad de medida del tiempo o velocidad métrica de una canción.
- **Capodastro / Cejilla (*Capo*):** Dispositivo que presiona las cuerdas en un traste de la guitarra para elevar su afinación manteniendo las digitaciones abiertas.
- **ChordPro:** Formato estándar de texto plano estructurado donde los acordes se escriben entre corchetes dentro de la letra (ej. `[Do]Santo, [Sol]Santo`).
- **Enarmonía:** Principio musical donde dos notas con nombres diferentes producen el mismo sonido físico (ej. Sol sostenido y La bemol).
- **IndexedDB:** Base de datos interna del navegador web que almacena canciones, repertorios y audios de forma permanente para que funcionen sin internet.
- **Lead Sheet:** Hoja guía que presenta únicamente la melodía principal, los acordes y la letra, habitual para cantantes y directores.
- **MusicXML:** Formato digital estándar universal para intercambio de partituras y notación musical entre diferentes programas profesionales.
- **OMR (*Optical Music Recognition*):** Reconocimiento Óptico de Música; tecnología para escanear partituras impresas y convertirlas a código digital.
- **OSMD (*OpenSheetMusicDisplay*):** Motor de código abierto que procesa MusicXML y lo dibuja en pantalla como partitura tradicional mediante gráficos vectoriales (SVG).
- **RBAC (*Role-Based Access Control*):** Control de acceso basado en roles; mecanismo de seguridad que restringe las acciones del sistema según el cargo ministerial del usuario.
- **Setlist (Repertorio):** Lista ordenada de himnos, coros y momentos espirituales programados para un culto o reunión específica.
- **Tono de Concierto (*Concert Pitch*):** El tono real absoluto que suena en el ambiente (referencia universal en afinación Do central).
- **Tono Escrito (*Written Pitch*):** Las notas que un músico de instrumento transpositor (como saxofón o trompeta) lee en su pentagrama para que al soplar coincida con el tono de concierto de la banda.
- **TPQN (*Ticks Per Quarter Note*):** Resolución de tiempo canónica interna del sistema (fijada en 960 pulsos por negra) para máxima precisión rítmica.

---

## 20. LIMITACIONES DE LA DOCUMENTACIÓN Y FECHA DE REVISIÓN

- **Fecha de Auditoría y Redacción:** 18 de octubre de 2026.
- **Base Técnica Verificada:** Repositorio oficial en rama `main`, commit base `e89f5a9` posterior a la remediación independiente Sprint R1-A (623 pruebas automatizadas ejecutadas y superadas con 100% de éxito).
- **Limitaciones Expresas:**
  - Esta guía describe con fidelidad matemática lo que el código fuente y las pruebas vigentes ejecutan hoy. No promete funciones que solo existan en planes futuros o maquetas visuales.
  - **No se declara preparación para producción comercial (*Production Readiness*):** La puesta en marcha definitiva en el presbiterio de la Iglesia Cristiana Bethesda permanece sujeta a las pruebas y validación manual directa por parte del Propietario del Proyecto y el liderazgo pastoral.

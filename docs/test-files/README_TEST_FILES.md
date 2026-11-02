# WORSHIP STUDIO — CONJUNTO DE ARCHIVOS DE PRUEBA MANUAL

Este directorio contiene los archivos musicales y documentos reales preparados para la verificación y prueba manual de **Bethesda Worship Studio**.

Todos los archivos provienen directamente de los fixtures oficiales del repositorio, han sido verificados byte por byte mediante sumas de comprobación SHA-256 y cumplen con los límites de tamaño y reglas de validación del sistema.

---

## 1. PAQUETE Y ARCHIVOS DISPONIBLES

Los archivos pueden ser descargados de forma individual o comprimidos en un solo archivo ZIP:

- **Archivo Comprimido:** [`WORSHIP_STUDIO_MANUAL_TEST_FILES.zip`](./WORSHIP_STUDIO_MANUAL_TEST_FILES.zip) (1,351,542 bytes)
- **Directorio Local:** `docs/test-files/`

### Inventario de Archivos y Sumas de Comprobación SHA-256:

| Archivo | Tamaño | Límite Máximo | Origen en Repositorio | SHA-256 |
|---|---|---|---|---|
| **`WORSHIP_TEST_FULL_SCORE.musicxml`** | 2,822 bytes (2.75 KB) | 5 MB | `frontend/src/core/ingestion/fixtures/files/valid_full_score.musicxml` | `710FF9AAAF30ADDA82B82348903E0668034924BDD926791490EE9C7A2C3D1253` |
| **`WORSHIP_TEST_LEAD_SHEET.chordpro`** | 319 bytes (0.31 KB) | 5 MB | `frontend/src/core/ingestion/fixtures/files/valid_lead_sheet.chordpro` | `21B71C862062AFB5928616C4CA4C9AC69D2879529920890F9A3A35F4C72D3605` |
| **`WORSHIP_TEST_CMB_AZUL.pdf`** | 840,426 bytes (820.73 KB) | 15 MB | `fixtures/documents/CMB_AZUL.pdf` | `12AB1265CCEF2306B63B5B5F9FFAC995C83B6C65E2D2BAFFD44158A59F049AD0` |
| **`WORSHIP_TEST_CMB_MUSIC.pdf`** | 824,820 bytes (805.49 KB) | 15 MB | `fixtures/documents/CMB_MUSIC.pdf` | `D7C22D4C949B614531E15BBF9DCD9900A3D7A2D245BBE4990B08C6D3FC130AE1` |

---

## 2. DETALLE DE PRUEBA POR ARCHIVO

### A. `WORSHIP_TEST_FULL_SCORE.musicxml` (Partitura Completa)
- **Obra:** *Sublime Gracia - Himno Canónico* (John Newton).
- **Contenido Musical:** Tonalidad de Sol Mayor (G Major), compás 4/4, tempo 120 BPM, clave de Sol, 2 compases con 4 notas melódicas, 3 acordes (`G`, `C`, `G`) y 4 sílabas líricas sincronizadas.
- **Formatos de Lectura Disponibles:**
  - `Partitura (Sheet Music)`: **DISPONIBLE**. Renderiza pentagramas tradicionales usando OSMD o AlphaTab.
  - `Cifrado con Letra (Chord Chart)`: **DISPONIBLE**. Renderiza acordes alineados sobre el texto.
  - `Letra Sola (Lyrics Only)`: **DISPONIBLE**. Renderiza solo la letra limpia.
  - `Tablatura (Tablature)`: **DISPONIBLE** (al seleccionar instrumento de cuerda con afinación, ej. Guitarra Acústica). AlphaTab calcula cuerdas y trastes reales nota a nota.
- **Formatos Inhabilitados:** Ninguno. Es una partitura estructurada completa.
- **Resultado Esperado:** 
  - Notificación de importación exitosa (MusicXML, 2 compases).
  - Los 4 botones de `ReadingFormatSelector` se encuentran activos.
  - Al cambiar de instrumento a *Piano Acústico*, la partitura se adapta a Gran Pentagrama (claves de Sol y Fa).
  - Al seleccionar *Saxofón Alto en Eb*, la tonalidad se transpone automáticamente a Mi Mayor escrito (+9 semitonos, 4 sostenidos).

---

### B. `WORSHIP_TEST_LEAD_SHEET.chordpro` (Guion de Acordes / Lead Sheet)
- **Obra:** *Cuán Grande es Dios* (En Espíritu y en Verdad).
- **Contenido Musical:** Tonalidad de Sol Mayor (G), tempo 120 BPM, métrica 4/4, secciones `{soc: Estrofa 1}` y `{soc: Coro}`, 8 acordes cifrados (`[G]`, `[Em]`, `[C]`, `[D]`) y 32 sílabas líricas.
- **Invariante Estricto:** **0 notas melódicas inventadas**.
- **Formatos de Lectura Disponibles:**
  - `Cifrado con Letra (Chord Chart)`: **DISPONIBLE**. Renderizado responsivo ultraliviano en `LeadSheetDOM`.
  - `Letra Sola (Lyrics Only)`: **DISPONIBLE**. Oculta los acordes y resalta la lírica congregacional.
- **Formatos Inhabilitados y Motivo:**
  - `Partitura (Sheet Music)`: **INHABILITADO**. Motivo: *"La canción no contiene notas melódicas (Lead Sheet Puro)."* El sistema no inventa notas melódicas ficticias para rellenar un pentagrama.
  - `Tablatura Melódica`: **INHABILITADA**. Motivo: *"Sin notas melódicas para calcular digitación en trastes."*
- **Resultado Esperado:**
  - Renderizado instantáneo en tarjetas semánticas de compás.
  - Al cambiar el control de Cejilla a *Capo 2*, los acordes se muestran como digitación de Fa Mayor (`F`, `Dm`, `Bb`, `C`) manteniendo el tono sonante inalterado.
  - Al alternar el sistema de cifrado a *Latino*, los acordes cambian a `Sol`, `Mi m`, `Do`, `Re`.

---

### C. `WORSHIP_TEST_CMB_AZUL.pdf` (Cancionero Azul — 55 Páginas)
- **Contenido:** Cancionero digital del Centro Misionero Bethesda con 54 canciones de alabanza y adoración (*Danzo en el río, Correré, Un Adorador, Gracia Sublime, A Danzar*, etc.). Diagramación en una y dos columnas.
- **Propósito de Prueba:**
  - Ingesta de documentos PDF pesados en el **Atril Visual** (`VisualDocumentStand`).
  - Navegación fluida por páginas (`Pág. 1 de 55`).
  - Alternancia entre modo *Flujo Continuo* y *Página Única*.
  - Zoom interactivo (50% a 200%), botón *Ajustar Ancho* y rotación (`0°`, `90°`, `180°`, `270°`).
  - Desplazamiento automático manos libres con la barra de **Autoscroll**.
  - Extracción de canciones en dos columnas y acordes mediante `PdfTextExtractor` en backend.
- **Formatos Inhabilitados:** Los botones de notación interactiva (`ReadingFormatSelector`) permanecen inactivos para el documento visual crudo; el atril despliega fielmente el PDF original sin alterar su diseño.

---

### D. `WORSHIP_TEST_CMB_MUSIC.pdf` (Cancionero Generación de Fuego — 74 Páginas)
- **Contenido:** Cancionero digital con 73 canciones de alabanza congregacional (*Hay una fuente en mí, Cuando pienso lo lindo que es, Venimos ante ti*, etc.). Incluye tablaturas ASCII de solo de guitarra (ej. en *"Como el color de la sangre"* de Alex Campos).
- **Propósito de Prueba:**
  - Prueba de estabilidad para documentos PDF extensos (74 páginas).
  - Verificación de anclaje de páginas en flujo continuo.
  - Prueba de rendimiento de streaming seguro mediante tickets temporales (`GET /api/v1/documents/:storageKey/file`).
  - Extracción de canciones y detección de acordes transponibles en superíndices (`C^D`, `G^A`).

---

## 3. GUÍA PASO A PASO PARA UTILIZAR LOS ARCHIVOS EN WORSHIP STUDIO

1. **Abrir la Aplicación:**
   - Asegúrese de que el backend esté ejecutándose (`http://localhost:3001/api/v1/health` responde `status: "ok"`).
   - Inicie sesión o ingrese al frontend en `http://localhost:5173`.
2. **Importar Archivo:**
   - En la barra superior, presione el botón **"Importar Archivo"** (🎼).
   - Arrastre `WORSHIP_TEST_FULL_SCORE.musicxml` o presione *"examinar desde tu dispositivo"* y selecciónelo.
   - Verifique el mensaje de éxito verde.
3. **Probar Formatos y Controles:**
   - En `ReadingFormatSelector`, alterne entre **Partitura**, **Cifrado con Letra**, **Letra Sola** y **Tablatura**.
   - Pruebe la transposición de semitonos (`+1` / `-1`).
   - Cambie de instrumento a *Guitarra Acústica* o *Piano Acústico*.
4. **Guardar y Verificar Persistencia:**
   - Presione **"Canciones en BD"** (🗄️) y haga clic en **"Guardar Canción Activa en Base de Datos"**.
   - Cierre el modal, cargue otra canción y vuelva a abrir **"Canciones en BD"**.
   - Presione **"Cargar en Atril"** sobre la canción guardada y verifique que conserva la insignia `💾 PostgreSQL (v1)`.
5. **Probar los Cancioneros PDF:**
   - En el importador, cargue `WORSHIP_TEST_CMB_AZUL.pdf`.
   - Navegue por las páginas usando los botones o las teclas `Flecha Izquierda` y `Flecha Derecha`.
   - Active el modo *Flujo Continuo* (tecla `C`) y presione *Play* en el control de Autoscroll para verificar el avance automático manos libres.


# BETHESDA WORSHIP STUDIO — AUDITORÍA TÉCNICA Y PREFLIGHT
## CONVERSIÓN INTELIGENTE DE DOCUMENTOS MUSICALES Y FORMATOS SELECCIONABLES DE ATRIL

- **Fecha:** 23 de Octubre de 2026
- **Rama Actual:** `main` (limpia, sincronizada con origen)
- **Autor:** Senior Software Architect, Music Information Retrieval & OMR Specialist
- **Archivos de Aceptación:** `fixtures/documents/CMB_AZUL.pdf` (55 páginas, 840 KB) y `fixtures/documents/CMB_MUSIC.pdf` (74 páginas, 824 KB)
- **Estado del Informe:** AUDITORÍA TÉCNICA Y PLAN ARQUITECTÓNICO APROBADO PARA EJECUCIÓN

---

## 1. ESTADO DEL REPOSITORIO Y COMPILACIÓN BASE

Antes de iniciar modificaciones, se realizó la inspección exhaustiva de la base de código y la verificación estática:
1. **Backend (`@bethesda/backend`):**
   - Node.js v20.18.0 / Fastify v5.2.1 / Drizzle ORM v0.39.3 / PostgreSQL / TypeScript v5.7.3.
   - `npm run typecheck` → **0 errores**.
   - `npm test` → **341 / 341 pruebas pasando** (62 suites).
2. **Frontend (`@bethesda/frontend`):**
   - React v19.3.0 / Vite v8.3.0 / AlphaTab v1.8.4 / OSMD v2.1.2 / TypeScript v7.0.2.
   - `npm run typecheck` → **0 errores**.
   - `npm test` → **420 / 420 pruebas pasando** (65 suites).
3. **Invariantes Arquitectónicos Consolidados:**
   - Cero invención o fabricación de notas melódicas, acordes o compases ficticios.
   - Preservación íntegra de RBAC, aislamiento multitenant y tickets de transmisión de un solo uso o cuota acotada (60s TTL).
   - Inmutabilidad estricta de `CanonicalMusicPayload` a 480 TPQN.

---

## 2. ANÁLISIS EXHAUSTIVO DE LOS DOCUMENTOS DE ACEPTACIÓN REALES

Se inspeccionaron directamente los binarios y los flujos de contenido de `CMB AZUL.pdf` y `CMB MUSIC.pdf`:

### 2.1 `CMB AZUL.pdf` (Cancionero Azul — Centro Misionero Bethesda)
- **Páginas:** 55 páginas.
- **Estructura:**
  * Página 1 (Pág. 0): Portada institucional "Ministerio de Alabanza".
  * Páginas 2-3 (Pág. 1-2): "Tabla de contenido" con 54 títulos de canciones indexadas con número de página.
  * Páginas 4-55 (Pág. 3-54): 54 canciones de alabanza y adoración de autores reconocidos (*Miel San Marcos, Marco Barrientos, Marcos Witt, Hillsong, Danilo Montero, Jaime Murrell, Barak, Un Corazón*, etc.).
- **Naturaleza del Contenido:**
  * **Tipografía y streams:** No son escaneos rasterizados planos; son documentos PDF vectoriales/digitales con operadores de texto estándar (`BT`, `ET`, `Tm`, `Tj`, `TJ`) comprimidos con `FlateDecode`.
  * **Distribución:** Páginas con diagramación en dos columnas (ej. Pág. 4: Columna izquierda *"Danzo en el rio"*, Columna derecha *"Fiesta"*) y páginas de una sola columna para canciones extensas.
  * **Contenido Musical Presente:** Letras completas, acordes cifrados en notación americana sobre las sílabas líricas (`G`, `Bm`, `F#m`, `Em`, `A`, `Eb`, `Bb/D`), etiquetas de sección litúrgica (`VERSO 1`, `CORO:`, `PUENTE:`, `INSTRUMENTAL`, `PRE-CORO`), intros armónicas (`Intro: ////Bm - G - D - A////`).
  * **Tablaturas y Riffs:** Ciertas páginas incluyen líneas de solo o riff instrumental en formato texto / tablatura ASCII:
    - Pág. 14 (*"porque la reina"* de Jaime Murrell):
      `INTRO: en guitarra (x4)`
      `E-------17--15--13--------`
      `B-25-25---25--25--27-25-23`
      `SOLO BAJO: (slap)`
      `G---19-19-19-17slide19----------------`
    - Pág. 17 (*"Cantaremos de tu gran amor"* de Barak):
      `Intro Guitarra (punteo 2 veces): 1° cuerda... 2° cuerda -----3---3--4----6--- 3° cuerda ---0---3------3------`.
  * **Contenido Musical Ausente:** **CERO pentagramas, CERO notas con figuras rítmicas tradicionales, CERO compases de partitura formal.**

### 2.2 `CMB MUSIC.pdf` (Cancionero Generación de Fuego — CMB)
- **Páginas:** 74 páginas.
- **Estructura:**
  * Página 1: Portada institucional "Ministerio de Alabanza - Generación de Fuego".
  * Páginas 2-5 (Páginas 1-4 de índice): Índice general con 73 canciones indexadas.
  * Páginas 6-74 (Páginas 5-73): Canciones de alabanza y adoración congregacional (*Juan Carlos Alvarado, Danilo Montero, Marcos Witt, Alex Campos, Daniel Calveti, Marco Barrientos, Hillsong*, etc.).
- **Naturaleza del Contenido:**
  * **Tipografía y streams:** PDF digital con streams `FlateDecode` y coordenadas cartesianas precisas (`Tm`).
  * **Contenido Musical Presente:** Acordes cifrados alineados sobre la letra, anotaciones de doble acorde para modulación / transporte en superíndices (ej. Pág. 6: `C^D`, `G^A`, `F^G`, `E-^F#-`, `A-^B-`), estrofas, coros, intros.
  * **Tablaturas y Solos:** Pág. 13 (*"COMO EL COLOR DE LA SANGRE"* de Alex Campos) incluye tablatura de solo de guitarra en texto:
    `B--6-4-3----6-4-3---3-----3-`
    `G-------5-3-------3---3-5---5--3-2`
  * **Contenido Musical Ausente:** **CERO pentagramas, CERO notas de partitura tradicional.**

---

## 3. AUDITORÍA DE COMPONENTES EXISTENTES Y CAPACIDADES REUTILIZABLES

| Componente | Archivo Fuente | Estado Actual | Potencial de Reutilización |
|---|---|---|---|
| **`ChordProImporter`** | `frontend/src/core/ingestion/chordpro/chordpro-importer.ts` | Parsea directivas ChordPro `{title}`, `{key}`, `{tempo}`, acordes entre corchetes `[C]`, lírica y secciones. Genera `CanonicalMusicPayload` a 480 TPQN sin fabricar notas. | **100% Reutilizable.** Es el motor canónico ideal una vez que el texto o PDF se normaliza a ChordPro. |
| **`MusicXmlImporter`** | `frontend/src/core/ingestion/musicxml/musicxml-importer.ts` | Parsea MusicXML completo (notas, silencios, compases, claves, voces, articulaciones, armaduras). | **100% Reutilizable** para entradas estructuradas formales. |
| **`ProjectionService`** | `frontend/src/core/projection/projection-service.ts` | Transforma `CanonicalMusicPayload` hacia `DerivedMusicalView` según instrumento, transposición, cejilla y representación (`STANDARD_NOTATION`, `CHORDS`, `LYRICS`, `TABLATURE`). | **100% Reutilizable.** Soporta nativamente las 4 representaciones. |
| **`TablatureCalculator`** | `frontend/src/core/projection/tablature-calculator.ts` | Mapea alturas canónicas a posiciones de cuerda y traste de guitarra y bajo respetando afinaciones y cejillas. | **Reutilizable** cuando existen alturas canónicas o acordes estructurados. |
| **`LeadsheetDomAdapter`** | `frontend/src/core/rendering/adapters/leadsheet-dom-adapter.ts` | Renderiza acordes alineados sobre lírica con soporte de transposición y notación latina/americana en el DOM. | **100% Reutilizable** para el formato **Cifrado con Letra**. |
| **`OsmdAdapter`** | `frontend/src/core/rendering/adapters/osmd-adapter.ts` | Renderiza pentagramas estructurados usando OpenSheetMusicDisplay a partir de MusicXML. | **100% Reutilizable** para el formato **Partitura**. |
| **`AlphaTabAdapter`** | `frontend/src/core/rendering/adapters/alphatab-adapter.ts` | Renderiza tablatura y notación estándar usando AlphaTab. | **100% Reutilizable** para el formato **Tablatura**. |
| **`VisualDocumentStand`** | `frontend/src/components/workspace/VisualDocumentStand.tsx` | Visualiza PDFs e imágenes originales con zoom, rotación, flujo continuo y descarga de blobs con token/ticket. | **100% Reutilizable** como vista de documento original de referencia. |
| **`OmrService`** | `backend/src/application/omr-service.ts` | Gestión de propuestas preliminares de IA con `isAiDraft: true`, regiones no reconocidas y aprobación humana obligatoria. | **Reutilizable** como contrato para ingesta OMR. |

---

## 4. BRECHAS IDENTIFICADAS (GAPS)

1. **Brecha 1 — Extracción de Texto y Detección "Chord-Over-Text":**
   El código actual trataba a los archivos PDF e imágenes como puramente visuales (`isVisualOnly: true`, compases = 0) sin intentar extraer el texto, las líneas de acordes o las secciones cuando el documento es digitalmente legible.
2. **Brecha 2 — Conversor Inteligente de Cifrado Plano a Estructura Musical:**
   No existía un analizador que detecte líneas de acordes colocadas espacialmente sobre líneas de letra (como en `CMB AZUL.pdf` y `CMB MUSIC.pdf`) y las transforme deterministamente en formato canónico/ChordPro.
3. **Brecha 3 — Selector de Formato de Atril en la Ingesta (Paso 4):**
   El músico no disponía de un modal de previsualización que le permita elegir entre los 4 formatos:
   * **Partitura** (Sheet Music)
   * **Cifrado con Letra** (Chords with Lyrics)
   * **Letra Sola** (Lyrics Only)
   * **Tablatura** (Tablature)
4. **Brecha 4 — Paso de Revisión y Corrección Humana (Paso 3):**
   No había interfaz para que el músico valide el título detectado, el artista, el tono musical y la letra/acordes antes de aceptar la conversión.
5. **Brecha 5 — Explicación Educativa y Honesta de Formatos No Disponibles:**
   Si un usuario carga un cancionero cifrado (como `CMB AZUL.pdf`), no se le explicaba claramente por qué la "Partitura" no se puede generar (falta de pentagramas/notas melódicas en el origen).

---

## 5. RIESGOS TÉCNICOS Y ESTRATEGIA DE MITIGACIÓN

| Riesgo | Probabilidad | Impacto | Estrategia de Mitigación |
|---|---|---|---|
| **Invención de notas en Partitura para cancioneros cifrados** | Alta si se usara IA no controlada | Inadmisible (Viola mandato) | **Bloquear deterministamente** la opción de Partitura cuando el documento solo contiene cifrado y letra. Mostrar alerta clara: *"El documento de origen es un cifrado armónico. Carece de pentagramas y notas melódicas necesarias para generar partitura."* |
| **Especulación de digitaciones en Tablatura** | Alta | Alto | Si el documento es un cifrado con acordes, la tablatura ofrece las posiciones de acordes (voicings de acordes con afinación estándar de guitarra E-A-D-G-B-E) o la tablatura de solos/riffs ASCII detectados, indicando explícitamente que no es una transcripción melódica nota por nota. |
| **Colapso de columnas en PDF de 2 columnas** | Media | Alto | El extractor de texto agrupa los bloques por su coordenada horizontal `X`: bloque izquierdo (`X < 300`) y bloque derecho (`X >= 300`), procesando cada canción de forma independiente para evitar mezclar letras de canciones distintas. |
| **Pérdida de la conversión al refrescar** | Media | Alto | La canción convertida y aprobada se persiste en PostgreSQL mediante `POST /api/v1/songs` o `POST /api/v1/songs/:id/versions`, quedando durablemente disponible en el catálogo de base de datos. |

---

## 6. PLAN DE IMPLEMENTACIÓN EN 6 ETAPAS

1. **Etapa 1 — Auditoría y Preflight:** Documentación de auditoría (`MUSIC_DOCUMENT_CONVERSION_AUDIT.md`) completada.
2. **Etapa 2 — Motor de Detección y Extracción "Chord-over-Text" & Riffs:**
   - Crear extractor y clasificador `DocumentTextExtractor` en backend/frontend.
   - Crear analizador `ChordSheetParser` que convierte texto con acordes superiores a ChordPro canónico, preservando títulos, secciones, acordes y letra.
3. **Etapa 3 — Servicio de Conversión y Evaluación de Capacidades de los 4 Formatos:**
   - Evaluar qué formatos son viables para cada página/documento.
   - Generar diagnósticos estructurados y explicaciones de formatos bloqueados.
4. **Etapa 4 — Modal Interactivo de Revisión, Corrección y Selección de Formato:**
   - Previsualización en frontend con campos editables (Título, Artista, Tono, Compás).
   - Selector visual de los 4 formatos de atril con tarjetas informativas de viabilidad.
   - Renderizado en atril digital y acceso permanente al documento visual original.
5. **Etapa 5 — Persistencia Canónica y Versionado en Base de Datos:**
   - Integración con endpoints de `SongService` y persistencia de versiones derivadas.
6. **Etapa 6 — Verificación, Matriz de Aceptación de los PDFs de Muestra y Cierre:**
   - Ejecución de pruebas no-browser.
   - Generación de reportes finales (`IMPLEMENTATION_REPORT` y `MANUAL_ACCEPTANCE`).

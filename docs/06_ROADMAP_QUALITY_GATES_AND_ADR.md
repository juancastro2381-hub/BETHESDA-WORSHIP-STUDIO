# BETHESDA WORSHIP STUDIO
## Documento 06: Stack Tecnológico, Estructura del Proyecto, Roadmap, Criterios de Aceptación y Registros de Decisión Arquitectónica (ADR)

---

## 1. Stack Tecnológico Recomendado y Justificación

Para garantizar robustez, velocidad, escalabilidad y una experiencia de usuario sobresaliente:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          STACK TECNOLÓGICO                             │
│                                                                        │
│  FRONTEND:                                                             │
│   • React 18+ con TypeScript 5+ (Tipado estricto en el modelo musical) │
│   • Vite (Compilación instantánea y HMR ultrarrápido)                  │
│   • TailwindCSS v3+ / CSS Modules (Diseño ergonómico de escenario)     │
│   • PWA (Vite PWA Plugin + Workbox para Offline-First total)           │
│   • alphaTab + OpenSheetMusicDisplay (Renderizado híbrido)             │
│   • Web Audio API nativo (Metrónomo y playback sin jitter)             │
│   • Dexie.js (Persistencia local en IndexedDB)                         │
│                                                                        │
│  BACKEND:                                                              │
│   • Python 3.12+ con FastAPI (Asincronía nativa, alto rendimiento)     │
│   • Pydantic v2 (Validación de esquemas y tipos a velocidad C)         │
│   • SQLAlchemy 2.0 Async + Alembic (ORM asíncrono y migraciones)       │
│   • Music21 / Mido / Librosa (Procesamiento musical de fondo)          │
│   • Celery / Redis (Workers de procesamiento de ingesta y audio)       │
│                                                                        │
│  PERSISTENCIA Y TIEMPO REAL:                                           │
│   • PostgreSQL 16+ con soporte JSONB e índices GIN                     │
│   • Redis 7+ (Caché volátil y broker de Pub/Sub para WebSockets)       │
│   • MinIO / Cloudflare R2 / AWS S3 (Almacenamiento de partituras/audio)│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Estructura de Directorios del Proyecto Recomendada

Se propone una arquitectura monorepo limpia (*Clean Architecture*) con separación estricta de responsabilidades:

```
bethesda-worship-studio/
├── docs/                                # Documentación de arquitectura y diseño
│   ├── 01_PRODUCT_VISION_AND_UX.md
│   ├── 02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md
│   ├── 03_PERFORMANCE_REHEARSAL_AND_REALTIME.md
│   ├── 04_INGESTION_AND_NOTATION_ENGINE.md
│   ├── 05_DATA_ARCHITECTURE_AND_API.md
│   └── 06_ROADMAP_QUALITY_GATES_AND_ADR.md
├── frontend/                            # Aplicación Cliente PWA (React + TS + Vite)
│   ├── public/
│   │   ├── fonts/smufl/                 # Bravura, Petaluma (glifos musicales)
│   │   ├── soundfonts/                  # Muestras acústicas para metrónomo y MIDI
│   │   └── icons/                       # Favicons y PWA Manifest
│   ├── src/
│   │   ├── core/                        # Núcleo musical agnóstico de UI
│   │   │   ├── music-theory/            # Cálculos de intervalos, transposición, enarmonías
│   │   │   ├── canonical-model/         # Tipos e interfaces canónicas (Song, Measure, Note)
│   │   │   └── audio-engine/            # Web Audio scheduler, metrónomo, player
│   │   ├── rendering/                   # Adaptadores de renderizado
│   │   │   ├── adapters/                # AlphaTabAdapter, OSMDAdapter, LeadSheetAdapter
│   │   │   └── components/              # CanvasContainer, SheetViewer, TabViewer
│   │   ├── features/                    # Módulos verticales por dominio de usuario
│   │   │   ├── performance-mode/        # Vista de atril, auto-scroll, pedal handler
│   │   │   ├── rehearsal/               # Controles de ensayo, bucles, tempo
│   │   │   ├── setlists/                # Gestión y ejecución de listas de culto
│   │   │   ├── song-catalog/            # Explorador y buscador de canciones
│   │   │   ├── song-editor/             # Editores Nivel 1 (rápido) y Nivel 2
│   │   │   └── real-time/               # WebSocket client, NTP sync, live listener
│   │   ├── offline/                     # IndexedDB repositories (Dexie) y sync queue
│   │   └── shared/                      # Componentes UI atómicos, hooks, temas
│   ├── index.html
│   ├── vite.config.ts
│   └── tsconfig.json
├── backend/                             # API Asíncrona (FastAPI + Python)
│   ├── app/
│   │   ├── core/                        # Configuración, seguridad JWT, base de datos
│   │   ├── domain/                      # Modelos de dominio y lógica pura de negocio
│   │   │   ├── music/                   # Transposición analítica, validación MusicXML
│   │   │   ├── identity/                # Usuarios, membresías y RBAC
│   │   │   └── worship/                 # Arreglos, setlists y sesiones
│   │   ├── infrastructure/              # Adaptadores externos
│   │   │   ├── db/                      # Modelos SQLAlchemy, repositorios
│   │   │   ├── storage/                 # Cliente S3 / MinIO
│   │   │   └── realtime/                # Gestor de conexiones WebSocket y Redis Pub/Sub
│   │   ├── ingestion/                   # Canal de importación (MusicXML, MIDI, Audio)
│   │   └── api/                         # Routers HTTP y WebSockets (v1)
│   ├── migrations/                      # Alembic migrations
│   ├── Dockerfile
│   └── requirements.txt
└── README.md
```

---

## 3. Hoja de Ruta de Implementación por Fases (Implementation Roadmap)

Para garantizar calidad y evitar acumulación de deuda técnica, el desarrollo se estructura en fases secuenciales con compuertas de salida (*Exit Gates*):

### FASE 0: Arquitectura, Descubrimiento y Especificación (FASE ACTUAL)
- **Objetivo:** Definir exhaustivamente los cimientos conceptuales, modelos de dominio y decisiones tecnológicas sin escribir código de producción.
- **Entregables:** Documentos arquitectónicos 01 al 07 y Blueprint Maestro.
- **Exit Gate:** Validación formal de desacoplamiento de instrumento/vista, modelo canónico único, separación Capo vs Transposición, ERD hardened y congelamiento estricto de alcance.

---

### FASE 1: Núcleo del Modelo Musical y Motor de Renderizado Básico
- **Objetivo:** Implementar la biblioteca matemática de teoría musical, el modelo canónico JSON y el renderizado funcional de partitura, tablatura y cifrado.
- **Alcance:**
  - Tipos canónicos en TypeScript y esquemas Pydantic v2.
  - Algoritmo de transposición analítica con preservación diatónica y enarmónica.
  - Separación formal de transposición musical (`transpositionSemitones`) y cejilla (`capoFret`).
  - Adaptadores de renderizado `IMusicRenderer`: `AlphaTabAdapter` (partitura, tab, batería) y `LeadSheetDOMAdapter` (letra + cifrado móvil). *(Nota: OSMDAdapter diferido a Fase 2 según Opción B).*
  - Ingesta determinista de MusicXML 4.0 y formato ChordPro.
- **Exit Gate:** Un usuario puede abrir una canción de prueba, transponerla de Sol a Mi bemol y ver cómo la partitura, acordes y tablatura se recalculan de forma matemáticamente exacta sin desalineaciones. La arquitectura y su comportamiento en tiempo de ejecución quedan sujetos a validación empírica en esta compuerta.

---

### FASE 2: Experiencia de Escenario (Vista de Interpretación) y Modo Offline
- **Objetivo:** Proporcionar la experiencia móvil ergonómica de atril lista para el culto.
- **Alcance:**
  - Vista de Interpretación con temas oscuros de alto contraste y botones táctiles > 48px.
  - Sistema de *Smart Defaults* y selección intuitiva de vistas.
  - Auto-scroll adaptativo por BPM.
  - Soporte de pedales Bluetooth (AirTurn).
  - PWA con Service Worker e IndexedDB para funcionamiento 100% offline.
- **Exit Gate:** La aplicación puede ponerse en modo avión en una tablet y permite navegar un setlist completo y leer la música con auto-scroll sin interrupciones.

---

### FASE 3: Setlists, Gestión de Repertorio y Modo Ensayo
- **Objetivo:** Permitir al Director Musical armar el servicio dominical y ensayar con la banda.
- **Alcance:**
  - Creación y reordenamiento de setlists con transiciones litúrgicas.
  - Metrónomo Web Audio de alta precisión con cuenta previa y bucle de secciones.
  - Pistas de referencia integradas.
  - Editor rápido de canciones (Nivel 1: letra, acordes, BPM, secciones).
- **Exit Gate:** El equipo de Bethesda ensaya un culto dominical completo utilizando el metrónomo integrado y bucles de secciones complejas.

---

### FASE 4: Sincronización en Tiempo Real (Live Worship Session)
- **Objetivo:** Interconexión en vivo entre el Director Musical y el atril de cada músico.
- **Alcance:**
  - Servidor WebSocket en FastAPI con Redis Pub/Sub.
  - Protocolo de sincronización con algoritmo NTP ligero (< 15ms desfase).
  - Despacho de cambios de sección y compás en vivo desde la tablet del MD.
  - Manejo de reconexión silenciosa sin popups en escenario.
- **Exit Gate:** Durante una sesión con 10 dispositivos conectados, el director cambia del Coro al Puente y todos los dispositivos reflejan el cambio instantáneamente.

---

### FASE 5: Ingesta Avanzada con IA, OMR y Multi-Tenancy Ampliado
- **Objetivo:** Automatización de digitalización masiva y expansión multi-iglesia.
- **Alcance:**
  - Canal de OMR para fotos de partituras impresas tomadas con el teléfono.
  - Estimación asistida de acordes y tempo a partir de audios de ensayo.
  - Flujo de revisión humana con indicador de confianza visual.
  - Portal de auto-registro y facturación multi-tenant para nuevas congregaciones.
- **Exit Gate:** Carga exitosa de una partitura arrugada tomada con foto móvil, generando un borrador calificado con > 85% de precisión que el arreglista valida en menos de 2 minutos.

---

## 4. Criterios de Aceptación de UX y Compuertas de Calidad (Quality Gates)

### Escenario Gherkin 1: Apertura y Configuración sin Entrenamiento (Zero-Training Gate)
```gherkin
Escenario: Un músico nuevo se incorpora al atril el domingo
  Dado que el músico abre la aplicación por primera vez en su teléfono móvil
  Cuando selecciona su instrumento "Guitarra Acústica"
  Y selecciona "¿Cómo quieres ver la canción?" como "Letra + Cifrado"
  Entonces la canción se despliega en menos de 1 segundo
  Y el tamaño de letra es automáticamente legible a 1 metro de distancia
  Y la aplicación no solicita tutoriales obligatorios ni terminología técnica.
```

### Escenario Gherkin 2: Transposición de Emergencia en Escenario
```gherkin
Escenario: El director pide cambiar la tonalidad en vivo
  Dado que la canción se encuentra en Sol Mayor (G)
  Cuando el músico pulsa el botón de transposición "[-]" una vez
  Entonces la tonalidad cambia a Fa sostenido Mayor (F#)
  Y todos los acordes, notas de pentagrama y trastes de tablatura se actualizan en menos de 100 ms
  Y ninguna ventana emergente modal bloquea la visualización de los compases.
```

### Presupuestos de Rendimiento (Performance Budgets):
- **First Contentful Paint (FCP) en móvil:** < 1.2 segundos en red 4G.
- **Tiempo de Transposición en Memoria:** < 50 milisegundos para una pieza de 120 compases.
- **Latencia de Broadcast WebSocket en Escenario:** < 30 milisegundos entre emisión y recepción local.
- **Consumo de Memoria en Navegador Móvil:** < 150 MB tras 2 horas continuas de ensayo.

---

## 5. Riesgos Técnicos y Estrategias de Mitigación

| Riesgo Técnico Identificado | Nivel de Severidad | Probabilidad | Estrategia de Mitigación Arquitectónica |
|:---|:---:|:---:|:---|
| **Desalineación visual entre acordes y sílabas al cambiar tamaño de pantalla** | Alto | Alta | Vinculación estricta a nivel de nodo en el modelo de datos (el acorde no es texto espacial, sino metadato de la sílaba correspondiente). |
| **Desfase (*jitter*) audible en el metrónomo por sobrecarga del hilo principal** | Crítico | Media | Delegación absoluta de la temporización al reloj de hardware de `AudioContext.currentTime` mediante Web Workers y Lookahead Scheduler. |
| **Fallo total de lectura por caída de internet durante el servicio** | Crítico | Alta | Service Worker con precarga automática de setlists en IndexedDB; conmutación a modo autónomo sin alertas molestas. |
| **Errores de notación en armaduras (ej. mostrar A# en lugar de Bb)** | Medio | Media | Motor de transposición interválica gobernado por el Círculo de Quintas y reglas de ortografía enarmónica diatónica. |
| **Conflicto de navegación en vivo si la conexión del director fluctúa** | Alto | Media | Modelo de marca temporal unificada (timestamp UTC compensado por NTP) y última escritura autorizada (*Last-Write-Wins*) con confirmación suave. |

---

## 6. Preguntas Abiertas de Arquitectura y Negocio

1. **Integración con CCLI / SongSelect:** ¿Dispone la Iglesia Bethesda de cuenta activa CCLI / SongSelect para evaluar integración con su API oficial de letras y acordes?
2. **Hardware de Atril en Bethesda:** ¿Qué porcentaje del equipo utiliza tablets (iPad / Galaxy Tab) versus teléfonos móviles pequeños durante los servicios habituales?
3. **Grabación de Audio en Directo:** ¿Se prevé en fases posteriores capturar el audio multitrack de la consola digital (ej. Behringer X32 / Allen & Heath) para correlacionarlo con la partitura en tiempo real?

---

## 7. Registros de Decisión Arquitectónica (ADR - Architecture Decision Records)

### ADR-001: Desacoplamiento entre Instrumento y Vista
- **Estado:** Aceptado.
- **Contexto:** En muchas herramientas comerciales, seleccionar "Guitarra" fuerza a ver una tablatura o seleccionar "Voz" fuerza a ver solo texto. En una congregación, guitarristas leen pentagrama o solo acordes, y vocalistas a menudo requieren pentagrama melódico.
- **Decisión:** La entidad `Instrument` describe el origen tímbrico y rango físico; la entidad `PerformanceView` describe el renderizador visual elegido por el usuario. Son entidades ortogonales.

### ADR-002: Modelo Canónico en Formato Documental JSONB
- **Estado:** Aceptado.
- **Contexto:** Modelar cada nota musical como una fila en una base de datos relacional genera millones de registros, bloqueos de escritura y joins excesivos al consultar una partitura.
- **Decisión:** Mantener metadatos de canciones y relaciones en tablas SQL de PostgreSQL, y encapsular la estructura musical polifónica interna en columnas `JSONB` indexables y auditables.

### ADR-003: Estrategia Híbrida de Renderizado (alphaTab + OSMD)
- **Estado:** Aceptado.
- **Contexto:** Ningún motor Open Source existente sobresale simultáneamente en partituras orquestales clásicas y en tablaturas/lead sheets modernas con audio para banda.
- **Decisión:** Implementar una interfaz unificada `IMusicRenderer` que despache a `alphaTab` para guitarra, bajo, batería y lead sheets rítmicas, y a `OSMD` para partituras de piano a dos manos y coros polifónicos.

### ADR-004: Prioridad Offline-First Absoluta para Atril
- **Estado:** Aceptado.
- **Contexto:** En el altar, la conectividad no puede ser un punto único de fallo (*Single Point of Failure*).
- **Decisión:** Toda la suite de interpretación y cálculo de transposición se ejecuta en el cliente en Web Workers, nutriéndose de IndexedDB local.

### ADR-005: Eliminación de Cargas Musicales Duplicadas en Partes de Instrumento
- **Estado:** Aceptado.
- **Contexto:** Almacenar notas en `INSTRUMENT_PART` creaba el riesgo de fuentes de verdad desincronizadas respecto al arreglo.
- **Decisión:** `INSTRUMENT_PART` actúa exclusivamente como descriptor de transposición, afinación y canal. `ARRANGEMENT.canonical_music_payload` es el contenedor único de notas, acordes y letras.

### ADR-006: Modelo de Tres Capas para la Experiencia de Atril (`PerformanceView`)
- **Estado:** Aceptado.
- **Contexto:** Las preferencias del usuario, los preajustes de la canción y las manipulaciones de zoom/scroll en vivo tienen ciclos de vida distintos.
- **Decisión:** Separar en: (1) `MusicianProfile` (BD), (2) `ArrangementViewPreset` (BD), y (3) `RuntimeDisplayState` (memoria cliente sin escrituras a BD).

### ADR-007: Congelamiento Riguroso de Alcance para Fase 1
- **Estado:** Aceptado.
- **Contexto:** Riesgo de dispersión técnica intentando abarcar audio IA, OMR y WebSockets prematuramente.
- **Decisión:** Congelar la Fase 1 exclusivamente al núcleo teórico, parsers deterministas y adaptadores de renderizado básicos.

### ADR-008: Separación Formal entre Transposición Musical y Cejilla (Capo)
- **Estado:** Aceptado.
- **Contexto:** Tratar el capo como transposición altera indebidamente la clave de concierto de la banda.
- **Decisión:** `transpositionSemitones` (tono de concierto objetivo) y `capoFret` (estrategia de digitación física de cuerdas) son magnitudes ortogonales e independientes.

### ADR-009: Despliegue Escalonado del Adaptador OSMD (Opción B)
- **Estado:** Aceptado.
- **Contexto:** Definir la frontera de implementación de adaptadores de renderizado en Fase 1.
- **Decisión:** Adoptar la Opción B: `IMusicRenderer` soportará `AlphaTabAdapter` y `LeadSheetDOMAdapter` en la Fase 1. La implementación de código de `OSMDAdapter` se programa para la Fase 2 (gran pentagrama de piano clásico y coro polifónico).

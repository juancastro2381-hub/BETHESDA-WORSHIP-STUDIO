# BETHESDA WORSHIP STUDIO
## Arquitectura de Software, Modelo de Dominio Musical y Diseño de Producto (Fase 0)

> **Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia.  
> **Estado:** Fase 0 — Especificación y Arquitectura Completa (Lista para Validación).  
> **Regla de Ejecución:** Cero código de producción, cero migraciones y cero UI hasta contar con aprobación explícita de la Fase 0.

---

## 🎵 Visión General del Sistema

**Bethesda Worship Studio** es la plataforma integral de tecnología musical diseñada específicamente para los ministerios de adoración contemporáneos. Integra en una sola arquitectura unificada y canónica:

- **Partituras Digitales Dinámicas**
- **Cifrados Armónicos Flexibles (Estándar, Latino, Nashville, Grados Romanos)**
- **Letras Estructuradas con Vinculación Silábica**
- **Tablaturas Interactivas (Guitarra y Bajo con digitación)**
- **Composición, Arreglos y Edición Multinivel (Nivel 1, 2 y 3)**
- **Gestión de Setlists Litúrgicos y Transiciones**
- **Modo Ensayo de Alta Precisión con Metrónomo Web Audio**
- **Sincronización en Tiempo Real en Escenario para Directores Musicales y Músicos**
- **Diseño Mobile-First Ergonómico con Resiliencia Offline-First Total**

---

## 📑 Índice Maestro de los 40 Entregables Arquitectónicos

La documentación técnica exhaustiva se encuentra organizada en 6 documentos especializados dentro de la carpeta [`docs/`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/):

| # | Entregable Requerido | Documento Principal de Referencia |
|:---:|:---|:---|
| **1** | Product Vision | [Doc 01: Visión y UX](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md#1-visión-central-del-producto) |
| **2** | Product Principles | [Doc 01: Visión y UX](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md#2-principios-de-producto-y-experiencia-de-usuario-ux) |
| **3** | User Personas (11 Arquetipos) | [Doc 01: Visión y UX](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md#3-arquetipos-de-usuario-user-personas) |
| **4** | User Journeys | [Doc 01: Visión y UX](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md#4-recorridos-del-usuario-user-journeys) |
| **5** | UX Architecture (Niveles 1, 2, 3) | [Doc 01: Visión y UX](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md#5-arquitectura-de-experiencia-de-usuario-y-divulgación-progresiva) |
| **6** | Information Architecture | [Doc 01: Visión y UX](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md#6-arquitectura-de-información-ia-y-mapa-de-navegación) |
| **7** | Functional Requirements | [Doc 01](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md) & [Doc 02](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md) |
| **8** | Non-Functional Requirements | [Doc 05](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md) & [Doc 06](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md) |
| **9** | Music Domain Model (Canonical Truth) | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#1-la-canción-como-fuente-canónica-de-la-verdad-canonical-source-of-truth) |
| **10** | Song Domain Model & Sections | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#2-modelo-de-dominio-de-canción-y-estructura-song--section-domain-model) |
| **11** | Arrangement Model | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#3-modelo-de-arreglos-arrangement-model) |
| **12** | Instrument Model (Transposing) | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#5-instrumentos-transpositores-concert-pitch-vs-written-pitch) |
| **13** | Notation Model (Instrument ≠ View) | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#4-instrumento--vista-musical-desacoplamiento-fundamental) |
| **14** | Chord Model | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#7-modelo-armónico-y-de-cifrado-chord-model) |
| **15** | Lyrics Model (Structured Syllables) | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#6-modelo-estructurado-de-letras-y-sílabas-structured-lyrics-model) |
| **16** | Performance View Model | [Doc 03: Interpretación y Vivo](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#1-modelo-de-vista-de-interpretación-performance-view-engine) |
| **17** | Setlist Model | [Doc 03: Interpretación y Vivo](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#2-modelo-de-setlist-listas-de-servicio-y-culto) |
| **18** | Rehearsal Model (Web Audio Metronome) | [Doc 03: Interpretación y Vivo](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#3-modo-ensayo-rehearsal-engine--web-audio-timing) |
| **19** | Real-Time Session Model | [Doc 03: Interpretación y Vivo](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#4-sesión-en-vivo-sincronizada-real-time-worship-session) |
| **20** | Versioning Model | [Doc 02](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#3-modelo-de-arreglos-arrangement-model) & [Doc 05](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md#2-diagrama-entidad-relación-erd) |
| **21** | AI Assistance Model (Asistente, no Autoridad) | [Doc 04: Ingesta y Renderizado](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/04_INGESTION_AND_NOTATION_ENGINE.md#3-principio-rector-de-inteligencia-artificial-asistente-no-autoridad) |
| **22** | Ingestion Architecture (7 Vías) | [Doc 04: Ingesta y Renderizado](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/04_INGESTION_AND_NOTATION_ENGINE.md#1-arquitectura-de-ingesta-de-canciones--nueva-canción) |
| **23** | Data Model (Relational + JSONB) | [Doc 05: Datos y API](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md#1-arquitectura-de-datos-y-estrategia-de-persistencia) |
| **24** | ERD (Mermaid Schema) | [Doc 05: Datos y API](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md#2-diagrama-entidad-relación-erd) |
| **25** | API Architecture (FastAPI REST) | [Doc 05: Datos y API](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md#3-arquitectura-de-api-restful-fastapi) |
| **26** | WebSocket Architecture & Protocol | [Doc 03: Interpretación y Vivo](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#5-especificación-del-protocolo-websocket) |
| **27** | MusicXML & SMuFL Strategy | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#9-estrategia-de-notación-musicxml-y-smufl) |
| **28** | Music Rendering Evaluation | [Doc 04: Ingesta y Renderizado](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/04_INGESTION_AND_NOTATION_ENGINE.md#4-evaluación-comparativa-de-tecnologías-de-renderizado-de-notación) |
| **29** | Transposition Architecture | [Doc 02: Modelo Musical](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#10-arquitectura-de-transposición-profesional) |
| **30** | Mobile UX Architecture | [Doc 01: Visión y UX](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md#7-arquitectura-ux-para-móvil-y-escenario-mobile-first-performance-ux) |
| **31** | Offline-First Strategy (PWA/IndexedDB) | [Doc 05: Datos y API](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md#4-estrategia-offline-first-y-pwa) |
| **32** | Security & Multi-Tenancy Architecture | [Doc 05: Datos y API](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md#5-arquitectura-de-seguridad-y-multi-inquilino-multi-tenancy) |
| **33** | Scalability Strategy | [Doc 05](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md) & [Doc 06](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#1-stack-tecnológico-recomendado-y-justificación) |
| **34** | Recommended Technology Stack | [Doc 06: Roadmap y ADR](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#1-stack-tecnológico-recomendado-y-justificación) |
| **35** | Recommended Project Structure | [Doc 06: Roadmap y ADR](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#2-estructura-de-directorios-del-proyecto-recomendada) |
| **36** | Phased Implementation Roadmap | [Doc 06: Roadmap y ADR](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#3-hoja-de-ruta-de-implementación-por-fases-implementation-roadmap) |
| **37** | UX Acceptance Criteria (Quality Gates) | [Doc 06: Roadmap y ADR](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#4-criterios-de-aceptación-de-ux-y-compuertas-de-calidad-quality-gates) |
| **38** | Technical Risks & Mitigations | [Doc 06: Roadmap y ADR](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#5-riesgos-técnicos-y-estrategias-de-mitigación) |
| **39** | Open Architecture Questions | [Doc 06: Roadmap y ADR](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#6-preguntas-abiertas-de-arquitectura-y-negocio) |
| **40** | Architecture Decision Records (ADR) | [Doc 06: Roadmap y ADR](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#7-registros-de-decisión-arquitectónica-adr---architecture-decision-records) |
| **41+**| **Fase 0.1: Architecture Hardening & Pre-Implementation** | [Doc 07: Hardening Arquitectónico](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/07_PHASE_0_1_ARCHITECTURE_HARDENING.md) |

---

## 🔒 Verificación de Compuertas de Salida (Exit Gates 0, 0.1 y 0.1.1)

> **Declaración de Ingeniería:**  
> La arquitectura se encuentra formalmente preparada y aprobada para la implementación de la Fase 1. El comportamiento en tiempo de ejecución, la fidelidad de los parsers, el desempeño de los renderizadores, las características de latencia y los riesgos de integración quedan sujetos a validación empírica durante la implementación de la Fase 1 y su correspondiente Compuerta de Salida.

Antes de autorizar el inicio de la **Fase 1**, se certifica explícitamente el cumplimiento de los principios no negociables:

1. **Desacoplamiento Instrumento ≠ Vista:** Comprobado y formalizado mediante `INSTRUMENT_REGISTRY`. Ningún instrumento está encadenado a una representación gráfica fija.
2. **Fuente Única de la Verdad:** El grafo musical reside exclusivamente en `canonical_music_payload` del arreglo. Se eliminaron `part_music_payload` de `INSTRUMENT_PART` y `canonical_lyrics` de `SONG` para evitar fuentes de verdad duplicadas o desconectadas.
3. **Separación Formal entre Transposición Musical y Cejilla (Capo):** `transpositionSemitones` (tono real objetivo) y `capoFret` (estrategia de digitación visual) son magnitudes ortogonales e independientes gobernadas por su propio invariante de dominio.
4. **Modelado Formal de `PerformanceView`:** Estructurado en 3 capas desacopladas: (A) Perfil persistido del músico (`MusicianProfile`), (B) Preajuste de canción (`ArrangementViewPreset`), y (C) Estado efímero de pantalla en atril (`RuntimeDisplayState`).
5. **Validación de Motores de Renderizado y Alcance OSMD (Opción B):** Evaluación de 15 casos ratificando la estrategia híbrida bajo la interfaz `IMusicRenderer`. Se adopta la Opción B: `AlphaTabAdapter` y `LeadSheetDOMAdapter` se implementan en Fase 1; `OSMDAdapter` para gran pentagrama de piano se implementa en Fase 2.
6. **Congelamiento Riguroso de Alcance (Phase 1 Scope Freeze):** Fronteras estrictas que impiden desvíos hacia OMR, transcripción de audio por IA o WebSockets prematuros.
7. **Resiliencia en el Altar:** Arquitectura Offline-First respaldada por Service Workers e IndexedDB en el cliente.
8. **Cero Código Prematuro:** Cero código de producción, cero migraciones y cero UI en las fases 0, 0.1 y 0.1.1.

```
==================================================
READY FOR EXPLICIT PHASE 1 AUTHORIZATION
==================================================
Do not start Phase 1. Wait for explicit authorization.
```

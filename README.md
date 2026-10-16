# BETHESDA WORSHIP STUDIO
## Plataforma Integral de Tecnología Musical, Notación Canónica y Gestión Litúrgica

> **Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia.  
> **Estado del Repositorio:** Fases 0 a 2C cerradas; Fase 3A (WP-01 y WP-02) implementadas y aprobadas.  
> **Compuerta de Gobernanza Actual:** **WP-01 y WP-02 APROBADOS; WP-03 NO INICIADO / NO AUTORIZADO (HOLD DE GOBERNANZA). WP-04, WP-05, Fase 3B, Fase 3C y fases posteriores NO AUTORIZADAS.**  
> **Regla de Ejecución:** Cero desarrollo o preflight técnico sobre WP-03 sin aprobación explícita y separada del Project Owner.

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

## 🏛️ Estado Real del Repositorio y Arquitectura Implementada

A diferencia del estado inicial de especificación (Fase 0), el repositorio contiene código de producción, esquemas de base de datos, migraciones versionadas y suites de pruebas automatizadas:

### 1. Backend (`backend/`)
- **Framework:** Fastify con TypeScript, arquitectura hexagonal/modular.
- **Persistencia:** PostgreSQL con Drizzle ORM (`backend/src/db/schema.ts`).
- **Migraciones Versionadas:**
  - `0000_normal_randall_flagg.sql`: Esquema base de canciones, arreglos y partes.
  - `0001_auth_rbac.sql`: Autenticación dual-cookie, refresh token rotation y RBAC de 5 roles (`ADMIN`, `SUPER_ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER`).
  - `0002_setlists_and_service_moments.sql`: Gestión de setlists litúrgicos y momentos de servicio.
  - `0003_single_active_setlist_constraint.sql`: Invariante de concurrencia de setlist activo único.
  - `0004_user_view_preferences.sql`: Persistencia atómica de preferencias de vista musical de usuario (Fase 3A — WP-01).
- **APIs REST:** Endpoints autenticados para autenticación, canciones, setlists y preferencias de usuario (`/api/v1/users/me/preferences`).
- **Validación:** Esquemas Zod con validación cruzada instrumento-representación y valores por defecto canónicos por rol (Fase 3A — WP-02).

### 2. Frontend (`frontend/`)
- **Framework:** React 18 con TypeScript y Vite.
- **Motor Musicológico Canónico (`frontend/src/core/`):**
  - Modelo de Dominio Musical Canónico desacoplado de la vista gráfica (invariante *Instrument ≠ View*).
  - Línea de tiempo de 480 TPQN para sincronización rítmica precisa.
  - Adaptadores de renderizado: `AlphaTabAdapter`, `OSMDAdapter` y `LeadSheetDOMAdapter`.
  - Parsers para MusicXML y ChordPro.
  - Motor de transposición armónica, cálculo ortogonal de cejilla (Capo) y ortografía enarmónica.

---

## 📑 Índice Maestro de Documentos Arquitectónicos Fundacionales

La documentación técnica fundacional de la arquitectura se encuentra organizada en la carpeta [`docs/`](docs/):

| # | Entregable Requerido | Documento Principal de Referencia |
|:---:|:---|:---|
| **1** | Product Vision | [Doc 01: Visión y UX](docs/01_PRODUCT_VISION_AND_UX.md#1-visión-central-del-producto) |
| **2** | Product Principles | [Doc 01: Visión y UX](docs/01_PRODUCT_VISION_AND_UX.md#2-principios-de-producto-y-experiencia-de-usuario-ux) |
| **3** | User Personas (11 Arquetipos) | [Doc 01: Visión y UX](docs/01_PRODUCT_VISION_AND_UX.md#3-arquetipos-de-usuario-user-personas) |
| **4** | User Journeys | [Doc 01: Visión y UX](docs/01_PRODUCT_VISION_AND_UX.md#4-recorridos-del-usuario-user-journeys) |
| **5** | UX Architecture (Niveles 1, 2, 3) | [Doc 01: Visión y UX](docs/01_PRODUCT_VISION_AND_UX.md#5-arquitectura-de-experiencia-de-usuario-y-divulgación-progresiva) |
| **6** | Information Architecture | [Doc 01: Visión y UX](docs/01_PRODUCT_VISION_AND_UX.md#6-arquitectura-de-información-ia-y-mapa-de-navegación) |
| **7** | Functional Requirements | [Doc 01](docs/01_PRODUCT_VISION_AND_UX.md) & [Doc 02](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md) |
| **8** | Non-Functional Requirements | [Doc 05](docs/05_DATA_ARCHITECTURE_AND_API.md) & [Doc 06](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md) |
| **9** | Music Domain Model (Canonical Truth) | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#1-la-canción-como-fuente-canónica-de-la-verdad-canonical-source-of-truth) |
| **10** | Song Domain Model & Sections | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#2-modelo-de-dominio-de-canción-y-estructura-song--section-domain-model) |
| **11** | Arrangement Model | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#3-modelo-de-arreglos-arrangement-model) |
| **12** | Instrument Model (Transposing) | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#5-instrumentos-transpositores-concert-pitch-vs-written-pitch) |
| **13** | Notation Model (Instrument ≠ View) | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#4-instrumento--vista-musical-desacoplamiento-fundamental) |
| **14** | Chord Model | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#7-modelo-armónico-y-de-cifrado-chord-model) |
| **15** | Lyrics Model (Structured Syllables) | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#6-modelo-estructurado-de-letras-y-sílabas-structured-lyrics-model) |
| **16** | Performance View Model | [Doc 03: Interpretación y Vivo](docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#1-modelo-de-vista-de-interpretación-performance-view-engine) |
| **17** | Setlist Model | [Doc 03: Interpretación y Vivo](docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#2-modelo-de-setlist-listas-de-servicio-y-culto) |
| **18** | Rehearsal Model (Web Audio Metronome) | [Doc 03: Interpretación y Vivo](docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#3-modo-ensayo-rehearsal-engine--web-audio-timing) |
| **19** | Real-Time Session Model | [Doc 03: Interpretación y Vivo](docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#4-sesión-en-vivo-sincronizada-real-time-worship-session) |
| **20** | Versioning Model | [Doc 02](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#3-modelo-de-arreglos-arrangement-model) & [Doc 05](docs/05_DATA_ARCHITECTURE_AND_API.md#2-diagrama-entidad-relación-erd) |
| **21** | AI Assistance Model (Asistente, no Autoridad) | [Doc 04: Ingesta y Renderizado](docs/04_INGESTION_AND_NOTATION_ENGINE.md#3-principio-rector-de-inteligencia-artificial-asistente-no-autoridad) |
| **22** | Ingestion Architecture (7 Vías) | [Doc 04: Ingesta y Renderizado](docs/04_INGESTION_AND_NOTATION_ENGINE.md#1-arquitectura-de-ingesta-de-canciones--nueva-canción) |
| **23** | Data Model (Relational + JSONB) | [Doc 05: Datos y API](docs/05_DATA_ARCHITECTURE_AND_API.md#1-arquitectura-de-datos-y-estrategia-de-persistencia) |
| **24** | ERD (Mermaid Schema) | [Doc 05: Datos y API](docs/05_DATA_ARCHITECTURE_AND_API.md#2-diagrama-entidad-relación-erd) |
| **25** | API Architecture (FastAPI REST) | [Doc 05: Datos y API](docs/05_DATA_ARCHITECTURE_AND_API.md#3-arquitectura-de-api-restful-fastapi) |
| **26** | WebSocket Architecture & Protocol | [Doc 03: Interpretación y Vivo](docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md#5-especificación-del-protocolo-websocket) |
| **27** | MusicXML & SMuFL Strategy | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#9-estrategia-de-notación-musicxml-y-smufl) |
| **28** | Music Rendering Evaluation | [Doc 04: Ingesta y Renderizado](docs/04_INGESTION_AND_NOTATION_ENGINE.md#4-evaluación-comparativa-de-tecnologías-de-renderizado-de-notación) |
| **29** | Transposition Architecture | [Doc 02: Modelo Musical](docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md#10-arquitectura-de-transposición-profesional) |
| **30** | Mobile UX Architecture | [Doc 01: Visión y UX](docs/01_PRODUCT_VISION_AND_UX.md#7-arquitectura-ux-para-móvil-y-escenario-mobile-first-performance-ux) |
| **31** | Offline-First Strategy (PWA/IndexedDB) | [Doc 05: Datos y API](docs/05_DATA_ARCHITECTURE_AND_API.md#4-estrategia-offline-first-y-pwa) |
| **32** | Security & Multi-Tenancy Architecture | [Doc 05: Datos y API](docs/05_DATA_ARCHITECTURE_AND_API.md#5-arquitectura-de-seguridad-y-multi-inquilino-multi-tenancy) |
| **33** | Scalability Strategy | [Doc 05](docs/05_DATA_ARCHITECTURE_AND_API.md) & [Doc 06](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#1-stack-tecnológico-recomendado-y-justificación) |
| **34** | Recommended Technology Stack | [Doc 06: Roadmap y ADR](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#1-stack-tecnológico-recomendado-y-justificación) |
| **35** | Recommended Project Structure | [Doc 06: Roadmap y ADR](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#2-estructura-de-directorios-del-proyecto-recomendada) |
| **36** | Phased Implementation Roadmap | [Doc 06: Roadmap y ADR](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#3-hoja-de-ruta-de-implementación-por-fases-implementation-roadmap) |
| **37** | UX Acceptance Criteria (Quality Gates) | [Doc 06: Roadmap y ADR](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#4-criterios-de-aceptación-de-ux-y-compuertas-de-calidad-quality-gates) |
| **38** | Technical Risks & Mitigations | [Doc 06: Roadmap y ADR](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#5-riesgos-técnicos-y-estrategias-de-mitigación) |
| **39** | Open Architecture Questions | [Doc 06: Roadmap y ADR](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#6-preguntas-abiertas-de-arquitectura-y-negocio) |
| **40** | Architecture Decision Records (ADR) | [Doc 06: Roadmap y ADR](docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md#7-registros-de-decisión-arquitectónica-adr---architecture-decision-records) |
| **41+**| **Fase 0.1: Architecture Hardening & Pre-Implementation** | [Doc 07: Hardening Arquitectónico](docs/07_PHASE_0_1_ARCHITECTURE_HARDENING.md) |

---

## 📋 Documentación de Gobernanza, Decisiones y Reportes de Implementación

Los expedientes formales de auditoría y decisiones del Project Owner residen en [`docs/reports/`](docs/reports/) y [`docs/`](docs/):

1. **Línea Base de Requisitos y Roadmap:**
   - [Consolidación de Requisitos de Usuario (v2.0)](docs/WORSHIP_STUDIO_REQUIREMENTS_CONSOLIDATION.md)
   - [Propuesta de Roadmap de Finalización](docs/WORSHIP_STUDIO_COMPLETION_ROADMAP_PROPOSAL.md)
   - [Auditoría de Consistencia de Gobernanza](docs/WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.md)
2. **Registro de Decisiones Canónicas del Propietario (Gate 1 y Gate 3):**
   - [Registro de Decisiones Gate 1 (DEC-01 y DEC-02)](docs/reports/WORSHIP_STUDIO_GATE_1_OWNER_DECISIONS.md)
   - [Registro de Decisiones Gate 3 (DEC-03, DEC-04 y DEC-05)](docs/reports/WORSHIP_STUDIO_GATE_3_OWNER_DECISIONS_REGISTRATION_REPORT.md)
3. **Fase 3A — Informes de Implementación y Salida:**
   - [Informe de Implementación WP-01 (Esquema y Repositorio)](docs/reports/WORSHIP_STUDIO_PHASE_3A_WP01_IMPLEMENTATION_REPORT.md)
   - [Aprobación Exit Gate WP-01 y Autorización WP-02](docs/reports/WORSHIP_STUDIO_PHASE_3A_WP01_EXIT_GATE_AND_WP02_AUTHORIZATION.md)
   - [Informe de Implementación WP-02 (API REST y Valores por Defecto)](docs/reports/WORSHIP_STUDIO_PHASE_3A_WP02_IMPLEMENTATION_REPORT.md)
   - [Remediación de Integridad Documental WP-02](docs/reports/WORSHIP_STUDIO_PHASE_3A_WP02_DOCUMENTARY_REMEDIATION_REPORT.md)
   - [Sign-Off Formal del Propietario WP-02 y Retención de WP-03](docs/reports/WORSHIP_STUDIO_PHASE_3A_WP02_OWNER_SIGNOFF_REPORT.md)

---

## 🔒 Compuertas de Gobernanza y Estado Actual de Ejecución

```
================================================================================
ESTADO ACTUAL DE GOBERNANZA DEL PROYECTO:
================================================================================
Fases Anteriores (Fase 0 a 2C): CERRADAS Y COMPLETADAS
Fase 3A — WP-01: APROBADO POR EL PROJECT OWNER (Esquema, Migración 0004, Repositorio)
Fase 3A — WP-02: APROBADO POR EL PROJECT OWNER (API REST Fastify, Zod, RBAC Defaults)
Fase 3A — WP-02 Exit Gate: FORMALMENTE APROBADA Y CERRADA
Fase 3A — WP-03 (Identidad Visual / Emblema Saxofón): NO INICIADO — NO AUTORIZADO (HOLD)
Fase 3A — WP-04 / WP-05 / Fases 3B, 3C y posteriores: ESTRICTAMENTE NO AUTORIZADAS

PRÓXIMA COMPUERTA: AUTORIZACIÓN SEPARADA DEL PROJECT OWNER PARA WP-03
================================================================================
```

> **Mandato de Detención:**  
> La ejecución técnica del repositorio se encuentra totalmente detenida en esta compuerta de gobernanza. El inicio de la Fase 3A — WP-03 (integración del emblema oficial del saxofón en el encabezado de la aplicación web) requiere una instrucción separada, explícita y formal del Project Owner.

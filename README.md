# BETHESDA WORSHIP STUDIO
## Plataforma Integral de Tecnología Musical, Notación Canónica y Gestión Litúrgica

> **Organización:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia.  
> **Estado del Repositorio:** Fases 0 a 2C cerradas; Fase 3A implementada; Workstreams Autorizados (Audio & Offline, WP-05 Autoscroll, Fase 3B Realtime, Fase 3C Multitracks & OMR) implementados y remediados en Sprint R1.  
> **Compuerta de Gobernanza Actual:** **Sprint de Remediación R1 IMPLEMENTADO Y VERIFICADO TÉCNICAMENTE (608/608 tests pasando). Validación manual en escenario/atril PENDIENTE de ejecución por el Project Owner.**  
> **Regla de Exclusión Estricta:** CERO integración o sincronización con pedales físicos (Bluetooth, WebHID, WebUSB, Gamepad).  

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
- **Sincronización en Tiempo Real en Escenario para Directores Musicales y Músicos (SSE + Stream Tickets efímeros)**
- **Infraestructura de Audio, Streaming con HTTP Range (RFC 7233) y Resiliencia Offline-First Total con Validación Criptográfica Binaria SHA-256**
- **Gestión de Sesiones Multitrack Persistentes en PostgreSQL y Asistencia OMR Veraz sin Invención de Notas**
- **Autoscroll Litúrgico Continuo con Modos Basado en Tempo y Viewport**
- **Diseño Mobile-First Ergonómico para Atril**

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
  - `0005_audio_assets.sql`: Infraestructura de almacenamiento y streaming de pistas de audio (Workstream A).
  - `0006_multitrack_sessions.sql`: Persistencia transaccional de sesiones y pistas multitrack aisladas por canción (Fase 3C).
- **APIs REST y Servicios en Tiempo Real:** Endpoints autenticados para autenticación, canciones, setlists, preferencias de usuario, audio (tickets de streaming, validación de bytes mágicos, streaming HTTP Range RFC 7233), sesiones en vivo SSE protegidas con tickets efímeros de un solo uso, multitrack sessions y propuestas OMR con compuerta de aprobación humana previa a la persistencia canónica.
- **Validación:** Esquemas Zod con validación cruzada estricta, inspección binaria de firmas de archivos de audio y partituras, y control de acceso basado en roles (RBAC) sin herencia implícita.

### 2. Frontend (`frontend/`)
- **Framework:** React 18 con TypeScript y Vite.
- **Motor Musicológico Canónico (`frontend/src/core/`):**
  - Modelo de Dominio Musical Canónico desacoplado de la vista gráfica (invariante *Instrument ≠ View*).
  - Línea de tiempo de 480 TPQN para sincronización rítmica precisa.
  - Adaptadores de renderizado: `AlphaTabAdapter`, `OSMDAdapter` y `LeadSheetDOMAdapter`.
  - Parsers para MusicXML y ChordPro.
  - Motor de transposición armónica, cálculo ortogonal de cejilla (Capo) y ortografía enarmónica.
  - Motor de Autoscroll Litúrgico Continuo (WP-05) con cálculo basado en tempo/compases y viewport, con pausa de pánico instantánea.
  - Administrador Offline (`OfflineManager`) con almacenamiento IndexedDB y verificación estricta de integridad binaria SHA-256 de los bytes descargados.
  - Cliente en Tiempo Real (`RealtimeClient`) con negociación segura de tickets de transmisión efímeros para Server-Sent Events (SSE).

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
4. **Flujos de Trabajo Autorizados e Implementados:**
   - [Informe de Infraestructura de Audio y Modo Offline (Workstream A)](docs/reports/WS_AUDIO_OFFLINE_IMPLEMENTATION_REPORT.md)
   - [Informe de Autoscroll Litúrgico Continuo — WP-05 (Workstream B)](docs/reports/WP05_AUTOSCROLL_IMPLEMENTATION_REPORT.md)
   - [Informe de Sincronización en Vivo SSE — Fase 3B (Workstream C)](docs/reports/PHASE_3B_REALTIME_LITURGICAL_FLOW_IMPLEMENTATION_REPORT.md)
   - [Informe de Multitracks y OMR — Fase 3C (Workstream D)](docs/reports/PHASE_3C_MULTITRACKS_OMR_IMPLEMENTATION_REPORT.md)
   - [Handoff de Flujos Autorizados](docs/reports/AUTHORIZED_WORKSTREAMS_FINAL_HANDOFF.md)
5. **Sprint de Remediación R1 (Seguridad, Integridad de Datos, Audio Offline, OMR y Multitracks):**
   - [Informe Preflight de Remediación R1](docs/reports/WS_REMEDIATION_R1_PREFLIGHT.md)
   - [Informe de Implementación de Remediación R1](docs/reports/WS_REMEDIATION_R1_IMPLEMENTATION_REPORT.md)
   - [Evidencia de Pruebas Automatizadas R1](docs/reports/WS_REMEDIATION_R1_TEST_EVIDENCE.md)
   - [Guía de Validación Manual para el Usuario](docs/reports/WS_REMEDIATION_R1_MANUAL_VALIDATION_GUIDE.md)
   - [Entrega Final y Cierre de Remediación R1](docs/reports/WS_REMEDIATION_R1_FINAL_HANDOFF.md)

---

## 🔒 Compuertas de Gobernanza y Estado Actual de Ejecución

```
================================================================================
ESTADO ACTUAL DE GOBERNANZA DEL PROYECTO (SPRINT R1 REMEDIADO):
================================================================================
Fases Anteriores (Fase 0 a 2C): CERRADAS Y COMPLETADAS
Fase 3A — WP-01 / WP-02 / WP-03: IMPLEMENTADAS Y AUDITADAS
Workstreams Autorizados:
  - Workstream A (Audio & Offline): IMPLEMENTADO Y REMEDIADO EN R1
  - Workstream B (WP-05 Autoscroll): IMPLEMENTADO Y VERIFICADO
  - Workstream C (Fase 3B Realtime Flow): IMPLEMENTADO Y REMEDIADO EN R1
  - Workstream D (Fase 3C Multitracks & OMR): IMPLEMENTADO Y REMEDIADO EN R1

Sprint de Remediación R1 (Prioridades P0, P1, P2):
  - R1-P0: Autorización de Sesión Realtime, Tickets SSE efímeros, Auth de Audio
  - R1-P1: Checksum binario real SHA-256 en Offline, OMR veraz sin invención,
           Persistencia SQL y aislamiento IDOR de Multitrack, Magic bytes y RFC 7233
  - R1-P2: Reconciliación de Gobernanza y Documentación

Regla de Exclusión Estricta:
  - CERO integración o sincronización con pedales físicos (Bluetooth/WebHID/WebUSB/Gamepad).

Verificación Técnica Automatizada:
  - 100% PASS: 608 tests pasando sin fallos (264 backend + 344 frontend).
  - TypeScript: 0 errores de compilación estricta en backend y frontend.

Estado Operativo y Próxima Compuerta:
  - Implementación y suite automatizada: VERIFICADA Y CONCLUIDA.
  - Validación litúrgica manual en atril/escenario: PENDIENTE por el Project Owner.
================================================================================
```

> **Mandato Operativo:**  
> La implementación del Sprint de Remediación R1 y los flujos autorizados se encuentran concluidos y validados exhaustivamente a nivel de pruebas unitarias, de integración, de concurrencia y de seguridad. La puesta en servicio definitivo en ensayos o cultos en vivo queda sujeta a la ejecución de la [Guía de Validación Manual](docs/reports/WS_REMEDIATION_R1_MANUAL_VALIDATION_GUIDE.md) por parte del Project Owner y su equipo ministerial.

# BETHESDA WORSHIP STUDIO — ARQUITECTURA OBJETIVO DE PLATAFORMA INTELIGENTE
## Blueprint Técnico: Sistema Asíncrono de Transcripción, OMR y Atril Digital

- **Fecha:** 2 de Noviembre de 2026
- **Estado:** FASE 0 — STRICTLY READ-ONLY ARCHITECTURAL ASSESSMENT
- **Autor:** Principal Software Architect & AI/ML Engineer
- **Documento:** `docs/reports/WS_AI_MUSIC_PLATFORM_TARGET_ARCHITECTURE.md`

---

## 1. VISIÓN Y PRINCIPIOS ARQUITECTÓNICOS

El objetivo es evolucionar Bethesda Worship Studio hacia una plataforma unificada y profesional de transcripción, separación y atril musical, superando las capacidades de plataformas comerciales como SongScription mediante:
1. **Desacoplamiento Estricto de Cómputo (Asynchronous Job Processing):** Los modelos de IA para separación de pistas (HTDemucs), transcripción de audio a MIDI (Basic Pitch), OMR (Audiveris/oemer) y alineación de letras (WhisperX) consumen memoria de GPU y CPU de forma masiva. **Jamás deben ejecutarse en el proceso principal de Node.js/Fastify.** Se establece un bus de mensajería con colas de tareas persistentes y workers dedicados.
2. **Propuestas de IA vs. Verdad Canónica (Human-in-the-Loop):** Toda inferencia generada por IA (audio o imagen) se trata como un *Borrador Preliminar* (`isAiDraft: true`) sujeto a revisión y edición humana con métricas explícitas de confianza por compás y nota. Solo tras la validación humana se persiste en el catálogo canónico litúrgico.
3. **Única Fuente de Verdad Canónica (Single Source of Truth):** El modelo canónico (`CanonicalMusicPayload 2.0`) unifica notas, acordes, métrica, pistas y letras. Los cuatro formatos de lectura (*Partitura*, *Cifrado con Letra*, *Letra Sola*, *Tablatura*) son **proyecciones deterministas sin duplicación de datos**.
4. **Resiliencia y Modo Fuera de Línea (Offline-First Stand):** El atril musical debe operar con cero latencia y tolerancia a fallos de red durante el servicio en vivo mediante Service Workers e IndexedDB.

---

## 2. DIAGRAMA DE CONTENEDORES DEL SISTEMA (C4 CONTAINER MODEL)

```mermaid
flowchart TB
    subgraph ClientLayer ["Capa de Cliente (Navegador / Tablet / Móvil)"]
        SPA["SPA React 19 (Worship Studio)"]
        WREC["MediaRecorder (Micrófono) / Video Links"]
        MEDIT["Interactive Music Editor (Canvas / VexFlow / AlphaTab)"]
        STAND["Digital Music Stand (OSMD / AlphaTab / LeadSheetDOM)"]
        SW["Service Worker & IndexedDB Cache"]
    end

    subgraph IngressLayer ["Ingreso y Seguridad"]
        APIGW["Reverse Proxy & TLS Terminator (Nginx / Cloudflare)"]
    end

    subgraph CoreBackend ["Backend Principal (Fastify 5 / TypeScript)"]
        FASTIFY["Fastify Core HTTP Server"]
        AUTH_SVC["Auth & RBAC Service (Argon2id + JWT)"]
        SONG_SVC["Song & Setlist Service"]
        JOB_ORCH["Job Orchestration & Dispatcher"]
        TICKET_SVC["Stream Ticket Service (Media Auth)"]
        WS_GATEWAY["WebSocket Gateway (Realtime Flow & Job Progress)"]
    end

    subgraph QueueLayer ["Capa de Colas y Eventos"]
        REDIS[("Redis 7.x (BullMQ / PubSub)")]
    end

    subgraph AiWorkerPool ["Pool de Microservicios de Inferencia IA (Python 3.11 / PyTorch)"]
        SEP_WORKER["Stem Separation Worker (Demucs v4)"]
        TRANS_WORKER["Audio-to-MIDI Worker (Basic Pitch + BTC Chords)"]
        VOICE_WORKER["Lyrics & Alignment Worker (WhisperX + wav2vec2)"]
        OMR_WORKER["OMR Worker (Audiveris CLI / oemer)"]
        BEAT_WORKER["Rhythm & Tempo Worker (Madmom)"]
    end

    subgraph StorageLayer ["Capa de Persistencia y Archivos"]
        POSTGRES[("PostgreSQL 16 (Drizzle ORM)")]
        MINIO["Object Storage (MinIO / S3 - Audio, Stems, PDFs)"]
    end

    SPA -->|HTTPS REST| APIGW
    SPA -->|WSS WebSockets| APIGW
    APIGW --> FASTIFY
    FASTIFY --> AUTH_SVC
    FASTIFY --> SONG_SVC
    FASTIFY --> JOB_ORCH
    FASTIFY --> TICKET_SVC
    FASTIFY --> WS_GATEWAY

    JOB_ORCH -->|Push Jobs| REDIS
    REDIS -->|Pop Jobs| SEP_WORKER
    REDIS -->|Pop Jobs| TRANS_WORKER
    REDIS -->|Pop Jobs| VOICE_WORKER
    REDIS -->|Pop Jobs| OMR_WORKER
    REDIS -->|Pop Jobs| BEAT_WORKER

    AiWorkerPool -->|Emit Progress & Results| REDIS
    REDIS -->|PubSub Progress| WS_GATEWAY
    WS_GATEWAY -->|Push Progress 0-100%| SPA

    SONG_SVC --> POSTGRES
    FASTIFY --> MINIO
    AiWorkerPool -->|Read Inputs / Write Stems| MINIO
    SW -->|Cache Storage| SPA
```

---

## 3. PIPELINE DE INFERENCIA DE IA DE EXTREMO A EXTREMO

El procesamiento de una pista de audio completa (mezcla estéreo) o una partitura escaneada sigue un flujo unificado y orquestado:

```mermaid
sequenceDiagram
    autonumber
    actor Musician as Músico / Director
    participant Client as Frontend (Worship Studio)
    participant API as Fastify API Gateway
    participant Queue as Redis / BullMQ
    participant Worker as AI Worker (Python PyTorch)
    participant MinIO as S3 / MinIO Storage
    participant DB as PostgreSQL 16

    Musician->>Client: Carga Audio (MP3/WAV) o Enlace
    Client->>API: POST /api/v1/transcription/jobs (multipart)
    API->>MinIO: Almacena archivo fuente original
    API->>DB: Registra Job en estado 'QUEUED'
    API->>Queue: Encola tarea 'MUSIC_PIPELINE'
    API-->>Client: 202 Accepted (jobId: UUID)

    par Sincronización en Tiempo Real
        Client->>API: Suscripción WebSocket (/api/v1/jobs/:jobId/stream)
    end

    Queue->>Worker: Consume tarea de transcripción
    Worker->>Worker: Paso 1: Beat Tracking y Tempo Map (Madmom)
    Worker->>API: Notifica progreso (15% - Tempo y Métrica detectados)
    API-->>Client: WS Event: PROGRESS (15%)

    Worker->>Worker: Paso 2: Separación de Fuentes (Demucs v4: Vocals, Bass, Drums, Other)
    Worker->>MinIO: Guarda 4 Stems WAV de alta fidelidad
    Worker->>API: Notifica progreso (45% - Pistas separadas)
    API-->>Client: WS Event: PROGRESS (45%)

    par Inferencia Paralela
        Worker->>Worker: Paso 3A: Transcripción Polifónica de Notas (Basic Pitch sobre Instrumental)
        Worker->>Worker: Paso 3B: Reconocimiento de Acordes (BTC sobre Acompañamiento)
        Worker->>Worker: Paso 3C: Transcripción de Letras y Fonemas (WhisperX sobre Pista Vocal)
    end

    Worker->>Worker: Paso 4: Fusión y Normalización Canónica a 480 TPQN
    Worker->>DB: Registra propuesta OMR/AI con isAiDraft: true y confianzas
    Worker->>API: Job completado (100%)
    API-->>Client: WS Event: COMPLETED (payload preliminar listo)
    
    Client->>Musician: Despliega Inspector de Revisión y Corrección Humana
    Musician->>Client: Ajusta acordes dudosos, confirma título y tonalidad
    Client->>API: POST /api/v1/songs (Persistir versión aprobada)
    API->>DB: Almacena SongVersion canónica inmutable
    API-->>Client: 201 Created (Canción disponible en Atril y Repertorio)
```

---

## 4. EVOLUCIÓN DEL MODELO CANÓNICO: `CanonicalMusicPayload 2.0`

Para soportar de forma nativa la salida de motores de IA, confianza de transcripción, trazabilidad de correcciones humanas y enlace con MIDI y stems de audio, se especifica la evolución del esquema canónico:

```typescript
/**
 * @file canonical-music-payload-v2.ts
 * @description Evolución del agregado canónico para soporte de IA, confianza y puente MIDI.
 */

export type SourceProvenanceType =
  | 'HUMAN_AUTHORING'
  | 'MUSICXML_IMPORT'
  | 'CHORDPRO_IMPORT'
  | 'AI_AUDIO_TRANSCRIPTION'
  | 'OMR_SCAN';

export interface MusicalItemConfidence {
  readonly score: number; // 0.0 a 1.0 (ej. 0.94)
  readonly engine: string; // ej. "BasicPitch-1.0", "BTC-Transformer", "Audiveris-5.3"
  readonly isHumanReviewed: boolean;
}

export interface NoteV2JSON {
  readonly id: string;
  readonly pitch: {
    readonly noteName: string; // ej. "C#", "F"
    readonly octave: number;   // ej. 4
    readonly midiNumber: number; // ej. 60 (C4)
  };
  readonly startTick: number;   // 480 TPQN
  readonly durationTicks: number;
  readonly voice: number;
  readonly staff: number;
  readonly velocity: number;    // 0 a 127
  readonly confidence?: MusicalItemConfidence | undefined;
  readonly tablatureHint?: {
    readonly string: number;    // 1 a 6
    readonly fret: number;      // 0 a 24
  } | undefined;
  readonly audioAlignment?: {
    readonly startSeconds: number;
    readonly endSeconds: number;
  } | undefined;
}

export interface ChordEventV2JSON {
  readonly startTick: number;
  readonly durationTicks: number;
  readonly root: string;        // ej. "G"
  readonly quality: string;     // ej. "maj7", "m7(b5)"
  readonly bass?: string;       // ej. "B" para G/B
  readonly displaySymbol: string; // ej. "Gmaj7/B"
  readonly confidence?: MusicalItemConfidence | undefined;
}

export interface LyricSyllableV2JSON {
  readonly text: string;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly syllabic: 'single' | 'begin' | 'middle' | 'end';
  readonly confidence?: MusicalItemConfidence | undefined;
  readonly phonemeTimestamps?: {
    readonly startMs: number;
    readonly endMs: number;
  } | undefined;
}

export interface CanonicalMusicPayloadV2JSON {
  readonly version: '2.0.0';
  readonly title: string;
  readonly artist?: string | null;
  readonly provenance: {
    readonly type: SourceProvenanceType;
    readonly sourceFileChecksumSha256?: string;
    readonly sourceUrl?: string;
    readonly importedAt: string;
    readonly overallConfidence: number; // 0.0 a 1.0
  };
  readonly timeline: {
    readonly totalDurationTicks: number;
    readonly measureCount: number;
    readonly tempoMap: {
      readonly events: Array<{
        readonly tick: number;
        readonly bpm: number;
        readonly timeSignature: string;
      }>;
    };
    readonly audioSyncMap?: Array<{
      readonly tick: number;
      readonly timestampSeconds: number;
    }>;
  };
  readonly sections: Array<{
    readonly id: string;
    readonly name: string; // "Intro", "Verso 1", "Coro"
    readonly startMeasure: number;
    readonly endMeasure: number;
  }>;
  readonly measures: Array<{
    readonly number: number;
    readonly timeSignature: string;
    readonly keySignature: string;
    readonly startTick: number;
    readonly durationTicks: number;
    readonly notes: NoteV2JSON[];
    readonly chords: ChordEventV2JSON[];
    readonly lyrics: LyricSyllableV2JSON[];
    readonly confidenceScore: number;
  }>;
  readonly instrumentTracks: Array<{
    readonly id: string;
    readonly name: string;
    readonly family: 'KEYS' | 'GUITAR' | 'BASS' | 'VOICE' | 'DRUMS' | 'WINDS';
    readonly clef: 'TREBLE' | 'BASS' | 'ALTO' | 'PERCUSSION';
    readonly transpositionSemitones: number;
    readonly stemAssetId?: string; // Enlace a stem separado en MinIO
  }>;
}
```

---

## 5. CAPA DE ALMACENAMIENTO HÍBRIDA Y SEGREGACIÓN DE DATOS

Para evitar que archivos masivos de audio y stems saturen la base de datos relacional, se establece una clara separación:

1. **PostgreSQL 16 (Drizzle ORM):**
   - Gestión de identidades, perfiles, credenciales (Argon2id) y auditoría.
   - Metadatos de canciones, versiones inmutables y relaciones litúrgicas (Setlists).
   - Estructura JSONB del árbol canónico (`canonical_payload` v2.0).
   - Registros de trabajos (`transcription_jobs`) con estados: `QUEUED`, `PROCESSING`, `AWAITING_REVIEW`, `APPROVED`, `FAILED`.
2. **MinIO / Amazon S3 (Object Storage):**
   - Almacenamiento de archivos fuente originales (MP3, WAV, PDF, MusicXML).
   - Almacenamiento de stems separados (Demucs: `vocals.wav`, `drums.wav`, `bass.wav`, `other.wav`).
   - Gestión de ciclo de vida (TTL): Archivos temporales no validados se eliminan a las 48 horas mediante reglas de ciclo de vida de cubos (*Bucket Lifecycle Policies*).
3. **Redis 7.x (In-Memory Data Store):**
   - Colas de tareas prioritarias (BullMQ).
   - Canal Pub/Sub para difusión de eventos de progreso en tiempo real hacia WebSockets.
   - Cache de tokens y sesiones activas.
4. **IndexedDB (Cliente Navegador):**
   - Almacén local cifrado de canciones y setlists para ejecución litúrgica 100% offline.

---

## 6. INTEGRACIÓN DEL EDITOR INTERACTIVO EN EL ATRIL DIGITAL

Para resolver la necesidad de corregir compases detectados por la IA sin abandonar el atril, se diseña una arquitectura de edición reactiva en dos niveles:

```mermaid
graph LR
    subgraph EditorMode ["Editor Interactivo de Notación y Acordes"]
        INSP["Panel Inspector Lateral (Metadatos & Compás Activo)"]
        NOT_EDIT["Visual Note Canvas (VexFlow / AlphaTab Interactive)"]
        CHORD_EDIT["Editor Visual de Cifrado y Sílabas"]
    end

    subgraph StateManagement ["Gestor Inmutable de Historial"]
        HIST["Undo / Redo Command History"]
        LOCAL_PAYLOAD["Draft CanonicalMusicPayload (Local State)"]
    end

    subgraph LiveRender ["Vista en Tiempo Real"]
        STAND_VIEW["Atril Digital (Proyección según Instrumento Activo)"]
    end

    INSP -->|Comando de Cambio de Tono / Acorde| HIST
    NOT_EDIT -->|Comando de Nota / Silencio| HIST
    CHORD_EDIT -->|Comando de Reemplazo de Letra| HIST
    HIST --> LOCAL_PAYLOAD
    LOCAL_PAYLOAD -->|Proyección Inmediata| STAND_VIEW
```

### Características del Editor de Atril:
- **Resaltado por Nivel de Confianza (Confidence Heatmap):** Los compases o notas cuya confianza de inferencia de IA sea inferior a 0.80 se resaltan con un sutil halo ámbar para alertar al músico de que requieren revisión.
- **Reproducción de Referencia A/B:** El músico puede presionar la barra espaciadora en cualquier compás para reproducir simultáneamente el audio original (o el stem vocal aislado) y la nota transcrita sintetizada por Web Audio API para validar el pitch de oído.
- **Historial Completo de Deshacer/Rehacer (Command Pattern):** Cada adición, eliminación o transposición genera un comando reversible.


# CC_03: ENGINE AND LICENSE EVALUATION
## BETHESDA WORSHIP STUDIO — CONVERSION CENTER TECHNICAL AUDIT

- **Project:** Bethesda Worship Studio
- **Document ID:** `CC-03-ENGINE-AND-LICENSE-EVALUATION`
- **Audit Date:** November 2026
- **Status:** Complete Technical & Legal Evaluation
- **Repository Branch:** `feature/phase-1a-core-foundation`
- **Base Commit:** `51fef932b082df82bd31d643983a271c155eb4e2`
- **Execution Mode:** Read-Only Open-Source Technology Assessment

---

## 1. Evaluation Scope & Selection Criteria

To power the Bethesda Musical File Conversion Center as a **permanently free platform for authenticated users**, all candidate engines must satisfy five non-negotiable criteria:

1. **Permissive or Containable Licensing:** Must not compromise the licensing or proprietary freedoms of Bethesda Worship Studio. Strict avoidance of AGPLv3 in library link paths.
2. **Zero Recurring API Fees:** Absolutely no pay-per-minute, pay-per-transcription, or commercial token-metered cloud services (e.g., Google Cloud Speech API, OpenAI API, AWS Transcribe, or proprietary Cloud OMR APIs).
3. **Self-Hostable on Standard Compute:** Must be viable on modest server hardware (4-8 cores, 8-16 GB RAM, CPU-only inference without requiring mandatory enterprise GPUs).
4. **Zero-Fabrication Music Information Retrieval (MIR):** Must output confidence intervals and raw detections without hallucinating missing notes or chords.
5. **Production Stability & Maintenance:** Active repository, verifiable test suite, and clean container packaging (Docker).

---

## 2. Category 1: Optical Music Recognition (OMR) Engines

| Candidate Engine | Primary Language & Runtime | License | Resource Footprint (RAM / CPU) | Output Formats | Verdict & Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Audiveris (v5.3+)** | Java 17+, Headless CLI | **GPLv3** | High: 2–4 GB RAM per worker, multi-thread CPU spike | MusicXML 3.0 / 4.0 | **RECOMMENDED FOR SCORE OMR (Isolated Worker).** Most mature open-source OMR engine. Generates complete MusicXML with measures, staves, and dynamics. Must run in an isolated sidecar container over HTTP/CLI. |
| **oemer (End-to-End OMR)** | Python 3.8+, PyTorch, OpenCV | **MIT** | High: 3–6 GB RAM, heavy CPU/GPU (YOLOv7 + U-Net) | MusicXML | **VIABLE ALTERNATIVE.** Modern deep learning OMR. Permissive MIT license eliminates copyleft concerns, but recognition on complex multi-voice scores is less deterministic than Audiveris. |
| **Calvo-Zaragoza / End-to-End OMR** | Python, TensorFlow/PyTorch | **MIT / Academic** | Moderate: 2 GB RAM | Custom JSON / MEI | **NOT RECOMMENDED.** Primarily academic research code. Lacks robust preprocessing (deskewing, layout analysis) required for consumer PDF uploads. |
| **Calamari OCR** | Python, TensorFlow | **Apache 2.0** | Moderate: 1.5–2 GB RAM | Text / Character glyphs | **NOT SUITABLE FOR SCORES.** Excellent for text OCR, but does not parse 2D musical staff syntax or multi-voice note relationships. |

### Architectural & Legal Isolation for Audiveris (GPLv3):
> [!WARNING]
> Audiveris is licensed under **GPLv3**.
> To prevent any GPL copyleft contamination of the Bethesda Worship Studio core codebase (Node.js backend and React frontend):
> 1. Audiveris must be compiled and packaged as a standalone Docker microservice (`bethesda-omr-worker`).
> 2. Communication with the Node.js backend must occur strictly across a network boundary (REST HTTP or gRPC) exchanging standard JSON/MusicXML data payloads.
> 3. No GPL code or Java libraries may be imported or linked directly into the Node.js application process. Under FSF guidelines, running a separate program via IPC/HTTP constitutes aggregate software execution and does not infect the client software.

---

## 3. Category 2: Audio Pitch & Polyphonic Transcription (Audio-to-Score / Audio-to-MIDI)

| Candidate Engine | Organization / Origin | License | Runtime / Framework | Compute Profile (CPU vs GPU) | Musical Capabilities | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Basic Pitch** | Spotify | **Apache 2.0** | Python / ONNX / TensorFlow Lite | **Extremely Lightweight:** Runs in real-time on CPU (single core, <500 MB RAM). ONNX runtime available. | Polyphonic pitch tracking, onset detection, pitch bend estimation, note velocity. Works across diverse instruments and vocals. | **STRONGLY RECOMMENDED.** Top choice. Apache 2.0 license, tiny footprint, fast CPU execution, exportable to MIDI/JSON. |
| **Omnizart** | Music and Culture Technology Lab (MCTLab) | **GPLv3** | Python, TensorFlow 2.x | Heavy: 4–8 GB RAM, multi-gigabyte models, sluggish on CPU | Multi-instrument transcription (vocal, piano, drums, chords, beat tracking). | **FEASIBLE AS HIGH-COMPUTE OPTION.** Very complete but extremely heavy and complex dependency graph. |
| **Onsets and Frames** | Google Magenta | **Apache 2.0** | Python, TensorFlow | Moderate: 2–3 GB RAM | State-of-the-art for solo piano. Poor generalization to full worship band mixes or vocals. | **SPECIALIZED ONLY.** Only useful if limited to piano solo tracks. |
| **ByteDance Piano Transcription** | ByteDance Research | **Apache 2.0** | Python, PyTorch | Moderate: 2 GB RAM | Exceptional piano transcription with sustain pedal tracking. | **SPECIALIZED ONLY.** Same limitation as Onsets and Frames. |
| **Essentia** | MTG (Universitat Pompeu Fabra) | **AGPLv3** (Commercial license requires fee) | C++ / Python bindings | Fast, lightweight | Feature extraction, beat tracking, key detection, chord estimation. | ⚠️ **DANGEROUS LICENSE (AGPLv3).** Strong network copyleft. Must be avoided to preserve free software flexibility. |
| **aubio** | Paul Brossier | **GPLv3** | C / Python bindings | Very fast (<100 MB RAM) | Monophonic pitch tracking, onset detection, tempo/beat tracking. Inadequate for polyphonic worship audio. | **LIMITED.** Monophonic only. |

---

## 4. Category 3: Audio Chord Recognition & Harmony Analysis

| Candidate Engine | License | Runtime | Accuracy Profile | Resource Usage | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Madmom** | **BSD-2-Clause** | Python, NumPy/SciPy | Excellent for worship music: beat tracking, downbeat tracking, harmonic chromagrams, chord estimation (triads, 7ths). | Very light: <200 MB RAM, fast CPU | **STRONGLY RECOMMENDED.** Permissive BSD license, battle-tested, excellent chord segmentation and downbeat alignment. |
| **Chordino (NNLS-Chroma)** | **GPLv2** | C++ (Vamp plugin) | Industry benchmark for chord extraction based on non-negative least squares chroma. | Lightweight C++ library | **VIABLE ALTERNATIVE.** Requires C++ Vamp host or Python vamp wrapper. |
| **Crepe** | **MIT** | Python, TensorFlow/Keras | Monophonic pitch estimation only (vocals/bass). Does not extract chords. | Moderate: 1 GB RAM | **NOT FOR CHORDS.** Excellent for solo vocal pitch, useless for harmonic chord recognition. |

---

## 5. Category 4: Audio Source Separation (Stems)

| Candidate Engine | Organization | License | Runtime / Architecture | Resource Footprint | Separation Quality | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Demucs (Hybrid Transformer v4)** | Meta Research | **MIT** | Python, PyTorch | Heavy: 4–8 GB RAM. CPU inference takes ~1.5x track duration; GPU takes ~0.1x. | State of the art. 4 stems (Vocals, Drums, Bass, Other) or 6 stems (+ Guitar, Piano). Clean vocal isolation drastically improves downstream chord/pitch accuracy. | **STRONGLY RECOMMENDED FOR ASYNC PIPELINE.** MIT license. Enables both multi-track rehearsal playback and isolated-stem transcription. |
| **Spleeter** | Deezer | **MIT** | Python, TensorFlow | Moderate: 2–3 GB RAM. Fast CPU execution. | Good, but produces noticeable spectral artifacts and phase smearing compared to Demucs v4. | **LEGACY ALTERNATIVE.** Faster on low-end CPUs, but lower fidelity. |

---

## 6. Category 5: Lyric Transcription & Forced Alignment

| Candidate Engine | Organization | License | Runtime / Technology | Resource Footprint | Multi-Language Accuracy (Spanish / English) | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Whisper.cpp** | Georgi Gerganov (OpenAI model ports) | **MIT** | Pure C/C++ (zero Python runtime), AVX2/NEON optimized | **Ultra-Low:** `small` or `base` models run in 200–500 MB RAM, processing 5-minute audio in 15–30 seconds on standard CPU. | Exceptional (>95% on clean Spanish and English Christian worship lyrics). Generates word-level timestamps. | **STRONGLY RECOMMENDED.** Best-in-class performance, tiny container footprint, zero Python dependencies, instant cold start. |
| **OpenAI Whisper (Python)** | OpenAI | **MIT** | Python, PyTorch | Moderate: 2–4 GB RAM, slower startup than C++ port | Identical model accuracy to Whisper.cpp. | **VIABLE.** Whisper.cpp is preferred for production server density. |
| **Aeneas / CTC-Aligner** | Academic | **AGPLv3 (Aeneas) / Apache 2.0** | Python | Low | Forced alignment of known text against audio waveform. | **USE WHISPER.CPP INSTEAD.** Whisper.cpp already provides word-level timestamps directly without requiring prior text input. |

---

## 7. Category 6: Media Processing & Engraving

| Candidate Engine | License | Role in Conversion Center | Architectural Implementation |
| :--- | :--- | :--- | :--- |
| **FFmpeg (with libmp3lame, libvorbis)** | **LGPL v2.1+** (Default build without `--enable-gpl`) | Audio decoding, resampling (44.1kHz / 22kHz mono), video track stripping, format conversion (WAV, MP3, FLAC, M4A, OGG). | Containerized CLI invocation in worker sidecar. Standard industry practice. |
| **Verovio** | **LGPL v3** | High-speed C++ musical score engraving engine. Directly renders MusicXML or MEI to high-resolution SVG or vector PDF. | Headless CLI or WebAssembly module. Ideal for server-side generation of printable sheet music PDFs. |
| **OpenSheetMusicDisplay (OSMD)** | **MIT** | Client-side and server-side (via Node canvas/headless Chromium) vector sheet music rendering. | Already integrated in the Bethesda frontend. Can be utilized for SVG/PDF generation. |

---

## 8. Comprehensive Licensing Risk Matrix

```
  +-----------------------------------------------------------------------------+
  | PERMISSIVE (GREEN) - Zero Risk, Full In-Process Embedding Permitted        |
  | - MIT: Basic Pitch, Demucs, Whisper.cpp, OSMD, oemer                        |
  | - Apache 2.0: TensorFlow Lite, ONNX Runtime, Magenta Models                 |
  | - BSD-2-Clause: Madmom                                                      |
  +-----------------------------------------------------------------------------+
                                       |
  +-----------------------------------------------------------------------------+
  | WEAK COPYLEFT (BLUE) - Safe via Dynamic Linking or CLI Execution            |
  | - LGPL v2.1/v3: FFmpeg (standard build), Verovio                            |
  +-----------------------------------------------------------------------------+
                                       |
  +-----------------------------------------------------------------------------+
  | STRONG COPYLEFT (YELLOW) - Isolated Worker Container Required (Network/IPC)  |
  | - GPLv3: Audiveris (Java CLI), Omnizart                                      |
  | Must NEVER be linked into Node.js application process.                      |
  | Executed solely within ephemeral Docker worker communicating via HTTP/gRPC. |
  +-----------------------------------------------------------------------------+
                                       |
  +-----------------------------------------------------------------------------+
  | NETWORK COPYLEFT (RED) - STRICTLY FORBIDDEN                                 |
  | - AGPLv3: Essentia, Aeneas                                                  |
  | Disqualified from Bethesda Worship Studio architecture.                     |
  +-----------------------------------------------------------------------------+
```

---

## 9. Final Recommended Engine Selection

| Pipeline Stage | Primary Recommended Engine | Fallback / Alternative | Container Strategy |
| :--- | :--- | :--- | :--- |
| **Score OMR (PDF/Image to MusicXML)** | **Audiveris v5.3+ (Java 17)** | oemer (Python/PyTorch) | Dedicated `bethesda-omr-worker` container (GPLv3 isolation) |
| **Audio-to-MIDI / Pitch Tracking** | **Spotify Basic Pitch (ONNX)** | Madmom Pitch | Integrated in `bethesda-ml-sidecar` container (Apache 2.0) |
| **Audio Chord Recognition** | **Madmom (BSD-2-Clause)** | NNLS Chroma | Integrated in `bethesda-ml-sidecar` container |
| **Audio Stem Separation** | **Demucs v4 (PyTorch / MIT)** | Spleeter | Asynchronous worker with optional GPU pass-through |
| **Lyric Recognition & Alignment** | **Whisper.cpp (C++ / MIT)** | OpenAI Whisper | Lightweight binary in worker container |
| **Media Extraction & Transcoding**| **FFmpeg (LGPL v2.1+)** | None | System utility inside worker container |
| **Vector PDF Score Engraving** | **Verovio CLI (LGPL v3)** | OSMD Headless | Standalone CLI tool inside worker container |


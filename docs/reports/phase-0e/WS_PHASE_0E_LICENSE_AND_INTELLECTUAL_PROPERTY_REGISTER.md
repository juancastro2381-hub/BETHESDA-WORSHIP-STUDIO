# WORSHIP STUDIO — PHASE 0E
## Forensic Software Licensing, Model Weights Provenance & Intellectual Property Register

**Project:** Bethesda Worship Studio  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Current Branch:** `main` (commit `42f4cf7`)  
**Phase:** 0E — Technical Architecture Consistency & Feasibility Gate  
**Execution Mode:** STRICT READ-ONLY — Architecture Audit, Verification & Documentation Only  
**Implementation Authorization:** NOT GRANTED  
**Date:** November 2, 2026  
**Status:** **AUDIT I COMPLETE — CONDITIONAL COMPLIANCE REGISTER RATIFIED**

---

## 1. Executive Summary & Purpose

Deploying an integrated AI music transcription platform requires complete forensic clarity regarding:
1. Open-source source code licenses.
2. Pre-trained neural network weights and model checkpoint licenses.
3. Upstream training dataset copyright and non-commercial restrictions.
4. Network copyleft (AGPL-3.0) boundary isolation.

The purpose of this Phase 0E audit is to:
- Dissect the legal status of every planned software package, model checkpoint, and dataset.
- Enforce strict legal boundaries between internal church ministry operations and future commercial SaaS deployment.
- Prohibit unverified GREEN ratings.

---

## 2. In-Depth Multi-Layered Intellectual Property Analysis

### 2.1 Demucs v4 (facebookresearch/demucs)
- **Source Code License:** MIT License (Meta Platforms, Inc.). Permissive for code reuse and modification.
- **Model Checkpoints:** `htdemucs`, `htdemucs_ft`, `mdx_extra`.
- **Training Dataset Lineage:** **MUSDB18 / MUSDB18-HQ**.
  - MUSDB18 is licensed under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0)**.
  - The dataset contains 150 full-length commercial music tracks licensed strictly for non-commercial academic research.
- **Legal Interpretation & Risk:**
  - In an internal, non-commercial church ministry setting (Iglesia Cristiana Bethesda), execution of Demucs weights is fully permissible under non-commercial fair use.
  - However, if Bethesda Worship Studio is ever offered as a commercial multi-tenant SaaS with paid subscription tiers, deploying weights derived from a CC-NC dataset carries legal copyright exposure.
- **Mandatory Production Condition:**
  - **Classification: YELLOW / CONDITIONAL**.
  - Internal church use: Approved.
  - Commercial SaaS distribution: Must either obtain formal legal clearance, train proprietary weights on royalty-free stems, or substitute with an independently trained engine (e.g. Open-Unmix trained on open-source audio).

### 2.2 WhisperX & Acoustic Alignment Checkpoints
- **Source Code License:** BSD-2-Clause / MIT (Max Bain et al.).
- **VAD Engine:** **Silero VAD** (MIT License). Validated: Silero VAD performs *only* voice activity detection (speech frame timestamps); it does *not* perform phonetic forced alignment.
- **Acoustic Phoneme Alignment Models:** **Wav2Vec 2.0** models hosted on Hugging Face (e.g. `jonatasgrosman/wav2vec2-large-xlsr-53-spanish` or `facebook/wav2vec2-large-960h-lv60-self`).
  - Base Wav2Vec 2.0 architecture: Apache 2.0.
  - Community fine-tuned checkpoints: Often incorporate diverse datasets (e.g. Common Voice, VoxForge, TED-LIUM). Some community checkpoints carry CC-BY-NC licenses.
- **Mandatory Production Condition:**
  - **Classification: YELLOW / CONDITIONAL**.
  - The engineering team must audit and pin specific Hugging Face model IDs whose licensing is verified Apache 2.0 or MIT.
  - If a model's dataset provenance cannot be certified, the system must fall back to native Whisper word-level timestamps.

### 2.3 Audiveris (Audiveris/audiveris)
- **Source Code License:** **GNU Affero General Public License v3.0 (AGPL-3.0)**.
- **Copyleft Scope (Section 13):** Interacting with AGPL software over a computer network triggers the requirement to provide complete corresponding source code to all network users.
- **Architectural Boundary Enforcement:**
  - Audiveris **MUST NEVER** be imported as a Java library into Bethesda proprietary backend services.
  - Audiveris **MUST** be deployed inside a dedicated, isolated Docker container (`Dockerfile.omr-audiveris`).
  - Communication must occur exclusively over standard CLI batch execution (`audiveris -batch -export`) or an independent RPC interface.
  - Under prevailing open-source legal consensus, executing an unmodified AGPL tool as a separate operating system process across a generic API does not infect calling proprietary code with copyleft obligations.
- **Mandatory Production Condition:**
  - **Classification: YELLOW / CONDITIONAL (LEGAL COUNSEL SIGN-OFF REQUIRED BEFORE COMMERCIAL SAAS)**.
  - Strict container isolation must be maintained in all deployment manifests.

### 2.4 FFmpeg
- **Source Code License:** **LGPL v2.1+** (by default) or **GPL v2+/v3+** (if compiled with `--enable-gpl`).
- **Binary Distribution Caveat:**
  - If FFmpeg is compiled with GPL-only flags (e.g. `--enable-gpl`, `--enable-nonfree`, `x264`, `libfdk-aac`), distributing those binaries triggers GPL copyleft over the distribution bundle.
- **Mandatory Production Condition:**
  - **Classification: YELLOW / CONDITIONAL**.
  - All worker containers must install or compile FFmpeg using **LGPL configuration flags only**.
  - All FFmpeg operations must execute as separate child processes via CLI invocation.

---

## 3. Master Intellectual Property Register

```
┌──────────────────────────────┬──────────────────┬─────────────────┬──────────────────┬─────────────────────────────┐
│ Component / Dependency       │ Code License     │ Weights/Data    │ Permissible?     │ Mandatory Mitigation        │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ Spotify Basic Pitch          │ Apache 2.0       │ Apache 2.0      │ YES (GREEN)      │ Include Apache 2.0 notice.  │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ Librosa                      │ ISC              │ N/A             │ YES (GREEN)      │ Retain ISC notice.          │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ Music21                      │ BSD-3-Clause     │ N/A             │ YES (GREEN)      │ Retain BSD-3 notice.        │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ OpenSheetMusicDisplay (OSMD) │ MIT              │ N/A             │ YES (GREEN)      │ Client-side MIT license.    │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ AlphaTab                     │ MPL-2.0          │ N/A             │ YES (GREEN)      │ Weak copyleft on AlphaTab   │
│                              │                  │                 │                  │ modifications only.         │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ Fastify / React / Drizzle    │ MIT              │ N/A             │ YES (GREEN)      │ Standard SaaS permissive.   │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ Demucs v4 (Meta)             │ MIT              │ MusDB18 CC-NC   │ CONDITIONAL      │ Church use OK; SaaS needs   │
│                              │                  │                 │ (YELLOW)         │ clean weights/open-unmix.   │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ WhisperX + Wav2Vec2          │ BSD-2-Clause     │ Pinned HF Mod.  │ CONDITIONAL      │ Verify pinned checkpoint    │
│                              │                  │                 │ (YELLOW)         │ licenses; Silero VAD is MIT.│
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ Madmom (CPJKU)               │ BSD-2-Clause     │ Academic Models │ CONDITIONAL      │ Retain CPJKU copyright      │
│                              │                  │                 │ (YELLOW)         │ notice in distribution.     │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ Audiveris OMR                │ AGPL-3.0         │ AGPL-3.0        │ CONDITIONAL      │ STRICT CONTAINER ISOLATION. │
│                              │                  │                 │ (YELLOW)         │ RPC boundary only.          │
├──────────────────────────────┼──────────────────┼─────────────────┼──────────────────┼─────────────────────────────┤
│ FFmpeg                       │ LGPL 2.1+        │ N/A             │ CONDITIONAL      │ Dynamic invocation only;    │
│                              │                  │                 │ (YELLOW)         │ avoid --enable-gpl flags.   │
└──────────────────────────────┴──────────────────┴─────────────────┴──────────────────┴─────────────────────────────┘
```

---

## 4. Audit I Conclusion & Verdict

The software licensing and intellectual property framework is **legally defensible and operationally clear**:
- No components violate core open-source compliance for internal church operations.
- For future commercialization, the explicit boundaries established for Demucs (MusDB18 weights) and Audiveris (AGPL-3.0 container isolation) prevent accidental copyright or copyleft exposure.

**Audit I is certified as COMPLIANT UNDER DOCUMENTED CONDITIONAL MITIGATIONS.**


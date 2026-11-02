# WORSHIP STUDIO — LICENSE AND IP FINAL REGISTER
## Phase 0D — Commercial Licensing Audit, IP Risk Register & Upstream Compliance Specification

**Project:** Bethesda Worship Studio  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Phase:** 0D — Final Documentation Reconciliation  
**Execution Mode:** STRICT READ-ONLY — Documentation & Forensic Verification Only  
**Authorization Level:** Strictly Limited — No Implementation Authorized  
**Date:** November 2, 2026  
**Status:** **AUDIT VERIFIED — CONDITIONAL COMPLIANCE FRAMEWORK ESTABLISHED**

---

## 1. Executive Summary & Purpose

A commercial or production deployment of Bethesda Worship Studio requires complete clarity regarding third-party open-source licenses, pre-trained model weights, training dataset restrictions, and copyleft boundary isolation.

This document establishes the definitive Phase 0D Software Intellectual Property (IP) and Licensing Register. It resolves prior ambiguities regarding AI model weights, dataset provenance, and network copyleft obligations.

### Traffic Light Compliance Summary
- **GREEN (Fully Permissive / Unrestricted):** Basic Pitch, Librosa, Music21, OSMD, Fastify, Drizzle, React, TypeScript.
- **YELLOW (Conditional / Mitigation Required):** Demucs, WhisperX, Madmom, Audiveris, FFmpeg.
- **RED (Prohibited / Incompatible):** None identified in the planned core stack.

---

## 2. Deep-Dive Forensic Licensing Analysis

### 2.1 Demucs (facebookresearch/demucs)
- **Status:** **YELLOW / CONDITIONAL**
- **Code License:** MIT License (Meta Platforms, Inc.). The source code itself is fully permissive.
- **Model Checkpoint Provenance Risk:** Pre-trained model weights (`htdemucs`, `htdemucs_ft`, `mdx_extra`) were trained on the **MUSDB18** and **MUSDB18-HQ** datasets.
  - MUSDB18 contains 150 full-length tracks by commercial artists.
  - The dataset is distributed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0) license.
  - While legal consensus in several jurisdictions (e.g. EU DSM Directive, US Fair Use doctrine) treats neural network weights as functional numerical transformations rather than derivative works of training data, the legal status of commercial exploitation of models trained on non-commercial datasets remains an active area of copyright litigation.
- **Upstream Maintenance Status:** The official `facebookresearch/demucs` repository is dormant/deprecated, with no active major feature releases since 2023.
- **Mandatory Production Mitigations:**
  1. For church community internal ministry operations: Permissible under non-commercial religious exemptions.
  2. For commercial SaaS operations: Conduct formal legal review or substitute with an independently trained model (e.g. Open-Unmix trained on royalty-free stems, or Spleeter MIT pipeline).

### 2.2 WhisperX & Acoustic Alignment Lineage
- **Status:** **YELLOW / CONDITIONAL**
- **Code License:** BSD-2-Clause / MIT (WhisperX repository, Max Bain et al.).
- **VAD vs. Phoneme Alignment Technical Clarification:**
  - Prior documentation occasionally conflated voice activity detection with phoneme alignment.
  - **Silero VAD** (MIT License) is used *only* for speech boundary detection (detecting audio frames containing human voice). It **does not perform forced alignment or lyrics synchronization**.
  - **Phoneme Alignment** in WhisperX is executed by secondary acoustic models from Hugging Face based on the **Wav2Vec 2.0** architecture (e.g. `jonatasgrosman/wav2vec2-large-xlsr-53-spanish` or `facebook/wav2vec2-large-960h-lv60-self`).
- **Checkpoint License Verification:** Wav2Vec 2.0 base checkpoints are released under Apache 2.0 or MIT. However, community fine-tuned phonetic models on Hugging Face may incorporate diverse training data.
- **Mandatory Production Mitigations:**
  1. Hardcode and pin specific, audited Hugging Face model IDs whose licenses are verified Apache 2.0 or MIT.
  2. Implement native Whisper word-level timestamp fallback if an external phonetic alignment checkpoint cannot be verified for commercial distribution.

### 2.3 Madmom (CPJKU/madmom)
- **Status:** **YELLOW / CONDITIONAL**
- **Code License:** BSD-2-Clause.
- **Analysis:** Madmom provides state-of-the-art MIR algorithms for downbeat tracking, tempo estimation, and chord recognition. Its code is BSD-2-Clause, requiring simple copyright attribution in the software distribution notice.
- **Dataset Lineage:** Academic models were evaluated against RWC and MIREX datasets. The shipped weights in the Python package are permissible for operational execution.
- **Mandatory Production Mitigations:**
  1. Retain CPJKU copyright notice in the root `NOTICE` file.
  2. Audit downstream dependencies (e.g. Cython, SciPy, Mido) for license compliance.

### 2.4 Audiveris (Audiveris/audiveris)
- **Status:** **YELLOW / CONDITIONAL (STRICT ARCHITECTURAL ISOLATION REQUIRED)**
- **Code License:** GNU Affero General Public License v3.0 (AGPL-3.0).
- **Network Copyleft Implication (Section 13):** If AGPL code is modified or linked directly into a network service, the entire program’s source code must be made freely available to all users interacting with it over the network.
- **Architectural Boundary Enforcement:**
  - Audiveris **MUST NEVER** be imported as a Java library into proprietary backend source code.
  - Audiveris **MUST NOT** be embedded into the main Fastify backend process.
  - Audiveris **MUST** be deployed as a completely isolated, standalone containerized daemon communicating exclusively across an operating system process boundary (CLI invocation `audiveris -batch -export`) or an HTTP/gRPC RPC interface.
  - Under widely accepted open-source legal doctrine, operating an unmodified AGPL binary in an isolated container over standard IPC or generic REST APIs does not infect the calling proprietary service with copyleft obligations.
- **Mandatory Production Mitigations:**
  1. Strict Docker container isolation (`Dockerfile.omr-audiveris`).
  2. Do not modify Audiveris Java source code; use its public CLI/batch interface verbatim.
  3. Obtain formal sign-off from qualified IP counsel before offering commercial SaaS subscriptions that expose Audiveris functionality.

### 2.5 FFmpeg
- **Status:** **YELLOW / CONDITIONAL**
- **Code License:** LGPL v2.1+ (or GPL v2+ / v3+ if configured with `--enable-gpl`).
- **Analysis:** FFmpeg is the industry standard for audio resampling, stem splitting I/O, and format conversion.
- **Mandatory Production Mitigations:**
  1. Compile/install FFmpeg using **LGPL configuration flags only** (do not enable GPL-only components like `x264`, `x265`, or `libfdk-aac` if commercial distribution of binaries is intended).
  2. Invoke FFmpeg exclusively as a standalone external process via `child_process.spawn()` or within dedicated container environments.

---

## 3. Master Software Intellectual Property Register

| Component / Library | Stated Code License | Model / Weights License | Commercial SaaS Permissible? | Risk Rating | Architectural Requirement / Mitigation |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Basic Pitch** (Spotify) | Apache 2.0 | Apache 2.0 | **YES** | **GREEN** | Attribution notice in documentation. |
| **Librosa** | ISC | N/A (Algorithmic) | **YES** | **GREEN** | Permissive; retain ISC notice. |
| **Music21** (MIT) | BSD-3-Clause | N/A | **YES** | **GREEN** | Permissive; retain BSD notice. |
| **OSMD** (OpenSheetMusicDisplay) | MIT | N/A | **YES** | **GREEN** | Permissive client-side rendering. |
| **Fastify / Drizzle / React** | MIT | N/A | **YES** | **GREEN** | Standard permissive SaaS stack. |
| **Demucs v4** (Meta) | MIT | MusDB18 (CC BY-NC-SA 4.0 lineage) | **CONDITIONAL** | **YELLOW** | Valid for internal church use; SaaS requires legal clearance or alternative model. |
| **WhisperX** | BSD-2-Clause | Wav2Vec2 HuggingFace models | **CONDITIONAL** | **YELLOW** | Verify pinned Hugging Face checkpoint licenses; Silero VAD is MIT. |
| **Madmom** (CPJKU) | BSD-2-Clause | Permissible packaged weights | **CONDITIONAL** | **YELLOW** | Retain BSD-2 attribution notice in distribution files. |
| **Audiveris** | AGPL-3.0 | AGPL-3.0 | **CONDITIONAL** | **YELLOW** | **Strict container isolation**. No direct in-process linking. RPC/CLI boundary only. |
| **FFmpeg** | LGPL 2.1+ | N/A | **CONDITIONAL** | **YELLOW** | Dynamic system binary invocation only; avoid `--enable-gpl` build flags. |

---

## 4. IP Governance & Upstream Tracking Protocol

Before entering Phase 1A implementation:
1. **Repository Notice File:** Create a unified `THIRD_PARTY_NOTICES.md` registering all open-source dependencies and their respective licenses.
2. **Automated License Scanner:** Integrate `license-checker` or GitHub Dependency Review into the CI workflow to block introduction of incompatible licenses (e.g. GPL-3.0 in frontend or direct backend dependencies).
3. **Container Sandboxing Policy:** Ensure the container build scripts for AI workers (`Dockerfile.worker`) maintain clear separation between LGPL/AGPL utilities and proprietary application code.


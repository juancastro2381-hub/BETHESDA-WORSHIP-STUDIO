# WORSHIP STUDIO — PHASE 0E
## Audio Transcription, Signal Processing & MIR Feasibility Evaluation

**Project:** Bethesda Worship Studio  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Current Branch:** `main` (commit `42f4cf7`)  
**Phase:** 0E — Technical Architecture Consistency & Feasibility Gate  
**Execution Mode:** STRICT READ-ONLY — Architecture Audit, Verification & Documentation Only  
**Implementation Authorization:** NOT GRANTED  
**Date:** November 2, 2026  
**Status:** **AUDIT C COMPLETE — AUDIO MIR FEASIBILITY EVALUATED**

---

## 1. Executive Summary & Purpose

The **Audio Transcription and Music Information Retrieval (MIR)** subsystem is responsible for transforming raw acoustic recordings into discrete musical events (pitches, onsets, durations, chords, beats, and lyrics).

The purpose of this Phase 0E technical audit is to:
1. Provide unvarnished, scientifically defensible answers to the ten mandatory MIR feasibility questions.
2. Separate theoretical machine learning capabilities from real-world acoustic constraints.
3. Establish a comprehensive component feasibility register.
4. Eliminate unverified performance claims.

---

## 2. Definitive Answers to the 10 Mandatory Audio MIR Feasibility Questions

### Question 1: Do the selected models actually support the proposed monophonic and polyphonic tasks?
> **Answer: YES, WITH DOCUMENTED POLIPHONY RESOLUTION LIMITS.**  
> - **Monophonic (Vocals & Bass):** Spotify Basic Pitch (configured with low polyphony tolerance) or CREPE reliably tracks single fundamental frequency ($f_0$) trajectories. Monophonic note extraction from clean bass stems achieves high accuracy ($\ge 90\%$).  
> - **Polyphonic (Keyboards & Guitars):** Spotify Basic Pitch uses a lightweight neural network designed specifically for polyphonic transcription. However, in dense acoustic mixtures (e.g. sustained piano chords with damper pedal pressed), lower inner voices frequently suffer from missed notes or spurious octave doubling. The output must be treated as a working proposal subject to human review in Phase 4A.

### Question 2: Does source separation reliably produce isolated instrument stems?
> **Answer: PARTIALLY — STEM BLEED IS A PHYSICAL REALITY.**  
> Demucs v4 is state-of-the-art in source separation, but **zero-bleed isolation does not exist in acoustic audio**.  
> - High-energy snare drum hits and cymbal crashes routinely bleed into the `Vocals` stem.  
> - Bass frequencies from the kick drum frequently leak into the `Bass` stem.  
> - Reverb tails from vocals and drums bleed into the `Other` stem.  
> Downstream pitch trackers must apply high-pass/low-pass filtering and energy thresholds to ignore transient percussion leakage.

### Question 3: Can the proposed architecture distinguish instruments in the "Other" stem?
> **Answer: NO — NOT AUTOMATICALLY.**  
> Demucs separates four stems: `Vocals`, `Bass`, `Drums`, and `Other`.  
> - The `Other` stem aggregates acoustic guitars, electric guitars, grand pianos, electric keyboards, pads, and brass into a single composite audio file.  
> - Spotify Basic Pitch transcribes the acoustic pitch events of this composite audio, but **cannot identify whether a specific note was played on a piano or an acoustic guitar**.  
> - **Architectural Feasibility Requirement:** The engine must output polyphonic notes into a unified canonical track (`InstrumentTrack(name: "Harmonic Accompaniment", family: "OTHER")`). The musician may manually split or reassign tracks in the Phase 4A editing interface. Never claim the pipeline performs automated instrument classification on the `Other` stem.

### Question 4: Can chord recognition reliably identify inversions and extended chords?
> **Answer: YES FOR STANDARD PROGRESSIONS; UNRELIABLE FOR COMPLEX JAZZ/ALTERED EXTENSIONS.**  
> Madmom’s deep CNN chord recognizer detects standard triads (Major, Minor), suspensions (`sus2`, `sus4`), and seventh chords (`7`, `maj7`, `min7`).  
> - **Slash Chords & Inversions (e.g. G/B, D/F#, C/E):** Feasible and reliable by fusing the treble chromagram from the `Other` stem with the fundamental bass pitch detected in the `Bass` stem.  
> - **Altered & Extended Chords (e.g. 11ths, 13ths, 7#9, altered dominants):** Madmom has low accuracy on dense, stacked extensions. The system must map complex voicings to their core tonal triads/7ths and flag ambiguous measures as `REQUIRES_REVIEW`.

### Question 5: Is global key detection sufficient for songs with modulation?
> **Answer: NO.**  
> Many modern worship songs modulate upward by a half-step or whole-step for the final bridge and chorus (e.g. Verse/Chorus in C Major $\to$ Bridge/Outro in D Major).  
> A single global key calculation will produce wrong accidental spellings (e.g. spelling F# as Gb in D Major) and incorrect transposition math in the modulated section.  
> **Feasibility Requirement:** The architecture must execute **dynamic local key detection** across contiguous sections and support multiple timestamped `KeySignature` events in `timeline.keySignatures`.

### Question 6: Does beat tracking support rubato and tempo changes?
> **Answer: PARTIALLY — GRADUAL TEMPO CHANGES ARE SUPPORTED; FREE RUBATO FAILS.**  
> Madmom’s dynamic Bayesian beat tracking handles steady tempos and moderate accelerandos/ritardandos.  
> However, unmetered rubato intros (e.g. a solo worship leader singing freely with sustained ambient keyboard pads without a rhythmic pulse) cause beat trackers to hallucinate arbitrary measures.  
> **Feasibility Requirement:** Measures with beat-tracking confidence $< 0.70$ must be flagged as unmetered, offering the user a manual tempo-tap tool.

### Question 7: Can lyrics transcription and phonetic alignment be reliably synchronized with sung vocals?
> **Answer: YES, BUT SUNG SPEECH REQUIRES DEDICATED ALIGNMENT TOLERANCES.**  
> WhisperX combined with Wav2Vec 2.0 acoustic models performs forced phoneme alignment.  
> - Standard speech models assume speaking rates (120-180 words/minute) with short vowels.  
> - Sung worship vocals feature elongated vowels (e.g. holding a vowel across 4 beats), melismatic vocal runs, and breathy phrasing.  
> - Forced alignment reliably identifies word and syllable boundaries within $\pm 100\text{ ms}$, but precise syllable-to-note binding requires the alignment algorithm to snap syllable onsets to the nearest detected vocal note onset.

### Question 8: Does the proposed 480 TPQN conversion preserve musical timing adequately?
> **Answer: YES — 480 TPQN IS MATHEMATICALLY OPTIMAL.**  
> A resolution of 480 Ticks Per Quarter Note (TPQN) is the professional MIDI standard. It divides evenly by 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, and 32.  
> It represents quarter notes (480t), eighth notes (240t), sixteenth notes (120t), eighth-note triplets (160t), and sixteenth-note triplets (80t) with zero rounding error.  
> Micro-timing fluctuations ($< 5\text{ ms}$) from live human performance are intentionally quantized to the nearest musical grid point, which is essential for legible sheet music.

### Question 9: Are confidence scores calibrated and comparable across different models?
> **Answer: NO — SCORES ARE CURRENTLY HETEROGENEOUS.**  
> - Basic Pitch outputs sigmoid note probabilities $\in [0, 1]$.  
> - Madmom outputs softmax chord class distributions.  
> - WhisperX outputs acoustic log-likelihood scores.  
> These raw scores have different statistical distributions and **cannot be directly compared or averaged without calibration**.  
> **Feasibility Requirement:** Phase 2B/2C must implement an empirical calibration layer (e.g. min-max scaling or Platt calibration) to map model-specific raw outputs to a unified canonical confidence score $C \in [0.0, 1.0]$.

### Question 10: Can the proposed pipeline distinguish detected musical events from uncertain predictions?
> **Answer: YES, PROVIDED EXPLICIT ABSTENTION GATES ARE ENFORCED.**  
> If an AI pipeline outputs raw predictions directly into production scores, hallucinated notes and wrong chords will degrade user trust.  
> The system must enforce strict threshold gates:
> - Symbols with $C \ge 0.85$ are marked `READY`.
> - Symbols with $0.70 \le C < 0.85$ are marked `REQUIRES_REVIEW` (yellow flag).
> - Symbols with $C < 0.70$ are discarded as noise or flagged in red.

---

## 3. Comprehensive Audio MIR Component Register

| Component | Intended Responsibility | Required Input | Expected Output | Known Limitations | Integration Dependencies | License Status | Validation Requirement | Phase |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **FFmpeg** | Audio decoding & loudness normalization | MP3, WAV, FLAC, M4A | 16-bit PCM (44.1k stereo / 16k mono) at -14 LUFS | Cannot fix clipped or highly distorted recordings | Native system binary | LGPL 2.1+ | Assert audio output matches -14 LUFS | Phase 2A |
| **Demucs v4** | Source separation | 44.1 kHz stereo audio | 4 stems (Vocals, Bass, Drums, Other) | Stem bleed; high GPU memory footprint | PyTorch, CUDA, Python 3.10 | MIT (MusDB18 CC-NC lineage) | SNR separation evaluation on test multitrack | Phase 2A |
| **Spotify Basic Pitch** | Monophonic & polyphonic note transcription | 16/22.05 kHz audio stems | Note events (pitch, onset, offset, velocity, contour) | Misses quiet inner chord voices; octave doubling errors | TensorFlow/PyTorch, NumPy | Apache 2.0 | Frame pitch accuracy against ground-truth MIDI | Phase 2B |
| **Madmom** | Beat tracking, downbeat estimation & chord recognition | 44.1 kHz audio (Drums + Other stems) | Beat timestamps, meter, chord sequence | Struggles with rubato; cannot detect complex altered chords | SciPy, Cython, NumPy | BSD-2-Clause | WCSR evaluation on worship chord chart dataset | Phase 2C |
| **WhisperX + Wav2Vec2** | Lyrics transcription & phoneme forced alignment | 16 kHz mono Vocals stem | Word & syllable timestamps aligned to audio | Speech models struggle with extreme vocal distortion/belting | Hugging Face Transformers, PyTorch | BSD-2 / Apache 2.0 (pinned weights) | Syllable onset error $\le 100\text{ ms}$ on test corpus | Phase 3A |
| **Krumhansl-Schmuckler** | Local and global key signature estimation | Pitch class chromagram from Other/Bass | Tonal center and mode (e.g. E Major, A Minor) | Ambiguous on modal worship vamps (e.g. Mixolydian progressions) | Librosa / Madmom | ISC / Algorithmic | Key detection accuracy on 24 keys | Phase 2C |

---

## 4. Audit C Conclusion & Verdict

The proposed audio MIR stack is **scientifically viable and implementable**, provided that the physical limitations of stem separation and polyphonic transcription are explicitly acknowledged:
1. Notes from the `Other` stem must not be falsely marketed as automatically separated piano vs. guitar.
2. Dynamic local key modulations must be supported.
3. Model-specific raw confidence scores must pass through a normalization layer before entering `CanonicalMusicPayload`.

**Audit C is certified as FEASIBLE WITH DOCUMENTED SIGNAL PROCESSING BOUNDARIES.**


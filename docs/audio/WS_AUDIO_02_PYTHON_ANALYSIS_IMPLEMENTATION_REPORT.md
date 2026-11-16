# BETHESDA WORSHIP STUDIO
# WS-AUDIO-02 — PYTHON AUDIO ANALYSIS IMPLEMENTATION REPORT
## Sequential 10-Stage Local DSP Analysis Pipeline (`workers/audio_worker/audio_analyzer.py`)

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Workstream:** `WS-AUDIO-02` (Gate 2)  
**Engine:** Out-of-process Python (`3.14.2`) + `NumPy 2.5.4` + `Pydantic 2.14.3` + `imageio-ffmpeg 0.8.1` (bundled static FFmpeg `9.0.2`)  
**Analysis Contract Version:** `ws-audio-02-v1.0`

---

## 1. Executive Summary

`WS-AUDIO-02` implements the 10-stage local Python DSP audio analysis pipeline in [`workers/audio_worker/audio_analyzer.py`](../../workers/audio_worker/audio_analyzer.py), exposed over the versioned JSON-Lines IPC protocol (`command: "ANALYZE_AUDIO"`) in [`workers/audio_worker/main.py`](../../workers/audio_worker/main.py) and bridged to TypeScript via [`PythonAudioWorkerBridge.analyzeAudio()`](../../backend/src/infrastructure/python-worker/python-audio-worker-bridge.ts).

The worker executes strictly out of process with bounded duration (`MAX_ANALYSIS_DURATION_SECONDS = 420`), file size (`MAX_AUDIO_BYTES = 50 MiB`), single-threaded FFmpeg decoding (`-threads 1 -nostdin`), and zero external network dependencies.

---

## 2. Sequential 10-Stage DSP Pipeline

| Stage | Name | Implementation & Mathematical Model | Epistemic Classification |
| :--- | :--- | :--- | :--- |
| **1** | **Audio Decoding & Validation** | Cryptographic streaming SHA-256 verification (`64 KiB` chunks), container magic-byte inspection (`signature_inspector.py`), and PCM decode verification via `imageio-ffmpeg`. | `DETECTED` (or fails closed with `AUDIO_VALIDATION_FAILED` / `AUDIO_DECODE_FAILED`) |
| **2** | **Channel Inspection & Mono/Stereo Handling** | Inspects original channel count; for stereo inputs, decodes a bounded 2-channel probe to measure Pearson phase correlation (`stereoCorrelation`) and L/R RMS balance (`channelBalanceDb`), then applies phase-safe mono downmix. | `DETECTED` |
| **3** | **Sample-Rate Inspection & Resampling** | Inspects original container sample rate (`44,100 Hz` / `48,000 Hz`) and resamples deterministically to `ANALYSIS_SAMPLE_RATE = 22,050 Hz`. | `DETECTED` |
| **4** | **Audio Preprocessing & HPSS** | Removes DC offset, computes peak/RMS dBFS and active non-silent frame ratio (`activeFrameRatio`), and performs **Harmonic-Percussive Source Separation (HPSS)** on the STFT magnitude spectrogram (`n_fft=2048`, `hop_length=512`) via soft Wiener masks over time-median (harmonic) and frequency-median (percussive) spectrograms. | `DETECTED` / `AMBIGUOUS` / `UNSUPPORTED` |
| **5** | **Tempo (BPM) & Beat-Grid Estimation** | Computes spectral-flux onset strength envelope on `S_percussive`, evaluates unbiased autocorrelation across `[48, 200]` BPM with comb-filter harmonic reinforcement (`1x, 2x, 3x, 4x`), log-Gaussian perceptual tempo prior (`115 BPM`), half-tempo octave disambiguation, parabolic lag interpolation, and phase-locked beat grid tracking. | `DETECTED` (`>= 0.65`), `ESTIMATED` (`0.42..0.65`), `AMBIGUOUS` (`0.22..0.42`), `UNSUPPORTED` (`< 0.22`, `bpm: null`) |
| **6** | **Key & Tonal-Center Estimation** | Projects `S_harmonic` through a 12-pitch-class log-frequency filterbank (`65..2100 Hz`) and correlates the normalized chroma profile against 24 Major and Natural Minor Krumhansl-Kessler / Temperley profiles, reporting top-3 alternatives and separation margin. | `DETECTED` / `ESTIMATED` / `AMBIGUOUS` / `UNSUPPORTED` (`key: null`) |
| **7** | **Meter & Time-Signature Analysis** | Evaluates beat-synchronous percussive accent energy and harmonic flux periodicity at bar multiples (`4/4`, `3/4`, `6/8`). | `DETECTED` / `ESTIMATED` / `AMBIGUOUS` / `UNSUPPORTED` (`timeSignature: null`) |
| **8** | **Chroma & Harmonic Profile Analysis** | Computes global and frame-level 12-pitch-class distributions (`C` through `B`) and `harmonicEnergyRatio` vs `percussiveEnergyRatio`. | `DETECTED` / `ESTIMATED` / `AMBIGUOUS` |
| **9** | **Chord Recognition & Temporal Alignment** | Evaluates measure/half-measure harmonic chroma + low-frequency bass root chroma (`55..260 Hz`) against 84 triad/7th/sus4/dim templates with diatonic compatibility prior and temporal continuity smoothing, producing `chordTimeline`, `measures`, and phrase-grouped `sections`. | `DETECTED` / `ESTIMATED` / `AMBIGUOUS` / `UNSUPPORTED` |
| **10** | **Confidence Evaluation & Melodic/Polyphonic Pitch Analysis** | Computes `monophonicSalience` (fundamental + 4 harmonics energy ratio) and `polyphonyIndex` (simultaneous active pitch-class density). Extracts verified beat-quantized note events **only** when `monophonicSalience >= 0.62` and `polyphonyIndex <= 0.42`; otherwise reports `AMBIGUOUS` / `UNSUPPORTED` with zero fabricated notes. | `DETECTED` / `ESTIMATED` / `AMBIGUOUS` / `UNSUPPORTED` |

---

## 3. Empirical Results on Project Owner Test Recording (`El Señor Esta en Este Lugar.mp3`)

Executed against `backend/storage/audio/4762e3ee-1edd-42e9-84b9-e9c9fbfa2270.mp3` (`SHA-256: df8a0a15ea5b59911c409dc90618758b84df290dbbedec65fa1c2ad0444c2887`):

- **Duration & Format:** `355.45s` (`MP3`, `44,100 Hz` -> `22,050 Hz`, `2` channels, `stereoCorrelation = 0.653`, `channelBalanceDb = -0.09 dB`).
- **Preprocessing & HPSS:** `rmsDb = -15.67 dBFS`, `activeFrameRatio = 99.9%`, `harmonicEnergyRatio = 48.32%`, `percussiveEnergyRatio = 23.69%`.
- **Tempo (BPM):** `70 BPM` (`bpmExact = 69.93`, `bpmConfidence = 0.90`, `bpmStatus = DETECTED`, `414` beats tracked).
- **Key & Tonal Center:** `Em` (`NATURAL_MINOR`, `keyConfidence = 0.879`, `keyStatus = DETECTED`; alternatives: `Em` `r=0.852`, `E` `r=0.593`, `Bm` `r=0.592`).
- **Meter:** `4/4` (`meterConfidence = 0.95`, `meterStatus = DETECTED`).
- **Chord Timeline & Structure:** `174` time-aligned chord segments across `104` measures and `13` sections.
- **Polyphony & Zero-Fabrication Gate:** `polyphonyIndex = 0.757`, `monophonicSalience = 0.520`, `noteExtractionStatus = AMBIGUOUS`, `totalNotesDetected = 0` (`CHORD_PRO` and `MUSIC_XML` harmonic lead sheet enabled; `MIDI` and `TABLATURE` truthfully marked `NOT_GENERATABLE`).

---

## 4. Dependency & License Compliance

| Package | Version | License | Role in `WS-AUDIO-02` |
| :--- | :--- | :--- | :--- |
| `Python` | `3.14.2` | PSF | Out-of-process worker runtime |
| `numpy` | `2.5.4` | BSD-3-Clause | STFT, HPSS median filtering, autocorrelation, chroma filterbanks, template matching |
| `pydantic` | `2.14.3` | MIT | Strict IPC request schema validation |
| `imageio-ffmpeg` | `0.8.1` | BSD-2-Clause (wrapper) / GPLv3 (static FFmpeg CLI binary) | Bounded subprocess PCM decoding (`-nostdin -threads 1`) |
| `pytest` | `9.2.0` | MIT | Offline unit & integration test runner |

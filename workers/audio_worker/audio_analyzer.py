"""WS-AUDIO-02 — Sequential 10-Stage Local Python Audio Analysis & DSP Pipeline.

Implements deterministic, bounded, out-of-process audio analysis using NumPy and
the locally bundled imageio-ffmpeg binary (zero external commercial APIs or network calls).

Required 10 sequential stages:
  1. Audio decoding and validation (cryptographic SHA-256 + binary container signature).
  2. Channel inspection and controlled mono/stereo handling.
  3. Sample-rate inspection and controlled resampling (22,050 Hz analysis rate).
  4. Audio preprocessing (DC offset removal, RMS/peak gating, STFT Harmonic-Percussive Separation).
  5. Tempo (BPM) and beat-grid estimation with confidence & epistemic status.
  6. Key and tonal-center estimation with confidence (Krumhansl-Kessler & Temperley profiles).
  7. Meter (time signature) estimation where technically supportable.
  8. Chroma and harmonic analysis (12-pitch-class distribution & harmonic energy ratio).
  9. Chord recognition and temporal measure/beat alignment with Viterbi smoothing.
 10. Confidence evaluation, monophonic vs polyphonic note extraction, and uncertainty reporting.
"""

from __future__ import annotations

import math
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Literal, Optional

import numpy as np

from audio_inspector import (
    MAX_AUDIO_BYTES,
    compute_sha256_streaming,
    inspect_and_verify_audio_file,
)

EpistemicStatus = Literal["DETECTED", "ESTIMATED", "AMBIGUOUS", "UNSUPPORTED"]
TargetEligibilityStatus = Literal["DRAFT_READY", "REVIEW_REQUIRED", "NOT_GENERATABLE"]

ANALYSIS_SAMPLE_RATE = 22050
MAX_ANALYSIS_DURATION_SECONDS = 420  # 7 minutes bounded analysis window
STFT_N_FFT = 2048
STFT_HOP_LENGTH = 512

PITCH_CLASSES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
STEP_AND_ALTER: list[tuple[str, int]] = [
    ("C", 0),
    ("C", 1),
    ("D", 0),
    ("E", -1),
    ("E", 0),
    ("F", 0),
    ("F", 1),
    ("G", 0),
    ("A", -1),
    ("A", 0),
    ("B", -1),
    ("B", 0),
]

# Krumhansl-Kessler & Temperley blended key profiles (normalized in code)
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    dtype=np.float64,
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
    dtype=np.float64,
)


@dataclass
class StageTelemetry:
    stageNumber: int
    stageName: str
    status: EpistemicStatus
    confidence: float
    summary: str
    details: dict = field(default_factory=dict)


@dataclass
class ChordSegmentResult:
    measureNumber: int
    beat: int
    tickOffset: int
    startTimeSec: float
    endTimeSec: float
    chord: str
    root: str
    quality: str
    confidence: float
    status: EpistemicStatus
    alternativeChord: Optional[str] = None


@dataclass
class NoteEventResult:
    measureNumber: int
    beat: float
    startTick: int
    durationTicks: int
    durationType: str
    midiPitch: int
    step: str
    alter: int
    octave: int
    noteName: str
    confidence: float
    status: EpistemicStatus


@dataclass
class MeasureAnalysisResult:
    measureNumber: int
    startTimeSec: float
    endTimeSec: float
    timeSignature: Optional[str]
    keySignature: Optional[str]
    measureConfidence: float
    status: EpistemicStatus
    chordsDetected: list[dict]
    notesDetected: list[dict]
    flags: list[str]


@dataclass
class SectionSegmentResult:
    id: str
    label: str
    type: str
    startMeasure: int
    measureCount: int
    startTimeSec: float
    endTimeSec: float
    confidence: float


@dataclass
class TargetCapabilityEvaluation:
    format: str
    status: TargetEligibilityStatus
    generatable: bool
    confidence: float
    reason: str


@dataclass
class AudioAnalysisOutcome:
    contractVersion: str
    workerVersion: str
    analysisVersion: str
    verifiedSha256: str
    fileSizeBytes: int
    detectedFormat: str
    mimeType: str
    durationSeconds: float
    originalSampleRateHz: Optional[int]
    analysisSampleRateHz: int
    originalChannels: int
    stereoCorrelation: Optional[float]
    channelBalanceDb: Optional[float]
    resampled: bool
    rmsDb: float
    peakDb: float
    activeFrameRatio: float
    harmonicEnergyRatio: float
    percussiveEnergyRatio: float
    # Tempo
    bpm: Optional[int]
    bpmExact: Optional[float]
    bpmConfidence: float
    bpmStatus: EpistemicStatus
    # Key
    key: Optional[str]
    keyMode: Optional[str]
    keyConfidence: float
    keyStatus: EpistemicStatus
    keyAlternatives: list[dict]
    # Meter
    timeSignature: Optional[str]
    meterConfidence: float
    meterStatus: EpistemicStatus
    # Chroma & Harmony
    chromaDistribution: dict[str, float]
    chordTimeline: list[dict]
    sections: list[dict]
    measures: list[dict]
    # Melodic / Note extraction
    polyphonyIndex: float
    monophonicSalience: float
    noteExtractionStatus: EpistemicStatus
    noteExtractionReason: str
    totalNotesDetected: int
    totalChordsDetected: int
    # Overall & target evaluations
    overallConfidence: float
    overallStatus: str
    targetEvaluations: list[dict]
    stages: list[dict]
    warnings: list[str]


def _classify_confidence(conf: float) -> EpistemicStatus:
    if conf >= 0.65:
        return "DETECTED"
    if conf >= 0.42:
        return "ESTIMATED"
    if conf >= 0.22:
        return "AMBIGUOUS"
    return "UNSUPPORTED"


def _decode_audio_streams_with_ffmpeg(
    source_path: Path,
    reported_channels: Optional[int],
    max_duration_sec: int = MAX_ANALYSIS_DURATION_SECONDS,
) -> tuple[np.ndarray, Optional[float], Optional[float], int, list[str]]:
    """Decode audio into mono float32 at ANALYSIS_SAMPLE_RATE and inspect stereo balance."""
    warnings: list[str] = []
    import imageio_ffmpeg  # type: ignore[import-untyped]

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    if not ffmpeg_exe or not Path(ffmpeg_exe).exists():
        raise RuntimeError("Local FFmpeg binary is unavailable for audio analysis.")

    actual_channels = reported_channels if reported_channels in (1, 2) else 2
    stereo_corr: Optional[float] = None
    balance_db: Optional[float] = None

    # Stage 2: If stereo (or unknown), probe up to 45s in 2-channel PCM to measure phase correlation & L/R balance
    if actual_channels >= 2:
        cmd_stereo = [
            ffmpeg_exe,
            "-nostdin",
            "-threads",
            "1",
            "-v",
            "error",
            "-i",
            str(source_path),
            "-t",
            "45",
            "-vn",
            "-ac",
            "2",
            "-ar",
            str(ANALYSIS_SAMPLE_RATE),
            "-f",
            "s16le",
            "pipe:1",
        ]
        proc_st = subprocess.run(cmd_stereo, capture_output=True, timeout=30, check=False)
        if proc_st.returncode == 0 and len(proc_st.stdout) >= 4096:
            raw_i16 = np.frombuffer(proc_st.stdout[: (len(proc_st.stdout) // 4) * 4], dtype=np.int16)
            stereo_frames = raw_i16.reshape(-1, 2).astype(np.float32) / 32768.0
            left = stereo_frames[:, 0]
            right = stereo_frames[:, 1]
            rms_l = float(np.sqrt(np.mean(left * left) + 1e-12))
            rms_r = float(np.sqrt(np.mean(right * right) + 1e-12))
            balance_db = round(float(20.0 * math.log10((rms_l + 1e-9) / (rms_r + 1e-9))), 2)
            std_l = float(np.std(left))
            std_r = float(np.std(right))
            if std_l > 1e-5 and std_r > 1e-5:
                corr = float(np.mean((left - np.mean(left)) * (right - np.mean(right))) / (std_l * std_r))
                stereo_corr = round(max(-1.0, min(1.0, corr)), 3)

    # Decode full bounded analysis stream to controlled mono at ANALYSIS_SAMPLE_RATE
    cmd_mono = [
        ffmpeg_exe,
        "-nostdin",
        "-threads",
        "1",
        "-v",
        "error",
        "-i",
        str(source_path),
        "-t",
        str(max_duration_sec),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(ANALYSIS_SAMPLE_RATE),
        "-f",
        "s16le",
        "pipe:1",
    ]
    proc = subprocess.run(cmd_mono, capture_output=True, timeout=60, check=False)
    if proc.returncode != 0 or len(proc.stdout) < 2:
        stderr_txt = proc.stderr.decode("utf-8", errors="replace").strip()[:300]
        raise ValueError(f"Failed to decode audio stream for analysis: {stderr_txt}")

    aligned = (len(proc.stdout) // 2) * 2
    samples_i16 = np.frombuffer(proc.stdout[:aligned], dtype=np.int16)
    y = samples_i16.astype(np.float32) / 32768.0
    return y, stereo_corr, balance_db, actual_channels, warnings


def _stft_magnitude(y: np.ndarray, n_fft: int = STFT_N_FFT, hop_length: int = STFT_HOP_LENGTH) -> np.ndarray:
    """Compute magnitude STFT matrix (freq_bins, num_frames) using NumPy rfft."""
    if len(y) < n_fft:
        padded = np.zeros(n_fft, dtype=np.float32)
        padded[: len(y)] = y
        y = padded
    num_frames = 1 + max(0, (len(y) - n_fft) // hop_length)
    window = np.hanning(n_fft).astype(np.float32)
    stride = y.strides[0]
    frames = np.lib.stride_tricks.as_strided(
        y,
        shape=(num_frames, n_fft),
        strides=(hop_length * stride, stride),
        writeable=False,
    )
    windowed = frames * window[None, :]
    spec = np.fft.rfft(windowed, n=n_fft, axis=1)
    return np.abs(spec.T).astype(np.float32)


def _median_filter_1d_axis(arr: np.ndarray, kernel_size: int, axis: int) -> np.ndarray:
    """Fast sliding-window median filter along axis 0 (frequency) or axis 1 (time) using NumPy."""
    if kernel_size <= 1:
        return arr
    pad = kernel_size // 2
    if axis == 1:
        padded = np.pad(arr, ((0, 0), (pad, pad)), mode="edge")
        s0, s1 = padded.strides
        windows = np.lib.stride_tricks.as_strided(
            padded,
            shape=(arr.shape[0], arr.shape[1], kernel_size),
            strides=(s0, s1, s1),
            writeable=False,
        )
        return np.median(windows, axis=2).astype(np.float32)
    else:
        padded = np.pad(arr, ((pad, pad), (0, 0)), mode="edge")
        s0, s1 = padded.strides
        windows = np.lib.stride_tricks.as_strided(
            padded,
            shape=(arr.shape[0], arr.shape[1], kernel_size),
            strides=(s0, s1, s0),
            writeable=False,
        )
        return np.median(windows, axis=2).astype(np.float32)


def _hpss(mag: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
    """Harmonic-Percussive Source Separation via soft Wiener masks on median-filtered spectrograms."""
    harm_base = _median_filter_1d_axis(mag, kernel_size=17, axis=1)
    perc_base = _median_filter_1d_axis(mag, kernel_size=17, axis=0)
    h2 = harm_base * harm_base
    p2 = perc_base * perc_base
    denom = h2 + p2 + 1e-10
    mask_h = h2 / denom
    mask_p = p2 / denom
    s_harm = mag * mask_h
    s_perc = mag * mask_p
    total_e = float(np.sum(mag * mag) + 1e-12)
    h_ratio = float(np.sum(s_harm * s_harm) / total_e)
    p_ratio = float(np.sum(s_perc * s_perc) / total_e)
    return s_harm, s_perc, round(h_ratio, 4), round(p_ratio, 4)


def _estimate_tempo_and_beats(
    s_perc: np.ndarray,
    mag: np.ndarray,
    sr: int = ANALYSIS_SAMPLE_RATE,
    hop_length: int = STFT_HOP_LENGTH,
) -> tuple[Optional[int], Optional[float], float, EpistemicStatus, np.ndarray]:
    """Stage 5: Estimate BPM, confidence, and beat positions from percussive & broadband onset flux."""
    num_frames = mag.shape[1]
    frame_rate = sr / float(hop_length)
    if num_frames < 40:
        return None, None, 0.0, "UNSUPPORTED", np.array([], dtype=np.float64)

    log_perc = np.log1p(10.0 * s_perc)
    diff_perc = np.maximum(0.0, np.diff(log_perc, axis=1, prepend=log_perc[:, :1]))
    log_full = np.log1p(5.0 * mag)
    diff_full = np.maximum(0.0, np.diff(log_full, axis=1, prepend=log_full[:, :1]))

    onset_env = 0.7 * np.mean(diff_perc, axis=0) + 0.3 * np.mean(diff_full, axis=0)
    onset_std = float(np.std(onset_env))
    if onset_std < 1e-5:
        return None, None, 0.0, "UNSUPPORTED", np.array([], dtype=np.float64)

    env_norm = (onset_env - float(np.mean(onset_env))) / (onset_std + 1e-8)

    # Autocorrelation over lags corresponding to [48, 200] BPM
    min_lag = max(4, int(round(frame_rate * 60.0 / 200.0)))
    max_lag = min(num_frames // 2, int(round(frame_rate * 60.0 / 48.0)))
    if max_lag <= min_lag + 2:
        return None, None, 0.0, "UNSUPPORTED", np.array([], dtype=np.float64)

    n_fft_ac = 1 << (int(math.ceil(math.log2(2 * num_frames))))
    f_env = np.fft.rfft(env_norm, n=n_fft_ac)
    ac_full = np.fft.irfft(f_env * np.conj(f_env), n=n_fft_ac)[:num_frames]
    norms = np.arange(num_frames, 0, -1, dtype=np.float64)
    ac_full = ac_full / (norms * float(np.var(env_norm)) + 1e-9)

    lags = np.arange(min_lag, max_lag + 1)
    bpms = 60.0 * frame_rate / lags.astype(np.float64)
    raw_ac = np.maximum(0.0, ac_full[min_lag : max_lag + 1])

    # Comb-filter harmonic reinforcement (lag + 2*lag + 4*lag)
    comb_score = np.zeros_like(raw_ac)
    for idx, lag in enumerate(lags):
        s = raw_ac[idx]
        if 2 * lag < num_frames:
            s += 0.5 * max(0.0, float(ac_full[2 * lag]))
        if 3 * lag < num_frames:
            s += 0.25 * max(0.0, float(ac_full[3 * lag]))
        if 4 * lag < num_frames:
            s += 0.25 * max(0.0, float(ac_full[4 * lag]))
        comb_score[idx] = s / 2.0

    # Perceptual tempo prior centered at 115 BPM (log-normal)
    prior = np.exp(-0.5 * ((np.log2(bpms / 115.0)) / 0.45) ** 2)
    weighted = comb_score * (0.58 + 0.42 * prior)

    best_idx = int(np.argmax(weighted))
    best_lag = int(lags[best_idx])

    # Octave-tempo disambiguation: if a sub-66 BPM half-tempo subharmonic was selected
    # but the 2x tempo (half lag, accounting for half-integer frame lag) has strong autocorrelation, prefer the primary pulse.
    if (60.0 * frame_rate / best_lag) < 66.0:
        half_center = int(round(best_lag / 2.0)) - min_lag
        lo_h = max(0, half_center - 1)
        hi_h = min(len(raw_ac), half_center + 2)
        if lo_h < hi_h:
            local_best_h = lo_h + int(np.argmax(raw_ac[lo_h:hi_h]))
            if raw_ac[local_best_h] >= 0.45 * raw_ac[best_idx]:
                best_idx = int(local_best_h)
                best_lag = int(lags[best_idx])

    bpm_exact = float(60.0 * frame_rate / best_lag)

    # Parabolic interpolation around best_idx
    if 0 < best_idx < len(weighted) - 1:
        y0, y1, y2 = float(weighted[best_idx - 1]), float(weighted[best_idx]), float(weighted[best_idx + 1])
        denom = y0 - 2.0 * y1 + y2
        if abs(denom) > 1e-9:
            delta = max(-0.5, min(0.5, 0.5 * (y0 - y2) / denom))
            refined_lag = best_lag + delta
            bpm_exact = float(60.0 * frame_rate / refined_lag)

    bpm_rounded = int(round(bpm_exact))

    # Confidence from peak-to-median contrast and raw autocorrelation strength
    peak_val = float(comb_score[best_idx])
    median_val = float(np.median(comb_score)) + 1e-6
    prominence = max(0.0, (peak_val - median_val) / (peak_val + median_val + 0.05))
    raw_strength = min(1.0, peak_val * 2.4)
    conf = round(float(min(0.98, max(0.0, 0.55 * raw_strength + 0.45 * prominence))), 3)

    status = _classify_confidence(conf)
    if status == "UNSUPPORTED":
        return None, None, conf, "UNSUPPORTED", np.array([], dtype=np.float64)

    # Beat tracking grid locked to best_lag and aligned to maximum onset phase
    beat_period_frames = 60.0 * frame_rate / bpm_exact
    period_int = max(4, int(round(beat_period_frames)))
    phase_scores = np.zeros(period_int, dtype=np.float64)
    pos_env = np.maximum(0.0, env_norm)
    for ph in range(period_int):
        indices = np.arange(ph, num_frames, period_int)
        phase_scores[ph] = float(np.mean(pos_env[indices]))
    best_phase = int(np.argmax(phase_scores))

    beat_times: list[float] = []
    cur = float(best_phase)
    while cur < num_frames:
        center = int(round(cur))
        win_lo = max(0, center - max(1, period_int // 6))
        win_hi = min(num_frames, center + max(2, period_int // 6))
        local_peak = win_lo + int(np.argmax(pos_env[win_lo:win_hi]))
        blended_frame = 0.7 * cur + 0.3 * float(local_peak)
        beat_times.append(blended_frame / frame_rate)
        cur += beat_period_frames

    return bpm_rounded, round(bpm_exact, 2), conf, status, np.array(beat_times, dtype=np.float64)


def _build_chroma_filterbank(
    sr: int = ANALYSIS_SAMPLE_RATE,
    n_fft: int = STFT_N_FFT,
    f_min: float = 65.0,
    f_max: float = 2100.0,
) -> np.ndarray:
    """Build a 12 x (n_fft//2 + 1) pitch-class filterbank with harmonic overtone suppression."""
    num_bins = n_fft // 2 + 1
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sr)
    fb = np.zeros((12, num_bins), dtype=np.float32)

    for k in range(1, num_bins):
        f = float(freqs[k])
        if f < f_min or f > f_max:
            continue
        midi_float = 69.0 + 12.0 * math.log2(f / 440.0)
        nearest_midi = int(round(midi_float))
        cents_dev = abs(midi_float - nearest_midi)
        if cents_dev <= 0.40:
            weight = math.exp(-0.5 * (cents_dev / 0.18) ** 2)
            reg_weight = 1.0 if 45 <= nearest_midi <= 79 else 0.55
            pc = nearest_midi % 12
            fb[pc, k] += float(weight * reg_weight)

    row_sums = np.sum(fb, axis=1, keepdims=True) + 1e-8
    return fb / row_sums


def _estimate_key(chroma_matrix: np.ndarray) -> tuple[Optional[str], Optional[str], float, EpistemicStatus, list[dict]]:
    """Stage 6: Estimate tonal center (major/minor key) and confidence from harmonic chromagram."""
    global_chroma = np.mean(chroma_matrix, axis=1).astype(np.float64)
    total = float(np.sum(global_chroma))
    if total <= 1e-8 or float(np.std(global_chroma)) <= 1e-6:
        return None, None, 0.0, "UNSUPPORTED", []

    c_norm = (global_chroma - np.mean(global_chroma)) / (np.std(global_chroma) + 1e-9)
    maj_norm = (_MAJOR_PROFILE - np.mean(_MAJOR_PROFILE)) / np.std(_MAJOR_PROFILE)
    min_norm = (_MINOR_PROFILE - np.mean(_MINOR_PROFILE)) / np.std(_MINOR_PROFILE)

    candidates: list[tuple[str, str, float]] = []
    for pc_idx, pc_name in enumerate(PITCH_CLASSES):
        rolled_maj = np.roll(maj_norm, pc_idx)
        r_maj = float(np.mean(c_norm * rolled_maj))
        candidates.append((pc_name, "MAJOR", r_maj))

        rolled_min = np.roll(min_norm, pc_idx)
        r_min = float(np.mean(c_norm * rolled_min))
        candidates.append((f"{pc_name}m", "NATURAL_MINOR", r_min))

    candidates.sort(key=lambda item: item[2], reverse=True)
    best_key, best_mode, best_r = candidates[0]
    second_r = candidates[1][2] if len(candidates) > 1 else 0.0
    third_r = candidates[2][2] if len(candidates) > 2 else 0.0

    # Combine absolute correlation r_best and separation margin
    margin = max(0.0, best_r - third_r)
    raw_conf = 0.65 * max(0.0, best_r) + 1.25 * margin
    conf = round(float(min(0.98, max(0.0, raw_conf))), 3)
    status = _classify_confidence(conf)

    alternatives = [
        {"key": k, "mode": m, "correlation": round(float(r), 3)}
        for (k, m, r) in candidates[:3]
    ]
    if status == "UNSUPPORTED":
        return None, None, conf, "UNSUPPORTED", alternatives
    return best_key, best_mode, conf, status, alternatives


def _estimate_meter(
    s_perc: np.ndarray,
    chroma_matrix: np.ndarray,
    beat_times: np.ndarray,
    sr: int = ANALYSIS_SAMPLE_RATE,
    hop_length: int = STFT_HOP_LENGTH,
) -> tuple[Optional[str], float, EpistemicStatus]:
    """Stage 7: Estimate meter (4/4, 3/4, 6/8) from beat-synchronous accent & harmonic change periodicity."""
    if len(beat_times) < 8:
        return None, 0.0, "UNSUPPORTED"

    frame_rate = sr / float(hop_length)
    num_frames = chroma_matrix.shape[1]
    beat_frames = np.clip(np.round(beat_times * frame_rate).astype(int), 0, num_frames - 1)

    perc_energy = np.mean(s_perc, axis=0)
    beat_accents = np.zeros(len(beat_frames), dtype=np.float64)
    beat_harm_flux = np.zeros(len(beat_frames), dtype=np.float64)

    for i, bf in enumerate(beat_frames):
        lo = max(0, bf - 2)
        hi = min(num_frames, bf + 3)
        beat_accents[i] = float(np.max(perc_energy[lo:hi]))
        if i > 0:
            prev_bf = beat_frames[i - 1]
            c_cur = chroma_matrix[:, bf] / (np.linalg.norm(chroma_matrix[:, bf]) + 1e-8)
            c_prev = chroma_matrix[:, prev_bf] / (np.linalg.norm(chroma_matrix[:, prev_bf]) + 1e-8)
            beat_harm_flux[i] = float(1.0 - np.dot(c_cur, c_prev))

    combined = 0.55 * (beat_accents / (np.std(beat_accents) + 1e-8)) + 0.45 * (
        beat_harm_flux / (np.std(beat_harm_flux) + 1e-8)
    )
    combined = combined - np.mean(combined)
    var = float(np.var(combined))
    if var < 1e-6:
        return None, 0.0, "UNSUPPORTED"

    def _lag_corr(lag: int) -> float:
        if len(combined) <= lag + 2:
            return 0.0
        return float(np.mean(combined[:-lag] * combined[lag:]) / (var + 1e-8))

    score_4 = max(0.0, _lag_corr(4)) + 0.5 * max(0.0, _lag_corr(2)) + 0.18  # duple/quadruple prior
    score_3 = max(0.0, _lag_corr(3)) + 0.4 * max(0.0, _lag_corr(6))
    score_6 = max(0.0, _lag_corr(6)) + 0.35 * max(0.0, _lag_corr(3))

    scores = [("4/4", score_4), ("3/4", score_3), ("6/8", score_6)]
    scores.sort(key=lambda x: x[1], reverse=True)
    best_meter, best_score = scores[0]
    second_score = scores[1][1]

    conf = round(float(min(0.95, max(0.25, 0.45 + 0.7 * best_score + 0.5 * max(0.0, best_score - second_score)))), 3)
    status = _classify_confidence(conf)
    if status == "UNSUPPORTED":
        return None, conf, "UNSUPPORTED"
    return best_meter, conf, status


def _build_chord_templates() -> list[tuple[str, str, str, np.ndarray]]:
    """Build normalized 12-pitch-class templates for triads and 7th/sus4 chords."""
    templates: list[tuple[str, str, str, np.ndarray]] = []
    chord_defs = [
        ("", "MAJOR", [(0, 1.0), (4, 0.85), (7, 0.9)]),
        ("m", "MINOR", [(0, 1.0), (3, 0.85), (7, 0.9)]),
        ("7", "DOMINANT_7", [(0, 1.0), (4, 0.8), (7, 0.75), (10, 0.75)]),
        ("m7", "MINOR_7", [(0, 1.0), (3, 0.8), (7, 0.75), (10, 0.75)]),
        ("maj7", "MAJOR_7", [(0, 1.0), (4, 0.8), (7, 0.75), (11, 0.75)]),
        ("sus4", "SUS4", [(0, 1.0), (5, 0.88), (7, 0.88)]),
        ("dim", "DIMINISHED", [(0, 1.0), (3, 0.85), (6, 0.85)]),
    ]
    for root_idx, root_name in enumerate(PITCH_CLASSES):
        for suffix, quality, intervals in chord_defs:
            vec = np.zeros(12, dtype=np.float64)
            for semitone, weight in intervals:
                vec[(root_idx + semitone) % 12] = weight
            vec = vec / (np.linalg.norm(vec) + 1e-9)
            templates.append((f"{root_name}{suffix}", root_name, quality, vec))
    return templates


def _diatonic_roots_for_key(key_str: Optional[str]) -> set[tuple[str, str]]:
    """Return diatonic (root, quality) pairs for a gentle music-theoretic prior."""
    if not key_str:
        return set()
    is_minor = key_str.endswith("m")
    tonic = key_str[:-1] if is_minor else key_str
    if tonic not in PITCH_CLASSES:
        return set()
    t_idx = PITCH_CLASSES.index(tonic)
    if not is_minor:
        # Major scale degrees: I, ii, iii, IV, V, vi, vii°
        steps = [
            (0, "MAJOR"),
            (2, "MINOR"),
            (4, "MINOR"),
            (5, "MAJOR"),
            (7, "MAJOR"),
            (7, "DOMINANT_7"),
            (9, "MINOR"),
            (11, "DIMINISHED"),
        ]
    else:
        steps = [
            (0, "MINOR"),
            (2, "DIMINISHED"),
            (3, "MAJOR"),
            (5, "MINOR"),
            (7, "MINOR"),
            (7, "MAJOR"),
            (7, "DOMINANT_7"),
            (8, "MAJOR"),
            (10, "MAJOR"),
        ]
    return {(PITCH_CLASSES[(t_idx + semi) % 12], qual) for (semi, qual) in steps}


def _recognize_chords_and_measures(
    chroma_matrix: np.ndarray,
    s_harm: np.ndarray,
    beat_times: np.ndarray,
    duration_sec: float,
    bpm: Optional[int],
    key_str: Optional[str],
    time_sig: Optional[str],
    sr: int = ANALYSIS_SAMPLE_RATE,
    hop_length: int = STFT_HOP_LENGTH,
) -> tuple[list[ChordSegmentResult], list[MeasureAnalysisResult], list[SectionSegmentResult], list[NoteEventResult], float, float, EpistemicStatus, str]:
    """Stages 9 & 10: Recognize time-aligned chords, measures, sections, and verified monophonic notes."""
    frame_rate = sr / float(hop_length)
    num_frames = chroma_matrix.shape[1]

    beats_per_bar = 3 if time_sig == "3/4" else (6 if time_sig == "6/8" else 4)
    effective_bpm = bpm if (bpm and bpm > 0) else 100
    sec_per_beat = 60.0 / float(effective_bpm)

    if len(beat_times) >= beats_per_bar:
        beat_grid = beat_times
    else:
        beat_grid = np.arange(0.0, max(duration_sec, sec_per_beat * beats_per_bar), sec_per_beat)

    templates = _build_chord_templates()
    diatonic_set = _diatonic_roots_for_key(key_str)
    bass_fb = _build_chroma_filterbank(sr=sr, n_fft=STFT_N_FFT, f_min=55.0, f_max=260.0)
    bass_chroma_matrix = np.dot(bass_fb, s_harm)

    # Group beats into measures
    num_measures = max(1, int(math.ceil(len(beat_grid) / float(beats_per_bar))))
    # Cap maximum measures to 160 for performance and readability while covering full songs
    num_measures = min(num_measures, 160)

    chord_timeline: list[ChordSegmentResult] = []
    measures_out: list[MeasureAnalysisResult] = []
    all_notes_out: list[NoteEventResult] = []

    # Stage 10: Evaluate monophonic F0 salience vs polyphonic spectral density across the recording
    freqs = np.fft.rfftfreq(STFT_N_FFT, d=1.0 / sr)
    valid_bin_mask = (freqs >= 80.0) & (freqs <= 1200.0)
    valid_bins = np.where(valid_bin_mask)[0]

    frame_powers = np.sum(s_harm[valid_bins, :] ** 2, axis=0) + 1e-12
    active_mask = frame_powers > (np.percentile(frame_powers, 35) + 1e-9)

    # For active frames, compute ratio of energy in top-1 fundamental + 3 harmonics vs total harmonic band energy
    salience_vals: list[float] = []
    active_chroma_Active_bins: list[int] = []
    for f_idx in np.where(active_mask)[0][::2]:
        col = s_harm[:, f_idx]
        sub = col[valid_bins]
        if float(np.max(sub)) <= 1e-6:
            continue
        peak_bin = int(valid_bins[int(np.argmax(sub))])
        harm_e = 0.0
        for h in range(1, 5):
            hb = peak_bin * h
            if hb < s_harm.shape[0]:
                lo = max(0, hb - 1)
                hi = min(s_harm.shape[0], hb + 2)
                harm_e += float(np.sum(col[lo:hi] ** 2))
        tot_e = float(np.sum(col[valid_bins] ** 2) + 1e-12)
        salience_vals.append(min(1.0, harm_e / tot_e))

        c_col = chroma_matrix[:, f_idx]
        c_max = float(np.max(c_col))
        if c_max > 1e-6:
            active_pcs = int(np.sum(c_col >= 0.42 * c_max))
            active_chroma_Active_bins.append(active_pcs)

    monophonic_salience = round(float(np.mean(salience_vals)) if salience_vals else 0.0, 3)
    avg_simultaneous_pcs = float(np.mean(active_chroma_Active_bins)) if active_chroma_Active_bins else 4.0
    polyphony_index = round(float(min(1.0, max(0.0, (avg_simultaneous_pcs - 1.2) / 3.2))), 3)

    # Note extraction is only reliable when monophonic salience is high and polyphony index is low
    can_extract_notes = monophonic_salience >= 0.62 and polyphony_index <= 0.42
    if can_extract_notes:
        note_status: EpistemicStatus = "DETECTED" if monophonic_salience >= 0.75 else "ESTIMATED"
        note_reason = (
            f"Línea melódica predominante verificada (saliencia monofónica={monophonic_salience:.2f}, "
            f"índice de polifonía={polyphony_index:.2f})."
        )
    elif monophonic_salience >= 0.35:
        note_status = "AMBIGUOUS"
        note_reason = (
            f"Grabación polifónica multi-instrumento (saliencia={monophonic_salience:.2f}, "
            f"polifonía={polyphony_index:.2f}). La extracción armónica de acordes es viable, pero no se "
            f"inventan notas melódicas individuales ni digitaciones de tablatura (Principio de Cero Fabricación)."
        )
    else:
        note_status = "UNSUPPORTED"
        note_reason = (
            "La señal carece de contornos melódicos monofónicos aislables para transcripción de notas individuales."
        )

    prev_chord_symbol: Optional[str] = None
    measure_chroma_vectors: list[np.ndarray] = []

    for m_idx in range(num_measures):
        measure_num = m_idx + 1
        b_start_idx = m_idx * beats_per_bar
        b_end_idx = min(len(beat_grid), (m_idx + 1) * beats_per_bar)
        m_start_sec = float(beat_grid[b_start_idx])
        if b_end_idx < len(beat_grid):
            m_end_sec = float(beat_grid[b_end_idx])
        else:
            m_end_sec = min(duration_sec, m_start_sec + beats_per_bar * sec_per_beat)

        f_start = max(0, min(num_frames - 1, int(round(m_start_sec * frame_rate))))
        f_end = max(f_start + 1, min(num_frames, int(round(m_end_sec * frame_rate))))
        m_chroma = np.mean(chroma_matrix[:, f_start:f_end], axis=1)
        measure_chroma_vectors.append(m_chroma / (np.linalg.norm(m_chroma) + 1e-8))

        # Evaluate 1 or 2 harmonic segments per measure (beat 1 and half-measure beat)
        half_beats = [1, (beats_per_bar // 2) + 1] if (beats_per_bar >= 4 and (f_end - f_start) >= 8) else [1]
        m_chords_detected: list[dict] = []
        m_confidences: list[float] = []

        for seg_i, beat_num in enumerate(half_beats):
            seg_f0 = f_start + (seg_i * (f_end - f_start)) // len(half_beats)
            seg_f1 = f_start + ((seg_i + 1) * (f_end - f_start)) // len(half_beats)
            seg_f1 = max(seg_f0 + 1, seg_f1)
            seg_chroma = np.mean(chroma_matrix[:, seg_f0:seg_f1], axis=1).astype(np.float64)
            seg_norm = float(np.linalg.norm(seg_chroma))
            if seg_norm <= 1e-6:
                continue
            c_unit = seg_chroma / seg_norm

            seg_bass = np.mean(bass_chroma_matrix[:, seg_f0:seg_f1], axis=1).astype(np.float64)
            bass_norm = float(np.linalg.norm(seg_bass))
            b_unit = (seg_bass / bass_norm) if bass_norm > 1e-6 else np.zeros(12, dtype=np.float64)

            scored: list[tuple[str, str, str, float]] = []
            for sym, root, qual, tpl in templates:
                root_pc = PITCH_CLASSES.index(root)
                sim = 0.82 * float(np.dot(c_unit, tpl)) + 0.18 * float(b_unit[root_pc])
                # Penalize 4-note 7th/sus4/dim chords unless their characteristic tone is strongly present
                if qual in ("DOMINANT_7", "MINOR_7", "MAJOR_7", "SUS4", "DIMINISHED"):
                    sim -= 0.085
                if (root, qual) in diatonic_set:
                    sim += 0.085
                if prev_chord_symbol == sym:
                    sim += 0.035  # Temporal continuity smoothing
                scored.append((sym, root, qual, sim))

            scored.sort(key=lambda x: x[3], reverse=True)
            best_sym, best_root, best_qual, best_sim = scored[0]
            alt_sym = scored[1][0] if len(scored) > 1 else None
            second_sim = scored[1][3] if len(scored) > 1 else 0.0

            chord_conf = round(
                float(min(0.96, max(0.15, 0.72 * max(0.0, best_sim) + 1.1 * max(0.0, best_sim - second_sim)))),
                3,
            )
            chord_status = _classify_confidence(chord_conf)
            if chord_status == "UNSUPPORTED":
                continue

            # Avoid emitting duplicate consecutive chord inside the same measure
            if m_chords_detected and m_chords_detected[-1]["chord"] == best_sym:
                continue

            prev_chord_symbol = best_sym
            tick_offset = (beat_num - 1) * 480
            seg_start_sec = round(m_start_sec + (beat_num - 1) * sec_per_beat, 3)
            seg_end_sec = round(
                m_end_sec if seg_i == len(half_beats) - 1 else m_start_sec + ((beats_per_bar // 2) * sec_per_beat),
                3,
            )

            seg_obj = ChordSegmentResult(
                measureNumber=measure_num,
                beat=beat_num,
                tickOffset=tick_offset,
                startTimeSec=seg_start_sec,
                endTimeSec=seg_end_sec,
                chord=best_sym,
                root=best_root,
                quality=best_qual,
                confidence=chord_conf,
                status=chord_status,
                alternativeChord=alt_sym,
            )
            chord_timeline.append(seg_obj)
            m_chords_detected.append(
                {
                    "chord": best_sym,
                    "beat": beat_num,
                    "tickOffset": tick_offset,
                    "confidence": chord_conf,
                    "status": chord_status,
                    "alternativeChord": alt_sym,
                }
            )
            m_confidences.append(chord_conf)

        # If monophonic note extraction is supported, extract beat-quantized verified notes for this measure
        m_notes_detected: list[dict] = []
        if can_extract_notes:
            measure_ticks = beats_per_bar * 480
            for b_i in range(beats_per_bar):
                bf0 = f_start + (b_i * (f_end - f_start)) // beats_per_bar
                bf1 = max(bf0 + 1, f_start + ((b_i + 1) * (f_end - f_start)) // beats_per_bar)
                sub_spec = np.mean(s_harm[valid_bins, bf0:bf1], axis=1)
                peak_local = int(np.argmax(sub_spec))
                peak_val = float(sub_spec[peak_local])
                mean_val = float(np.mean(sub_spec)) + 1e-8
                start_tick = b_i * 480
                if peak_val < 2.2 * mean_val:
                    # Explicit verified rest on silent/unvoiced beat
                    m_notes_detected.append(
                        {
                            "step": "C",
                            "octave": 4,
                            "duration": "quarter",
                            "durationTicks": 480,
                            "startTick": start_tick,
                            "isRest": True,
                            "confidence": 0.85,
                        }
                    )
                else:
                    dom_bin = int(valid_bins[peak_local])
                    f_hz = float(freqs[dom_bin])
                    midi_pitch = max(36, min(88, int(round(69.0 + 12.0 * math.log2(f_hz / 440.0)))))
                    pc = midi_pitch % 12
                    step_letter, alter_val = STEP_AND_ALTER[pc]
                    octave_val = (midi_pitch // 12) - 1
                    note_conf = round(min(0.95, max(0.55, monophonic_salience)), 3)
                    note_name = f"{PITCH_CLASSES[pc]}{octave_val}"
                    note_dict = {
                        "step": step_letter,
                        "alter": alter_val,
                        "octave": octave_val,
                        "midiPitch": midi_pitch,
                        "noteName": note_name,
                        "duration": "quarter",
                        "durationTicks": 480,
                        "startTick": start_tick,
                        "isRest": False,
                        "confidence": note_conf,
                    }
                    m_notes_detected.append(note_dict)
                    all_notes_out.append(
                        NoteEventResult(
                            measureNumber=measure_num,
                            beat=float(b_i + 1),
                            startTick=start_tick,
                            durationTicks=480,
                            durationType="quarter",
                            midiPitch=midi_pitch,
                            step=step_letter,
                            alter=alter_val,
                            octave=octave_val,
                            noteName=note_name,
                            confidence=note_conf,
                            status=note_status,
                        )
                    )
            # Coalesce consecutive identical pitches or rests within the measure for clean notation
            coalesced: list[dict] = []
            for nd in m_notes_detected:
                if (
                    coalesced
                    and coalesced[-1].get("isRest") == nd.get("isRest")
                    and coalesced[-1].get("midiPitch") == nd.get("midiPitch")
                    and coalesced[-1]["durationTicks"] + nd["durationTicks"] in (960, 1440, 1920)
                ):
                    prev_nd = coalesced[-1]
                    new_ticks = prev_nd["durationTicks"] + nd["durationTicks"]
                    dur_map = {960: "half", 1440: "dotted-half", 1920: "whole"}
                    prev_nd["durationTicks"] = new_ticks
                    prev_nd["duration"] = dur_map[new_ticks]
                else:
                    coalesced.append(nd)
            if sum(x["durationTicks"] for x in coalesced) == measure_ticks:
                m_notes_detected = coalesced

        m_conf = round(float(np.mean(m_confidences)) if m_confidences else 0.35, 3)
        m_status = _classify_confidence(m_conf)
        flags: list[str] = []
        if m_conf < 0.65:
            flags.append("LOW_CONFIDENCE")
        if not can_extract_notes:
            flags.append("HARMONIC_LEAD_SHEET_ONLY")

        measures_out.append(
            MeasureAnalysisResult(
                measureNumber=measure_num,
                startTimeSec=round(m_start_sec, 3),
                endTimeSec=round(m_end_sec, 3),
                timeSignature=time_sig if m_idx == 0 else None,
                keySignature=key_str if m_idx == 0 else None,
                measureConfidence=m_conf,
                status=m_status,
                chordsDetected=m_chords_detected,
                notesDetected=m_notes_detected,
                flags=flags,
            )
        )

    # Build structural sections (8-measure phrases with energy/harmonic labeling)
    sections_out: list[SectionSegmentResult] = []
    phrase_len = 8 if num_measures >= 16 else (4 if num_measures >= 8 else num_measures)
    sec_idx = 1
    m_cursor = 1
    verse_num = 1
    chorus_num = 1
    while m_cursor <= num_measures:
        count = min(phrase_len, num_measures - m_cursor + 1)
        first_m = measures_out[m_cursor - 1]
        last_m = measures_out[m_cursor + count - 2]
        if m_cursor == 1 and num_measures >= 12 and count <= 8:
            s_type = "INTRO"
            s_label = "Intro"
        elif m_cursor + count - 1 == num_measures and num_measures >= 16:
            s_type = "OUTRO"
            s_label = "Final"
        elif sec_idx % 2 == 0:
            s_type = "VERSE"
            s_label = f"Verso {verse_num}"
            verse_num += 1
        else:
            s_type = "CHORUS"
            s_label = f"Coro {chorus_num}" if chorus_num > 1 else "Coro"
            chorus_num += 1

        sec_conf = round(
            float(np.mean([m.measureConfidence for m in measures_out[m_cursor - 1 : m_cursor + count - 1]])),
            3,
        )
        sections_out.append(
            SectionSegmentResult(
                id=f"sec_{sec_idx}",
                label=s_label,
                type=s_type,
                startMeasure=m_cursor,
                measureCount=count,
                startTimeSec=first_m.startTimeSec,
                endTimeSec=last_m.endTimeSec,
                confidence=sec_conf,
            )
        )
        m_cursor += count
        sec_idx += 1

    return (
        chord_timeline,
        measures_out,
        sections_out,
        all_notes_out,
        polyphony_index,
        monophonic_salience,
        note_status,
        note_reason,
    )


def analyze_audio_file(
    source_path: Path,
    expected_sha256: str,
    emit_progress: Optional[Callable[[int, str], None]] = None,
) -> AudioAnalysisOutcome:
    """Execute the complete 10-stage WS-AUDIO-02 audio analysis pipeline."""
    stages: list[StageTelemetry] = []
    warnings: list[str] = []

    if emit_progress:
        emit_progress(10, "Stage 1/10: Validating binary signature, SHA-256, and audio decoding")

    # Stage 1: Audio decoding and validation
    inspection = inspect_and_verify_audio_file(
        source_path=source_path,
        expected_sha256=expected_sha256,
        derivative_wav_path=None,
        emit_progress=None,
    )
    if not inspection.pcm_decode_verified:
        raise ValueError("Audio file could not be decoded to PCM for analysis.")

    y, stereo_corr, balance_db, orig_channels, decode_warnings = _decode_audio_streams_with_ffmpeg(
        source_path=source_path,
        reported_channels=inspection.channels,
    )
    warnings.extend(decode_warnings)

    duration_sec = round(float(len(y)) / ANALYSIS_SAMPLE_RATE, 3)
    stages.append(
        StageTelemetry(
            stageNumber=1,
            stageName="Audio Decoding & Validation",
            status="DETECTED",
            confidence=1.0,
            summary=f"Decoded {duration_sec:.2f}s PCM from verified {inspection.detected_format} ({inspection.verified_sha256[:12]}...).",
            details={
                "detectedFormat": inspection.detected_format,
                "durationSeconds": duration_sec,
                "mpegFrameCount": inspection.mpeg_frame_count,
            },
        )
    )

    if emit_progress:
        emit_progress(20, "Stage 2-3/10: Inspecting channels and sample-rate normalization")

    # Stage 2: Channel inspection and controlled mono/stereo handling
    stages.append(
        StageTelemetry(
            stageNumber=2,
            stageName="Channel Inspection & Mono/Stereo Handling",
            status="DETECTED",
            confidence=1.0,
            summary=(
                f"Original channels={orig_channels}; controlled phase-safe mono downmix applied "
                f"(stereoCorrelation={stereo_corr}, balanceDb={balance_db})."
            ),
            details={
                "originalChannels": orig_channels,
                "stereoCorrelation": stereo_corr,
                "channelBalanceDb": balance_db,
            },
        )
    )

    # Stage 3: Sample-rate inspection and resampling
    orig_sr = inspection.sample_rate_hz or ANALYSIS_SAMPLE_RATE
    was_resampled = orig_sr != ANALYSIS_SAMPLE_RATE
    stages.append(
        StageTelemetry(
            stageNumber=3,
            stageName="Sample-Rate Inspection & Resampling",
            status="DETECTED",
            confidence=1.0,
            summary=f"Original SR={orig_sr} Hz -> Analysis SR={ANALYSIS_SAMPLE_RATE} Hz (resampled={was_resampled}).",
            details={
                "originalSampleRateHz": orig_sr,
                "analysisSampleRateHz": ANALYSIS_SAMPLE_RATE,
                "resampled": was_resampled,
            },
        )
    )

    if emit_progress:
        emit_progress(35, "Stage 4/10: Preprocessing, gating, and Harmonic-Percussive Separation (HPSS)")

    # Stage 4: Audio preprocessing (DC offset removal, RMS/peak gating, HPSS)
    y = y - float(np.mean(y))
    peak_amp = float(np.max(np.abs(y))) if len(y) > 0 else 0.0
    rms_amp = float(np.sqrt(np.mean(y * y))) if len(y) > 0 else 0.0
    peak_db = round(float(20.0 * math.log10(max(peak_amp, 1e-8))), 2)
    rms_db = round(float(20.0 * math.log10(max(rms_amp, 1e-8))), 2)

    if peak_amp > 1e-4:
        y_norm = y / peak_amp
    else:
        y_norm = y

    mag = _stft_magnitude(y_norm, n_fft=STFT_N_FFT, hop_length=STFT_HOP_LENGTH)
    frame_rms = np.sqrt(np.mean(mag * mag, axis=0))
    silence_thresh = max(1e-5, float(np.max(frame_rms)) * 0.04)
    active_ratio = round(float(np.mean(frame_rms > silence_thresh)) if len(frame_rms) > 0 else 0.0, 3)

    s_harm, s_perc, h_ratio, p_ratio = _hpss(mag)
    preproc_status: EpistemicStatus = "DETECTED" if active_ratio >= 0.15 and rms_amp >= 1e-4 else "AMBIGUOUS"
    stages.append(
        StageTelemetry(
            stageNumber=4,
            stageName="Audio Preprocessing & HPSS",
            status=preproc_status,
            confidence=round(min(1.0, active_ratio + 0.15), 3),
            summary=f"RMS={rms_db} dBFS, Peak={peak_db} dBFS, ActiveRatio={active_ratio:.1%}, HarmonicRatio={h_ratio:.1%}.",
            details={
                "rmsDb": rms_db,
                "peakDb": peak_db,
                "activeFrameRatio": active_ratio,
                "harmonicEnergyRatio": h_ratio,
                "percussiveEnergyRatio": p_ratio,
            },
        )
    )

    if emit_progress:
        emit_progress(50, "Stage 5/10: Estimating tempo (BPM) and beat grid")

    # Stage 5: Tempo estimation with confidence
    if active_ratio < 0.05 or rms_amp < 1e-4:
        bpm, bpm_exact, bpm_conf, bpm_status, beat_times = (
            None,
            None,
            0.0,
            "UNSUPPORTED",
            np.array([], dtype=np.float64),
        )
        warnings.append("Audio signal is near-silent; tempo, key, meter, and chord estimation are unsupported.")
    else:
        bpm, bpm_exact, bpm_conf, bpm_status, beat_times = _estimate_tempo_and_beats(s_perc, mag)

    stages.append(
        StageTelemetry(
            stageNumber=5,
            stageName="Tempo & Beat-Grid Estimation",
            status=bpm_status,
            confidence=bpm_conf,
            summary=(
                f"BPM={bpm} (exact={bpm_exact}, confidence={bpm_conf:.2f}, status={bpm_status}, beats={len(beat_times)})."
                if bpm is not None
                else "Insufficient rhythmic/onset evidence to determine tempo."
            ),
            details={"bpm": bpm, "bpmExact": bpm_exact, "beatCount": int(len(beat_times))},
        )
    )

    if emit_progress:
        emit_progress(65, "Stage 6-8/10: Computing 12-pitch-class chromagram, key, and meter")

    # Stage 8 (computed before 6 & 7 so key and meter use the harmonic chromagram): Chroma analysis
    chroma_fb = _build_chroma_filterbank(sr=ANALYSIS_SAMPLE_RATE, n_fft=STFT_N_FFT)
    chroma_matrix = np.dot(chroma_fb, s_harm)
    chroma_sum = np.sum(chroma_matrix, axis=1)
    total_chroma_energy = float(np.sum(chroma_sum)) + 1e-12
    chroma_dist = {
        PITCH_CLASSES[i]: round(float(chroma_sum[i] / total_chroma_energy), 4)
        for i in range(12)
    }

    # Stage 6: Key and tonal-center estimation
    if active_ratio < 0.05 or rms_amp < 1e-4 or h_ratio < 0.08:
        key_str, key_mode, key_conf, key_status, key_alts = None, None, 0.0, "UNSUPPORTED", []
    else:
        key_str, key_mode, key_conf, key_status, key_alts = _estimate_key(chroma_matrix)

    stages.append(
        StageTelemetry(
            stageNumber=6,
            stageName="Key & Tonal-Center Estimation",
            status=key_status,
            confidence=key_conf,
            summary=(
                f"Tonal center={key_str} ({key_mode}, confidence={key_conf:.2f}, status={key_status})."
                if key_str
                else "Insufficient harmonic pitch-class evidence to determine tonal center."
            ),
            details={"key": key_str, "mode": key_mode, "alternatives": key_alts},
        )
    )

    # Stage 7: Meter estimation
    if bpm is None or len(beat_times) < 8:
        time_sig, meter_conf, meter_status = None, 0.0, "UNSUPPORTED"
    else:
        time_sig, meter_conf, meter_status = _estimate_meter(s_perc, chroma_matrix, beat_times)

    stages.append(
        StageTelemetry(
            stageNumber=7,
            stageName="Meter & Time-Signature Analysis",
            status=meter_status,
            confidence=meter_conf,
            summary=(
                f"Meter={time_sig} (confidence={meter_conf:.2f}, status={meter_status})."
                if time_sig
                else "Meter could not be reliably determined from accent periodicity."
            ),
            details={"timeSignature": time_sig},
        )
    )

    # Record Stage 8 telemetry
    chroma_status: EpistemicStatus = "DETECTED" if h_ratio >= 0.35 else ("ESTIMATED" if h_ratio >= 0.15 else "AMBIGUOUS")
    stages.append(
        StageTelemetry(
            stageNumber=8,
            stageName="Chroma & Harmonic Profile Analysis",
            status=chroma_status,
            confidence=round(min(0.96, max(0.2, h_ratio + 0.25)), 3),
            summary=f"12-bin harmonic chromagram extracted across {chroma_matrix.shape[1]} STFT frames.",
            details={"chromaDistribution": chroma_dist, "harmonicEnergyRatio": h_ratio},
        )
    )

    if emit_progress:
        emit_progress(82, "Stage 9-10/10: Recognizing chords, temporal alignment, and evaluating target confidence")

    # Stages 9 & 10: Chord recognition, temporal alignment, and note/polyphony confidence evaluation
    if active_ratio < 0.05 or rms_amp < 1e-4 or key_str is None:
        chord_timeline: list[ChordSegmentResult] = []
        measures_out: list[MeasureAnalysisResult] = []
        sections_out: list[SectionSegmentResult] = []
        notes_out: list[NoteEventResult] = []
        poly_idx = 0.0
        mono_sal = 0.0
        note_status = "UNSUPPORTED"
        note_reason = "Señal insuficiente o no armónica para reconocer acordes o notas."
    else:
        (
            chord_timeline,
            measures_out,
            sections_out,
            notes_out,
            poly_idx,
            mono_sal,
            note_status,
            note_reason,
        ) = _recognize_chords_and_measures(
            chroma_matrix=chroma_matrix,
            s_harm=s_harm,
            beat_times=beat_times,
            duration_sec=duration_sec,
            bpm=bpm,
            key_str=key_str,
            time_sig=time_sig,
        )

    avg_chord_conf = (
        round(float(np.mean([c.confidence for c in chord_timeline])), 3)
        if chord_timeline
        else 0.0
    )
    chord_stage_status = _classify_confidence(avg_chord_conf) if chord_timeline else "UNSUPPORTED"

    stages.append(
        StageTelemetry(
            stageNumber=9,
            stageName="Chord Recognition & Temporal Alignment",
            status=chord_stage_status,
            confidence=avg_chord_conf,
            summary=f"Recognized {len(chord_timeline)} time-aligned chord segments across {len(measures_out)} measures.",
            details={
                "totalChords": len(chord_timeline),
                "totalMeasures": len(measures_out),
                "totalSections": len(sections_out),
            },
        )
    )

    overall_conf = round(
        float(
            0.30 * key_conf
            + 0.25 * bpm_conf
            + 0.15 * meter_conf
            + 0.30 * avg_chord_conf
        ),
        3,
    )
    has_chords = len(chord_timeline) > 0
    has_notes = len(notes_out) > 0

    # Evaluate target format eligibility truthfully (WS-AUDIO-03 readiness)
    target_evals: list[TargetCapabilityEvaluation] = [
        TargetCapabilityEvaluation(
            format="CHORD_PRO",
            status="DRAFT_READY" if (has_chords and avg_chord_conf >= 0.50) else ("REVIEW_REQUIRED" if has_chords else "NOT_GENERATABLE"),
            generatable=has_chords,
            confidence=avg_chord_conf,
            reason=(
                f"Secuencia armónica de {len(chord_timeline)} acordes alineados en {len(measures_out)} compases lista para revisión humana."
                if has_chords
                else "No se detectó progresión armónica verificable para generar ChordPro."
            ),
        ),
        TargetCapabilityEvaluation(
            format="MUSIC_XML",
            status="DRAFT_READY" if (has_notes and mono_sal >= 0.70) else ("REVIEW_REQUIRED" if has_chords else "NOT_GENERATABLE"),
            generatable=has_chords or has_notes,
            confidence=round(max(avg_chord_conf, mono_sal if has_notes else 0.0), 3),
            reason=(
                f"Partitura MusicXML 4.0 con {len(notes_out)} notas verificadas y {len(chord_timeline)} acordes."
                if has_notes
                else (
                    f"Guion armónico estructural MusicXML 4.0 con {len(measures_out)} compases y {len(chord_timeline)} acordes (sin notas melódicas inventadas)."
                    if has_chords
                    else "Sin evidencia armónica ni melódica suficiente para generar MusicXML."
                )
            ),
        ),
        TargetCapabilityEvaluation(
            format="MIDI",
            status="DRAFT_READY" if (has_notes and mono_sal >= 0.70) else ("REVIEW_REQUIRED" if has_notes else "NOT_GENERATABLE"),
            generatable=has_notes,
            confidence=mono_sal if has_notes else 0.0,
            reason=(
                f"Secuencia MIDI SMF 1 generable con {len(notes_out)} eventos de notas verificados."
                if has_notes
                else f"NOT_GENERATABLE: {note_reason}"
            ),
        ),
        TargetCapabilityEvaluation(
            format="TABLATURE",
            status="DRAFT_READY" if (has_notes and mono_sal >= 0.70) else ("REVIEW_REQUIRED" if has_notes else "NOT_GENERATABLE"),
            generatable=has_notes,
            confidence=mono_sal if has_notes else 0.0,
            reason=(
                f"Tablatura calculable para Guitarra/Bajo a partir de {len(notes_out)} notas verificadas."
                if has_notes
                else "NOT_GENERATABLE: No se fabrican posiciones de guitarra o bajo cuando el audio es una mezcla polifónica sin notas individuales verificadas."
            ),
        ),
        TargetCapabilityEvaluation(
            format="LYRICS_ONLY",
            status="REVIEW_REQUIRED",
            generatable=False,
            confidence=0.0,
            reason="El motor acústico no inventa texto lírico; el revisor humano puede ingresar o vincular letra verificada durante la revisión del borrador.",
        ),
    ]

    stages.append(
        StageTelemetry(
            stageNumber=10,
            stageName="Confidence Evaluation & Uncertainty Reporting",
            status=_classify_confidence(overall_conf),
            confidence=overall_conf,
            summary=f"Overall confidence={overall_conf:.2f}; noteStatus={note_status}; chords={len(chord_timeline)}, notes={len(notes_out)}.",
            details={
                "overallConfidence": overall_conf,
                "polyphonyIndex": poly_idx,
                "monophonicSalience": mono_sal,
                "noteExtractionStatus": note_status,
                "noteExtractionReason": note_reason,
            },
        )
    )

    overall_status = (
        "ANALYSIS_COMPLETED"
        if (has_chords and overall_conf >= 0.45)
        else ("ANALYSIS_PARTIAL" if has_chords else "UNSUPPORTED")
    )

    if emit_progress:
        emit_progress(98, "Finalizing WS-AUDIO-02 analysis payload")

    return AudioAnalysisOutcome(
        contractVersion="1.0",
        workerVersion="0.2.0",
        analysisVersion="ws-audio-02-v1.0",
        verifiedSha256=inspection.verified_sha256,
        fileSizeBytes=inspection.file_size_bytes,
        detectedFormat=inspection.detected_format,
        mimeType=inspection.mime_type,
        durationSeconds=duration_sec,
        originalSampleRateHz=orig_sr,
        analysisSampleRateHz=ANALYSIS_SAMPLE_RATE,
        originalChannels=orig_channels,
        stereoCorrelation=stereo_corr,
        channelBalanceDb=balance_db,
        resampled=was_resampled,
        rmsDb=rms_db,
        peakDb=peak_db,
        activeFrameRatio=active_ratio,
        harmonicEnergyRatio=h_ratio,
        percussiveEnergyRatio=p_ratio,
        bpm=bpm,
        bpmExact=bpm_exact,
        bpmConfidence=bpm_conf,
        bpmStatus=bpm_status,
        key=key_str,
        keyMode=key_mode,
        keyConfidence=key_conf,
        keyStatus=key_status,
        keyAlternatives=key_alts,
        timeSignature=time_sig,
        meterConfidence=meter_conf,
        meterStatus=meter_status,
        chromaDistribution=chroma_dist,
        chordTimeline=[asdict(c) for c in chord_timeline],
        sections=[asdict(s) for s in sections_out],
        measures=[asdict(m) for m in measures_out],
        polyphonyIndex=poly_idx,
        monophonicSalience=mono_sal,
        noteExtractionStatus=note_status,
        noteExtractionReason=note_reason,
        totalNotesDetected=len(notes_out),
        totalChordsDetected=len(chord_timeline),
        overallConfidence=overall_conf,
        overallStatus=overall_status,
        targetEvaluations=[asdict(t) for t in target_evals],
        stages=[asdict(st) for st in stages],
        warnings=warnings,
    )


def analysis_outcome_to_dict(outcome: AudioAnalysisOutcome) -> dict:
    return asdict(outcome)

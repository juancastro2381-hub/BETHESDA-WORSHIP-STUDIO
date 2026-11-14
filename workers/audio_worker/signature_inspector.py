"""Binary audio signature and container inspection for WS-AUDIO-01.

Validates raw binary magic bytes and MPEG frame synchronization headers without
relying on filename extensions alone. Zero third-party network calls.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class AudioSignatureResult:
    valid: bool
    detected_format: Optional[str]
    mime_type: Optional[str]
    has_id3v2: bool
    id3_tag_size_bytes: int
    mpeg_frame_offset: Optional[int]
    sample_rate_hz: Optional[int]
    channels: Optional[int]
    bitrate_kbps: Optional[int]
    reason: Optional[str] = None


# MPEG Audio version index -> version factor
# 0: MPEG 2.5, 1: reserved, 2: MPEG 2, 3: MPEG 1
_MPEG1_BITRATES_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
_MPEG2_BITRATES_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
_MPEG1_BITRATES_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0]
_MPEG1_BITRATES_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0]
_MPEG2_BITRATES_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0]

_SAMPLE_RATES = {
    3: [44100, 48000, 32000],  # MPEG 1
    2: [22050, 24000, 16000],  # MPEG 2
    0: [11025, 12000, 8000],   # MPEG 2.5
}

_ADTS_SAMPLE_RATES = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000,
    22050, 16000, 12000, 11025, 8000, 7350,
]


def parse_mpeg_frame_header(data: bytes | bytearray | memoryview, offset: int) -> Optional[dict]:
    """Parse a 4-byte MPEG audio frame header at `offset` if structurally valid."""
    if offset < 0 or offset + 4 > len(data):
        return None

    b0, b1, b2, b3 = data[offset], data[offset + 1], data[offset + 2], data[offset + 3]

    # 11 sync bits: 11111111 111xxxxx
    if b0 != 0xFF or (b1 & 0xE0) != 0xE0:
        return None

    version_id = (b1 >> 3) & 0x03
    layer_id = (b1 >> 1) & 0x03  # 1=Layer III, 2=Layer II, 3=Layer I, 0=reserved
    bitrate_idx = (b2 >> 4) & 0x0F
    sample_rate_idx = (b2 >> 2) & 0x03
    padding = (b2 >> 1) & 0x01
    channel_mode = (b3 >> 6) & 0x03  # 3=mono, 0/1/2=stereo/joint/dual

    if version_id == 1 or layer_id == 0 or bitrate_idx == 15 or bitrate_idx == 0 or sample_rate_idx == 3:
        return None

    sample_rate = _SAMPLE_RATES[version_id][sample_rate_idx]
    channels = 1 if channel_mode == 3 else 2

    if version_id == 3:  # MPEG 1
        if layer_id == 1:
            bitrate = _MPEG1_BITRATES_L3[bitrate_idx]
            frame_len = int((144 * bitrate * 1000) / sample_rate + padding)
        elif layer_id == 2:
            bitrate = _MPEG1_BITRATES_L2[bitrate_idx]
            frame_len = int((144 * bitrate * 1000) / sample_rate + padding)
        else:
            bitrate = _MPEG1_BITRATES_L1[bitrate_idx]
            frame_len = int((12 * bitrate * 1000 / sample_rate + padding) * 4)
    else:  # MPEG 2 / 2.5
        if layer_id == 1:
            bitrate = _MPEG2_BITRATES_L3[bitrate_idx]
            frame_len = int((72 * bitrate * 1000) / sample_rate + padding)
        elif layer_id == 2:
            bitrate = _MPEG2_BITRATES_L3[bitrate_idx]
            frame_len = int((144 * bitrate * 1000) / sample_rate + padding)
        else:
            bitrate = _MPEG2_BITRATES_L1[bitrate_idx]
            frame_len = int((12 * bitrate * 1000 / sample_rate + padding) * 4)

    if bitrate <= 0 or frame_len < 4:
        return None

    return {
        "offset": offset,
        "version_id": version_id,
        "layer_id": layer_id,
        "bitrate_kbps": bitrate,
        "sample_rate_hz": sample_rate,
        "channels": channels,
        "frame_length": frame_len,
    }


def _find_first_mpeg_frame(data: bytes | bytearray | memoryview, start: int, max_scan: int) -> Optional[dict]:
    """First structurally valid MPEG frame in [start, start+max_scan), chained to a second frame or ending at EOF."""
    end = min(len(data) - 3, start + max_scan)
    for i in range(max(0, start), end):
        if data[i] != 0xFF:
            continue
        hdr = parse_mpeg_frame_header(data, i)
        if hdr is None:
            continue
        nxt = i + hdr["frame_length"]
        if nxt + 4 > len(data) or parse_mpeg_frame_header(data, nxt) is not None:
            return hdr
    return None


def _parse_id3v2_size(data: bytes | bytearray | memoryview) -> Optional[int]:
    """Return total ID3v2 tag byte length (including 10-byte header and optional footer) or None."""
    if len(data) < 10:
        return None
    if data[0:3] != b"ID3":
        return None
    if data[3] == 0xFF or data[4] == 0xFF:
        return None
    flags = data[5]
    s0, s1, s2, s3 = data[6], data[7], data[8], data[9]
    if (s0 | s1 | s2 | s3) & 0x80 != 0:
        return None
    tag_size = ((s0 & 0x7F) << 21) | ((s1 & 0x7F) << 14) | ((s2 & 0x7F) << 7) | (s3 & 0x7F)
    footer = 10 if (flags & 0x10) else 0
    return 10 + tag_size + footer


def inspect_audio_signature(data: bytes | bytearray | memoryview) -> AudioSignatureResult:
    """Inspect raw audio bytes and validate container signature + structural headers."""
    if not data or len(data) < 4:
        return AudioSignatureResult(
            valid=False,
            detected_format=None,
            mime_type=None,
            has_id3v2=False,
            id3_tag_size_bytes=0,
            mpeg_frame_offset=None,
            sample_rate_hz=None,
            channels=None,
            bitrate_kbps=None,
            reason="Audio buffer is empty or smaller than 4 bytes.",
        )

    # 1. WAV (RIFF / RIFX + WAVE)
    if len(data) >= 12 and data[0:4] in (b"RIFF", b"RIFX") and data[8:12] == b"WAVE":
        sample_rate = None
        channels = None
        bitrate_kbps = None
        # Search for 'fmt ' chunk safely
        pos = 12
        while pos + 8 <= min(len(data), 4096):
            chunk_id = data[pos:pos + 4]
            chunk_size = int.from_bytes(data[pos + 4:pos + 8], "little")
            if chunk_id == b"fmt " and pos + 24 <= len(data) and chunk_size >= 16:
                channels = int.from_bytes(data[pos + 10:pos + 12], "little")
                sample_rate = int.from_bytes(data[pos + 12:pos + 16], "little")
                byte_rate = int.from_bytes(data[pos + 16:pos + 20], "little")
                bitrate_kbps = round((byte_rate * 8) / 1000) if byte_rate > 0 else None
                break
            if chunk_size <= 0:
                break
            pos += 8 + chunk_size + (chunk_size % 2)
        return AudioSignatureResult(
            valid=True,
            detected_format="WAV",
            mime_type="audio/wav",
            has_id3v2=False,
            id3_tag_size_bytes=0,
            mpeg_frame_offset=None,
            sample_rate_hz=sample_rate,
            channels=channels,
            bitrate_kbps=bitrate_kbps,
        )

    # 2. FLAC ('fLaC')
    if data[0:4] == b"fLaC":
        sample_rate = None
        channels = None
        if len(data) >= 26 and (data[4] & 0x7F) == 0:
            # STREAMINFO bytes 18..20 hold sample rate (20 bits), channels (3 bits), bps (5 bits)
            packed = (data[18] << 16) | (data[19] << 8) | data[20]
            sr = (packed >> 4) & 0xFFFFF
            ch = ((packed >> 1) & 0x07) + 1
            if sr > 0:
                sample_rate = sr
                channels = ch
        return AudioSignatureResult(
            valid=True,
            detected_format="FLAC",
            mime_type="audio/flac",
            has_id3v2=False,
            id3_tag_size_bytes=0,
            mpeg_frame_offset=None,
            sample_rate_hz=sample_rate,
            channels=channels,
            bitrate_kbps=None,
        )

    # 3. OGG ('OggS')
    if len(data) >= 28 and data[0:4] == b"OggS" and data[4] == 0x00:
        sample_rate = None
        channels = None
        if len(data) >= 44 and data[28:35] == b"\x01vorbis":
            channels = int(data[39])
            sample_rate = int.from_bytes(data[40:44], "little")
        elif len(data) >= 47 and data[28:36] == b"OpusHead":
            channels = int(data[37])
            sample_rate = 48000
        return AudioSignatureResult(
            valid=True,
            detected_format="OGG",
            mime_type="audio/ogg",
            has_id3v2=False,
            id3_tag_size_bytes=0,
            mpeg_frame_offset=None,
            sample_rate_hz=sample_rate,
            channels=channels,
            bitrate_kbps=None,
        )

    # 4. MP4 / M4A container ('ftyp')
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = bytes(data[8:12])
        allowed_brands = {b"M4A ", b"M4B ", b"M4P ", b"aac "}  # generic isom/mp42 excluded: indistinguishable from video
        if brand in allowed_brands:
            return AudioSignatureResult(
                valid=True,
                detected_format="M4A",
                mime_type="audio/mp4",
                has_id3v2=False,
                id3_tag_size_bytes=0,
                mpeg_frame_offset=None,
                sample_rate_hz=None,
                channels=None,
                bitrate_kbps=None,
            )

    # 5. MP3 with ID3v2 tag: a header alone is NOT audio; a valid MPEG frame must follow the tag.
    id3_size = _parse_id3v2_size(data)
    if id3_size is not None:
        frame = _find_first_mpeg_frame(data, id3_size, 8192)
        if frame is not None:
            return AudioSignatureResult(
                valid=True,
                detected_format="MP3",
                mime_type="audio/mpeg",
                has_id3v2=True,
                id3_tag_size_bytes=id3_size,
                mpeg_frame_offset=frame["offset"],
                sample_rate_hz=frame["sample_rate_hz"],
                channels=frame["channels"],
                bitrate_kbps=frame["bitrate_kbps"],
            )
        return AudioSignatureResult(
            valid=False,
            detected_format=None,
            mime_type=None,
            has_id3v2=True,
            id3_tag_size_bytes=id3_size,
            mpeg_frame_offset=None,
            sample_rate_hz=None,
            channels=None,
            bitrate_kbps=None,
            reason=(
                "ID3v2 header detected, but no valid MPEG audio frame follows the tag. "
                "An ID3 header alone is not playable audio."
            ),
        )

    # 6. Raw ADTS AAC (sync 0xFFFx with layer bits = 00)
    if len(data) >= 7 and data[0] == 0xFF and (data[1] & 0xF6) == 0xF0:
        sr_idx = (data[2] >> 2) & 0x0F
        ch_cfg = ((data[2] & 0x01) << 2) | ((data[3] >> 6) & 0x03)
        frame_len = ((data[3] & 0x03) << 11) | (data[4] << 3) | ((data[5] >> 5) & 0x07)
        if sr_idx < len(_ADTS_SAMPLE_RATES) and frame_len >= 7:
            return AudioSignatureResult(
                valid=True,
                detected_format="AAC",
                mime_type="audio/aac",
                has_id3v2=False,
                id3_tag_size_bytes=0,
                mpeg_frame_offset=0,
                sample_rate_hz=_ADTS_SAMPLE_RATES[sr_idx],
                channels=ch_cfg if ch_cfg > 0 else None,
                bitrate_kbps=None,
            )

    # 7. Raw MP3 without ID3 (MPEG frame sync; tolerate leading zero padding)
    skip = 0
    while skip < 1024 and skip < len(data) and data[skip] == 0x00:
        skip += 1
    raw_frame = _find_first_mpeg_frame(data, skip, 64)
    if raw_frame is not None:
        return AudioSignatureResult(
            valid=True,
            detected_format="MP3",
            mime_type="audio/mpeg",
            has_id3v2=False,
            id3_tag_size_bytes=0,
            mpeg_frame_offset=raw_frame["offset"],
            sample_rate_hz=raw_frame["sample_rate_hz"],
            channels=raw_frame["channels"],
            bitrate_kbps=raw_frame["bitrate_kbps"],
        )

    return AudioSignatureResult(
        valid=False,
        detected_format=None,
        mime_type=None,
        has_id3v2=False,
        id3_tag_size_bytes=0,
        mpeg_frame_offset=None,
        sample_rate_hz=None,
        channels=None,
        bitrate_kbps=None,
        reason=(
            "Unrecognized audio signature: content matches no supported format "
            "(MP3 with/without ID3, WAV, FLAC, OGG, M4A/AAC)."
        ),
    )
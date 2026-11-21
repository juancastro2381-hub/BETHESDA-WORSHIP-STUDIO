# WORSHIP STUDIO — PHASE 1B-R2
## SOURCE CLASSIFICATION & BINARY MAGIC BYTE INSPECTION REPORT

**Project:** Bethesda Worship Studio  
**Workstream:** E — Accurate Source Type Classification  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1B-R2 — Final Integrity Remediation  
**Status:** Certified Remediated & Fully Verified  

---

## 1. PURPOSE & PRINCIPLE

Scores ingested by church musicians range from multi-page vector PDFs to scanned PNG/JPEG sheet images and archived high-resolution TIFF scores.

Previous implementations incorrectly lumped image scores into the `'PDF'` category or treated visual scores without discriminating between image bitmaps and structured documents.

Phase 1B-R2 establishes:
1. Robust, server-side binary magic byte detection.
2. Clean separation between `IMAGE_SCORE` (persisted as format `'IMAGE'`) and `PDF_SCORE` (persisted as format `'PDF'`).
3. Complete TIFF format support across Little-Endian and Big-Endian architectures.
4. Honest reporting of visual processing status (`RECOGNITION_UNAVAILABLE` when an external neural OMR engine is not active), guaranteeing zero fabricated notes.

---

## 2. BINARY MAGIC BYTE SIGNATURE MATRIX

| Format | Magic Byte Signature (Hex / ASCII) | Classified Source Type | Database Format |
| :--- | :--- | :--- | :--- |
| **PDF** | `%PDF-` (`25 50 44 46 2D`) | `PDF_SCORE` | `'PDF'` |
| **PNG** | `\x89PNG\r\n\x1a\n` (`89 50 4E 47 0D 0A 1A 0A`) | `IMAGE_SCORE` | `'IMAGE'` |
| **JPEG** | `\xFF\xD8\xFF` (`FF D8 FF`) | `IMAGE_SCORE` | `'IMAGE'` |
| **TIFF (LE)** | `II*\x00` (`49 49 2A 00`) | `IMAGE_SCORE` | `'IMAGE'` |
| **TIFF (BE)** | `MM\x00*` (`4D 4D 00 2A`) | `IMAGE_SCORE` | `'IMAGE'` |
| **MIDI** | `MThd` (`4D 54 68 64`) | `MIDI` | `'MIDI'` |
| **MusicXML** | `<?xml` / `<score-partwise` | `MUSICXML` | `'MUSIC_XML'` |

---

## 3. IMPLEMENTATION DETAILS

### 3.1 Upfront Inspection in `UniversalIngestionService`
```typescript
private static isImageSource(buffer?: Buffer, filename?: string): boolean {
  if (buffer && buffer.length >= 4) {
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
    // TIFF (Little Endian: 49 49 2a 00 o Big Endian: 4d 4d 00 2a)
    if (
      (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
    ) {
      return true;
    }
  }

  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp', '.bmp'].includes(ext);
  }

  return false;
}
```

### 3.2 Format Mapping in Database Persistence
In `UniversalIngestionService.mapSourceTypeToFormat`:
- `IMAGE_SCORE` $\to$ `'IMAGE'`
- `PDF_SCORE` $\to$ `'PDF'`
- `MIDI` $\to$ `'MIDI'`
- `MUSICXML` $\to$ `'MUSIC_XML'`
- `CHORDPRO` $\to$ `'CHORD_PRO'`
- `WRITTEN_NOTES` $\to$ `'WRITTEN_NOTES'`
- `AUDIO` $\to$ `'AUDIO'`
- `VIDEO_URL` $\to$ `'VIDEO_URL'`

---

## 4. AUTOMATED TEST EVIDENCE

Tests in `backend/src/__tests__/universal-ingestion-phase1b-r2.test.ts`:

| Test ID | Test Description | Result | Execution Time |
| :--- | :--- | :--- | :--- |
| **E1.1** | `should classify PNG file as IMAGE_SCORE and persist format IMAGE` | **PASS** | 13.8 ms |
| **E1.2** | `should classify JPEG file as IMAGE_SCORE and persist format IMAGE` | **PASS** | 12.2 ms |
| **E1.3** | `should classify TIFF file as IMAGE_SCORE and persist format IMAGE` | **PASS** | 7.0 ms |
| **E1.4** | `should classify PDF file as PDF_SCORE and persist format PDF` | **PASS** | 9.2 ms |

**Workstream E Total:** 4 passed, 0 failed.


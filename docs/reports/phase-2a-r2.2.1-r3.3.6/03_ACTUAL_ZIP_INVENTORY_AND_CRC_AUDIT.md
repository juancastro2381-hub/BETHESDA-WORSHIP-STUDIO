# PHASE 2A-R2.2.1-R3.3.6 — ACTUAL ZIP INVENTORY AND CRC AUDIT REPORT

**Project:** Bethesda Worship Studio  
**Role:** Senior QA Auditor, Technical Evidence Auditor  
**Target Archive:** `BETHESDA_WORSHIP_STUDIO_PHASE_2A_R2_2_1_R3_3_5_REVIEW.zip` (at repository root)  
**Archive Size:** 69,476 bytes  
**Archive SHA-256:** `3A69C393117D907766C701B200C5A3CFB197A0CB2E2A63A8AB2F13A96FD6A158`  
**Date:** 2026-11-10T15:15:00-05:00  

---

## 1. DIRECT INVENTORY OF R3.3.5 REVIEW ARCHIVE

An inspection of `BETHESDA_WORSHIP_STUDIO_PHASE_2A_R2_2_1_R3_3_5_REVIEW.zip` was performed using Node.js and .NET ZipFile APIs.

The archive contains exactly **15 entries** (14 payload files + 1 manifest):

| # | Entry Path | Uncompressed Length (Bytes) | Compressed Length (Bytes) | Compression Ratio | CRC32 | Entry Classification |
| :-: | :--- | :-: | :-: | :-: | :-: | :--- |
| 1 | `backend/src/application/conversion-worker.ts` | 69,344 | 14,973 | 78.4% | `509354F6` | Payload (Production Code) |
| 2 | `backend/src/__tests__/conversion-worker-certification.test.ts` | 133,526 | 20,908 | 84.3% | `F88BA7C2` | Payload (Certification Test) |
| 3 | `docs/reports/phase-2a-r2.2.1-r3.3.5/01_PREFLIGHT_AND_GIT_GOVERNANCE.md` | 3,344 | 1,500 | 55.1% | `ECF6286A` | Payload (Report 01) |
| 4 | `docs/reports/phase-2a-r2.2.1-r3.3.5/02_SOURCE_DOCUMENTATION_CORRECTION.md` | 3,990 | 1,818 | 54.4% | `8F67B79D` | Payload (Report 02) |
| 5 | `docs/reports/phase-2a-r2.2.1-r3.3.5/03_ZIP_CONTENTS_AND_CRC_AUDIT.md` | 3,189 | 1,474 | 53.8% | `4B24AEE3` | Payload (Report 03) |
| 6 | `docs/reports/phase-2a-r2.2.1-r3.3.5/04_SHA256_MANIFEST_RECONCILIATION.md` | 5,645 | 2,584 | 54.2% | `004A8309` | Payload (Report 04) |
| 7 | `docs/reports/phase-2a-r2.2.1-r3.3.5/05_TEST_AND_BUILD_EVIDENCE_AUDIT.md` | 3,698 | 1,753 | 52.6% | `968F93E6` | Payload (Report 05) |
| 8 | `docs/reports/phase-2a-r2.2.1-r3.3.5/06_FINAL_R3_3_5_CERTIFICATION_REPORT.md` | 4,684 | 2,368 | 49.5% | `D6CBF38D` | Payload (Report 06) |
| 9 | `docs/reports/phase-2a-r2.2.1-r3.3.5/07_SHA256SUMS.txt` | 2,144 | 1,123 | 47.6% | `02CE0B29` | Self-Excluding Manifest |
| 10 | `docs/reports/phase-2a-r2.2.1-r3.3.5/git_diff_phase_2a_r2.2.1_r3.3.5.patch` | 5,012 | 1,246 | 75.1% | `FB054346` | Payload (Git Patch) |
| 11 | `docs/reports/phase-2a-r2.2.1-r3.3.5/git_status_phase_2a_r2.2.1_r3.3.5.txt` | 1,106 | 389 | 64.8% | `F13F8052` | Payload (Git Status) |
| 12 | `docs/reports/phase-2a-r2.2.1-r3.3.5/logs/all_conversion_suites.log` | 81,228 | 10,564 | 87.0% | `32C07265` | Payload (Execution Log) |
| 13 | `docs/reports/phase-2a-r2.2.1-r3.3.5/logs/backend_build.log` | 90 | 70 | 22.2% | `A47F3B52` | Payload (Execution Log) |
| 14 | `docs/reports/phase-2a-r2.2.1-r3.3.5/logs/backend_typecheck.log` | 116 | 86 | 25.9% | `55E7DF07` | Payload (Execution Log) |
| 15 | `docs/reports/phase-2a-r2.2.1-r3.3.5/logs/certification_suite.log` | 28,744 | 5,492 | 80.9% | `5FB9357E` | Payload (Execution Log) |

---

## 2. CRC32 INTEGRITY AND EXTRACTION VERIFICATION

1. **Extraction Sandbox:** The complete archive was extracted to an isolated directory using `[System.IO.Compression.ZipFile]::ExtractToDirectory`.
2. **Decompression Integrity:** All 15 files decompressed with zero CRC errors, zero truncation, and zero null-byte exceptions.
3. **Duplicate Path Check:** A Set comparison of all 15 full names confirmed **zero duplicate paths**.
4. **Structural Normalization:** Zero standalone directory entries (all directories are implicitly represented by file relative paths).
5. **No Extraneous Files:** Zero hidden OS metadata files (`.DS_Store`, `Thumbs.db`), zero `.env` files, and zero temporary compiler artifacts.


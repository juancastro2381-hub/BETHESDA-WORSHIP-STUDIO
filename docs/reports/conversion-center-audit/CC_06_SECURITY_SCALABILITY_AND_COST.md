# CC_06: SECURITY, SCALABILITY, AND COST ANALYSIS
## BETHESDA WORSHIP STUDIO — CONVERSION CENTER TECHNICAL AUDIT

- **Project:** Bethesda Worship Studio
- **Document ID:** `CC-06-SECURITY-SCALABILITY-AND-COST`
- **Audit Date:** November 2026
- **Status:** Complete Technical Security & Infrastructure Cost Assessment
- **Repository Branch:** `feature/phase-1a-core-foundation`
- **Base Commit:** `51fef932b082df82bd31d643983a271c155eb4e2`
- **Execution Mode:** Read-Only Security Audit & Operational Modeling

---

## 1. Threat Modeling & Defensive Invariants

The Conversion Center processes untrusted user-supplied files (binaries, compressed archives, PDFs, multimedia) and URLs. It must implement multi-layered defenses to prevent privilege escalation, denial of service (DoS), server-side request forgery (SSRF), and tenant data leaks.

### Threat Matrix & Mitigation:

| Threat Vector | Attack Scenario | Defensive Invariant Implemented in Architecture |
| :--- | :--- | :--- |
| **MIME Spoofing** | Attacker uploads an executable or HTML payload masked with `audio/mpeg` or `application/pdf` MIME header. | **Binary Magic Byte Inspection.** Headers are evaluated via strict byte offset matching (`AudioIngestionAdapter`, `validateOmrFileSignature`). MIME headers declared by the client are cross-verified and rejected on mismatch. |
| **Decompression Bomb (Zip/XML Bomb)** | Attacker uploads a tiny `.mxl` (compressed MusicXML) or vector PDF containing recursive entity expansion or 1000:1 compression ratio. | **Decompression Guard.** Uncompressed stream limits capped at **50 MB**. XML parsers disable external entity expansion (`resolveExternalEntities: false`, `disallowDoctype: true`). |
| **Server-Side Request Forgery (SSRF)** | Attacker inputs a URL pointing to `http://169.254.169.254` (cloud metadata) or internal service `http://127.0.0.1:5432`. | **Pre-Fetch Domain & IP Whitelisting.** Strict hostname whitelist (`youtube.com`, `youtu.be`, `vimeo.com`), blocking of IPv4 private CIDRs (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16) and IPv6 loopbacks (`VideoUrlIngestionAdapter`). |
| **Cross-Tenant Data Exposure (IDOR)** | User B guesses source ID or checksum of User A's uploaded score and downloads original master. | **Tenant-Scoped Idempotency & RBAC.** All queries require `userId = $current_user AND checksum_sha256 = $hash`. Stream tickets and download routes verify ownership before streaming. |
| **Denial of Service (DoS / Compute Exhaustion)** | User floods the system with twenty 2-hour audio files for simultaneous stem separation. | **Per-User Concurrency Gates & Job Rate Limits.** Each user is limited to **2 concurrent background jobs**; surplus jobs are queued with fair-share scheduling. |
| **Buffer Overflow in Native Binaries** | Malformed MP4/WAV exploits a vulnerability in native FFmpeg or Whisper.cpp. | **Container Sandboxing.** Workers run in unprivileged containers with dropped capabilities (`cap-drop=ALL`), non-root UID, read-only root filesystems, and strict memory limits. |

---

## 2. Container Sandboxing & Isolation Architecture

To completely isolate third-party C/C++, Java, and Python runtimes (FFmpeg, Audiveris, Whisper.cpp, PyTorch/ONNX), workers execute in dedicated, disposable sidecar containers:

```
 +---------------------------------------------------------------------------------------------------+
 | HOST SYSTEM (Linux Kernel with cgroups v2 & AppArmor / SELinux)                                   |
 |                                                                                                   |
 |   +---------------------------------------+   +---------------------------------------+           |
 |   | CONTAINER: bethesda-ml-worker         |   | CONTAINER: bethesda-omr-worker        |           |
 |   | - User: nonroot (UID 10001)           |   | - User: nonroot (UID 10002)           |           |
 |   | - Read-Only Root Filesystem           |   | - Read-Only Root Filesystem           |           |
 |   | - Capabilities: cap-drop=ALL          |   | - Capabilities: cap-drop=ALL          |           |
 |   | - tmpfs: /tmp (size=512MB, noexec)    |   | - tmpfs: /tmp (size=1GB, noexec)      |           |
 |   | - Memory Limit: 2048 MB (Hard OOM)    |   | - Memory Limit: 3072 MB (Hard OOM)    |           |
 |   | - CPU Quota: 2.0 cores max            |   | - CPU Quota: 2.0 cores max            |           |
 |   | - Network: Internal bridge only       |   | - Network: Internal bridge only       |           |
 |   |   (No direct internet egress)         |   |   (No direct internet egress)         |           |
 |   | - Execution Timeout: 120 seconds      |   | - Execution Timeout: 180 seconds      |           |
 |   +---------------------------------------+   +---------------------------------------+           |
 +---------------------------------------------------------------------------------------------------+
```

### Docker Compose Hardening Profile:
```yaml
services:
  ml-worker:
    image: bethesda/conversion-ml-worker:1.0
    restart: on-failure
    user: "10001:10001"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp:size=512M,mode=1777
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 2048M
        reservations:
          cpus: "0.5"
          memory: 512M
    networks:
      - internal-worker-network
```

---

## 3. Scalability & Queue Concurrency Strategy

The asynchronous queue is powered by **pg-boss** embedded in PostgreSQL, ensuring full transactional atomicity without needing an extra Redis cluster.

### 3.1. Queue Partitioning & Concurrency Caps
Jobs are divided into three priority classes:
1. **Interactive Fast Queue (`conversion:fast`):**
   - Chord extraction from text PDF, MIDI-to-MusicXML transpilation, lyrics extraction.
   - Max concurrency: **10 concurrent workers**. Latency: **< 2 seconds**.
2. **Audio ML Queue (`conversion:audio`):**
   - Basic Pitch transcription, Madmom chord recognition, Whisper.cpp lyric alignment.
   - Max concurrency: **2 concurrent workers per 4-core node**. Latency: **10–30 seconds**.
3. **Heavy OMR & Stem Separation Queue (`conversion:heavy`):**
   - Audiveris score scanning, Demucs v4 stem isolation.
   - Max concurrency: **1 concurrent worker per node**. Latency: **45–120 seconds**.

### 3.2. Fair-Share Multi-Tenant Throttling
To guarantee that a single user uploading 50 files cannot monopolize the worker pool:
- Per-User Active Limit: Maximum **2 active processing jobs** across all queues.
- Secondary Submissions: Automatically held in `status = QUEUED` until preceding jobs finish.
- Job Expiration & Re-queue: Jobs locked for > 3 minutes without heartbeat are marked as `FAILED` and recycled up to 3 retry attempts.

---

## 4. Storage Lifecycle & Automated Housekeeping

All files handled by the Conversion Center fall into one of two storage tiers:

```
  +----------------------------------------------------------------------------------+
  | TIER 1: PERMANENT MASTER SOURCES (song_sources table)                            |
  | - Retained indefinitely while associated song exists.                            |
  | - Immutable SHA-256 integrity verification.                                      |
  | - Stored in secure local volume or S3-compatible private bucket.                 |
  +----------------------------------------------------------------------------------+
                                           |
  +----------------------------------------------------------------------------------+
  | TIER 2: EPHEMERAL WORKER ARTIFACTS (/tmp/bethesda-conversion-cache/)              |
  | - Downsampled WAVs, stripped video audio, binarized OMR TIFF tiles, temp XMLs.   |
  | - Lifecycle: Cleaned immediately upon job completion or after 24-hour TTL cron. |
  +----------------------------------------------------------------------------------+
```

### Automated Cleanup Cron (Executed every 6 hours):
```sql
-- Clean orphaned jobs older than 7 days
DELETE FROM background_jobs 
WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED') 
  AND completed_at < NOW() - INTERVAL '7 days';
```
Ephemeral disk files in `/tmp/conversions/` older than 24 hours are pruned using a lightweight container cron job (`find /tmp/conversions -type f -mtime +1 -delete`).

---

## 5. Comprehensive Cost Analysis: Achieving a Permanently Free Platform

A core design requirement is that Bethesda Worship Studio must remain **100% permanently free for church worship teams and musicians**, without subscriptions, ad clutter, or artificial usage fees.

### 5.1. The Traditional Cloud SaaS Pitfall (Commercial APIs)
If built using standard commercial cloud APIs, costs quickly become unsustainable:
- Google Cloud Speech-to-Text / Whisper API: \$0.006 per minute.
- Cloud OMR (e.g. ScanScore API, Sheet Music Scanner Cloud): \$0.10–\$0.25 per page.
- Cloud Audio Stem Separation: \$0.05–\$0.15 per track.
- For a congregation with 200 songs, 10 team members, and weekly rehearsals: **\$120–\$300+ monthly in recurring API charges**.

### 5.2. The Bethesda Self-Hosted Open-Source Cost Profile
By utilizing self-hosted, CPU-quantized open-source engines (Basic Pitch ONNX, Whisper.cpp, Madmom, Audiveris, Verovio), all recurring API fees are **\$0.00**.

| Infrastructure Component | Minimum Spec (Small Church / Team) | Recommended Production Spec (Multi-Church / Sanctuary) | Monthly Cost |
| :--- | :--- | :--- | :--- |
| **Compute Server (VPS)** | 4 vCPU, 8 GB RAM, 100 GB NVMe | 8 vCPU, 16 GB RAM, 250 GB NVMe | **\$24 – \$48 / month** (Hetzner, OVH, DigitalOcean) |
| **Database** | Shared PostgreSQL 16 on same VPS | Managed PostgreSQL or dedicated container | **\$0 (included in VPS)** |
| **Object Storage** | Local NVMe mount | Cloudflare R2 / Backblaze B2 (100 GB free tier) | **\$0.00** |
| **ML Inference Fees** | Local CPU inference | Local CPU inference | **\$0.00** |
| **Licensing / Software** | Open Source (MIT / Apache / BSD / LGPL) | Open Source | **\$0.00** |
| **TOTAL MONTHLY COST** | — | — | **\$24 – \$48 total** |

### 5.3. Summary of Cost Efficiency
A single modest VPS (\$30/month) running the containerized architecture can process **over 5,000 sheet music conversions, audio transcriptions, and chord sheet transpiler jobs per month**, easily serving dozens of church worship ministries at an average infrastructure cost of less than **\$0.01 per conversion**, fully covered by standard ministry hosting budgets.


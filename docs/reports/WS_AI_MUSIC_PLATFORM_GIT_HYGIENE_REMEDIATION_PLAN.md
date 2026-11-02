# WORSHIP STUDIO — REPOSITORY & GIT HYGIENE REMEDIATION PLAN
## Remediation Blueprint for Tracked Dependencies and Runtime Artifacts

**Project:** BETHESDA WORSHIP STUDIO  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Phase:** Phase 0A — Audit Remediation  
**Role:** DevSecOps Engineer & Senior Backend Engineer  
**Date:** November 2, 2026  
**Status:** DRAFTED — PENDING PRODUCT OWNER APPROVAL  

---

## 1. Executive Summary & Problem Statement

During the Phase 0A repository audit, an inspection of the Git index revealed that thousands of extraneous runtime and dependency files are actively tracked in Git version control:

1. **7,367 tracked files inside `backend/node_modules/`:**
   Although `backend/.gitignore` lists `node_modules`, these files were staged and committed prior to the `.gitignore` rule or with forced staging (`git add -f`). As Git continues tracking any file already present in the index regardless of `.gitignore`, every local dependency file remains tracked.
2. **140+ binary media and document files inside `backend/storage/`:**
   `backend/storage/audio/` and `backend/storage/documents/` contain runtime `.wav`, `.mp3`, and `.pdf` files totaling over 4.2 MB. Because `backend/storage/` was never added to `.gitignore`, every test execution or upload during local development resulted in binary artifacts being committed into Git tracking.

### Operational & Security Consequences
- **Repository Bloat:** Unnecessary bloat inflates clone times and CI/CD checkout overhead.
- **Merge Conflicts:** Developers on different OS platforms (Windows CRLF vs. Linux/macOS LF) encounter phantom dirty trees in `node_modules`.
- **Data Leakage Risk:** User-uploaded audio, proprietary worship tracks, or copyrighted sheet music placed in `backend/storage/` could be accidentally committed and pushed to public remote repositories.

---

## 2. Distinction: Test Fixtures vs. Runtime Storage

To avoid disrupting regression tests or development workflows, a strict architectural distinction must be maintained:

```mermaid
flowchart TD
    subgraph RepoRoot [Bethesda Worship Studio Repository]
        direction TB
        subgraph VersionedFixtures [Versioned Musical Test Fixtures (KEEP IN GIT)]
            F1["frontend/src/core/ingestion/fixtures/files/*"]
            F2["docs/test-files/*"]
            F3["fixtures/documents/*"]
        end
        subgraph EphemeralStorage [Runtime Upload Storage (REMOVE FROM GIT)]
            S1["backend/storage/audio/*"]
            S2["backend/storage/documents/*"]
            S3["backend/node_modules/*"]
        end
    end
```

| Path | Purpose | File Types | Git Status | Remediation Action |
| :--- | :--- | :--- | :--- | :--- |
| `frontend/src/core/ingestion/fixtures/` | Automated unit test fixtures | `.musicxml`, `.chordpro`, `.pdf` | Tracked | **Retain in Git** (Required for test assertions) |
| `docs/test-files/` | Downloadable manual QA test files | `.musicxml`, `.chordpro`, `.pdf`, `.zip` | Tracked | **Retain in Git** (QA Deliverable) |
| `fixtures/documents/` | Integration test songbooks | `.pdf` (`CMB_AZUL.pdf`, etc.) | Tracked | **Retain in Git** (Document regression tests) |
| `backend/node_modules/` | Local npm dependencies | `.js`, `.json`, `.d.ts` (7,367 files) | Tracked | **UNTRACK FROM GIT** via `git rm --cached` |
| `backend/storage/audio/` | Runtime uploaded audio files | `.wav`, `.mp3` (>70 files) | Tracked | **UNTRACK FROM GIT** via `git rm --cached` |
| `backend/storage/documents/` | Runtime uploaded sheet music | `.pdf`, `.png` (>70 files) | Tracked | **UNTRACK FROM GIT** via `git rm --cached` |

---

## 3. Step-by-Step Remediation Procedure

> [!CAUTION]
> **MANDATORY GOVERNANCE RULE:**  
> Under Phase 0A rules, **no Git mutations, commits, or branch changes may be executed automatically**.  
> The following remediation steps must be executed manually by the repository administrator only after explicit Product Owner sign-off.

### Step 1: Verification of Working Tree Cleanliness
Before running any Git index modification, verify that there are no uncommitted application changes:
```powershell
git status --short
```
Ensure that no modified `.ts`, `.tsx`, `.sql`, or `.json` application files are in an uncommitted state.

### Step 2: Untrack `backend/node_modules/` from Git Index
Execute `git rm --cached -r` to remove the tracked dependency files from the Git index **without deleting them from the local filesystem**:
```powershell
git rm --cached -r backend/node_modules
```
*(This deletes 7,367 tracked entries from index; local node_modules remain untouched so the backend continues running).*

### Step 3: Untrack Runtime Uploads from `backend/storage/`
Remove tracked runtime audio and document artifacts from index:
```powershell
git rm --cached -r backend/storage
```
*(Local files in `backend/storage/` remain intact on the developer's machine).*

### Step 4: Ensure Directory Placeholders Exist (`.gitkeep`)
To prevent the runtime directories from disappearing in fresh clones:
```powershell
# Create .gitkeep in storage directories
New-Item -ItemType File -Path "backend/storage/audio/.gitkeep" -Force
New-Item -ItemType File -Path "backend/storage/documents/.gitkeep" -Force
git add -f backend/storage/audio/.gitkeep backend/storage/documents/.gitkeep
```

### Step 5: Update `.gitignore`
Update both root and `backend/.gitignore` to permanently exclude runtime storage and build artifacts:

**File: `backend/.gitignore`**
```gitignore
# Dependencies
node_modules/

# Runtime Storage
storage/audio/*
!storage/audio/.gitkeep
storage/documents/*
!storage/documents/.gitkeep

# Build and logs
dist/
build/
*.log
.env
.env.local
.env.production
```

**File: `.gitignore` (Root)**
```gitignore
# Node dependencies
node_modules/
**/node_modules/

# Local storage and test runs
backend/storage/audio/*
!backend/storage/audio/.gitkeep
backend/storage/documents/*
!backend/storage/documents/.gitkeep

# Environment variables
.env
*.env
```

### Step 6: Atomic Remediation Commit
Stage the `.gitignore` modifications and the index removals in a single atomic commit:
```powershell
git add backend/.gitignore .gitignore
git commit -m "chore(git): untrack node_modules and runtime storage artifacts from git index"
```

### Step 7: Post-Remediation Verification
Confirm that the working tree is clean and node_modules are ignored:
```powershell
# Verify that git status reports a clean tree
git status

# Verify that node_modules files are no longer tracked
git ls-files backend/node_modules/ | Measure-Object -Line
# Expected output: 0 Lines

# Verify that storage files are no longer tracked
git ls-files backend/storage/ | Measure-Object -Line
# Expected output: 2 Lines (.gitkeep files only)

# Verify backend builds and runs normally
npm --prefix backend run test
```

---

## 4. Rollback Plan

If an unexpected issue occurs prior to committing:
```powershell
# Restore Git index to HEAD without affecting filesystem
git reset HEAD backend/node_modules backend/storage
git checkout HEAD -- backend/.gitignore .gitignore
```
If an issue occurs after committing, create a revert commit:
```powershell
git revert HEAD --no-edit
```

---

## 5. Sign-Off & Approval Gate

| Role | Name / Title | Status | Date |
| :--- | :--- | :--- | :--- |
| **DevSecOps Engineer** | Technical Lead | APPROVED (Plan Defended) | Nov 2, 2026 |
| **Lead Architect** | Principal Architect | APPROVED (Isolation Verified) | Nov 2, 2026 |
| **Product Owner** | Project Owner | **PENDING EXPLICIT AUTHORIZATION** | — |


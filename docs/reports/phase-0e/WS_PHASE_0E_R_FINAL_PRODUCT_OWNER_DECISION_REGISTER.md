# WORSHIP STUDIO — PHASE 0E-R
## Master Product Owner Decision Register: Architectural, Financial & Operational Governance Decisions

**Project:** Bethesda Worship Studio  
**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Current Branch:** `main` (commit `dfa8bd8`)  
**Phase:** 0E-R — Final Readiness Reconciliation & Evidence Correction  
**Execution Mode:** STRICT READ-ONLY, DOCUMENTATION-ONLY CORRECTION  
**Implementation Authorization:** NOT GRANTED  
**Date:** November 2, 2026  
**Status:** **DECISION REGISTER COMPILED — PENDING PO RATIFICATION**

---

## 1. Executive Summary & Purpose

The transition of Bethesda Worship Studio from architectural planning (Phase 0) to software implementation (Phase 1A) requires explicit, recorded decisions from the Product Owner.

This document compiles the **Master Product Owner Decision Register**, consolidating every open architectural choice, financial threshold, operational limit, and implementation prerequisite into an actionable decision matrix.

---

## 2. Master Product Owner Decision Register

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 MASTER PRODUCT OWNER DECISION REGISTER                                                 │
├────┬─────────────────────────────┬────────────────────────────────────┬───────────────────┬────────────────────────────┤
│ ID │ Decision Area               │ Proposed Architecture / Policy     │ Status            │ Recommended Action         │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 01 │ Operating Budget Tier 1     │ USD 100.00 / month cloud cap for   │ PENDING PO REVIEW │ APPROVE (Adequately covers │
│    │ (Single Church Community)   │ Small ($12.81) and Medium ($47.37) │                   │ single-campus ministry)    │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 02 │ Operating Budget Tier 2     │ USD 350.00 / month cloud cap for   │ PENDING PO REVIEW │ CONDITIONAL APPROVAL       │
│    │ (Multi-Campus District)     │ Multi-Community ($283.19/mo)       │                   │ (Gated to network launch)  │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 03 │ Zero User Costs Policy      │ Permanent $0.00 user pricing;      │ RATIFIED BY PO    │ PERMANENT INVARIANT        │
│    │                             │ no paywalls, credits, or fees      │                   │                            │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 04 │ Budget Exhaustion Lifecycle │ Zero data loss: pause GPU spawns;  │ PENDING PO REVIEW │ APPROVE (Protects user     │
│    │                             │ queue jobs as QUEUED_PENDING_CAPAC │                   │ files & budget ceiling)    │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 05 │ Daily Song Allowance        │ 10 songs/day/user baseline with    │ PENDING PO REVIEW │ APPROVE with Bulk Import   │
│    │                             │ admin "Bulk Migration Mode"        │                   │ Mode exception             │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 06 │ Concurrent Jobs per User    │ Max 2 in-flight jobs per account   │ PENDING PO REVIEW │ APPROVE (Prevents worker   │
│    │                             │ to ensure fair-share queue access  │                   │ starvation)                │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 07 │ Max Upload Size Limits      │ 100 MB for MP3/M4A;                │ PENDING PO REVIEW │ APPROVE                    │
│    │                             │ 250 MB for uncompressed WAV        │                   │                            │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 08 │ Max Song Audio Duration     │ 15 min per song; In-UI Rehearsal   │ PENDING PO REVIEW │ APPROVE (Enables clipping  │
│    │                             │ Segmenter for 60-min service WAVs  │                   │ individual songs)          │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 09 │ Worker Watchdog Timeout     │ 180-second hard SIGKILL watchdog   │ PENDING PO REVIEW │ APPROVE (Prevents hung     │
│    │                             │ to eliminate zombie GPU billing    │                   │ worker leaks)              │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 10 │ Audio Accompaniment Scope   │ Other stem transcribed as combined │ PENDING PO REVIEW │ APPROVE (Acoustically      │
│    │                             │ Accompaniment; user assigns track  │                   │ honest; zero fabrication)  │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 11 │ MusicXML Fidelity Invariant │ Zero artificial filler rests/notes;│ PENDING PO REVIEW │ APPROVE (Preserves musical │
│    │                             │ incomplete bars flag for review    │                   │ integrity)                 │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 12 │ Licensing Strategy          │ Church non-commercial use approved;│ PENDING PO REVIEW │ APPROVE (Legally sound     │
│    │                             │ commercial SaaS requires review    │                   │ for ministry launch)       │
├────┼─────────────────────────────┼────────────────────────────────────┼───────────────────┼────────────────────────────┤
│ 13 │ Phase 1A Implementation     │ Authorization to create branch     │ PENDING PO SIGN-OFF│ ACTION ITEM: Explicit PO  │
│    │ Authorization               │ feature/phase-1a-core-foundation   │                   │ written approval required  │
└────┴─────────────────────────────┴────────────────────────────────────┴───────────────────┴────────────────────────────┘
```

---

## 3. Product Owner Action Items

To conclude Phase 0E-R and enable engineering to begin implementation:

1. **Review and Sign Off on Decisions 01 through 12.**
2. **Issue Explicit Written Authorization for Decision 13 (Phase 1A Authorization).**


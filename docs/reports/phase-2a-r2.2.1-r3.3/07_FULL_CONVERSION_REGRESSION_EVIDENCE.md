# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3
## Report 07: Full Conversion Suite Regression Evidence & Arithmetic Reconciliation

**Execution Command:** `npx tsx --env-file=backend/.env --test --test-concurrency=1 backend/src/__tests__/conversion-*.test.ts`  
**Discovered Test Files:** 9  
**Total Tests:** 106  
**Passed:** 106  
**Failed:** 0  
**Skipped:** 0  
**Duration:** 29,714 ms (Exit Code: 0)

---

### 1. Test Suite Reconciliation Arithmetic

To avoid any ambiguity between glob discovering individual files and isolated executions:

$$\text{Complementary Test Suites (8 files)} = 9 + 8 + 9 + 5 + 6 + 2 + 5 + 9 = 53 \text{ tests}$$
$$\text{Certification Suite (1 file: conversion-worker-certification.test.ts)} = 53 \text{ tests}$$
$$\text{Total Unique Tests Executed by Glob} = 53 + 53 = 106 \text{ tests}$$

---

### 2. File-by-File Breakdown

| # | Test File | Test Count | Passed | Failed | Skipped | Technology Employed |
|---|---|:---:|:---:|:---:|:---:|---|
| 1 | `conversion-api.test.ts` | 9 | 9 | 0 | 0 | Fastify HTTP + Real PostgreSQL |
| 2 | `conversion-audit-remediation.test.ts` | 8 | 8 | 0 | 0 | Service Layer + Real PostgreSQL |
| 3 | `conversion-cancellation.test.ts` | 9 | 9 | 0 | 0 | Real PostgreSQL (Transacciones y Leases) |
| 4 | `conversion-catalog-idempotency.test.ts` | 5 | 5 | 0 | 0 | Real PostgreSQL (Catalog Commitment) |
| 5 | `conversion-concurrency-leases.test.ts` | 6 | 6 | 0 | 0 | Real PostgreSQL (Fencing Tokens) |
| 6 | `conversion-pgboss-retry.test.ts` | 2 | 2 | 0 | 0 | Real pg-boss + Real PostgreSQL |
| 7 | `conversion-queue-lifecycle.test.ts` | 5 | 5 | 0 | 0 | Real pg-boss + Real PostgreSQL |
| 8 | `conversion-security.test.ts` | 9 | 9 | 0 | 0 | Fastify HTTP + Anti-IDOR Security |
| 9 | `conversion-worker-certification.test.ts` | 53 | 53 | 0 | 0 | Real pg-boss, Real PostgreSQL + Disk + Mutex |
| **TOTAL** | **9 Test Files** | **106** | **106** | **0** | **0** | **100% Pass Rate** |

---

### 3. Log Artifact Verification

The complete stdout/stderr output of the execution is captured at:
`docs/reports/phase-2a-r2.2.1-r3.3/logs/all_conversion_suites.log`


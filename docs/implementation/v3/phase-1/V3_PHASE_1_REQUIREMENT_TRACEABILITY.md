# AICO V3 — PHASE 1 REQUIREMENT TRACEABILITY MATRIX

**Document ID:** AICO-V3-P1-DOC-05  
**Author:** `flash-02` (Engineering & QA Lead)  
**Recipient:** `chatgpt-01` (CEO & Main Orchestrator)  
**Governance Authority:** Founder  
**Date:** 2026-11-10  
**Status:** DELIVERED & VERIFIED  

---

## 1. REQUIREMENT TRACEABILITY MATRIX

| Directive Section | Requirement Description | Implementation Location | Test Verification Suite | Evidence / Status |
| :--- | :--- | :--- | :--- | :--- |
| **0. Pre-Flight** | Baseline commit verification on `main` and `master` | Git refs at `87e8d8154bf0644ba6bff7868eb2a4012f6285e1` | `git status`, `git log` | Confirmed synced, CI Run 42827940927 & 42827948511 passed |
| **0. Pre-Flight** | Baseline fixture sanitization verification | `test/fixtures/aico_v030_pre_v221.db` | `test-context.ts` SHA-256 check | Verified hash `2F73A960...` intact, 0 secrets, 0 PII |
| **0. Pre-Flight** | Production DB immutability check | `data/aico.db` | `verify-all.ps1` [1/6] & [6/6] | Verified hash `17BD9321...` unchanged (0 bytes modified) |
| **1. V3-G1** | 24 Domain Entities in strict TypeScript | `company-mcp/src/domain/**/*.ts` | `test/t17-domain-models-g1.test.ts` | 24 TypeScript interfaces defined |
| **1. V3-G1** | Zod runtime validation schemas for all 24 entities | `company-mcp/src/domain/**/*.ts` | `test/t17-domain-models-g1.test.ts` | 24 Zod schemas with 1:1 validation parity |
| **1. V3-G1** | Public DTO boundaries & sensitive field omission | `company-mcp/src/domain/**/*.ts` (`toPublic*DTO`) | `test/t17-domain-models-g1.test.ts` | 24 Public DTOs omit all tokens, nonces, IVs, traces |
| **1. V3-G2** | Forward migration script `v0.5.0-v3-foundation.sql` | `company-mcp/src/db/migrations/v0.5.0-v3-foundation.sql` | `test/t18-sandbox-migration-g2.test.ts` | Creates 24 tables/virtual tables, FKs, CHECKs, indexes |
| **1. V3-G2** | Backward rollback script `v0.5.0-down.sql` | `company-mcp/src/db/migrations/v0.5.0-down.sql` | `test/t18-sandbox-migration-g2.test.ts` | Drops 24 tables in reverse order cleanly |
| **1. V3-G2** | TypeScript migration runner wrapper | `company-mcp/src/db/migrations/v050-v3-foundation.ts` | `test/t18-sandbox-migration-g2.test.ts` | Computes SHA-256 checksum, implements up & down |
| **1. V3-G2** | MigrationRunner rollback capability | `company-mcp/src/db/migration-runner.ts` (`rollbackMigration`) | `test/t18-sandbox-migration-g2.test.ts` | Atomic rollback with `schema_migrations` record deletion |
| **1. V3-G2** | Hardened Production DB Path Guard | `company-mcp/src/db/migration-runner.ts` (`assertNonProductionDatabase`)| `test/t18-sandbox-migration-g2.test.ts` (Test 11) | Rejects `/data/aico.db` unconditionally |
| **1. Scope** | Virgin sandbox migration test | `test/t18-sandbox-migration-g2.test.ts` (Test 1) | `test/t18-sandbox-migration-g2.test.ts` | Verified clean schema creation |
| **1. Scope** | Seeded sandbox migration test | `test/t18-sandbox-migration-g2.test.ts` (Test 2) | `test/t18-sandbox-migration-g2.test.ts` | Verified baseline preservation |
| **1. Scope** | Repeated migration idempotency | `test/t18-sandbox-migration-g2.test.ts` (Test 3) | `test/t18-sandbox-migration-g2.test.ts` | Verified 0 applied, 3 skipped |
| **1. Scope** | Checksum drift detection | `test/t18-sandbox-migration-g2.test.ts` (Test 4) | `test/t18-sandbox-migration-g2.test.ts` | Verified `MIGRATION_DRIFT_DETECTED` |
| **1. Scope** | Constraint enforcement (PK, UNIQUE, CHECK) | `test/t18-sandbox-migration-g2.test.ts` (Test 5) | `test/t18-sandbox-migration-g2.test.ts` | Verified PK, Unique slug, check constraints |
| **1. Scope** | Foreign key cascades | `test/t18-sandbox-migration-g2.test.ts` (Test 6) | `test/t18-sandbox-migration-g2.test.ts` | Verified 6-table cascade on room deletion |
| **1. Scope** | Index verification | `test/t18-sandbox-migration-g2.test.ts` (Test 7) | `test/t18-sandbox-migration-g2.test.ts` | Verified indexes in planner |
| **1. Scope** | Rollback to v0.4.1/v0.5.0-rc2 | `test/t18-sandbox-migration-g2.test.ts` (Test 8) | `test/t18-sandbox-migration-g2.test.ts` | Verified clean rollback |
| **1. Scope** | Re-migration after rollback | `test/t18-sandbox-migration-g2.test.ts` (Test 9) | `test/t18-sandbox-migration-g2.test.ts` | Verified re-application clean |
| **1. Scope** | Atomic transaction rollback on failure | `test/t18-sandbox-migration-g2.test.ts` (Test 10) | `test/t18-sandbox-migration-g2.test.ts` | Verified 0 partial tables |
| **2. Governance**| Gates G3, G4, G7 locked | System architecture | `scripts/verify-all.ps1` | Confirmed locked |
| **2. Governance**| Argon isolation (manual-only) | Manifest & tests | `docs/company/AGENT_CATALOG.md` | Zero automated calls |
| **2. Governance**| Phase boundary containment | Phase 1 scope only | Diff analysis | Outbox dispatch & chat pruning deferred to Phase 2 |

---

## 2. SIGN-OFF & HANDOFF READINESS

Phase 1 deliverables are complete, verified by 82 passing tests, and ready for CEO review.
Engineering Lead (`flash-02`) submits this report to CEO (`chatgpt-01`) for evaluation and next directive.
Gate V3-G3 remains LOCKED pending formal evaluation.

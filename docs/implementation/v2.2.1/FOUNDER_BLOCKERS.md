# AICO v2.2.1 — FOUNDER BLOCKERS & DECISION TRACKER

**Date:** 2026-11-06  
**Status:** Tracking Active Gates

---

## 1. Active Founder Gates

| Gate | Scope | Required Action | Status | Impact if Gated |
| :---: | :--- | :--- | :---: | :--- |
| **G1** | Manifest v1.1 Approval | Review `company-manifest.json` schema v1.1 policy additions (`session_mode`, `dispatch_mode`, etc.). | PENDING | Phase 1 implementation completes preview script only; does not force live DB changes. |
| **G1.5** | Sandbox Client Auth PoC | Authorize testing of token authentication on disposable sandbox DB. | PENDING | Sandbox PoC can be developed in isolation without touching live system. |
| **G2** | Local Auth & ACL Package | Review generated DACL / DPAPI scripts and service account plans. | PENDING | No NTFS ACLs modified on Windows host. |
| **G4** | Production DB Migration | Authorize running MigrationRunner against `D:\AI-COMPANY\data\aico.db`. | **BLOCKED** | Live production database remains 100% frozen. All tests run on sandbox copies. |
| **G7** | Public Gateway & Ngrok Release | Authorize opening external tunnel and activating port 3335. | **BLOCKED** | Port 3335 remains disabled; ngrok remains stopped. |

---

## 2. Independent Work In Progress (Non-Gated)

The following activities do NOT require bypassing Founder gates and are proceeding:
1. Manifest validator and runtime configuration abstraction (`Phase 1`).
2. Test harness and sandbox fixture factory (`Phase 3`).
3. Core domain services (`S01`–`S04`), SQLite migration scripts `v040`–`v050` tested against disposable temporary databases (`Phase 4A`).
4. MCP tool schema and DTO contract implementations.

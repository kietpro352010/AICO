# AICO Test Fixtures Specification

## 1. Fixture: `aico_v030_pre_v221.db`

### Provenance & Purpose
This file is the sanitized, deterministic canonical SQLite database snapshot representing AICO schema v0.3.0 prior to migration v0.4.0, v0.4.1, and v0.5.0. It is utilized by migration test suites (`T01`, `T02`, `T04`, `T05`, `T07`, `T08`, `T09`, `T10`, `T16`) to verify forward schema migrations, state machines, and sandbox initialization.

### Security & Sanitization Attestation
- **No Production Data:** Contains zero production tasks, zero client data, zero session logs.
- **No Credentials / Secrets:** Contains zero API keys, zero DPAPI blobs, zero HMAC audit secret keys.
- **Static Public Manifest:** Contains only the initial 6 agent definitions and 5 quota pools derived directly from the public `company-manifest.json`.
- **Usage Events:** Table `agent_usage_events` contains exactly 0 records.

### Cryptographic Verification
- **File Size:** 45,056 bytes
- **SHA-256 Hash:** `2F73A9602DBBC50DA68B323FA00D2D7808855DF7A21FAA3DBEE64EC3EFD1477A`
- **Constant:** `CANONICAL_V030_BACKUP_HASH` in `company-mcp/test/helpers/test-context.ts`

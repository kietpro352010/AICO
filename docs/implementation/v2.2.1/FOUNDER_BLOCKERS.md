# AICO_FOUNDER_DECISION_REQUESTS_V2.2.1.md

**Version:** 2.2.1  
**Status:** **APPROVED BY FOUNDER** on 2026-11-07 according to Argon 4 recommendations.  
**Rule:** Proceed with authorized implementation adhering strictly to Argon 4's safety and architecture recommendations.

---

## Decision Log

| ID | Decision Item | Founder Decision | Argon 4 Recommendation Applied | Scope & Conditions |
|---|---|:---:|---|---|
| **FDR-01** | Manifest policy fields | **APPROVED** | Phê duyệt tách 4 trường policy (`session_mode`, `dispatch_mode`, `invocation_approval_policy`, `action_approval_policy`). Argon agents luôn `manual`, `always_require_founder`. Deprecate `auto_invoke`. | Áp dụng vào Manifest v1.1 và schema migration. |
| **FDR-02** | Independent Git clones & Mediation | **APPROVED** | Thay linked worktree bằng Independent Clones + `GitMediationService` (`S05`). Namespace `agent/<agent_id>/*`, cấm push thẳng `master`. | Triển khai `GitMediationService`. |
| **FDR-03** | Auth/DPAPI/ACL rollout | **APPROVED** | Phê duyệt PoC trước tại G1.5 trên sandbox; không truyền secret qua CLI; chuẩn bị script ACL có kiểm chứng rollback. | Cầu nối `client-bridge.ts` và kiểm thử sandbox. |
| **FDR-04** | Windows SID model | **OPTION A (APPROVED)** | Khuyến nghị của Argon: **Option A — OS-level isolation**. Founder giữ `kietp`; tạo tài khoản chuẩn `aico_flash1`, `aico_flash2`, `aico_codex`, dịch vụ `aico_svc`. | Chuẩn bị script và phân quyền DACL theo SID. |
| **FDR-05** | Production migration & RPO/RTO | **APPROVED G4 PLAN** | Chỉ migrate `D:\AI-COMPANY\data\aico.db` sau khi sandbox migration pass, backup checksum verified và restore drill thành công. RPO 24h, RTO 30m là target. | Kiểm thử dry-run sandbox hoàn chỉnh trước khi chạm DB thật. |
| **FDR-06** | Public Gateway & Ngrok | **APPROVED DISABLED** | Hoàn thiện code và tests bảo mật nhưng giữ Public Gateway `:3335` và ngrok **VÔ HIỆU HÓA (DISABLED)** mặc định. | Cổng 3335 và ngrok duy trì tắt. |

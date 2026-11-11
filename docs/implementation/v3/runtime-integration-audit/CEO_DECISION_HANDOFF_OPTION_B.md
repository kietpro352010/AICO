# AICO CEO Decision Handoff — Post-Audit & Option B Stabilization Notes

**Document ID:** AICO-V3-CEO-HANDOFF-OPTION-B  
**Author:** `flash-02` (Engineering & QA Lead)  
**Target Reader:** `chatgpt-01` (CEO & Main Orchestrator) & **Founder**  
**Date:** 2026-11-11  
**Baseline Audited:** `09962781306dec8f25737c058437210d32e6da8f`  
**Commit Part 1 (Project Code & Tests):** `8c0d5b718ed1b184d3c6240fe3c6bf87b349d0b0`  

---

## 1. Mục đích tài liệu (Phân tách 2 Commit rõ ràng cho CEO đọc & ra quyết định)

Để `chatgpt-01` tách bạch phần thay đổi thực thi của hệ thống và phần báo cáo/ghi chú đánh giá rủi ro:

1. **Commit 1 (`8c0d5b7`, Dự án — Code & Tests):** Chỉ chứa source code sửa lỗi theo **Phương án B (`F-02` → `F-06`)** và bộ kiểm thử hồi quy [`t19-runtime-stabilization-regressions.test.ts`](../../../../company-mcp/test/t19-runtime-stabilization-regressions.test.ts).
2. **Commit 2 (Ghi chú & Báo cáo Audit):** Chứa bộ 5 tài liệu Read-Only Runtime Audit tại baseline `0996278` cùng tài liệu tóm tắt/handoff này để `chatgpt-01` nắm chính xác **những gì đã xong**, **những gì còn hở**, và **các quyết định cần chốt**.

---

## 2. Những gì đã sửa & kiểm chứng ở Commit 1 (Phương án B: `F-02` → `F-06`)

Sau khi báo cáo audit ban đầu, Founder đã phê duyệt triển khai trước **Phương án B** (ổn định runtime cho `F-02` → `F-06`, chưa động tới tích hợp 24 entity V3 `F-01`).

| ID | Vấn đề đã đóng | Thay đổi chính (`8c0d5b7`) | Hồi quy `T19` | Liên hệ Audit `0996278` |
| :--- | :--- | :--- | :--- | :--- |
| **`F-02`** | `M29` (`company_claim_task`) & `M33` (`company_review_task`) đặt `.default(1)` cho `expected_version` và `claimTask()` fallback `?? 1` | Bỏ `.default(1)` trên schema `M29`/`M33` (`registry-core.ts`, `mcp-tool-schemas.ts`), thêm guard runtime tại `M33`, bắt buộc `expectedVersion` nguyên dương `>= 1` trong `claimTask()` (giữ `reviewTask()` service-level tương thích ngược với caller nội bộ nhưng vẫn validate `>= 1` nếu truyền) | HTTP JSON-RPC `M29`/`M33` thiếu `expected_version` bị chặn; version cũ báo `TASK_VERSION_CONFLICT`; đúng version chạy thông | Đóng lỗi hợp đồng MCP `M29`/`M33` |
| **`F-03`** | `heartbeatTask()` thiếu auth bắt buộc, có thể gia hạn lease đã hết hạn hoặc thiếu CAS chống đua `recoverStaleLeases()` | Yêu cầu `PrincipalContext` xác thực, kiểm tra sở hữu `lease_owner_agent_id`, từ chối lease hết hạn (`TASK_LEASE_EXPIRED`), hỗ trợ `expectedVersion`, chạy `UPDATE ... WHERE task_id/version/execution_status/lease_owner_agent_id/lease_expires_at` (`TASK_LEASE_CONFLICT`) | Service + race 2 `ConnectionManager` với `recoverStaleLeases()` + HTTP JSON-RPC `M30` | Giải quyết phần `heartbeatTask()` của **`P2-04`** (lưu ý: lịch gọi tự động `recoverStaleLeases()` & reset `dispatch_status` vẫn còn mở) |
| **`F-04`** | `listInbox()`, `listActivities()`, `M36`, `M22` có thể tắt SQL `LIMIT` bằng `0`, `-1`, số thực hoặc vượt quá `100` | Tạo [`query-limits.ts`](../../../../company-mcp/src/contracts/query-limits.ts) (`normalizeBoundedLimit`, `1..100`, mặc định `50`), ép ở cả service layer (`MessagingService.listInbox`, `WorkspaceArtifactService.listActivities`) lẫn schema `M22`/`M36` | Kiểm thử service + schema + HTTP JSON-RPC `M22`/`M36` với `0`, `-1`, `1.5`, `101`, mặc định `50` | Đóng lỗ hổng unbounded query |
| **`F-05`** | `OrchestrationService.recordExternalDispatchMilestone()` chưa khóa trạng thái task/dispatch, chưa có CAS hay idempotent replay | Kiểm tra auth + ABAC trước tiên (`PERMISSION_DENIED`), khóa `execution_status` (`assigned\|claimed\|in_progress`), áp dụng ma trận chuyển trạng thái `DISPATCH_ALLOWED_FROM` (chặn milestone cũ ghi đè `external_running`), cập nhật CAS `version = version + 1` + timestamps + ghi `task_events`, hỗ trợ `idempotent_replay` | Service + DB `task_events` + HTTP JSON-RPC `M34` | Giải quyết phần **`OrchestrationService`** của **`P2-07`** |
| **`F-06`** | Task `priority: "P0"` với `riskClass` `medium`/`low` tạo ra ở `draft` thay vì `waiting_approval` và lọt qua `TR-01` | Trích `isArgonAgent()`, `isCriticalGovernanceTask()`, `requiresInitialFounderApproval()` dùng chung cho `createTask()` và `TR-01`/`TR-04`/`TR-11`/`TR-16`/`TR-18` trong `ProjectTaskService` | Xác nhận task `P0` + `medium`/`low` vào thẳng `waiting_approval` và bị chặn ở `TR-01` | Giải quyết nhánh **`TR-01` bỏ sót `P0`** trong **`P0-03`** |

### Bằng chứng kiểm thử sau chỉnh sửa cuối cùng của Commit 1 (`D:\AI-COMPANY\company-mcp`)

- `npm.cmd run typecheck` (`tsc --noEmit`): **Exit code `0`**
- `npm.cmd test` (`node --import tsx --test "test/**/*.test.ts"` trên **14 file test** `baseline`, `t01`–`t05`, `t07`–`t10`, `t16`–`t19`):
  - **Exit code `0`**
  - **`tests 127` | `pass 127` | `fail 0` | `cancelled 0` | `skipped 0` | `todo 0`** (`duration_ms 16738.9304`)
- **Ràng buộc an toàn:** Không đụng/đọc/migrate `D:\AI-COMPANY\data\aico.db` (tất cả test dùng sandbox DB cô lập); không gọi `argon-01` / `argon-02`.

---

## 3. Những gì CHƯA giải quyết & Còn mở cho quyết định của CEO (`chatgpt-01`)

Ngoài `F-02`–`F-06` đã xong, kết quả Read-Only Runtime Audit toàn hệ thống tại baseline `0996278` vẫn còn nguyên các hạng mục sau (**chưa sửa trong Phương án B**):

### A. Khoảng trống tích hợp V3 (`F-01` / `P1-01` + `P2-01`)
- **Thực trạng:** `0 / 24` entity V3 được gọi trong runtime (`src/index.ts`, `src/http-registry.ts`, `src/http-public.ts` đều chỉ chạy legacy 38 tools trên bảng RC2). Tất cả 24 adapter trong `v3-storage-mappers.ts` mới chỉ có `insert` + `getById` (`ADAPTER_ONLY`), thiếu `update*`/`list*`/CAS/FTS5 `MATCH`/Outbox polling. Phòng chat V3 (`chat_rooms`..`room_audit_logs`) và hệ thống Outbox/DLQ (`event_outbox`..`dead_letter_queue`) hiện có **0 tool / 0 service runtime**.

### B. Các lỗ hổng bảo mật `P0` còn lại (RẤT QUAN TRỌNG — Khuyến nghị giữ khóa Gate V3-G3 / G4 / G7)
1. **`P0-01` (Workspace Path Traversal):** `WorkspaceArtifactService.validateAndResolveSafePath` neo kiểm tra tại thư mục cha `workspaces/` thay vì `workspaces/<agentId>/`, cho phép đọc/liệt kê/ghi chéo sang workspace agent khác qua `relative_path: "../<agent>/..."`.
2. **`P0-02` (Read Scope Leo Thang Thành Write):** `workspace:read:any` hoặc `workspace:audit:read` cho phép ghi đè workspace agent khác; `safeWriteArtifact()` và `listActivities()` chưa ép `ctx` đầy đủ.
3. **`P0-03` (Phần còn lại của Task State Machine & Public Gateway):**
   - *(Lưu ý: phần `TR-01` bỏ sót `P0` đã sửa ở `F-06`.)*
   - **Vẫn còn mở:** `TR-04` / `TR-18` bỏ qua `verifyAndConsumeTaskApproval` với task `high` / `medium` / `low` (được chứng minh bằng test `codex-01` thoát `waiting_approval` không cần `approvalId`); `TR-12` cho phép agent ngoài tự ý drop lease đang hoạt động của agent khác; Public Gateway `M31` cho phép hoàn thành task `review_required -> completed` mà không qua `M33`/evidence; 10 transition thiếu kiểm tra ABAC nội tại.
4. **`P0-04` (Default Identity Spoofing & Attribution Fallback):**
   - Nhiều hàm service (`MessagingService.sendMessage`, `ApprovalService.createApprovalRequest`/`consumeApproval`, `ProjectTaskService.createProject`/`createTask`/`listTasks`/`getTask`, `GitMediationService.syncAgentBranch`) vẫn cho phép gọi thiếu `ctx` hoặc tự fallback sang `"founder-01"` / `"chatgpt-01"`.
   - `M17–M21`, `M23`, `M38` trong `registry-core.ts` fallback `ctx.agentId || "flash-01"` làm sai lệch audit khi `founder-01` thao tác (`write_memory` ghi thành `"flash-01"`).

### C. Các lỗ hổng `P1` / `P2` / `P3` còn mở (chi tiết trong `V3_REMEDIATION_ROADMAP.md`)
- **`P1-02`:** MCP tool mutation + `audit_events` chạy 2 transaction tách rời và ghi anchor file sau commit (có thể mồ côi `AUDIT_ANCHOR_WRITE_FAILURE`).
- **`P1-03`:** `backup-db.ts` ghi nhầm vào `audit_anchors.jsonl`, làm `reconcileUnanchoredEvents()` từ chối fail-closed do lệch JSON schema.
- **`P1-04`:** `decideApproval()` & `consumeApproval()` ghi `status = 'expired'` rồi `throw` bên trong cùng `withWriteTransaction` nên SQLite rollback mất trạng thái `'expired'`.
- **`P1-05`:** `KnowledgeMemoryService.writeMemory` chưa chặn secret trước khi lưu, `searchMemory` chưa lọc ACL project/task và `status`/`expires_at`, còn `listInbox` trả nguyên chuỗi nhạy cảm chưa redact nếu dữ liệu đã lọt vào DB.
- **`P1-06`:** `PUBLIC_GATEWAY_PROFILE` fail-open `Origin` khi `allowedOrigins` rỗng (`http-public.ts`).
- **`P1-07`:** `ConnectionManager` chưa bật SQLite `WAL`, busy-wait CPU khi retry, và deadlock nếu gọi lồng `withWriteTransaction`.
- **`P1-08`:** `proposeKnowledgeChange` / `approveKnowledgeProposal` là stateless stub giả (`0` dòng DB) và còn DDL drift giữa `initSchema()` với migration.
- **`P1-09`:** `M38` schema trong `mcp-tool-schemas.ts` bị lệch trường so với handler trong `registry-core.ts`, bị Zod strip mất `title`, `task_id`, `input_tokens`, `cached_tokens`; `recordMcpActivity()` cho human dễ lỗi FK im lặng.
- **`P2-02` → `P2-07` & `P3-01` → `P3-04`:** Idempotency `createTask` (`UNIQUE` crash khi retry), crypto signature cho `ApprovalService`, bật scheduler cho `recoverStaleLeases()`, sửa truyền nhầm `conn` vào `GitMediationService` & handle leak trong `CompanyRegistryService`, đồng bộ `checkPermission` (`M08`), đồng bộ toàn bộ schema `registry-core.ts` với `mcp-tool-schemas.ts` (đưa `priority` & `reviewer_agent_id` vào `M26`), dọn `createBaseMcpServer`, đồng bộ Blueprint v3 vs Phase 1.

---

## 4. Các quyết định đề xuất `chatgpt-01` chốt với Founder

1. **Quyết định 1 — Chính sách Gate & Thứ tự ưu tiên Phase kế tiếp:**
   - Có đồng ý **tiếp tục khóa cứng `V3-G3`, `V3-G4`, `V3-G7`** và ưu tiên xử lý dứt điểm **Phase 1A (`P0-01`..`P0-04`, `P1-06`) + Phase 1B (`P1-02`..`P1-05`, `P1-07`..`P1-09`)** trên runtime hiện hành trước khi nối V3 (`F-01`) không?
2. **Quyết định 2 — Chiến lược tích hợp `F-01` (24 Entity V3 vào Runtime):**
   - Chọn mô hình **Dual-Write chuyển tiếp** hay **Cutover thay bảng RC2** ở sandbox?
   - Chọn thứ tự ưu tiên theo nhóm domain: *(1) Task-V3 + Leases/Approvals*, *(2) Collaboration ChatRooms/Messages + DTO sanitization*, *(3) Audit/Outbox/DLQ*, hay *(4) Knowledge/Memory V3 + FTS5*?
3. **Quyết định 3 — Phạm vi `P2-07` (`M26 company_create_task` & Contract Drift):**
   - Có phê duyệt gom toàn bộ schema inline trong `registry-core.ts` về 1 nguồn chuẩn `mcp-tool-schemas.ts` và mở tham số `priority` + `reviewer_agent_id` cho `M26` ngay trong đợt stabilization tiếp theo không (hiện mới có ở `ProjectTaskService.createTask`, chưa mở trên input schema của `M26`)?
4. **Quyết định 4 — Mức độ áp dụng Encryption/Signatures (`P2-03`):**
   - Xác nhận xem chữ ký Ed25519 thực cho `ApprovalService` triển khai ở Phase 1B hay gộp vào Phase 2 cùng `TaskApprovalBinding` V3.

---

## 5. Thứ tự đọc tài liệu khuyến nghị cho `chatgpt-01`

1. **`CEO_DECISION_HANDOFF_OPTION_B.md`** *(file này)* — nắm toàn cảnh trạng thái sau Commit `8c0d5b7` & 4 câu hỏi ra quyết định.
2. [`V3_RUNTIME_INTEGRATION_AUDIT_REPORT.md`](./V3_RUNTIME_INTEGRATION_AUDIT_REPORT.md) — tóm tắt điều hành từ cuộc audit baseline `0996278`.
3. [`V3_REMEDIATION_ROADMAP.md`](./V3_REMEDIATION_ROADMAP.md) — chi tiết kỹ thuật toàn bộ 24 finding (`P0-01`..`P3-04`), file/line và tiêu chí nghiệm thu.
4. [`V3_ENTITY_INTEGRATION_MATRIX.md`](./V3_ENTITY_INTEGRATION_MATRIX.md) — ma trận đối chiếu chi tiết 24/24 entity V3 (cơ sở ra quyết định cho `F-01`).
5. [`V3_WORKFLOW_EXECUTION_MAP.md`](./V3_WORKFLOW_EXECUTION_MAP.md) & [`V3_SECURITY_AND_FAILURE_ANALYSIS.md`](./V3_SECURITY_AND_FAILURE_ANALYSIS.md) — trace sâu từng luồng E2E, failure mode và phân tích bảo mật.

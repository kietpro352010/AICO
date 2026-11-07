import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxTestContext } from "./helpers/test-context.js";
import { ConnectionManager } from "../src/db/connection-manager.js";
import { GitMediationService } from "../src/services/git-mediation-service.js";
import { KnowledgeMemoryService } from "../src/services/knowledge-memory-service.js";
import { ProjectTaskService } from "../src/services/project-task-service.js";
import { ObservabilityQuotaService } from "../src/services/observability-quota-service.js";

test("T04-T08 Comprehensive Verification: Git, Knowledge FTS5, Task State Machine & HMAC Audit Chain", () => {
  const ctx = createSandboxTestContext("aico-comprehensive-");

  try {
    const connManager = new ConnectionManager(ctx.dbPath);

    // 1. GitMediationService verification
    const gitService = new GitMediationService(ctx.tempDir);
    assert.equal(gitService.validateBranchName("flash-01", "agent/flash-01/feat-test"), true);
    assert.equal(gitService.validateBranchName("flash-01", "master"), false);
    assert.equal(gitService.validateBranchName("flash-01", "agent/codex-01/feat"), false);

    // 2. KnowledgeMemoryService & FTS5 Bilingual search
    const kmService = new KnowledgeMemoryService(connManager);
    kmService.initSchema();

    kmService.indexDocument({
      doc_id: "doc_01",
      title: "Hệ thống điều phối tại Đà Nẵng",
      category: "architecture",
      summary: "Tài liệu kiến trúc AICO v2.2.1",
      body_markdown: "Nội dung hướng dẫn chi tiết điều phối.",
      tags_json: '["architecture", "danang"]'
    });

    // Test unaccented Vietnamese query matching accented text
    const searchRes = kmService.searchKnowledge("dieu phoi");
    assert.ok(searchRes.length > 0, "Unaccented query 'dieu phoi' matches document");
    assert.equal(searchRes[0].doc_id, "doc_01");

    // Test private memory isolation
    kmService.writeMemory({
      memoryId: "mem_flash1_01",
      scope: "agent_private",
      ownerAgentId: "flash-01",
      content: "Flash 1 secret notes"
    });

    const flash2Memories = kmService.searchMemory({ callerAgentId: "flash-02" });
    assert.equal(
      flash2Memories.some((m) => m.memory_id === "mem_flash1_01"),
      false,
      "flash-02 cannot read agent_private memory of flash-01"
    );

    // 3. ProjectTaskService & State Machine Separation of Duties
    const ptService = new ProjectTaskService(connManager);
    ptService.initSchema();

    // Regular task
    const task1 = ptService.createTask({
      taskId: "task_100",
      projectId: "proj_01",
      title: "Develop feature",
      assignedAgentId: "flash-02",
      createdBy: "chatgpt-01"
    });
    assert.equal(task1.execution_status, "draft");

    // Argon task -> strictly starts in waiting_approval with max_retries = 0
    const argonTask = ptService.createTask({
      taskId: "task_argon_01",
      projectId: "proj_01",
      title: "Audit system",
      assignedAgentId: "argon-01",
      createdBy: "chatgpt-01"
    });
    assert.equal(argonTask.execution_status, "waiting_approval");
    assert.equal(argonTask.max_retries, 0);

    // Test Separation of Duties on Review: Agent cannot review their own work
    connManager.withWriteTransaction((db) => {
      db.prepare("UPDATE tasks SET execution_status = 'review_required' WHERE task_id = 'task_100'").run();
    });

    assert.throws(
      () => ptService.reviewTask({ taskId: "task_100", reviewerId: "flash-02", decision: "completed" }),
      /ABAC_OWNERSHIP_OR_SOD_VIOLATION/
    );

    // Founder or CTO can review
    const reviewed = ptService.reviewTask({ taskId: "task_100", reviewerId: "flash-01", decision: "completed" });
    assert.equal(reviewed.execution_status, "completed");

    // 4. ObservabilityQuotaService & HMAC Audit Chain
    const obsService = new ObservabilityQuotaService(connManager, "test_secret_key");
    obsService.initSchema();

    const ev1 = obsService.appendAuditEvent({
      actorId: "flash-01",
      action: "git_sync",
      resourceType: "branch",
      resourceId: "agent/flash-01/test",
      outcome: "succeeded"
    });

    const ev2 = obsService.appendAuditEvent({
      actorId: "founder-01",
      action: "decide_approval",
      resourceType: "approval_request",
      resourceId: "appr_123",
      outcome: "succeeded"
    });

    const verifyBeforeTamper = obsService.verifyAuditChainIntegrity();
    assert.equal(verifyBeforeTamper.valid, true);
    assert.equal(verifyBeforeTamper.totalEvents, 2);

    // Tamper with event 1 outcome directly via SQL
    connManager.withWriteTransaction((db) => {
      db.prepare("UPDATE audit_events SET outcome = 'failed' WHERE event_id = ?").run((ev1.event_id || ev1.audit_id) as string);
    });

    const verifyAfterTamper = obsService.verifyAuditChainIntegrity();
    assert.equal(verifyAfterTamper.valid, false, "HMAC audit chain detects SQL tampering");
    assert.equal(verifyAfterTamper.brokenAtEventId, ev1.event_id || ev1.audit_id);
  } finally {
    ctx.cleanup();
  }
});

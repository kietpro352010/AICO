# AICO V3 MASTER BLUEPRINT — TASK & COLLABORATIVE ORCHESTRATION

**Document ID:** `BP-V3-07`  
**Version:** `3.1.0-reconciled`  
**Date:** 2026-11-07  
**Author:** `flash-02` — Engineering & QA Lead  
**Design Phase:** Architecture & Contracts Design Only (No Implementation Authorized)  
**Baseline Git Reference:** Branch `feat/v2.2.1-implementation`, Commit `cd749107c4b34e26f61e14a238336e414f78779d`  
**Actual HEAD:** `21f3aad16911eb076e2245a791bde51178a0d222`  
**Target Workspace:** `D:\AI-COMPANY`

---

## 1. ORCHESTRATION OVERVIEW & DESIGN PRINCIPLES

In AICO V3, complex software engineering initiatives are executed through an autonomous, hierarchical workflow engine (`REQ-V3-021`). Work is structured as Directed Acyclic Graphs (DAGs) of tasks with strict Separation of Duties (SoD), non-conflicting leases, heartbeat monitoring, and multi-tier verification gates.

### 1.1 Core Principles
1. **DAG Decomposition (`REQ-V3-022`):** Complex goals are broken into granular tasks with explicit dependency constraints.
2. **Deterministic Ownership (`REQ-V3-023`):** Exactly one agent holds an exclusive lease on an active task.
3. **Four-Eyes Principle (SoD, `REQ-V3-025`):** The creator or implementer of code cannot review or verify their own work.
4. **Mandatory QA Sign-Off (`REQ-V3-025`):** No task can transition to `DONE` without explicit, independent verification evidence submitted by `flash-02` (QA Lead).
5. **Partitioned Lease Recovery (`REQ-V3-024`, `REQ-V3-031`):** Inactive standard workers forfeit leases to queue. **Expired Argon tasks transition to `BLOCKED_MANUAL_INTERVENTION` and require human Founder intervention; they are NEVER automatically retried or returned to `READY_FOR_DEV`.**

---

## 2. THE CANONICAL 23-STATE TASK STATE MACHINE

The state machine encapsulates exactly **23** mutually exclusive states:

```mermaid
stateDiagram-v2
    [*] --> INTAKE_PENDING: company_create_task()
    INTAKE_PENDING --> ARCH_REVIEW_PENDING: Complexity HIGH / CRITICAL
    INTAKE_PENDING --> READY_FOR_DECOMPOSITION: Standard task
    ARCH_REVIEW_PENDING --> READY_FOR_DECOMPOSITION: CTO approves architecture
    ARCH_REVIEW_PENDING --> REJECTED: Infeasible or policy violation

    READY_FOR_DECOMPOSITION --> DECOMPOSING: Subtasks generating
    DECOMPOSING --> DECOMPOSED: Subtasks linked in DAG
    DECOMPOSED --> BLOCKED: Upstream dependencies incomplete
    DECOMPOSED --> READY_FOR_DEV: Upstream dependencies complete
    BLOCKED --> READY_FOR_DEV: All dependencies reach DONE

    READY_FOR_DEV --> LEASE_ACQUISITION_PENDING: company_claim_task() lock
    LEASE_ACQUISITION_PENDING --> IN_PROGRESS: Lease granted & nonce issued
    IN_PROGRESS --> IN_PROGRESS: company_renew_lease()
    IN_PROGRESS --> STALE_LEASE_RECOVERY: Heartbeat timed out (>180s)

    STALE_LEASE_RECOVERY --> READY_FOR_DEV: Non-Argon (Retry count < max)
    STALE_LEASE_RECOVERY --> BLOCKED_MANUAL_INTERVENTION: Argon Task (Zero auto-retry)

    IN_PROGRESS --> BLOCKED_RUNTIME: Environment error
    BLOCKED_RUNTIME --> IN_PROGRESS: Error resolved

    IN_PROGRESS --> IN_TECHNICAL_REVIEW: company_submit_review()
    IN_TECHNICAL_REVIEW --> REWORK_REQUIRED: CTO requests changes
    REWORK_REQUIRED --> IN_PROGRESS: Assignee re-claims lease

    IN_TECHNICAL_REVIEW --> IN_QA_VERIFICATION: CTO approves (SoD verified)
    IN_QA_VERIFICATION --> QA_REJECTED: QA finds defects
    QA_REJECTED --> REWORK_REQUIRED: QA feedback routed to backlog

    IN_QA_VERIFICATION --> READY_FOR_ACCEPTANCE: QA issues PASS
    READY_FOR_ACCEPTANCE --> FOUNDER_GATE_LOCKED: requires_founder_gate = 1
    FOUNDER_GATE_LOCKED --> ACCEPTANCE_PENDING: Human Founder signs approval

    READY_FOR_ACCEPTANCE --> ACCEPTANCE_PENDING: Non-gated task
    ACCEPTANCE_PENDING --> DONE: CEO / Founder complete_task()
    ACCEPTANCE_PENDING --> REWORK_REQUIRED: Final acceptance rejected

    DONE --> REOPENED: company_reopen_task() on regression
    REOPENED --> READY_FOR_DEV: Assigned for regression fix

    IN_PROGRESS --> ABORTED: Cancelled by Founder/CEO
    READY_FOR_DEV --> ABORTED: Cancelled before execution
    DONE --> [*]
    ABORTED --> [*]
    REJECTED --> [*]
    BLOCKED_MANUAL_INTERVENTION --> [*]: Manual Founder Resolution
```

---

## 3. STATE TRANSITION AUTHORIZATION & VALIDATION MATRIX (26 TRANSITIONS)

Every transition specifies its exact actor, RBAC scope, ABAC rule, preconditions, side effects, and audit event (`REQ-V3-021`):

| ID | From State | To State | Operation | Actor | Scope | ABAC Rule | Preconditions | Side Effects | Audit Event |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TR-01** | `[*] ` | `INTAKE_PENDING` | `company_create_task` | `chatgpt-01`, `flash-01`, `founder-human` | `task:create` | None | Valid project_id | Inserts task record | `task.created` |
| **TR-02** | `INTAKE_PENDING` | `ARCH_REVIEW_PENDING`| Auto-Router | Orchestrator | `system` | None | Priority HIGH/CRITICAL | Alerts CTO | `task.routed_arch_review` |
| **TR-03** | `ARCH_REVIEW_PENDING`| `READY_FOR_DECOMP` | `company_approve_review` | `flash-01` (CTO), `founder-human` | `code:review` | Anti-self | Reviewer = CTO | Advances task | `task.arch_approved` |
| **TR-04** | `READY_FOR_DECOMP` | `DECOMPOSED` | `company_create_task` (subtasks)| `chatgpt-01` (CEO), `flash-01` | `task:create` | Department Lead | DAG cycle check pass | Links subtask edges | `task.decomposed` |
| **TR-05** | `DECOMPOSED` | `BLOCKED` | Dependency Engine | Orchestrator | `system` | None | >=1 upstream not DONE | Sets blocking flag | `task.blocked_dependency` |
| **TR-06** | `BLOCKED` | `READY_FOR_DEV` | Dependency Engine | Orchestrator | `system` | None | 100% upstream DONE | Unblocks task | `task.unblocked` |
| **TR-07A**| `READY_FOR_DEV` | `LEASE_ACQUISITION_PENDING`| `company_claim_task` | Assigned Agent | `task:claim` | Matching capability | Task unleased | Optimistic lock set | `task.lease_claim_started` |
| **TR-07B**| `LEASE_ACQUISITION_PENDING`| `IN_PROGRESS` | Atomic Commit | Orchestrator | `system` | Lease lock valid | No lease collision | Inserts `task_leases` | `task.claimed` |
| **TR-08** | `IN_PROGRESS` | `IN_PROGRESS` | `company_renew_lease` | Leaseholder | `task:claim` | Leaseholder match | `now < expires_at` | Extends `expires_at` | `task.lease_renewed` |
| **TR-09** | `IN_PROGRESS` | `STALE_LEASE_RECOVERY` | Lease Monitor Cron | Orchestrator | `system` | None | `now > expires_at` | Enters recovery queue | `task.lease_stale_detected` |
| **TR-10A**| `STALE_LEASE_RECOVERY` | `READY_FOR_DEV` | Lease Sweeper | Orchestrator | `system` | Non-Argon Worker | Retry count < max | Deletes lease | `task.lease_recovered` |
| **TR-10B**| `STALE_LEASE_RECOVERY` | `BLOCKED_MANUAL_INTERVENTION`| Lease Sweeper | Orchestrator | `system` | Argon Specialist | Assigned = Argon | Deletes lease; alerts Founder | `task.argon_lease_blocked` |
| **TR-11** | `IN_PROGRESS` | `IN_TECHNICAL_REVIEW`| `company_submit_review` | Leaseholder | `task:submit` | Leaseholder match | Artifacts provided | Deletes lease | `task.submitted_review` |
| **TR-12** | `IN_TECHNICAL_REVIEW`| `REWORK_REQUIRED` | `company_approve_review` | `flash-01` (CTO), `founder-human` | `code:review` | SoD check | Decision = CHANGES | Notifies assignee | `task.review_rejected` |
| **TR-13** | `IN_TECHNICAL_REVIEW`| `IN_QA_VERIFICATION` | `company_approve_review` | `flash-01` (CTO), `founder-human` | `code:review` | SoD check (`REQ-V3-025`)| Decision = APPROVE | Enqueues QA | `task.review_approved` |
| **TR-14** | `IN_QA_VERIFICATION` | `QA_REJECTED` | `company_verify_qa` | `flash-02` (QA Lead), `founder-human` | `qa:verify` | Designated QA | Verdict = FAIL | Records defect report | `task.qa_rejected` |
| **TR-15** | `QA_REJECTED` | `REWORK_REQUIRED` | Auto-Router | Orchestrator | `system` | None | Defect logged | Routes to assignee | `task.routed_rework` |
| **TR-16** | `IN_QA_VERIFICATION` | `READY_FOR_ACCEPTANCE`| `company_verify_qa` | `flash-02` (QA Lead), `founder-human` | `qa:verify` | Designated QA | Verdict = PASS | Sets verification flag | `task.qa_passed` |
| **TR-17** | `READY_FOR_ACCEPTANCE`| `FOUNDER_GATE_LOCKED`| Safety Engine | Orchestrator | `system` | None | `requires_founder_gate = 1` | Locks task | `task.founder_gate_locked` |
| **TR-18** | `FOUNDER_GATE_LOCKED`| `ACCEPTANCE_PENDING` | `company_decide_approval`| `founder-human` (Human) | `approval:grant` | Human Principal (`REQ-V3-030`)| Ed25519 signature valid | Consumes approval | `task.founder_gate_approved` |
| **TR-19** | `ACCEPTANCE_PENDING` | `DONE` | `company_complete_task` | `chatgpt-01` (CEO), `founder-human` | `task:complete` | Executive Role | Acceptance criteria met | Archives task room | `task.completed` |
| **TR-20** | Any non-terminal | `ABORTED` | `company_abort_task` | `chatgpt-01` (CEO), `founder-human` | `task:manage` | Executive Role | Cancellation reason given | Deletes lease | `task.aborted` |
| **TR-21** | `ARCH_REVIEW_PENDING`| `REJECTED` | `company_approve_review` | `flash-01` (CTO), `founder-human` | `code:review` | Anti-self | Architectural violation | Records rejection | `task.rejected` |
| **TR-22** | `IN_PROGRESS` | `BLOCKED_RUNTIME` | `company_report_block` | Leaseholder | `task:claim` | Leaseholder match | Environment error | Holds lease | `task.runtime_blocked` |
| **TR-23** | `BLOCKED_RUNTIME` | `IN_PROGRESS` | `company_resolve_block` | Leaseholder | `task:claim` | Leaseholder match | Error resolved | Resumes execution | `task.runtime_unblocked` |
| **TR-24** | `REWORK_REQUIRED` | `IN_PROGRESS` | `company_claim_task` | Assignee | `task:claim` | Assignee match | Unleased | Re-acquires lease | `task.rework_started` |
| **TR-25** | `ACCEPTANCE_PENDING` | `REWORK_REQUIRED` | `company_complete_task` (Reject)| `chatgpt-01` (CEO), `founder-human` | `task:complete` | Executive Role | Acceptance failed | Routes rework | `task.acceptance_rejected` |
| **TR-26** | `DONE` | `REOPENED` | `company_reopen_task` | `flash-02` (QA Lead), `founder-human` | `task:manage` | QA Lead / Founder | Regression report provided | Clears completed_at | `task.reopened` |

---

## 4. PARTITIONED LEASE RECOVERY SPECIFICATION (`REQ-V3-024`, `REQ-V3-031`)

### 4.1 Blanket Recovery Removal & Safety Logic
To completely eliminate the safety violation of blanket lease recovery (`RISK-V221-004`), the lease sweeper executes strict conditional partitioning:

```typescript
export async function recoverExpiredLeases(db: Database): Promise<void> {
  const now = Date.now();
  const expiredLeases = db.prepare(`
    SELECT l.lease_id, l.task_id, l.agent_id, t.task_type, t.requires_founder_gate
    FROM task_leases l
    JOIN tasks t ON l.task_id = t.task_id
    WHERE l.expires_at < ?
  `).all(now);

  for (const lease of expiredLeases) {
    const isArgon = lease.agent_id === 'argon-01' || lease.agent_id === 'argon-02' || lease.task_type === 'SPECIALIST';

    if (isArgon) {
      // TR-10B: NEVER auto-retry Argon. Lock in BLOCKED_MANUAL_INTERVENTION
      db.transaction(() => {
        db.prepare(`UPDATE tasks SET status = 'BLOCKED_MANUAL_INTERVENTION', updated_at = ? WHERE task_id = ?`)
          .run(now, lease.task_id);
        db.prepare(`DELETE FROM task_leases WHERE lease_id = ?`).run(lease.lease_id);
        insertAuditEvent(db, {
          actor: 'orchestrator',
          action: 'task.argon_lease_blocked',
          target_type: 'task',
          target_id: lease.task_id,
          payload: { reason: 'Argon lease expired; manual Founder intervention required' }
        });
      })();
      postBoardroomAlert(`CRITICAL: Task ${lease.task_id} assigned to Argon expired. Moved to BLOCKED_MANUAL_INTERVENTION. Zero auto-retry.`);
    } else {
      // TR-10A: Standard worker recovery
      db.transaction(() => {
        db.prepare(`UPDATE tasks SET status = 'READY_FOR_DEV', updated_at = ? WHERE task_id = ?`)
          .run(now, lease.task_id);
        db.prepare(`DELETE FROM task_leases WHERE lease_id = ?`).run(lease.lease_id);
        insertAuditEvent(db, {
          actor: 'orchestrator',
          action: 'task.lease_recovered',
          target_type: 'task',
          target_id: lease.task_id,
          payload: { previous_agent: lease.agent_id }
        });
      })();
    }
  }
}
```

---

## 5. DIRECTED ACYCLIC GRAPH (DAG) RESOLUTION (`REQ-V3-022`)

1. **Cycle Prevention:** Prior to persisting dependencies in `task_dependencies`, Kahn's algorithm validates that the graph remains cycle-free. Any attempt to introduce circular edges fails immediately with `E_DEPENDENCY_CYCLE`.
2. **Parallel Fan-Out:** When a parent task decomposes into independent subtasks, all subtasks with in-degree 0 immediately enter `READY_FOR_DEV` for parallel claims by distinct workers.
3. **Barrier Synchronization (Fan-In):** Integrating tasks remain in `BLOCKED` until all parent prerequisites enter `DONE`.

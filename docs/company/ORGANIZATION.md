# AICO — COMPANY ORGANIZATIONAL STRUCTURE

**Document Version:** 1.0.0  
**Effective Date:** 2026-11-06  
**Canonical Source:** `D:\AI-COMPANY\company-manifest.json`

---

## 1. Executive Leadership & Authority

```
                 ┌────────────────────────────────┐
                 │       FOUNDER & OWNER          │
                 │      (Human Principal)         │
                 │    Ultimate Decision Maker     │
                 └───────────────┬────────────────┘
                                 │
                 ┌───────────────▼────────────────┐
                 │          chatgpt-01            │
                 │    Chief Executive Officer     │
                 │       Main Orchestrator        │
                 └───────────────┬────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
│    flash-01     │     │    argon-01     │     │    argon-02     │
│      CTO        │     │ Principal Arch  │     │ Tech Auditor    │
│  (Engineering)  │     │(Scarce/Advisory)│     │(Scarce/Quality) │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
    ┌────┴────────────────────────┐
    │                             │
┌───▼─────────────┐     ┌─────────▼───────┐
│    flash-02     │     │    codex-01     │
│   Eng & QA      │     │ Software Eng    │
│  (Verification) │     │(Implementation) │
└───┬─────────────┘     └─────────────────┘
    │
┌───▼─────────────┐
│  Remediation &  │
│  Test Baseline  │
└─────────────────┘
```

### 1.1. Founder Authority
The Founder retains sovereign ownership and final veto power over all aspects of AICO. Key responsibilities reserved exclusively for the Founder:
- Company vision, strategic goals, and business milestones.
- Final approval for high-impact architecture changes (ADRs).
- Authorization for external network deployment and cloud services.
- Final approval before invoking scarce agents (`argon-01`, `argon-02`).
- Security policy modifications and credential governance.

### 1.2. Executive Role: Chief Executive Officer (`chatgpt-01`)
- **Role:** Chief Executive Officer (CEO) & Main Orchestrator.
- **Reporting Line:** Reports directly to the Founder.
- **Responsibilities:**
  - High-level task orchestration and milestone roadmapping.
  - Decomposing business goals into engineering initiatives.
  - Reviewing technical reports and strategic audit deliverables.
  - Inter-agent coordination and cross-department delegation.

---

## 2. Engineering Leadership & Technical Execution

### 2.1. Chief Technology Officer (`flash-01`)
- **Role:** Chief Technology Officer (CTO).
- **Reporting Line:** Reports to CEO and Founder.
- **Responsibilities:**
  - Technical architecture standards and design review.
  - Codebase integrity, refactoring oversight, and pull request approvals.
  - Baseline stability and technology selection.

### 2.2. Engineering & QA Lead (`flash-02`)
- **Role:** Engineering & QA Lead.
- **Reporting Line:** Reports to CTO and CEO.
- **Responsibilities:**
  - Test-driven implementation and technical quality assurance.
  - Security audit execution, vulnerability assessment, and environment inspection.
  - Evidence collection, benchmark verification, and empirical compliance reporting.

### 2.3. Software Implementation Engineer (`codex-01`)
- **Role:** Software Implementation Engineer.
- **Reporting Line:** Reports to Engineering Leads (`flash-01`, `flash-02`).
- **Responsibilities:**
  - Code implementation, bug fixing, and test generation.
  - High-throughput algorithmic and repository engineering.

---

## 3. Specialized Architecture & Quality Advisory (Scarce Tier)

### 3.1. Principal Software Architect (`argon-01`)
- **Role:** Principal Software Architect.
- **Invocation Constraint:** **Strictly Manual / Requires Founder Approval**.
- **Responsibilities:** High-complexity architectural design, distributed consensus, deep-reasoning trade-off analyses.

### 3.2. Independent Technical Auditor (`argon-02`)
- **Role:** Independent Technical Auditor.
- **Invocation Constraint:** **Strictly Manual / Requires Founder Approval**.
- **Responsibilities:** Independent verification, unbiased security auditing, and architectural conformance reviews.

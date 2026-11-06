# 02 — SECURITY AND WORKSPACES

1. **Path Traversal Defense:**
   - All workspace paths must resolve strictly within the designated project/agent root directory.
   - Symbolic links, junction points, reparse points, and relative `..` path traversals leading outside the sandbox are rejected.
2. **Windows Security Boundaries:**
   - Do not claim OS-level process isolation between agents executing under the same Windows SID.
   - Isolation across processes of the same user is enforced logically via credential scoping, workspace boundaries, and token authorization.
3. **Public Gateway & Tunnel Quarantine:**
   - Public MCP endpoints (:3335) and ngrok tunnels remain offline by default.
   - Activation requires explicit Founder Gate G7 approval.
4. **Credential Protection:**
   - Never print, log, or commit tokens, private keys, or credentials.
   - Do not use command-line arguments or environment variables to pass production secrets.

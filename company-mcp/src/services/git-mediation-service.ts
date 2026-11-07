import * as path from "node:path";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import type { PrincipalContext } from "../security/context-store.js";
import { SecretScanner } from "../security/secret-scanner.js";

export interface GitMediationConfig {
  centralRepoPath: string;
  allowedBranchPrefix: string;
  workspacesRoot?: string;
}

export class GitMediationService {
  private centralRepoPath: string;
  private workspacesRoot: string;

  constructor(centralRepoPathOrConn?: string | any, workspacesRoot?: string) {
    if (typeof centralRepoPathOrConn === "string") {
      this.centralRepoPath = path.resolve(centralRepoPathOrConn);
    } else {
      this.centralRepoPath = path.resolve(process.env.AICO_ROOT || "D:/AI-COMPANY");
    }
    this.workspacesRoot = workspacesRoot || process.env.AICO_WORKSPACES_ROOT || "D:/AICO-WORKSPACES";
  }

  public validateBranchName(agentId: string, branchName: string): boolean {
    const pattern = new RegExp(`^agent/${agentId}/[a-z0-9-]+$`);
    return pattern.test(branchName);
  }

  public scanCommitFiles(clonePath: string, commitSha: string): { valid: boolean; forbiddenFiles: string[]; secretPattern?: string } {
    try {
      const output = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commitSha], {
        cwd: clonePath,
        encoding: "utf8"
      });

      const files = output.split(/\r?\n/).filter(Boolean);
      const forbiddenPatterns = [
        /\.db$/,
        /\.db-wal$/,
        /\.db-shm$/,
        /\.env$/,
        /\.dpapi$/,
        /\.key$/,
        /\.pem$/,
        /^\.git\/hooks/
      ];
      const foundForbidden: string[] = [];

      for (const f of files) {
        if (forbiddenPatterns.some((p) => p.test(f))) {
          foundForbidden.push(f);
        }
      }

      // Content inspection: scan commit diff for secret patterns
      try {
        const patch = execFileSync("git", ["diff-tree", "-p", commitSha], {
          cwd: clonePath,
          encoding: "utf8"
        });
        const scan = SecretScanner.scan(patch);
        if (scan.hasSecret) {
          return { valid: false, forbiddenFiles: foundForbidden, secretPattern: scan.patternMatched };
        }
      } catch {
        // If diff-tree -p fails on root commit, proceed with file check
      }

      return { valid: foundForbidden.length === 0, forbiddenFiles: foundForbidden };
    } catch (err: any) {
      throw new Error(`GIT_DIFF_TREE_FAILED: Failed to inspect commit tree: ${err.message}`);
    }
  }

  public syncAgentBranch(params: {
    ctx?: PrincipalContext;
    agentId: string;
    branchName: string;
    direction: "push_agent_branch" | "pull_master";
    clonePath?: string;
  }): { success: boolean; branch_name: string; direction: string; commit_sha: string; status: string; message: string } {
    // ABAC ownership check
    if (params.ctx && params.ctx.principalType !== "human" && params.ctx.principalId !== "founder-01") {
      if (params.ctx.agentId && params.ctx.agentId !== params.agentId) {
        throw new Error(`PERMISSION_DENIED: Agent ${params.ctx.agentId} cannot sync branch for agent ${params.agentId}`);
      }
    }

    if (!this.validateBranchName(params.agentId, params.branchName)) {
      throw new Error(`GIT_BRANCH_NAMESPACE_VIOLATION: Branch '${params.branchName}' must match agent/${params.agentId}/[a-z0-9-]+`);
    }

    const effectiveClonePath = params.clonePath || path.resolve(this.workspacesRoot, params.agentId, "repo");

    if (!fs.existsSync(effectiveClonePath)) {
      throw new Error(`GIT_CLONE_NOT_FOUND: Agent clone directory does not exist: ${effectiveClonePath}`);
    }

    if (params.direction === "push_agent_branch") {
      let commitSha: string;
      try {
        commitSha = execFileSync("git", ["rev-parse", `refs/heads/${params.branchName}`], {
          cwd: effectiveClonePath,
          encoding: "utf8"
        }).trim();
      } catch {
        try {
          commitSha = execFileSync("git", ["rev-parse", params.branchName], {
            cwd: effectiveClonePath,
            encoding: "utf8"
          }).trim();
        } catch (err: any) {
          throw new Error(`GIT_REV_PARSE_FAILED: Failed to resolve branch '${params.branchName}' commit: ${err.message}`);
        }
      }

      const scanResult = this.scanCommitFiles(effectiveClonePath, commitSha);
      if (!scanResult.valid) {
        if (scanResult.secretPattern) {
          throw new Error(`SECRET_LEAK_PREVENTED: Commit diff contains sensitive credential pattern: ${scanResult.secretPattern}`);
        }
        throw new Error(`SECRET_LEAK_PREVENTED: Commit contains forbidden files: ${scanResult.forbiddenFiles.join(", ")}`);
      }

      try {
        execFileSync("git", ["fetch", effectiveClonePath, `${params.branchName}:${params.branchName}`], {
          cwd: this.centralRepoPath,
          encoding: "utf8"
        });
      } catch (err: any) {
        throw new Error(`GIT_SYNC_FAILED: Failed to fetch agent branch to central repository: ${err.message}`);
      }

      return {
        success: true,
        branch_name: params.branchName,
        direction: params.direction,
        commit_sha: commitSha,
        status: "synced",
        message: `Branch ${params.branchName} synced to central repository safely`
      };
    } else {
      // pull_master
      let masterSha: string;
      try {
        masterSha = execFileSync("git", ["rev-parse", "master"], { cwd: this.centralRepoPath, encoding: "utf8" }).trim();
      } catch (err: any) {
        throw new Error(`GIT_REV_PARSE_FAILED: Failed to resolve central master commit: ${err.message}`);
      }

      try {
        execFileSync("git", ["fetch", this.centralRepoPath, "master"], {
          cwd: effectiveClonePath,
          encoding: "utf8"
        });
      } catch (err: any) {
        throw new Error(`GIT_FETCH_FAILED: Failed to fetch central master in agent clone: ${err.message}`);
      }

      return {
        success: true,
        branch_name: params.branchName,
        direction: params.direction,
        commit_sha: masterSha,
        status: "fetched",
        message: `Fetched latest master commit ${masterSha} from central repository`
      };
    }
  }
}

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

  public scanCommitFiles(
    clonePath: string,
    commitSha: string,
    options?: { baseRef?: string }
  ): { valid: boolean; forbiddenFiles: string[]; secretPattern?: string } {
    try {
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

      // 1. Working Tree & Untracked Files Scan (Check staged, unstaged, and untracked files)
      try {
        const statusOutput = execFileSync("git", ["status", "--porcelain", "-uall"], {
          cwd: clonePath,
          encoding: "utf8",
          timeout: 10000
        });
        const statusLines = statusOutput.split(/\r?\n/).filter(Boolean);
        const untrackedForbidden: string[] = [];
        for (const line of statusLines) {
          const filePath = line.slice(3).trim();
          if (forbiddenPatterns.some((p) => p.test(filePath))) {
            untrackedForbidden.push(filePath);
          }
        }
        if (untrackedForbidden.length > 0) {
          return { valid: false, forbiddenFiles: untrackedForbidden };
        }
      } catch {
        // Continue if git status is unavailable (e.g. bare repo)
      }

      // 2. Full Tree Scan: Inspect ALL files present in the branch tree at commitSha
      const treeOutput = execFileSync("git", ["ls-tree", "-r", "--name-only", commitSha], {
        cwd: clonePath,
        encoding: "utf8",
        timeout: 15000
      });

      const files = treeOutput.split(/\r?\n/).filter(Boolean);
      const foundForbidden: string[] = [];

      for (const f of files) {
        if (forbiddenPatterns.some((p) => p.test(f))) {
          foundForbidden.push(f);
        }
      }

      if (foundForbidden.length > 0) {
        return { valid: false, forbiddenFiles: foundForbidden };
      }

      // 3. Full Branch Divergence Scan (Replace -n 50 cap with merge-base full history diff)
      try {
        let rangeArg = commitSha;
        const targetBase = options?.baseRef || "master";
        try {
          const mergeBase = execFileSync("git", ["merge-base", targetBase, commitSha], {
            cwd: clonePath,
            encoding: "utf8",
            timeout: 10000
          }).trim();
          if (mergeBase && mergeBase !== commitSha) {
            rangeArg = `${mergeBase}..${commitSha}`;
          }
        } catch {
          // If merge-base resolution fails, scan full history reachable from commitSha
          rangeArg = commitSha;
        }

        const patchOutput = execFileSync("git", ["log", "-p", "-m", "--full-history", rangeArg], {
          cwd: clonePath,
          encoding: "utf8",
          timeout: 30000
        });
        const scan = SecretScanner.scan(patchOutput);
        if (scan.hasSecret) {
          return { valid: false, forbiddenFiles: [], secretPattern: scan.patternMatched };
        }
      } catch (err: any) {
        throw new Error(`GIT_PATCH_SCAN_FAILED: Failed to scan commit history patches: ${err.message}`);
      }

      return { valid: true, forbiddenFiles: [] };
    } catch (err: any) {
      if (err.message?.startsWith("GIT_PATCH_SCAN_FAILED")) throw err;
      throw new Error(`GIT_TREE_SCAN_FAILED: Failed to inspect branch tree: ${err.message}`);
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

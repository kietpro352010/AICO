import * as path from "node:path";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";

export interface GitMediationConfig {
  centralRepoPath: string;
  allowedBranchPrefix: string;
}

export class GitMediationService {
  private centralRepoPath: string;

  constructor(centralRepoPath: string = "D:/AI-COMPANY") {
    this.centralRepoPath = path.resolve(centralRepoPath);
  }

  public validateBranchName(agentId: string, branchName: string): boolean {
    const pattern = new RegExp(`^agent/${agentId}/[a-z0-9-]+$`);
    return pattern.test(branchName);
  }

  public scanCommitFiles(clonePath: string, commitSha: string): { valid: boolean; forbiddenFiles: string[] } {
    try {
      const output = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commitSha], {
        cwd: clonePath,
        encoding: "utf8"
      });

      const files = output.split(/\r?\n/).filter(Boolean);
      const forbiddenPatterns = [/\.db$/, /\.db-wal$/, /\.db-shm$/, /\.env$/, /\.dpapi$/, /\.key$/, /\.pem$/, /^\.git\/hooks/];
      const foundForbidden: string[] = [];

      for (const f of files) {
        if (forbiddenPatterns.some((p) => p.test(f))) {
          foundForbidden.push(f);
        }
      }

      return { valid: foundForbidden.length === 0, forbiddenFiles: foundForbidden };
    } catch {
      return { valid: false, forbiddenFiles: ["failed_to_inspect_commit"] };
    }
  }

  public syncAgentBranch(params: {
    agentId: string;
    clonePath: string;
    branchName: string;
    direction: "push_agent_branch" | "fetch_central";
  }): { success: boolean; message: string } {
    if (!this.validateBranchName(params.agentId, params.branchName)) {
      throw new Error(`GIT_BRANCH_NAMESPACE_VIOLATION: Branch '${params.branchName}' must match agent/${params.agentId}/[a-z0-9-]+`);
    }

    if (params.direction === "push_agent_branch") {
      // Get current HEAD commit sha of clone branch
      const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: params.clonePath, encoding: "utf8" }).trim();
      const scanResult = this.scanCommitFiles(params.clonePath, commitSha);
      if (!scanResult.valid) {
        throw new Error(`SECRET_LEAK_PREVENTED: Commit contains forbidden files: ${scanResult.forbiddenFiles.join(", ")}`);
      }

      // Fetch the branch into central repo without merge
      execFileSync("git", ["fetch", params.clonePath, `${params.branchName}:${params.branchName}`], {
        cwd: this.centralRepoPath,
        encoding: "utf8"
      });

      return { success: true, message: `Branch ${params.branchName} synced to central repository safely` };
    }

    return { success: true, message: "Fetch central completed" };
  }
}

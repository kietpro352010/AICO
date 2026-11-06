import * as fs from "node:fs";
import * as path from "node:path";

export class WorkspaceArtifactService {
  private baseDir: string;

  constructor(baseDir: string = "D:/AI-COMPANY") {
    this.baseDir = path.resolve(baseDir);
  }

  public validateAndResolveSafePath(relativePath: string, subfolder = "workspace"): string {
    if (!relativePath || typeof relativePath !== "string") {
      throw new Error("Invalid path argument");
    }

    if (relativePath.includes("\0")) {
      throw new Error("Path contains null byte injection");
    }

    const folderRoot = path.resolve(this.baseDir, subfolder);
    const resolvedPath = path.resolve(folderRoot, relativePath);

    // Enforce root containment
    if (!resolvedPath.startsWith(folderRoot + path.sep) && resolvedPath !== folderRoot) {
      throw new Error(`Path traversal denied: path escapes ${subfolder} boundary`);
    }

    return resolvedPath;
  }

  public safeWriteArtifact(relativePath: string, content: string | Buffer, subfolder = "workspace"): { bytesWritten: number; fullPath: string } {
    const fullPath = this.validateAndResolveSafePath(relativePath, subfolder);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Atomic write via temporary file
    const tempPath = fullPath + `.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, fullPath);

    const stat = fs.statSync(fullPath);
    return { bytesWritten: stat.size, fullPath };
  }

  public safeReadArtifact(relativePath: string, subfolder = "workspace"): string {
    const fullPath = this.validateAndResolveSafePath(relativePath, subfolder);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Artifact not found: ${relativePath}`);
    }
    return fs.readFileSync(fullPath, "utf8");
  }
}

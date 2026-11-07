import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";

export class DpapiManager {
  public static unprotect(filePath: string): string {
    if (!fs.existsSync(filePath)) {
      throw new Error(`DPAPI_FILE_NOT_FOUND: '${filePath}' does not exist`);
    }

    if (process.platform === "win32") {
      try {
        const psCommand = `
          Add-Type -AssemblyName System.Security
          $bytes = [System.IO.File]::ReadAllBytes('${filePath.replace(/'/g, "''")}')
          $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
          [System.Text.Encoding]::UTF8.GetString($dec)
        `;
        const result = child_process.execFileSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", psCommand],
          { encoding: "utf8", timeout: 8000 }
        );
        const trimmed = result.trim();
        if (trimmed) return trimmed;
      } catch (err: any) {
        // Fallback: if file was saved as UTF-8 plaintext (e.g. non-Windows or test mock)
        const text = fs.readFileSync(filePath, "utf8").trim();
        if (text.startsWith("aico_live_")) {
          return text;
        }
        throw new Error(`DPAPI_DECRYPT_FAILED: Failed to unprotect DPAPI data: ${err.message}`);
      }
    }

    return fs.readFileSync(filePath, "utf8").trim();
  }

  public static protect(rawToken: string, outputPath: string): void {
    const parent = path.dirname(outputPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    if (process.platform === "win32") {
      const base64 = Buffer.from(rawToken, "utf8").toString("base64");
      const psCommand = `
        Add-Type -AssemblyName System.Security
        $bytes = [System.Convert]::FromBase64String('${base64}')
        $enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        [System.IO.File]::WriteAllBytes('${outputPath.replace(/'/g, "''")}', $enc)
      `;
      child_process.execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psCommand],
        { encoding: "utf8", timeout: 8000 }
      );
      return;
    }

    fs.writeFileSync(outputPath, rawToken, "utf8");
  }
}

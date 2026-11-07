export class SecretScanner {
  private static readonly SECRET_PATTERNS: RegExp[] = [
    /aico_live_[a-zA-Z0-9_-]{16,}/g,
    /sk-[a-zA-Z0-9_-]{20,}/g,
    /ghp_[a-zA-Z0-9]{20,}/g,
    /gho_[a-zA-Z0-9]{20,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    /AIza[0-9A-Za-z-_]{35}/g,
    /bearer\s+[a-zA-Z0-9_\-\.]{24,}/gi
  ];

  public static scan(content: string): { hasSecret: boolean; patternMatched?: string } {
    if (!content) return { hasSecret: false };

    for (const pattern of this.SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        return {
          hasSecret: true,
          patternMatched: pattern.source
        };
      }
    }

    return { hasSecret: false };
  }

  public static redact(content: string): string {
    if (!content) return content;
    let result = content;
    for (const pattern of this.SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, "[REDACTED_SECRET]");
    }
    return result;
  }
}

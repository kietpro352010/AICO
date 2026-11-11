export interface SecretPatternDefinition {
  id: string;
  category: string;
  description: string;
  pattern: RegExp;
}

export interface SecretScanResult {
  hasSecret: boolean;
  secretId?: string;
  category?: string;
  patternMatched?: string;
}

/**
 * Explicit catalog of AICO platform, auth protocol, VCS, cloud, SaaS,
 * private key, credentialed URL, and env-assignment secret patterns.
 *
 * Ordering is load-bearing:
 * - HTTP Bearer precedes compact JWT so `"Bearer <jwt>"` redacts as one token.
 * - Anthropic `sk-ant-` precedes generic `sk-` for accurate classification.
 * - Multi-line PEM/PGP private key blocks precede single-line header fallbacks.
 */
export const AICO_SECRET_CATALOG: readonly SecretPatternDefinition[] = [
  {
    id: "aico_canonical_token",
    category: "aico_token",
    description: "Canonical AICO gateway, live, test, agent, or session credential token",
    pattern:
      /aico_(?:live_[a-zA-Z0-9_-]{16,}|(?:test|agent|session)_(?:[a-fA-F0-9]{24,}|(?=[a-zA-Z0-9_-]*\d)[a-zA-Z0-9_-]{16,}))/g
  },
  {
    id: "aico_legacy_agent_token",
    category: "aico_token",
    description: "Legacy AICO per-agent credential token (aico_<agentId>_<hex>)",
    pattern: /aico_[a-zA-Z0-9][a-zA-Z0-9._-]{0,40}_[a-fA-F0-9]{32,}/g
  },
  {
    id: "http_bearer_credential",
    category: "http_auth",
    description: "HTTP Bearer authorization credential",
    pattern:
      /[bB][eE][aA][rR][eE][rR]\s+(?=[A-Za-z0-9_\-.+/=]*(?:[0-9.+/=]|(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])))[a-zA-Z0-9_\-\.+/=]{24,}/g
  },
  {
    id: "http_basic_auth_header",
    category: "http_auth",
    description: "HTTP Authorization Basic credential header",
    pattern: /authorization\s*[:=]\s*basic\s+[A-Za-z0-9+/]{12,}={0,2}/gi
  },
  {
    id: "http_basic_auth_token",
    category: "http_auth",
    description: "HTTP Basic base64 credential token",
    pattern: /\bbasic\s+(?=[A-Za-z]*[0-9+/=])[A-Za-z0-9+/]{12,}={0,2}(?![A-Za-z0-9+/=_])/gi
  },
  {
    id: "jwt_compact_token",
    category: "jwt",
    description: "Signed compact JSON Web Token (JWS)",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.e[A-Za-z0-9_-]{9,}\.[A-Za-z0-9_-]{16,}\b/g
  },
  {
    id: "anthropic_api_key",
    category: "provider_api_key",
    description: "Anthropic API key (sk-ant-*)",
    pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g
  },
  {
    id: "openai_api_key",
    category: "provider_api_key",
    description: "OpenAI API key (sk-*, sk-proj-*, sk-svcacct-*)",
    pattern: /sk-[a-zA-Z0-9_-]{20,}/g
  },
  {
    id: "github_fine_grained_pat",
    category: "vcs_token",
    description: "GitHub fine-grained personal access token",
    pattern: /github_pat_[a-zA-Z0-9_]{22,}/g
  },
  {
    id: "github_oauth_pat",
    category: "vcs_token",
    description: "GitHub classic PAT, OAuth, user-to-server, or server-to-server token",
    pattern: /gh[pousr]_[a-zA-Z0-9]{20,}/g
  },
  {
    id: "google_gemini_api_key",
    category: "provider_api_key",
    description: "Google / Gemini API key (AIza*)",
    pattern: /AIza[0-9A-Za-z_-]{35}/g
  },
  {
    id: "aws_access_key_id",
    category: "cloud_credential",
    description: "AWS IAM/STS access key ID",
    pattern: /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g
  },
  {
    id: "slack_api_token",
    category: "saas_webhook_or_token",
    description: "Slack bot, user, app, or workspace token",
    pattern: /xox(?:a|b|p|r|s)-[0-9A-Za-z-]{10,}/g
  },
  {
    id: "slack_incoming_webhook",
    category: "saas_webhook_or_token",
    description: "Slack incoming webhook URL",
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,}\/B[a-zA-Z0-9_]{8,}\/[a-zA-Z0-9_]{16,}/gi
  },
  {
    id: "webhook_signing_secret",
    category: "saas_webhook_or_token",
    description: "Webhook endpoint signing secret (whsec_*)",
    pattern: /\bwhsec_[a-zA-Z0-9]{24,}\b/g
  },
  {
    id: "pem_private_key_block",
    category: "private_key",
    description: "Bounded PEM private key block",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{0,16384}?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
  },
  {
    id: "pgp_private_key_block",
    category: "private_key",
    description: "Bounded PGP private key block",
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]{0,16384}?-----END PGP PRIVATE KEY BLOCK-----/g
  },
  {
    id: "private_key_header",
    category: "private_key",
    description: "Single-line PEM or PGP private key header",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g
  },
  {
    id: "credentialed_service_url",
    category: "credentialed_url",
    description: "Service URL containing embedded userinfo credentials (preserves host and path)",
    pattern: /(?:https?|amqps?|postgres(?:ql)?|rediss?|mysql|mongodb(?:\+srv)?|wss?):\/\/[^/\s:@]+:[^/\s@]+@/gi
  },
  {
    id: "env_secret_assignment",
    category: "env_secret",
    description: "High-signal AICO or provider environment secret assignment",
    pattern:
      /(?<=\b(?:AICO_AUDIT_HMAC_KEY|AICO_STDIO_TOKEN|AICO_WEBHOOK_SECRET|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY)\s*[:=]\s*["']?)[A-Za-z0-9_+/!@#$%^&*.-]{16,}={0,2}/g
  }
];

export class SecretScanner {
  public static getCatalog(): readonly SecretPatternDefinition[] {
    return AICO_SECRET_CATALOG;
  }

  public static scan(content: string): SecretScanResult {
    if (!content) return { hasSecret: false };

    for (const entry of AICO_SECRET_CATALOG) {
      entry.pattern.lastIndex = 0;
      const matched = entry.pattern.test(content);
      entry.pattern.lastIndex = 0;
      if (matched) {
        return {
          hasSecret: true,
          secretId: entry.id,
          category: entry.category,
          patternMatched: entry.pattern.source
        };
      }
    }

    return { hasSecret: false };
  }

  public static redact(content: string): string {
    if (!content) return content;
    let result = content;
    for (const entry of AICO_SECRET_CATALOG) {
      entry.pattern.lastIndex = 0;
      result = result.replace(entry.pattern, "[REDACTED_SECRET]");
      entry.pattern.lastIndex = 0;
    }
    return result;
  }
}

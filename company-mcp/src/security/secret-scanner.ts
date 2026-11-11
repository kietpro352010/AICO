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

interface InternalSecretRuleSpec {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly source: string;
  readonly flags: string;
}

function freezeRuleSpec(
  id: string,
  category: string,
  description: string,
  pattern: RegExp
): InternalSecretRuleSpec {
  return Object.freeze({
    id,
    category,
    description,
    source: pattern.source,
    flags: pattern.flags
  });
}

/**
 * Module-private deeply frozen table of canonical secret rule specifications.
 * Only immutable primitive metadata (`source`, `flags`) is retained so neither
 * exported catalog snapshots nor caller-inspected `RegExp` objects can mutate
 * internal scanner behavior at runtime.
 *
 * Ordering is load-bearing:
 * - HTTP Bearer precedes compact JWT so `"Bearer <jwt>"` redacts as one token.
 * - Anthropic `sk-ant-` precedes generic `sk-` for accurate classification.
 * - Multi-line PEM/PGP private key blocks precede single-line header fallbacks.
 */
const INTERNAL_SECRET_RULES: readonly InternalSecretRuleSpec[] = Object.freeze([
  freezeRuleSpec(
    "aico_canonical_token",
    "aico_token",
    "Canonical AICO gateway, live, test, agent, or session credential token",
    /aico_(?:live_[a-zA-Z0-9_-]{16,}|(?:test|agent|session)_(?:[a-fA-F0-9]{24,}|(?=[a-zA-Z_-]{0,128}\d)[a-zA-Z0-9_-]{16,}))/g
  ),
  freezeRuleSpec(
    "aico_legacy_agent_token",
    "aico_token",
    "Legacy AICO per-agent credential token (aico_<agentId>_<hex>)",
    /aico_[a-zA-Z0-9][a-zA-Z0-9._-]{0,40}_[a-fA-F0-9]{32,}/g
  ),
  freezeRuleSpec(
    "http_bearer_credential",
    "http_auth",
    "HTTP Bearer authorization credential",
    /[bB][eE][aA][rR][eE][rR]\s+(?:(?=[A-Za-z_-]*[0-9.+/=])|(?=[A-Z0-9_-]*[a-z][a-z0-9_-]*[A-Z])|(?=[a-z0-9_-]*[A-Z][A-Z0-9_-]*[a-z]))[a-zA-Z0-9_\-\.+/=]{24,}/g
  ),
  freezeRuleSpec(
    "http_basic_auth_header",
    "http_auth",
    "HTTP Authorization Basic credential header",
    /authorization\s*[:=]\s*basic\s+[A-Za-z0-9+/]{12,}={0,2}/gi
  ),
  freezeRuleSpec(
    "http_basic_auth_token",
    "http_auth",
    "HTTP Basic base64 credential token",
    /\bbasic\s+(?=[A-Za-z]*[0-9+/=])[A-Za-z0-9+/]{12,}={0,2}(?![A-Za-z0-9+/=_])/gi
  ),
  freezeRuleSpec(
    "jwt_compact_token",
    "jwt",
    "Signed compact JSON Web Token (JWS)",
    /\beyJ[A-Za-z0-9_-]{8,}\.e[A-Za-z0-9_-]{9,}\.[A-Za-z0-9_-]{16,}\b/g
  ),
  freezeRuleSpec(
    "anthropic_api_key",
    "provider_api_key",
    "Anthropic API key (sk-ant-*)",
    /sk-ant-[a-zA-Z0-9_-]{20,}/g
  ),
  freezeRuleSpec(
    "openai_api_key",
    "provider_api_key",
    "OpenAI API key (sk-*, sk-proj-*, sk-svcacct-*)",
    /sk-[a-zA-Z0-9_-]{20,}/g
  ),
  freezeRuleSpec(
    "github_fine_grained_pat",
    "vcs_token",
    "GitHub fine-grained personal access token",
    /github_pat_[a-zA-Z0-9_]{22,}/g
  ),
  freezeRuleSpec(
    "github_oauth_pat",
    "vcs_token",
    "GitHub classic PAT, OAuth, user-to-server, or server-to-server token",
    /gh[pousr]_[a-zA-Z0-9]{20,}/g
  ),
  freezeRuleSpec(
    "google_gemini_api_key",
    "provider_api_key",
    "Google / Gemini API key (AIza*)",
    /AIza[0-9A-Za-z_-]{35}/g
  ),
  freezeRuleSpec(
    "aws_access_key_id",
    "cloud_credential",
    "AWS IAM/STS access key ID",
    /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g
  ),
  freezeRuleSpec(
    "slack_api_token",
    "saas_webhook_or_token",
    "Slack bot, user, app, or workspace token",
    /xox(?:a|b|p|r|s)-[0-9A-Za-z-]{10,}/g
  ),
  freezeRuleSpec(
    "slack_incoming_webhook",
    "saas_webhook_or_token",
    "Slack incoming webhook URL",
    /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,}\/B[a-zA-Z0-9_]{8,}\/[a-zA-Z0-9_]{16,}/gi
  ),
  freezeRuleSpec(
    "webhook_signing_secret",
    "saas_webhook_or_token",
    "Webhook endpoint signing secret (whsec_*)",
    /\bwhsec_[a-zA-Z0-9]{24,}\b/g
  ),
  freezeRuleSpec(
    "pem_private_key_block",
    "private_key",
    "Bounded PEM private key block",
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{0,16384}?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
  ),
  freezeRuleSpec(
    "pgp_private_key_block",
    "private_key",
    "Bounded PGP private key block",
    /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]{0,16384}?-----END PGP PRIVATE KEY BLOCK-----/g
  ),
  freezeRuleSpec(
    "private_key_header",
    "private_key",
    "Single-line PEM or PGP private key header",
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g
  ),
  freezeRuleSpec(
    "credentialed_service_url",
    "credentialed_url",
    "Service URL containing embedded userinfo credentials (preserves host and path)",
    /(?:https?|amqps?|postgres(?:ql)?|rediss?|mysql|mongodb(?:\+srv)?|wss?):\/\/[^/\s:@]+:[^/\s@]+@/gi
  ),
  freezeRuleSpec(
    "env_secret_assignment",
    "env_secret",
    "High-signal AICO or provider environment secret assignment",
    /(?<=\b(?:AICO_AUDIT_HMAC_KEY|AICO_STDIO_TOKEN|AICO_WEBHOOK_SECRET|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY)\s*[:=]\s*["']?)[A-Za-z0-9_+/!@#$%^&*.-]{16,}={0,2}/g
  )
]);

function createFrozenCatalogSnapshot(): readonly SecretPatternDefinition[] {
  return Object.freeze(
    INTERNAL_SECRET_RULES.map((rule) =>
      Object.freeze({
        id: rule.id,
        category: rule.category,
        description: rule.description,
        // Fresh non-frozen RegExp clone: callers can run .test()/.replace() on /g without
        // hitting V8 strict-mode `lastIndex` read-only errors, while remaining isolated.
        pattern: new RegExp(rule.source, rule.flags)
      })
    )
  );
}

/**
 * Frozen defensive snapshot of the AICO secret pattern catalog.
 * Mutating any `RegExp` on this snapshot cannot affect `SecretScanner` or `getCatalog()`.
 */
export const AICO_SECRET_CATALOG: readonly SecretPatternDefinition[] = createFrozenCatalogSnapshot();

export class SecretScanner {
  public static getCatalog(): readonly SecretPatternDefinition[] {
    return createFrozenCatalogSnapshot();
  }

  public static scan(content: string): SecretScanResult {
    if (!content) return { hasSecret: false };

    for (const rule of INTERNAL_SECRET_RULES) {
      const pattern = new RegExp(rule.source, rule.flags);
      if (pattern.test(content)) {
        return {
          hasSecret: true,
          secretId: rule.id,
          category: rule.category,
          patternMatched: rule.source
        };
      }
    }

    return { hasSecret: false };
  }

  public static redact(content: string): string {
    if (!content) return content;
    let result = content;
    for (const rule of INTERNAL_SECRET_RULES) {
      const pattern = new RegExp(rule.source, rule.flags);
      result = result.replace(pattern, "[REDACTED_SECRET]");
    }
    return result;
  }
}

import { z } from "zod";
import { SecretScanner } from "../security/secret-scanner.js";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeAllowlistedValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === "string") {
    return SecretScanner.redact(value);
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return seen.get(value);
    }

    if (Array.isArray(value)) {
      const cleanArray: unknown[] = [];
      seen.set(value, cleanArray);
      for (const item of value) {
        cleanArray.push(sanitizeAllowlistedValue(item, seen));
      }
      return cleanArray;
    }

    const cleanObj: Record<string, unknown> = {};
    seen.set(value, cleanObj);
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }
      Object.defineProperty(cleanObj, key, {
        value: sanitizeAllowlistedValue((value as Record<string, unknown>)[key], seen),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return cleanObj;
  }
  return value;
}

/**
 * Redacts known secret patterns from a nullable or required public text field.
 * Non-string values (e.g. unparsed type-confused payloads) pass through untouched
 * so strict DTO schemas fail closed with a ZodError.
 */
export function redactPublicString(value: string): string;
export function redactPublicString(value: string | null): string | null;
export function redactPublicString(value: string | null): string | null {
  if (value === null || typeof value !== "string") {
    return value;
  }
  return SecretScanner.redact(value);
}

/**
 * Redacts known secret patterns from each string element in a public string array.
 * Non-array inputs or non-string items pass through untouched so strict DTO schemas fail closed.
 */
export function redactPublicStringArray(values: readonly string[]): string[] {
  if (!Array.isArray(values)) {
    return values as unknown as string[];
  }
  return values.map((item) => (typeof item === "string" ? SecretScanner.redact(item) : item));
}

/**
 * Attaches a fail-closed secret-detection refinement to a Zod string schema so
 * sensitive credentials cannot enter public text fields.
 */
export function noSecretText(schema: z.ZodString, fieldName?: string): z.ZodString {
  return schema.superRefine((val, ctx) => {
    const scan = SecretScanner.scan(val);
    if (scan.hasSecret) {
      ctx.addIssue({
        code: "custom",
        message: `SECRET_LEAK_PREVENTED: ${fieldName ?? "Public text"} cannot contain sensitive credentials (${scan.secretId ?? scan.patternMatched})`
      });
    }
  });
}

/**
 * Direct caller guard asserting that a public text string contains no known secret patterns.
 * Throws an Error prefixed with `SECRET_LEAK_PREVENTED:` when a credential is detected.
 */
export function assertNoSecretInPublicText(value: string, fieldName?: string): void {
  const scan = SecretScanner.scan(value);
  if (scan.hasSecret) {
    throw new Error(
      `SECRET_LEAK_PREVENTED: ${fieldName ?? "Public text"} cannot contain sensitive credentials (${scan.secretId ?? scan.patternMatched})`
    );
  }
}

function assertNoSecretInValueRecursive(
  value: unknown,
  fieldPath: string | undefined,
  seen: WeakSet<object>
): void {
  if (typeof value === "string") {
    assertNoSecretInPublicText(value, fieldPath);
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const childPath = fieldPath ? `${fieldPath}[${i}]` : `[${i}]`;
      assertNoSecretInValueRecursive(value[i], childPath, seen);
    }
    return;
  }

  if (value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value)) {
    return;
  }

  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }
    const childPath = fieldPath ? `${fieldPath}.${key}` : key;
    assertNoSecretInValueRecursive((value as Record<string, unknown>)[key], childPath, seen);
  }
}

/**
 * Recursively validates strings, arrays, and plain records against `SecretScanner`
 * for pre-flight checks on public payloads while safely skipping dangerous keys
 * and handling cyclic references.
 */
export function assertNoSecretInValue(value: unknown, fieldPath?: string): void {
  assertNoSecretInValueRecursive(value, fieldPath, new WeakSet<object>());
}

/**
 * Projects a record onto an explicit allowlist of own keys.
 * Redacts known secret patterns in allowlisted strings and string array items,
 * while keeping non-string values intact so strict Zod schemas fail closed on type confusion.
 */
export function projectPublicAllowlistedRecord(
  source: Record<string, unknown> | undefined | null,
  allowedKeys: readonly string[]
): Record<string, unknown> {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  const projected: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }
    const rawValue = source[key];
    if (rawValue === undefined) {
      continue;
    }
    Object.defineProperty(projected, key, {
      value: sanitizeAllowlistedValue(rawValue),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }

  return projected;
}

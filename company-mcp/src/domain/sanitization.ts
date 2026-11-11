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
 */
export function redactPublicString(value: string): string;
export function redactPublicString(value: string | null): string | null;
export function redactPublicString(value: string | null): string | null {
  return value === null ? null : SecretScanner.redact(value);
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

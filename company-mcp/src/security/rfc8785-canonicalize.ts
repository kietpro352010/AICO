import * as crypto from "node:crypto";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) Implementation.
 * Provides deterministic canonical serialization across arbitrary nesting depths.
 * Compliant with RFC 8785 / RFC 8259 JSON Data Model:
 * - Rejects data outside the JSON data model (Functions, Symbols, BigInts, Dates, RegExp, Maps, Sets, undefined)
 * - Rejects non-finite numbers (NaN, Infinity, -Infinity)
 * - Rejects strings and object keys with lone/unpaired surrogates
 * - Normalizes -0 to 0
 * - Formats numbers strictly per ECMAScript ToString(Number) (RFC 8785 Section 3.2.2.3)
 * - Deterministic UTF-16 code unit key sorting at all object depths
 * - Strict whitespace stripping
 * - Preserves array element order
 * - Sparse array holes serialize as null per RFC 8785 / ECMAScript; explicit undefined in arrays is rejected
 * - Circular structure detection
 */

function hasLoneSurrogate(str: string): boolean {
  if (typeof (str as any).isWellFormed === "function") {
    return !(str as any).isWellFormed();
  }
  return /(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(str);
}

export function rfc8785Canonicalize(data: unknown, seen = new Set<unknown>()): string {
  if (data === null) {
    return "null";
  }

  const type = typeof data;

  if (type === "boolean") {
    return data ? "true" : "false";
  }

  if (type === "number") {
    const num = data as number;
    if (!Number.isFinite(num)) {
      throw new TypeError("RFC 8785: Non-finite numbers (NaN, Infinity) are not permitted in JSON data model");
    }
    if (Object.is(num, -0)) {
      return "0";
    }
    return String(num);
  }

  if (type === "string") {
    const str = data as string;
    if (hasLoneSurrogate(str)) {
      throw new TypeError("RFC 8785: Lone surrogate code point detected in string");
    }
    return JSON.stringify(data);
  }

  if (type === "object") {
    if (seen.has(data)) {
      throw new TypeError("RFC 8785: Circular reference detected during canonicalization");
    }
    seen.add(data);

    try {
      if (Array.isArray(data)) {
        const items: string[] = [];
        for (let i = 0; i < data.length; i++) {
          // Sparse array hole: missing index (!(i in data)) serializes as null per RFC 8785 / ECMAScript
          if (!(i in data)) {
            items.push("null");
          } else if (data[i] === undefined) {
            // Explicit undefined is outside the JSON data model
            throw new TypeError(`RFC 8785: Element at index ${i} is undefined, which is outside JSON data model`);
          } else if (data[i] === null) {
            items.push("null");
          } else {
            const item = data[i];
            const itemType = typeof item;
            if (itemType === "function" || itemType === "symbol" || itemType === "bigint") {
              throw new TypeError(`RFC 8785: Element at index ${i} has unsupported type '${itemType}' outside JSON data model`);
            }
            items.push(rfc8785Canonicalize(item, seen));
          }
        }
        return "[" + items.join(",") + "]";
      }

      // Check for non-plain objects outside the JSON data model (Date, RegExp, Map, Set, Error, Buffer, etc.)
      const proto = Object.getPrototypeOf(data);
      if (proto !== null && proto !== Object.prototype) {
        const ctorName = (data as any)?.constructor?.name || typeof data;
        throw new TypeError(`RFC 8785: Object of type '${ctorName}' is outside JSON data model`);
      }

      // Plain Object: sort keys in ascending order by UTF-16 code units (lexicographical)
      const keys = Object.keys(data as Record<string, unknown>).sort((a, b) => {
        return a < b ? -1 : a > b ? 1 : 0;
      });

      const entries: string[] = [];
      for (const key of keys) {
        if (hasLoneSurrogate(key)) {
          throw new TypeError("RFC 8785: Lone surrogate code point detected in object key");
        }
        const val = (data as Record<string, unknown>)[key];
        const valType = typeof val;

        // Reject properties outside JSON data model
        if (val === undefined) {
          throw new TypeError(`RFC 8785: Property '${key}' is undefined, which is outside JSON data model`);
        }
        if (valType === "function" || valType === "symbol" || valType === "bigint") {
          throw new TypeError(`RFC 8785: Property '${key}' has unsupported type '${valType}' outside JSON data model`);
        }

        entries.push(JSON.stringify(key) + ":" + rfc8785Canonicalize(val, seen));
      }
      return "{" + entries.join(",") + "}";
    } finally {
      seen.delete(data);
    }
  }

  throw new TypeError(`RFC 8785: Unsupported data type '${type}' outside JSON data model`);
}

export function computeCanonicalPayloadSha256(payload: unknown): string {
  const canonical = rfc8785Canonicalize(payload);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

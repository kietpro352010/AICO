/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) Implementation.
 * Provides deterministic canonical serialization across arbitrary nesting depths.
 * Compliant with RFC 8785:
 * - Deterministic UTF-16 code unit key sorting at all object depths
 * - Strict whitespace stripping
 * - Preserved array element order
 * - IEEE 754 number formatting, -0 normalized to 0, non-finite numbers rejected
 * - Circular structure detection
 */

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
      throw new TypeError("RFC 8785: Non-finite numbers (NaN, Infinity) are not permitted in canonical JSON");
    }
    if (Object.is(num, -0)) {
      return "0";
    }
    return String(num);
  }

  if (type === "string") {
    return JSON.stringify(data);
  }

  if (type === "object") {
    if (seen.has(data)) {
      throw new TypeError("RFC 8785: Circular reference detected during canonicalization");
    }
    seen.add(data);

    try {
      if (Array.isArray(data)) {
        const items = data.map((item) => {
          if (item === undefined || typeof item === "function" || typeof item === "symbol") {
            return "null";
          }
          return rfc8785Canonicalize(item, seen);
        });
        return "[" + items.join(",") + "]";
      }

      // Plain Object: sort keys in ascending order by UTF-16 code units
      const keys = Object.keys(data as Record<string, unknown>).sort((a, b) => {
        return a < b ? -1 : a > b ? 1 : 0;
      });

      const entries: string[] = [];
      for (const key of keys) {
        const val = (data as Record<string, unknown>)[key];
        if (val === undefined || typeof val === "function" || typeof val === "symbol") {
          continue; // JSON.stringify omits undefined/function/symbol properties in objects
        }
        entries.push(JSON.stringify(key) + ":" + rfc8785Canonicalize(val, seen));
      }
      return "{" + entries.join(",") + "}";
    } finally {
      seen.delete(data);
    }
  }

  throw new TypeError(`RFC 8785: Unsupported data type '${type}' for canonicalization`);
}

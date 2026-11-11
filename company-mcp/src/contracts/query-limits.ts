export const MIN_QUERY_LIMIT = 1;
export const MAX_QUERY_LIMIT = 100;
export const DEFAULT_QUERY_LIMIT = 50;

/**
 * Validates and normalizes list-query limits so direct service calls cannot
 * disable SQL LIMIT via 0 or -1 or request unbounded result sets.
 */
export function normalizeBoundedLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_QUERY_LIMIT;
  }
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < MIN_QUERY_LIMIT ||
    limit > MAX_QUERY_LIMIT
  ) {
    throw new Error(
      `VALIDATION_ERROR: limit must be an integer between ${MIN_QUERY_LIMIT} and ${MAX_QUERY_LIMIT}`
    );
  }
  return limit;
}

import { AsyncLocalStorage } from "node:async_hooks";

export interface PrincipalContext {
  readonly authenticated: boolean;
  readonly principalType: "human" | "agent" | "service";
  readonly principalId: string;
  readonly displayName: string;
  readonly agentId: string | null;
  readonly credentialId: string;
  readonly role: string;
  readonly department: string;
  readonly scopes: ReadonlySet<string>;
  readonly accessProfile: "human_owner" | "local_agent_physical" | "web_agent_logical" | "system_service";
  readonly workspaceId: string | null;
  readonly allowPublicGateway: boolean;
  readonly sourceGateway: "local" | "public" | "stdio";
  readonly requestId: string;
  readonly authenticatedAt: string;
  readonly error?: string;
}

export const requestContextStore = new AsyncLocalStorage<PrincipalContext>();

export function getRequestContext(): PrincipalContext | undefined {
  return requestContextStore.getStore();
}

export function requireRequestContext(): PrincipalContext {
  const ctx = requestContextStore.getStore();
  if (!ctx || !ctx.authenticated) {
    throw new Error("AUTH_MISSING_OR_INVALID_TOKEN: Request is unauthenticated or missing security context");
  }
  return ctx;
}

export function assertAuthenticatedContext(
  ctx: PrincipalContext | null | undefined,
  operation: string,
  options?: { allowedPrincipalTypes?: Array<"human" | "agent" | "service"> }
): asserts ctx is PrincipalContext {
  if (!ctx || ctx.authenticated !== true) {
    throw new Error(`AUTHENTICATION_REQUIRED: ${operation} requires an authenticated PrincipalContext (ctx.authenticated must be true)`);
  }
  if (typeof ctx.principalId !== "string" || ctx.principalId.trim().length === 0) {
    throw new Error(`AUTHENTICATION_REQUIRED: ${operation} requires an authenticated PrincipalContext (valid principalId is required)`);
  }
  if (ctx.principalType !== "human" && ctx.principalType !== "agent" && ctx.principalType !== "service") {
    throw new Error(`AUTHENTICATION_REQUIRED: ${operation} requires an authenticated PrincipalContext (valid principalType 'human' | 'agent' | 'service' is required)`);
  }
  if (options?.allowedPrincipalTypes && !options.allowedPrincipalTypes.includes(ctx.principalType)) {
    throw new Error(
      `PERMISSION_DENIED: ${operation} restricted to principal types [${options.allowedPrincipalTypes.join(", ")}] (got '${ctx.principalType}')`
    );
  }
}

export function isFounderHuman(ctx: PrincipalContext | null | undefined): boolean {
  return Boolean(
    ctx &&
      ctx.authenticated === true &&
      ctx.principalType === "human" &&
      ctx.principalId === "founder-01" &&
      ctx.agentId === null
  );
}

export function isExecutiveLeadership(ctx: PrincipalContext | null | undefined): boolean {
  if (!ctx || ctx.authenticated !== true) return false;
  if (isFounderHuman(ctx)) return true;
  return (
    ctx.principalType === "agent" &&
    ctx.agentId === ctx.principalId &&
    (ctx.principalId === "flash-01" || ctx.principalId === "chatgpt-01")
  );
}

export function isReviewLeadership(ctx: PrincipalContext | null | undefined): boolean {
  if (isExecutiveLeadership(ctx)) return true;
  return Boolean(
    ctx &&
      ctx.authenticated === true &&
      ctx.principalType === "agent" &&
      ctx.agentId === ctx.principalId &&
      ctx.principalId === "flash-02"
  );
}

export function isArchiveLeadership(ctx: PrincipalContext | null | undefined): boolean {
  if (isFounderHuman(ctx)) return true;
  return Boolean(
    ctx &&
      ctx.authenticated === true &&
      ctx.principalType === "agent" &&
      ctx.agentId === ctx.principalId &&
      ctx.principalId === "flash-01"
  );
}

export function hasPrincipalScope(ctx: PrincipalContext | null | undefined, scope: string): boolean {
  if (!ctx || ctx.authenticated !== true || !ctx.scopes) return false;
  const scopesLike = ctx.scopes as unknown as { has?: (s: string) => boolean };
  if (typeof scopesLike.has !== "function") return false;
  return scopesLike.has("*") || scopesLike.has(scope);
}

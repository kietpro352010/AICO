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

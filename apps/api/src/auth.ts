import { AsterError } from "../../../packages/core/src/errors.ts";
import type { AsterIncomingRequest } from "./http.ts";

export interface AuthenticatedPrincipal {
  readonly actorId: string;
  readonly tenantId: string;
  readonly scopes: readonly string[];
}

export interface AsterAuthAdapter {
  authenticate(request: AsterIncomingRequest): Promise<AuthenticatedPrincipal>;
}

/** Development-only adapter. Production must supply an OIDC/JWT-verifying adapter. */
export const createDevelopmentAuthAdapter = (): AsterAuthAdapter => ({
  async authenticate(request) {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new AsterError("AUTHENTICATION_REQUIRED", 401, "Authentication is required.");
    }
    const actorId = authorization.slice("Bearer ".length);
    const tenantId = request.headers["x-tenant-id"]?.toString();
    if (!actorId || !tenantId) throw new AsterError("AUTHENTICATION_REQUIRED", 401, "Authentication is required.");
    return { actorId, tenantId, scopes: ["*"] };
  }
});

export const assertScope = (principal: AuthenticatedPrincipal, requiredScope: string): void => {
  if (!principal.scopes.includes("*") && !principal.scopes.includes(requiredScope)) {
    throw new AsterError("TENANT_SCOPE_DENIED", 403, "Request is not authorized for this operation.");
  }
};

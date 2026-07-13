import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AsterError } from "../../../packages/core/src/errors.ts";
import { AsterService } from "../../../packages/core/src/service.ts";
import type { RequestContext } from "../../../packages/core/src/types.ts";
import { CryptoIdGenerator, InMemoryAsterStore, SystemClock } from "../../../packages/adapters/src/memory-store.ts";
import { PostgresAsterStore } from "../../../packages/adapters/src/postgres-store.ts";
import { assertScope, createDevelopmentAuthAdapter, type AsterAuthAdapter } from "./auth.ts";

export interface AsterServerOptions {
  readonly service?: AsterService;
  readonly authAdapter?: AsterAuthAdapter;
  readonly readiness?: () => Promise<boolean>;
  /** Production hosts assert that the injected service uses durable storage. */
  readonly durableStorage?: boolean;
}

export type AsterIncomingRequest = AsyncIterable<Buffer | string> & {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: IncomingMessage["headers"];
};

export interface AsterOutgoingResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: string): void;
}

let defaultService: AsterService | undefined;

export const createAsterServer = (options: AsterServerOptions = {}) => {
  assertRuntimeSafety(options);
  const service = options.service ?? getDefaultService();
  return createServer((request, response) => {
    void handleAsterRequest(service, request, response, options.authAdapter ?? createDevelopmentAuthAdapter(), options.readiness);
  });
};

export const handleAsterRequest = async (
  service: AsterService,
  request: AsterIncomingRequest,
  response: AsterOutgoingResponse,
  authAdapter: AsterAuthAdapter = createDevelopmentAuthAdapter(),
  readiness?: () => Promise<boolean>
): Promise<void> => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, { data: { ok: true } });
    }
    if (request.method === "GET" && url.pathname === "/ready") {
      const ready = await (readiness?.() ?? Promise.resolve(true));
      return send(response, ready ? 200 : 503, { data: { ready } });
    }
    if (request.method === "POST" && url.pathname === "/v1/personas") {
      return send(response, 201, { data: await service.createPersona(await contextFrom(request, authAdapter, "aster:personas:write"), parseCreatePersona(await readJson(request))) });
    }
    const versionMatch = url.pathname.match(/^\/v1\/personas\/([^/]+)\/versions$/);
    if (request.method === "POST" && versionMatch?.[1]) {
      return send(response, 201, {
        data: await service.createVersion(await contextFrom(request, authAdapter, "aster:personas:write"), {
          personaId: versionMatch[1],
          contract: parseCreateVersion(await readJson(request)).contract
        })
      });
    }
    const publishMatch = url.pathname.match(/^\/v1\/personas\/([^/]+)\/versions\/([0-9]+)\/publish$/);
    if (request.method === "POST" && publishMatch?.[1] && publishMatch[2]) {
      return send(response, 200, {
        data: await service.publishVersion(await contextFrom(request, authAdapter, "aster:personas:publish"), {
          personaId: publishMatch[1],
          version: Number(publishMatch[2])
        })
      });
    }
    const compileMatch = url.pathname.match(/^\/v1\/personas\/([^/]+)\/versions\/([0-9]+)\/compile$/);
    if (request.method === "POST" && compileMatch?.[1] && compileMatch[2]) {
      return send(response, 200, {
        data: await service.compileVersion(await contextFrom(request, authAdapter, "aster:personas:compile"), {
          personaId: compileMatch[1],
          version: Number(compileMatch[2])
        })
      });
    }
    const diffMatch = url.pathname.match(/^\/v1\/personas\/([^/]+)\/versions\/([0-9]+)\/diff\/([0-9]+)$/);
    if (request.method === "GET" && diffMatch?.[1] && diffMatch[2] && diffMatch[3]) {
      return send(response, 200, {
        data: await service.diffVersions(await contextFrom(request, authAdapter, "aster:personas:read"), {
          personaId: diffMatch[1],
          fromVersion: Number(diffMatch[2]),
          toVersion: Number(diffMatch[3])
        })
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/plugins/validate") {
      return send(response, 200, { data: await service.validatePlugin(await contextFrom(request, authAdapter, "aster:plugins:write"), await readJson(request)) });
    }
    return send(response, 404, { error: { code: "RESOURCE_NOT_FOUND", message: "Route was not found." } });
  } catch (error) {
    if (error instanceof AsterError) {
      return send(response, error.status, { error: { code: error.code, message: error.message, details: error.details } });
    }
    return send(response, 500, { error: { code: "INTERNAL_ERROR", message: "Unexpected failure." } });
  }
};

const getDefaultService = (): AsterService => {
  if (defaultService) return defaultService;
  const store = process.env.DATABASE_URL ? new PostgresAsterStore(process.env.DATABASE_URL) : new InMemoryAsterStore();
  defaultService = new AsterService({
    repository: store,
    plugins: store,
    idempotency: store,
    audit: store,
    clock: new SystemClock(),
    ids: new CryptoIdGenerator(),
    transactions: store
  });
  return defaultService;
};

const contextFrom = async (request: AsterIncomingRequest, authAdapter: AsterAuthAdapter, requiredScope: string): Promise<RequestContext> => {
  const principal = await authAdapter.authenticate(request);
  assertScope(principal, requiredScope);
  const requestedTenantId = request.headers["x-tenant-id"]?.toString();
  if (requestedTenantId && requestedTenantId !== principal.tenantId) {
    throw new AsterError("TENANT_SCOPE_DENIED", 403, "Request cannot access this resource.");
  }
  const idempotencyKey = request.headers["idempotency-key"]?.toString();
  return {
    tenantId: principal.tenantId,
    actorId: principal.actorId,
    correlationId: request.headers["x-correlation-id"]?.toString() ?? "corr_dev",
    ...(idempotencyKey ? { idempotencyKey } : {})
  };
};

const assertRuntimeSafety = (options: AsterServerOptions): void => {
  if (process.env.NODE_ENV !== "production") return;
  if (!options.authAdapter) throw new Error("Production startup requires an explicit production auth adapter.");
  if (!process.env.DATABASE_URL) throw new Error("Production startup requires DATABASE_URL.");
  if (!options.durableStorage) throw new Error("Production startup requires a durable storage assertion.");
  const host = process.env.HOST;
  if (!host || host === "0.0.0.0" || host === "::") throw new Error("Production startup requires an explicit non-wildcard HOST.");
};

const readJson = async (request: AsterIncomingRequest): Promise<Record<string, unknown>> => {
  const contentType = request.headers["content-type"]?.toString();
  if (request.method !== "GET" && contentType !== undefined && !contentType.includes("application/json")) {
    throw new AsterError("VALIDATION_FAILED", 422, "Request validation failed.", ["content-type must be application/json"]);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AsterError("VALIDATION_FAILED", 422, "Request validation failed.", ["body must be a JSON object"]);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AsterError) throw error;
    throw new AsterError("VALIDATION_FAILED", 422, "Request validation failed.", ["body must be valid JSON"]);
  }
};

const parseCreatePersona = (body: Record<string, unknown>): { readonly name: string } => {
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new AsterError("VALIDATION_FAILED", 422, "Request validation failed.", ["name is required"]);
  }
  return { name: body.name };
};

const parseCreateVersion = (body: Record<string, unknown>): { readonly contract: unknown } => {
  if (!Object.hasOwn(body, "contract")) {
    throw new AsterError("VALIDATION_FAILED", 422, "Request validation failed.", ["contract is required"]);
  }
  return { contract: body.contract };
};

const send = (response: AsterOutgoingResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

if (process.argv[1]?.endsWith("http.ts") || process.argv[1]?.endsWith("http.js")) {
  const port = Number(process.env.PORT ?? "3000");
  const host = process.env.HOST ?? "127.0.0.1";
  createAsterServer().listen(port, host, () => {
    process.stdout.write(`ASTER API listening on ${port}\n`);
  });
}

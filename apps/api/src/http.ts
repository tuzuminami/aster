import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AsterError } from "../../../packages/core/src/errors.ts";
import { AsterService } from "../../../packages/core/src/service.ts";
import type { RequestContext } from "../../../packages/core/src/types.ts";
import { InMemoryAsterStore, SequentialIdGenerator, SystemClock } from "../../../packages/adapters/src/memory-store.ts";
import { PostgresAsterStore } from "../../../packages/adapters/src/postgres-store.ts";

const store = process.env.DATABASE_URL ? new PostgresAsterStore(process.env.DATABASE_URL) : new InMemoryAsterStore();
const service = new AsterService({
  repository: store,
  plugins: store,
  idempotency: store,
  audit: store,
  clock: new SystemClock(),
  ids: new SequentialIdGenerator()
});

export const createAsterServer = () =>
  createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        return send(response, 200, { data: { ok: true } });
      }
      if (request.method === "POST" && url.pathname === "/v1/personas") {
        return send(response, 201, { data: await service.createPersona(contextFrom(request), parseCreatePersona(await readJson(request))) });
      }
      const versionMatch = url.pathname.match(/^\/v1\/personas\/([^/]+)\/versions$/);
      if (request.method === "POST" && versionMatch?.[1]) {
        return send(response, 201, {
          data: await service.createVersion(contextFrom(request), {
            personaId: versionMatch[1],
            contract: parseCreateVersion(await readJson(request)).contract
          })
        });
      }
      const publishMatch = url.pathname.match(/^\/v1\/personas\/([^/]+)\/versions\/([0-9]+)\/publish$/);
      if (request.method === "POST" && publishMatch?.[1] && publishMatch[2]) {
        return send(response, 200, {
          data: await service.publishVersion(contextFrom(request), {
            personaId: publishMatch[1],
            version: Number(publishMatch[2])
          })
        });
      }
      const compileMatch = url.pathname.match(/^\/v1\/personas\/([^/]+)\/versions\/([0-9]+)\/compile$/);
      if (request.method === "POST" && compileMatch?.[1] && compileMatch[2]) {
        return send(response, 200, {
          data: await service.compileVersion(contextFrom(request), {
            personaId: compileMatch[1],
            version: Number(compileMatch[2])
          })
        });
      }
      const diffMatch = url.pathname.match(/^\/v1\/personas\/([^/]+)\/versions\/([0-9]+)\/diff\/([0-9]+)$/);
      if (request.method === "GET" && diffMatch?.[1] && diffMatch[2] && diffMatch[3]) {
        return send(response, 200, {
          data: await service.diffVersions(contextFrom(request), {
            personaId: diffMatch[1],
            fromVersion: Number(diffMatch[2]),
            toVersion: Number(diffMatch[3])
          })
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/plugins/validate") {
        return send(response, 200, { data: await service.validatePlugin(contextFrom(request), await readJson(request)) });
      }
      return send(response, 404, { error: { code: "RESOURCE_NOT_FOUND", message: "Route was not found." } });
    } catch (error) {
      if (error instanceof AsterError) {
        return send(response, error.status, { error: { code: error.code, message: error.message, details: error.details } });
      }
      return send(response, 500, { error: { code: "INTERNAL_ERROR", message: "Unexpected failure." } });
    }
  });

const contextFrom = (request: IncomingMessage): RequestContext => {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    throw new AsterError("AUTHENTICATION_REQUIRED", 401, "Authentication is required.");
  }
  const tenantId = header(request, "x-tenant-id");
  const actorId = auth.slice("Bearer ".length);
  if (actorId.length === 0) throw new AsterError("AUTHENTICATION_REQUIRED", 401, "Authentication is required.");
  const idempotencyKey = request.headers["idempotency-key"]?.toString();
  return {
    tenantId,
    actorId,
    correlationId: request.headers["x-correlation-id"]?.toString() ?? "corr_dev",
    ...(idempotencyKey ? { idempotencyKey } : {})
  };
};

const header = (request: IncomingMessage, name: string): string => {
  const value = request.headers[name]?.toString();
  if (!value) throw new AsterError("TENANT_SCOPE_DENIED", 403, "Request cannot access this resource.");
  return value;
};

const readJson = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
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

const send = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

if (process.argv[1]?.endsWith("http.ts") || process.argv[1]?.endsWith("http.js")) {
  const port = Number(process.env.PORT ?? "3000");
  createAsterServer().listen(port, () => {
    process.stdout.write(`ASTER API listening on ${port}\n`);
  });
}

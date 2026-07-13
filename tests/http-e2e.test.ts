import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAsterServer, handleAsterRequest, type AsterIncomingRequest, type AsterOutgoingResponse } from "../apps/api/src/http.ts";
import type { AsterAuthAdapter } from "../apps/api/src/auth.ts";
import {
  AsterError,
  AsterService,
  type PersonaContract,
  type PluginManifest,
  type PluginReference,
  type PluginRegistry
} from "../packages/core/src/index.ts";
import { DeterministicClock, InMemoryAsterStore, SequentialIdGenerator } from "../packages/adapters/src/memory-store.ts";

test("AT-AST-013 HTTP flow enforces headers and compiles deterministically", async () => {
  const { service } = makeService();
  {
    const health = await requestJson(service, "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { data: { ok: true } });

    const missingAuth = await requestJson(service, "/v1/personas", {
      method: "POST",
      body: { name: "Tutor" },
      headers: { "x-tenant-id": "tenant_http", "idempotency-key": "missing-auth" }
    });
    assert.equal(missingAuth.status, 401);

    const missingIdempotency = await requestJson(service, "/v1/personas", {
      method: "POST",
      body: { name: "Tutor" },
      headers: authHeaders()
    });
    assert.equal(missingIdempotency.status, 409);

    const created = await requestJson(service, "/v1/personas", {
      method: "POST",
      body: { name: "Tutor" },
      headers: authHeaders({ idempotencyKey: "create-persona" })
    });
    assert.equal(created.status, 201);
    const personaId = readDataRecord(created.body).id;
    assert.equal(typeof personaId, "string");

    const changedPayload = await requestJson(service, "/v1/personas", {
      method: "POST",
      body: { name: "Different Tutor" },
      headers: authHeaders({ idempotencyKey: "create-persona" })
    });
    assert.equal(changedPayload.status, 409);

    const version = await requestJson(service, `/v1/personas/${personaId}/versions`, {
      method: "POST",
      body: { contract },
      headers: authHeaders({ idempotencyKey: "create-version" })
    });
    assert.equal(version.status, 201);
    assert.equal(readDataRecord(version.body).status, "draft");

    const otherTenant = await requestJson(service, `/v1/personas/${personaId}/versions`, {
      method: "POST",
      body: { contract },
      headers: authHeaders({ tenantId: "tenant_other", idempotencyKey: "wrong-tenant" })
    });
    assert.equal(otherTenant.status, 404);

    const draftCompile = await requestJson(service, `/v1/personas/${personaId}/versions/1/compile`, {
      method: "POST",
      headers: authHeaders({ idempotencyKey: "compile-draft" })
    });
    assert.equal(draftCompile.status, 409);

    const published = await requestJson(service, `/v1/personas/${personaId}/versions/1/publish`, {
      method: "POST",
      headers: authHeaders({ idempotencyKey: "publish-version" })
    });
    assert.equal(published.status, 200);

    const firstCompile = await requestJson(service, `/v1/personas/${personaId}/versions/1/compile`, {
      method: "POST",
      headers: authHeaders({ idempotencyKey: "compile-version" })
    });
    assert.equal(firstCompile.status, 200);
    const replayedCompile = await requestJson(service, `/v1/personas/${personaId}/versions/1/compile`, {
      method: "POST",
      headers: authHeaders({ idempotencyKey: "compile-version-replay" })
    });
    assert.equal(replayedCompile.status, 200);
    assert.deepEqual(replayedCompile.body, firstCompile.body);

    await requestJson(service, `/v1/personas/${personaId}/versions`, {
      method: "POST",
      body: {
        contract: {
          ...contract,
          components: [...contract.components, { id: "extra", type: "instruction", body: "Ask one follow-up." }]
        }
      },
      headers: authHeaders({ idempotencyKey: "create-version-two" })
    });
    const diff = await requestJson(service, `/v1/personas/${personaId}/versions/1/diff/2`, {
      headers: authHeaders()
    });
    assert.equal(diff.status, 200);
    assert.deepEqual(readDataRecord(diff.body).changedComponents, ["extra"]);
  }
});

test("AT-AST-014 HTTP compile fails closed when plugin becomes incompatible", async () => {
  const plugins = new MutablePluginRegistry();
  const { service } = makeService(plugins);

  const acceptedPlugin = await requestJson(service, "/v1/plugins/validate", {
    method: "POST",
    body: {
      name: "renderer",
      version: "1.0.0",
      capabilities: ["renderer"],
      coreApiVersion: "v1",
      enabled: true
    },
    headers: authHeaders({ idempotencyKey: "plugin-validate" })
  });
  assert.equal(acceptedPlugin.status, 200);

  const created = await requestJson(service, "/v1/personas", {
    method: "POST",
    body: { name: "Plugin Tutor" },
    headers: authHeaders({ idempotencyKey: "plugin-persona" })
  });
  const personaId = readDataRecord(created.body).id;
  assert.equal(typeof personaId, "string");

  await requestJson(service, `/v1/personas/${personaId}/versions`, {
    method: "POST",
    body: {
      contract: {
        ...contract,
        plugins: [{ name: "renderer", version: "1.0.0", capability: "renderer" }]
      }
    },
    headers: authHeaders({ idempotencyKey: "plugin-version" })
  });
  await requestJson(service, `/v1/personas/${personaId}/versions/1/publish`, {
    method: "POST",
    headers: authHeaders({ idempotencyKey: "plugin-publish" })
  });

  const compiled = await requestJson(service, `/v1/personas/${personaId}/versions/1/compile`, {
    method: "POST",
    headers: authHeaders({ idempotencyKey: "plugin-compile" })
  });
  assert.equal(compiled.status, 200);

  plugins.disable("tenant_http", "renderer", "1.0.0");
  const rejected = await requestJson(service, `/v1/personas/${personaId}/versions/1/compile`, {
    method: "POST",
    headers: authHeaders({ idempotencyKey: "plugin-compile-after-disable" })
  });
  assert.equal(rejected.status, 422);
});

test("AT-AST-015 production auth derives tenancy from a verified principal and enforces scopes", async () => {
  const { service, store } = makeService();
  const adapter: AsterAuthAdapter = {
    async authenticate(request) {
      if (request.headers.authorization !== "Bearer verified-token") {
        throw new AsterError("AUTHENTICATION_REQUIRED", 401, "Authentication is required.");
      }
      return { actorId: "oidc_actor", tenantId: "tenant_verified", scopes: ["aster:personas:read"] };
    }
  };
  const forged = await requestJson(service, "/v1/personas", {
    method: "POST",
    body: { name: "Nope" },
    headers: { authorization: "Bearer forged", "x-tenant-id": "tenant_verified", "idempotency-key": "forged" },
    authAdapter: adapter
  });
  assert.equal(forged.status, 401);
  const insufficientScope = await requestJson(service, "/v1/personas", {
    method: "POST",
    body: { name: "Nope" },
    headers: { authorization: "Bearer verified-token", "x-tenant-id": "tenant_verified", "idempotency-key": "scope" },
    authAdapter: adapter
  });
  assert.equal(insufficientScope.status, 403);
  const tenantMismatch = await requestJson(service, "/v1/personas", {
    method: "POST",
    body: { name: "Nope" },
    headers: { authorization: "Bearer verified-token", "x-tenant-id": "tenant_forged", "idempotency-key": "tenant" },
    authAdapter: { async authenticate() { return { actorId: "oidc_actor", tenantId: "tenant_verified", scopes: ["aster:personas:write"] }; } }
  });
  assert.equal(tenantMismatch.status, 403);
  assert.equal(await store.getPersona("tenant_verified", "per_1"), undefined);
});

test("AT-AST-016 production startup refuses development auth, in-memory storage, and wildcard binding", () => {
  const original = { nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL, host: process.env.HOST };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    delete process.env.HOST;
    assert.throws(() => createAsterServer({ service: makeService().service }), /production auth adapter/);
    assert.throws(() => createAsterServer({ service: makeService().service, authAdapter: { async authenticate() { return { actorId: "a", tenantId: "t", scopes: ["*"] }; } } }), /DATABASE_URL/);
    process.env.DATABASE_URL = "postgres://example";
    process.env.HOST = "127.0.0.1";
    assert.throws(() => createAsterServer({ service: makeService().service, authAdapter: { async authenticate() { return { actorId: "a", tenantId: "t", scopes: ["*"] }; } } }), /durable storage assertion/);
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original.databaseUrl;
    if (original.host === undefined) delete process.env.HOST; else process.env.HOST = original.host;
  }
});

test("AT-AST-021 OpenAPI-valid plugin requests derive tenancy from the verified principal", async () => {
  const openApi = readFileSync("packages/contracts/openapi/openapi.yaml", "utf8");
  assert.match(openApi, /TenantAssertion:\n      name: X-Tenant-Id\n      in: header\n      required: false/);
  assert.match(openApi, /\/v1\/plugins\/validate:[\s\S]*?requestBody:\n        required: true[\s\S]*?\$ref: "#\/components\/schemas\/PluginManifest"/);
  assert.match(openApi, /"401":\n          \$ref: "#\/components\/responses\/AuthenticationRequired"/);
  assert.match(openApi, /"403":\n          \$ref: "#\/components\/responses\/AuthorizationDenied"/);
  assert.match(openApi, /"422":\n          \$ref: "#\/components\/responses\/ValidationFailed"/);

  const { service } = makeService();
  const verifiedAuth: AsterAuthAdapter = {
    async authenticate() {
      return { actorId: "verified_actor", tenantId: "tenant_verified", scopes: ["aster:plugins:write"] };
    }
  };
  const plugin = {
    name: "renderer",
    version: "1.0.0",
    capabilities: ["renderer"],
    coreApiVersion: "v1",
    enabled: true
  };
  const accepted = await requestJson(service, "/v1/plugins/validate", {
    method: "POST",
    body: plugin,
    headers: { authorization: "Bearer verified", "idempotency-key": "verified-plugin" },
    authAdapter: verifiedAuth
  });
  assert.equal(accepted.status, 200);

  const rejectedBody = await requestJson(service, "/v1/plugins/validate", {
    method: "POST",
    body: { ...plugin, coreApiVersion: "v2" },
    headers: { authorization: "Bearer verified", "idempotency-key": "invalid-plugin" },
    authAdapter: verifiedAuth
  });
  assert.equal(rejectedBody.status, 422);

  const rejectedTenant = await requestJson(service, "/v1/plugins/validate", {
    method: "POST",
    body: plugin,
    headers: { authorization: "Bearer verified", "x-tenant-id": "tenant_other", "idempotency-key": "mismatched-plugin" },
    authAdapter: verifiedAuth
  });
  assert.equal(rejectedTenant.status, 403);
});

test("AT-AST-024 readiness is dependency-aware while liveness remains available", async () => {
  const { service } = makeService();
  const request = { method: "GET", url: "/ready", headers: {}, async *[Symbol.asyncIterator]() {} } satisfies AsterIncomingRequest;
  let status = 0;
  let body = "";
  await handleAsterRequest(service, request, { writeHead(next) { status = next; }, end(next) { body = next; } }, undefined, async () => false);
  assert.equal(status, 503);
  assert.deepEqual(JSON.parse(body), { data: { ready: false } });
});

const requestJson = async (
  service: AsterService,
  path: string,
  options: {
    readonly method?: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
    readonly authAdapter?: AsterAuthAdapter;
  } = {}
): Promise<{ readonly status: number; readonly body: unknown }> => {
  let status = 0;
  let body = "";
  const request = {
    method: options.method ?? "GET",
    url: path,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {})
    },
    async *[Symbol.asyncIterator]() {
      if (options.body) yield Buffer.from(JSON.stringify(options.body));
    }
  } satisfies AsterIncomingRequest;
  const response = {
    writeHead(nextStatus: number): void {
      status = nextStatus;
    },
    end(nextBody: string): void {
      body = nextBody;
    }
  } satisfies AsterOutgoingResponse;
  await handleAsterRequest(service, request, response, options.authAdapter);
  return { status, body: JSON.parse(body) as unknown };
};

const readDataRecord = (body: unknown): Record<string, unknown> => {
  assert.ok(body !== null && typeof body === "object" && !Array.isArray(body));
  const data = (body as { readonly data?: unknown }).data;
  assert.ok(data !== null && typeof data === "object" && !Array.isArray(data));
  return data as Record<string, unknown>;
};

const authHeaders = ({
  tenantId = "tenant_http",
  actorId = "actor_http",
  idempotencyKey
}: {
  readonly tenantId?: string;
  readonly actorId?: string;
  readonly idempotencyKey?: string;
} = {}): Record<string, string> => ({
  authorization: `Bearer ${actorId}`,
  "x-tenant-id": tenantId,
  ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
});

const makeService = (plugins?: PluginRegistry) => {
  const store = new InMemoryAsterStore();
  const service = new AsterService({
    repository: store,
    plugins: plugins ?? store,
    idempotency: store,
    audit: store,
    transactions: store,
    clock: new DeterministicClock("2026-07-06T00:00:00.000Z"),
    ids: new SequentialIdGenerator()
  });
  return { service, store };
};

class MutablePluginRegistry implements PluginRegistry {
  private readonly manifests = new Map<string, PluginManifest>();

  public async validateReferences(
    tenantId: string,
    references: readonly PluginReference[]
  ): Promise<void> {
    for (const reference of references) {
      const manifest = this.manifests.get(this.key(tenantId, reference.name, reference.version));
      if (!manifest?.enabled || !manifest.capabilities.includes(reference.capability)) {
        throw new AsterError("PLUGIN_INCOMPATIBLE", 422, "Plugin reference is not enabled or compatible.");
      }
    }
  }

  public async validateManifest(tenantId: string, manifest: PluginManifest): Promise<void> {
    if (!manifest.enabled) {
      throw new AsterError("PLUGIN_INCOMPATIBLE", 422, "Plugin must be enabled before use.");
    }
    this.manifests.set(this.key(tenantId, manifest.name, manifest.version), manifest);
  }

  public disable(tenantId: string, name: string, version: string): void {
    const key = this.key(tenantId, name, version);
    const manifest = this.manifests.get(key);
    if (manifest) this.manifests.set(key, { ...manifest, enabled: false });
  }

  private key(tenantId: string, name: string, version: string): string {
    return `${tenantId}:${name}@${version}`;
  }
}

const contract: PersonaContract = {
  schemaVersion: "1.0",
  persona: {
    displayName: "Aster HTTP Tutor",
    purpose: "Verify HTTP persona compilation.",
    voice: ["concise", "reliable"]
  },
  components: [
    { id: "base", type: "instruction", body: "Return concise HTTP guidance." },
    { id: "boundary", type: "boundary", body: "Do not imply hidden model state.", dependsOn: ["base"] }
  ],
  policyReferences: [{ id: "default-safety", version: "2026-07", required: true }]
};

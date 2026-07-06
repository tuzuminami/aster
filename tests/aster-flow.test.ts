import assert from "node:assert/strict";
import test from "node:test";
import { AsterError, AsterService, type PersonaContract } from "../packages/core/src/index.ts";
import { DeterministicClock, InMemoryAsterStore, SequentialIdGenerator } from "../packages/adapters/src/memory-store.ts";

const contract: PersonaContract = {
  schemaVersion: "1.0",
  persona: {
    displayName: "Aster Tutor",
    purpose: "Help a learner practice concise explanations.",
    voice: ["calm", "precise"]
  },
  components: [
    { id: "base", type: "instruction", body: "Answer with concrete examples." },
    { id: "boundary", type: "boundary", body: "Do not claim real-world authority.", dependsOn: ["base"] },
    { id: "context", type: "context", body: "Prefer short practice loops." }
  ],
  policyReferences: [{ id: "default-safety", version: "2026-01", required: true }]
};

test("AT-AST-001 primary persona flow compiles deterministic bundle and audits writes", async () => {
  const { service, store } = makeService();
  const context = {
    tenantId: "tenant_a",
    actorId: "actor_a",
    correlationId: "corr_a",
    idempotencyKey: "create-persona-1"
  };
  const persona = await service.createPersona(context, { name: "Tutor" });
  const replayedPersona = await service.createPersona(context, { name: "Tutor" });
  assert.equal(replayedPersona.id, persona.id);

  const draft = await service.createVersion(
    { ...context, idempotencyKey: "create-version-1" },
    { personaId: persona.id, contract }
  );
  assert.equal(draft.status, "draft");

  const published = await service.publishVersion(context, { personaId: persona.id, version: 1 });
  assert.equal(published.status, "published");

  const first = await service.compileVersion(context, { personaId: persona.id, version: 1 });
  const second = await service.compileVersion(context, { personaId: persona.id, version: 1 });
  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.provenance.componentIds, ["base", "boundary", "context"]);

  const audit = await store.listAuditEvents("tenant_a", `${persona.id}:1`);
  assert.ok(audit.some((event) => event.action === "persona_version.published"));
  assert.ok(audit.some((event) => event.action === "persona_version.compiled"));
});

test("AT-AST-007 draft versions cannot compile", async () => {
  const { service } = makeService();
  const persona = await service.createPersona(baseContext("create-persona-7"), { name: "Tutor" });
  await service.createVersion(baseContext("create-version-7"), { personaId: persona.id, contract });
  await assert.rejects(
    service.compileVersion(baseContext("compile-draft-7"), { personaId: persona.id, version: 1 }),
    (error: unknown) => error instanceof AsterError && error.code === "VERSION_CONFLICT"
  );
});

test("AT-AST-008 publish and compile idempotency prevent duplicate side effects", async () => {
  const { service, store } = makeService();
  const persona = await service.createPersona(baseContext("create-persona-8"), { name: "Tutor" });
  await service.createVersion(baseContext("create-version-8"), { personaId: persona.id, contract });

  const publishContext = baseContext("publish-8");
  const published = await service.publishVersion(publishContext, { personaId: persona.id, version: 1 });
  const replayedPublished = await service.publishVersion(publishContext, { personaId: persona.id, version: 1 });
  assert.equal(replayedPublished.status, published.status);

  const compileContext = baseContext("compile-8");
  const firstBundle = await service.compileVersion(compileContext, { personaId: persona.id, version: 1 });
  (firstBundle.context.instructions as string[])[0] = "mutated outside the store";
  const replayedBundle = await service.compileVersion(compileContext, { personaId: persona.id, version: 1 });
  assert.equal(replayedBundle.contentHash, firstBundle.contentHash);
  assert.equal(replayedBundle.context.instructions[0], "Answer with concrete examples.");
  const existingBundle = await service.compileVersion(baseContext("compile-8-existing"), {
    personaId: persona.id,
    version: 1
  });
  assert.equal(existingBundle.contentHash, firstBundle.contentHash);
  assert.equal(existingBundle.context.instructions[0], "Answer with concrete examples.");

  const audit = await store.listAuditEvents("tenant_a", `${persona.id}:1`);
  assert.equal(audit.filter((event) => event.action === "persona_version.published").length, 1);
  assert.equal(audit.filter((event) => event.action === "persona_version.compiled").length, 1);
});

test("AT-AST-009 state-changing operations require idempotency keys", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.createPersona({ tenantId: "tenant_a", actorId: "actor_a", correlationId: "corr_a" }, { name: "Tutor" }),
    (error: unknown) => error instanceof AsterError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("AT-AST-002 invalid contract and cyclic references fail closed", async () => {
  const { service } = makeService();
  const persona = await service.createPersona(baseContext("create-persona-2"), { name: "Tutor" });
  await assert.rejects(
    service.createVersion(baseContext("bad-version"), {
      personaId: persona.id,
      contract: {
        ...contract,
        components: [
          { id: "a", type: "instruction", body: "A", dependsOn: ["b"] },
          { id: "b", type: "context", body: "B", dependsOn: ["a"] }
        ]
      }
    }),
    (error: unknown) => error instanceof AsterError && error.code === "VALIDATION_FAILED"
  );
});

test("AT-AST-003 published versions are immutable", async () => {
  const { service } = makeService();
  const persona = await service.createPersona(baseContext("create-persona-3"), { name: "Tutor" });
  await service.createVersion(baseContext("create-version-3"), { personaId: persona.id, contract });
  await service.publishVersion(baseContext("publish-3"), { personaId: persona.id, version: 1 });
  await assert.rejects(
    service.replacePublishedVersionContract(baseContext("replace-3"), { personaId: persona.id, version: 1, contract }),
    (error: unknown) => error instanceof AsterError && error.code === "VERSION_CONFLICT"
  );
});

test("AT-AST-004 tenant isolation and unknown plugin references fail closed", async () => {
  const { service } = makeService();
  const persona = await service.createPersona(baseContext("create-persona-4"), { name: "Tutor" });
  await assert.rejects(
    service.createVersion(baseContext("plugin-version"), {
      personaId: persona.id,
      contract: {
        ...contract,
        plugins: [{ name: "missing", version: "1.0.0", capability: "context_injector" }]
      }
    }),
    (error: unknown) => error instanceof AsterError && error.code === "PLUGIN_INCOMPATIBLE"
  );
  await assert.rejects(
    service.createVersion(
      {
        tenantId: "tenant_b",
        actorId: "actor_b",
        correlationId: "corr_b",
        idempotencyKey: "wrong-tenant"
      },
      { personaId: persona.id, contract }
    ),
    (error: unknown) => error instanceof AsterError && error.code === "RESOURCE_NOT_FOUND"
  );
});

test("AT-AST-010 compiled bundles preserve validated plugin references", async () => {
  const { service } = makeService();
  await service.validatePlugin(baseContext("plugin-10"), {
    name: "renderer",
    version: "1.0.0",
    capabilities: ["renderer"],
    coreApiVersion: "v1",
    enabled: true
  });
  const persona = await service.createPersona(baseContext("create-persona-10"), { name: "Tutor" });
  const pluginContract: PersonaContract = {
    ...contract,
    plugins: [{ name: "renderer", version: "1.0.0", capability: "renderer" }]
  };
  await service.createVersion(baseContext("create-version-10"), { personaId: persona.id, contract: pluginContract });
  await service.publishVersion(baseContext("publish-10"), { personaId: persona.id, version: 1 });

  const bundle = await service.compileVersion(baseContext("compile-10"), { personaId: persona.id, version: 1 });
  assert.deepEqual(bundle.context.pluginReferences, pluginContract.plugins);
  assert.deepEqual(bundle.provenance.pluginReferenceIds, ["renderer@1.0.0:renderer"]);
});

test("AT-AST-012 plugin registry is tenant scoped", async () => {
  const { service } = makeService();
  await service.validatePlugin(tenantContext("tenant_b", "plugin-12b"), {
    name: "renderer",
    version: "1.0.0",
    capabilities: ["renderer"],
    coreApiVersion: "v1",
    enabled: true
  });

  const persona = await service.createPersona(baseContext("create-persona-12"), { name: "Tutor" });
  await assert.rejects(
    service.createVersion(baseContext("create-version-12"), {
      personaId: persona.id,
      contract: {
        ...contract,
        plugins: [{ name: "renderer", version: "1.0.0", capability: "renderer" }]
      }
    }),
    (error: unknown) => error instanceof AsterError && error.code === "PLUGIN_INCOMPATIBLE"
  );
});

test("AT-AST-006 plugin validation requires tenant context", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.validatePlugin(
      { tenantId: "", actorId: "actor_a", correlationId: "corr_a", idempotencyKey: "plugin-1" },
      {
        name: "renderer",
        version: "1.0.0",
        capabilities: ["renderer"],
        coreApiVersion: "v1",
        enabled: true
      }
    ),
    (error: unknown) => error instanceof AsterError && error.code === "TENANT_SCOPE_DENIED"
  );
});

test("AT-AST-005 diff reports changed components", async () => {
  const { service } = makeService();
  const persona = await service.createPersona(baseContext("create-persona-5"), { name: "Tutor" });
  const first = await service.createVersion(baseContext("create-version-5a"), { personaId: persona.id, contract });
  const second = await service.createVersion(baseContext("create-version-5b"), {
    personaId: persona.id,
    contract: {
      ...contract,
      components: [...contract.components, { id: "extra", type: "instruction", body: "Ask one follow-up question." }]
    }
  });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  const diff = await service.diffVersions(baseContext("diff-5"), { personaId: persona.id, fromVersion: 1, toVersion: 2 });
  assert.deepEqual(diff.changedComponents, ["extra"]);
});

const makeService = () => {
  const store = new InMemoryAsterStore();
  const service = new AsterService({
    repository: store,
    plugins: store,
    idempotency: store,
    audit: store,
    clock: new DeterministicClock(),
    ids: new SequentialIdGenerator()
  });
  return { service, store };
};

const baseContext = (idempotencyKey: string) => ({
  tenantId: "tenant_a",
  actorId: "actor_a",
  correlationId: "corr_a",
  idempotencyKey
});

const tenantContext = (tenantId: string, idempotencyKey: string) => ({
  tenantId,
  actorId: "actor_a",
  correlationId: "corr_a",
  idempotencyKey
});

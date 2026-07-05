import assert from "node:assert/strict";
import test from "node:test";
import { AsterService, type PersonaContract } from "../packages/core/src/index.ts";
import { DeterministicClock, SequentialIdGenerator } from "../packages/adapters/src/memory-store.ts";
import { PostgresAsterStore } from "../packages/adapters/src/postgres-store.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("AT-AST-PG-001 PostgreSQL adapter persists compile flow with tenant isolation", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const store = new PostgresAsterStore(databaseUrl);
  const service = new AsterService({
    repository: store,
    plugins: store,
    idempotency: store,
    audit: store,
    clock: new DeterministicClock("2026-07-05T00:00:00.000Z"),
    ids: new SequentialIdGenerator()
  });
  try {
    const context = {
      tenantId: `tenant_pg_${Date.now()}`,
      actorId: "actor_pg",
      correlationId: "corr_pg",
      idempotencyKey: "create-persona"
    };
    const persona = await service.createPersona(context, { name: "Postgres Tutor" });
    const version = await service.createVersion(
      { ...context, idempotencyKey: "create-version" },
      { personaId: persona.id, contract }
    );
    assert.equal(version.version, 1);
    await service.publishVersion(context, { personaId: persona.id, version: 1 });
    const bundle = await service.compileVersion(context, { personaId: persona.id, version: 1 });
    assert.equal(bundle.personaId, persona.id);
    await assert.rejects(
      service.createVersion(
        { tenantId: "other_tenant", actorId: "actor_pg", correlationId: "corr_pg", idempotencyKey: "wrong-tenant" },
        { personaId: persona.id, contract }
      )
    );
    const audit = await store.listAuditEvents(context.tenantId, `${persona.id}:1`);
    assert.ok(audit.some((event) => event.action === "persona_version.compiled"));
  } finally {
    await store.close();
  }
});

const contract: PersonaContract = {
  schemaVersion: "1.0",
  persona: {
    displayName: "Aster PostgreSQL Tutor",
    purpose: "Verify durable persona compilation.",
    voice: ["precise"]
  },
  components: [
    { id: "instruction", type: "instruction", body: "Return concise guidance." },
    { id: "boundary", type: "boundary", body: "Never imply hidden model state.", dependsOn: ["instruction"] }
  ],
  policyReferences: [{ id: "default-safety", version: "2026-07", required: true }]
};

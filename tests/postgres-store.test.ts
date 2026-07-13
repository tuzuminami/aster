import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { AsterService, type PersonaContract } from "../packages/core/src/index.ts";
import { CryptoIdGenerator, DeterministicClock, SequentialIdGenerator } from "../packages/adapters/src/memory-store.ts";
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
    transactions: store,
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
    const existingBundle = await service.compileVersion(
      { ...context, idempotencyKey: "compile-existing" },
      { personaId: persona.id, version: 1 }
    );
    assert.equal(bundle.personaId, persona.id);
    assert.deepEqual(existingBundle, bundle);
    await assert.rejects(
      service.createVersion(
        { tenantId: "other_tenant", actorId: "actor_pg", correlationId: "corr_pg", idempotencyKey: "wrong-tenant" },
        { personaId: persona.id, contract }
      )
    );
    const audit = await store.listAuditEvents(context.tenantId, `${persona.id}:1`);
    assert.equal(audit.filter((event) => event.action === "persona_version.compiled").length, 1);
  } finally {
    await store.close();
  }
});

test("AT-AST-PG-002 PostgreSQL idempotency is serialized across replicas and restarts", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const firstStore = new PostgresAsterStore(databaseUrl);
  const secondStore = new PostgresAsterStore(databaseUrl);
  const thirdStore = new PostgresAsterStore(databaseUrl);
  const context = {
    tenantId: `tenant_atomic_${Date.now()}`,
    actorId: "actor_pg",
    correlationId: "corr_atomic",
    idempotencyKey: "same-request"
  };
  const createService = (store: PostgresAsterStore) => new AsterService({
    repository: store,
    plugins: store,
    idempotency: store,
    audit: store,
    transactions: store,
    clock: new DeterministicClock("2026-07-05T00:00:00.000Z"),
    ids: new CryptoIdGenerator()
  });
  try {
    const [first, second] = await Promise.all([
      createService(firstStore).createPersona(context, { name: "Atomic replica" }),
      createService(secondStore).createPersona(context, { name: "Atomic replica" })
    ]);
    assert.equal(first.id, second.id);
    assert.equal((await firstStore.listAuditEvents(context.tenantId, first.id)).length, 1);

    await firstStore.close();
    const replayed = await createService(thirdStore).createPersona(context, { name: "Atomic replica" });
    assert.deepEqual(replayed, first);
    assert.equal((await secondStore.listAuditEvents(context.tenantId, first.id)).length, 1);
  } finally {
    await Promise.allSettled([firstStore.close(), secondStore.close(), thirdStore.close()]);
  }
});

test("AT-AST-PG-003 PostgreSQL rolls the resource back when an audit insert fails", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const tenantId = `tenant_audit_failure_${suffix}`;
  const trigger = `aster_test_reject_audit_${suffix}`;
  const fn = `aster_test_reject_audit_fn_${suffix}`;
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new PostgresAsterStore(databaseUrl);
  const service = new AsterService({
    repository: store,
    plugins: store,
    idempotency: store,
    audit: store,
    transactions: store,
    clock: new DeterministicClock("2026-07-05T00:00:00.000Z"),
    ids: new SequentialIdGenerator()
  });
  try {
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.tenant_id = '${tenantId}') EXECUTE FUNCTION ${fn}()`);
    await assert.rejects(service.createPersona({
      tenantId,
      actorId: "actor_pg",
      correlationId: "corr_atomic",
      idempotencyKey: "audit-failure"
    }, { name: "Must not persist" }));
    const resources = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM personas WHERE tenant_id = $1", [tenantId]);
    const idempotency = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM idempotency_records WHERE tenant_id = $1", [tenantId]);
    assert.equal(resources.rows[0]?.count, "0");
    assert.equal(idempotency.rows[0]?.count, "0");
  } finally {
    await store.close();
    await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_events`).catch(() => undefined);
    await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`).catch(() => undefined);
    await pool.end();
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

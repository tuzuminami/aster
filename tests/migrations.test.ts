import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runPostgresMigrations } from "../scripts/migrate-postgres.ts";

const connectionString = process.env.TEST_DATABASE_URL;

test("AT-AST-MIG-001 migrations are repeatable, checksummed, and serializable", { skip: !connectionString }, async () => {
  assert.ok(connectionString);
  const directory = await mkdtemp(join(tmpdir(), "aster-migrations-"));
  const ledgerTable = `schema_migrations_test_${Date.now()}`;
  const probeTable = `aster_migration_probe_${Date.now()}`;
  const filename = "900_test_migration.sql";
  await writeFile(join(directory, filename), `CREATE TABLE ${probeTable} (id INTEGER PRIMARY KEY);\n`);
  try {
    const [first, concurrent] = await Promise.all([
      runPostgresMigrations({ connectionString, migrationsDirectory: directory, ledgerTable }),
      runPostgresMigrations({ connectionString, migrationsDirectory: directory, ledgerTable })
    ]);
    assert.deepEqual([...first, ...concurrent].sort(), [filename]);
    assert.deepEqual(await runPostgresMigrations({ connectionString, migrationsDirectory: directory, ledgerTable }), []);

    await writeFile(join(directory, filename), `CREATE TABLE ${probeTable} (id BIGINT PRIMARY KEY);\n`);
    await assert.rejects(
      runPostgresMigrations({ connectionString, migrationsDirectory: directory, ledgerTable }),
      /checksum changed/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

export interface MigrationOptions {
  readonly connectionString: string;
  readonly migrationsDirectory?: string;
  readonly ledgerTable?: string;
}

interface AppliedMigration {
  readonly filename: string;
  readonly checksum_sha256: string;
}

export async function runPostgresMigrations(options: MigrationOptions): Promise<readonly string[]> {
  const pool = new Pool({
    connectionString: options.connectionString,
    connectionTimeoutMillis: 2_000,
    allowExitOnIdle: true
  });
  try {
    const client = await pool.connect();
    try {
      return await applyMigrations(client, options.migrationsDirectory ?? defaultMigrationsDirectory(), options.ledgerTable ?? "schema_migrations");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function applyMigrations(client: PoolClient, migrationsDirectory: string, ledgerTable: string): Promise<readonly string[]> {
  if (!/^[a-z_][a-z0-9_]*$/.test(ledgerTable)) throw new Error("Migration ledger table name is invalid");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`aster:postgres-migrations:v1:${ledgerTable}`]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${ledgerTable} (
        filename TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    const known = new Set(files);
    const appliedResult = await client.query<AppliedMigration>(
      `SELECT filename, checksum_sha256 FROM ${ledgerTable} ORDER BY filename`
    );
    for (const applied of appliedResult.rows) {
      if (!known.has(applied.filename)) {
        throw new Error(`Applied migration is missing from this release: ${applied.filename}`);
      }
    }

    const appliedByFilename = new Map(appliedResult.rows.map((migration) => [migration.filename, migration]));
    const newlyApplied: string[] = [];
    for (const file of files) {
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      const checksum = sha256(sql);
      const existing = appliedByFilename.get(file);
      if (existing) {
        if (existing.checksum_sha256 !== checksum) {
          throw new Error(`Applied migration checksum changed: ${file}`);
        }
        continue;
      }
      await client.query(sql);
      await client.query(
        `INSERT INTO ${ledgerTable} (filename, checksum_sha256) VALUES ($1, $2)`,
        [file, checksum]
      );
      newlyApplied.push(file);
    }
    await client.query("COMMIT");
    return newlyApplied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function defaultMigrationsDirectory(): string {
  return fileURLToPath(new URL("../db/migrations", import.meta.url));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const applied = await runPostgresMigrations({ connectionString });
  for (const filename of applied) process.stdout.write(`applied ${filename}\n`);
}

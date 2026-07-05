import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const migrationsDir = new URL("../db/migrations", import.meta.url);
const pool = new Pool({ connectionString, connectionTimeoutMillis: 2_000, allowExitOnIdle: true });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = await readFile(join(migrationsDir.pathname, file), "utf8");
      await client.query(sql);
      process.stdout.write(`applied ${file}\n`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PostgresAsterStore } from "../../../packages/adapters/src/postgres-store.ts";
import { AsterService } from "../../../packages/core/src/service.ts";
import { CryptoIdGenerator, SystemClock } from "../../../packages/adapters/src/memory-store.ts";
import { createAsterServer } from "./http.ts";
import type { AsterAuthAdapter } from "./auth.ts";

export async function createProductionRuntime(env = process.env) {
  if (env.NODE_ENV !== "production") throw new Error("NODE_ENV=production is required for the production runtime.");
  const databaseUrl = required(env.DATABASE_URL, "DATABASE_URL");
  const modulePath = required(env.ASTER_AUTH_MODULE, "ASTER_AUTH_MODULE");
  const host = required(env.HOST, "HOST");
  if (host === "0.0.0.0" || host === "::") throw new Error("HOST must not be a wildcard in production.");
  const module = await import(pathToFileURL(resolve(modulePath)).href);
  const authAdapter = module.authAdapter as AsterAuthAdapter | undefined;
  if (!authAdapter || typeof authAdapter.authenticate !== "function") throw new Error("ASTER_AUTH_MODULE must export authAdapter.authenticate.");
  const store = new PostgresAsterStore(databaseUrl);
  const service = new AsterService({ repository: store, plugins: store, idempotency: store, audit: store, transactions: store, clock: new SystemClock(), ids: new CryptoIdGenerator() });
  const server = createAsterServer({ service, authAdapter, durableStorage: true, readiness: async () => store.healthCheck().catch(() => false) });
  return { server, store, host, port: Number(env.PORT ?? "3000") };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}

if (process.argv[1]?.endsWith("runtime.ts") || process.argv[1]?.endsWith("runtime.js")) {
  createProductionRuntime().then(({ server, host, port }) => server.listen(port, host));
}

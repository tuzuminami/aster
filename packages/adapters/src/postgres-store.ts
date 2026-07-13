import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { AsterError } from "../../core/src/errors.ts";
import type { AtomicMutationPorts, AtomicMutationScope, AtomicMutationStore, AuditLog, BundleSaveResult, IdempotencyStore, PersonaRepository, PluginRegistry } from "../../core/src/ports.ts";
import type { AuditEvent, CompiledBundle, Persona, PersonaVersion, PluginManifest } from "../../core/src/types.ts";

export class PostgresAsterStore implements PersonaRepository, AuditLog, IdempotencyStore, PluginRegistry, AtomicMutationStore {
  private readonly pool: Pool;
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();

  public constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true
    });
    this.pool.on("error", () => {
      // Background pool errors are intentionally swallowed here; request paths surface typed failures.
    });
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async runAtomically<T>(scope: AtomicMutationScope, operation: (ports: AtomicMutationPorts) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`aster:idempotency:${scope.tenantId}:${scope.idempotencyKey}:${scope.operation}`]
      );
      const result = await this.transactionClient.run(client, async () => operation({ repository: this, audit: this, idempotency: this }));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof AsterError) throw error;
      throw new AsterError("DEPENDENCY_UNAVAILABLE", 503, "Database transaction failed.");
    } finally {
      client.release();
    }
  }

  public async createPersona(persona: Persona): Promise<void> {
    await this.query(
      `INSERT INTO personas (id, tenant_id, name, created_at, created_by, updated_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [persona.id, persona.tenantId, persona.name, persona.createdAt, persona.createdBy, persona.updatedAt, persona.version]
    );
  }

  public async getPersona(tenantId: string, personaId: string): Promise<Persona | undefined> {
    const result = await this.query<PersonaRow>(
      `SELECT id, tenant_id, name, created_at, created_by, updated_at, version
       FROM personas
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, personaId]
    );
    return result.rows[0] ? personaFromRow(result.rows[0]) : undefined;
  }

  public async createVersion(version: PersonaVersion): Promise<PersonaVersion> {
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`aster:persona-version:${version.tenantId}:${version.personaId}`]
      );
      const next = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM persona_versions
         WHERE tenant_id = $1 AND persona_id = $2`,
        [version.tenantId, version.personaId]
      );
      const nextVersion = Number(next.rows[0]?.next_version ?? 1);
      const created = { ...version, version: nextVersion };
      await client.query(
        `INSERT INTO persona_versions
           (persona_id, tenant_id, version, status, contract_json, content_hash, created_at, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          created.personaId,
          created.tenantId,
          created.version,
          created.status,
          JSON.stringify(created.contract),
          created.contentHash,
          created.createdAt,
          created.createdBy,
          created.updatedAt
        ]
      );
      return created;
    });
  }

  public async getVersion(tenantId: string, personaId: string, version: number): Promise<PersonaVersion | undefined> {
    const result = await this.query<PersonaVersionRow>(
      `SELECT persona_id, tenant_id, version, status, contract_json, content_hash, created_at, created_by, updated_at
       FROM persona_versions
       WHERE tenant_id = $1 AND persona_id = $2 AND version = $3`,
      [tenantId, personaId, version]
    );
    return result.rows[0] ? versionFromRow(result.rows[0]) : undefined;
  }

  public async updateVersionStatus(
    tenantId: string,
    personaId: string,
    version: number,
    status: PersonaVersion["status"],
    updatedAt: string
  ): Promise<PersonaVersion | undefined> {
    const result = await this.query<PersonaVersionRow>(
      `UPDATE persona_versions
       SET status = $4, updated_at = $5
       WHERE tenant_id = $1 AND persona_id = $2 AND version = $3
       RETURNING persona_id, tenant_id, version, status, contract_json, content_hash, created_at, created_by, updated_at`,
      [tenantId, personaId, version, status, updatedAt]
    );
    return result.rows[0] ? versionFromRow(result.rows[0]) : undefined;
  }

  public async saveBundle(bundle: CompiledBundle, tenantId: string, actorId: string): Promise<BundleSaveResult> {
    const result = await this.query<{ inserted: number }>(
      `INSERT INTO compiled_bundles
         (tenant_id, persona_id, version, compiler_version, content_hash, bundle_json, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, persona_id, version, compiler_version) DO NOTHING
       RETURNING 1 AS inserted`,
      [
        tenantId,
        bundle.personaId,
        bundle.version,
        bundle.compilerVersion,
        bundle.contentHash,
        JSON.stringify(bundle),
        bundle.provenance.compiledAt,
        actorId
      ]
    );
    return result.rows[0] ? "created" : "existing";
  }

  public async getBundle(
    tenantId: string,
    personaId: string,
    version: number,
    compilerVersion: string
  ): Promise<CompiledBundle | undefined> {
    const result = await this.query<{ bundle_json: string | CompiledBundle }>(
      `SELECT bundle_json
       FROM compiled_bundles
       WHERE tenant_id = $1 AND persona_id = $2 AND version = $3 AND compiler_version = $4`,
      [tenantId, personaId, version, compilerVersion]
    );
    return result.rows[0] ? parseJson<CompiledBundle>(result.rows[0].bundle_json) : undefined;
  }

  public async listAuditEvents(tenantId: string, resourceId: string): Promise<readonly AuditEvent[]> {
    const result = await this.query<AuditEventRow>(
      `SELECT id, tenant_id, actor_id, action, resource_type, resource_id, reason, correlation_id, before_hash, after_hash, created_at
       FROM audit_events
       WHERE tenant_id = $1 AND resource_id = $2
       ORDER BY created_at ASC, id ASC`,
      [tenantId, resourceId]
    );
    return result.rows.map(auditFromRow);
  }

  public async append(event: AuditEvent): Promise<void> {
    await this.query(
      `INSERT INTO audit_events
         (id, tenant_id, actor_id, action, resource_type, resource_id, reason, correlation_id, before_hash, after_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.id,
        event.tenantId,
        event.actorId,
        event.action,
        event.resourceType,
        event.resourceId,
        event.reason,
        event.correlationId,
        event.beforeHash ?? null,
        event.afterHash ?? null,
        event.createdAt
      ]
    );
  }

  public async replay<T>(tenantId: string, idempotencyKey: string | undefined, operation: string): Promise<T | undefined> {
    if (!idempotencyKey) return undefined;
    const result = await this.query<{ response_json: unknown }>(
      `SELECT response_json
       FROM idempotency_records
       WHERE tenant_id = $1 AND key = $2 AND operation = $3`,
      [tenantId, idempotencyKey, operation]
    );
    return result.rows[0] ? (result.rows[0].response_json as T) : undefined;
  }

  public async record<T>(tenantId: string, idempotencyKey: string | undefined, operation: string, response: T): Promise<void> {
    if (!idempotencyKey) return;
    await this.query(
      `INSERT INTO idempotency_records (tenant_id, key, operation, response_json, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, key, operation) DO NOTHING`,
      [tenantId, idempotencyKey, operation, JSON.stringify(response), new Date().toISOString()]
    );
  }

  public async validateReferences(
    tenantId: string,
    references: readonly { name: string; version: string; capability: string }[]
  ): Promise<void> {
    for (const reference of references) {
      const result = await this.query<{ capabilities: readonly string[]; enabled: boolean }>(
        `SELECT capabilities, enabled
       FROM plugin_manifests
       WHERE tenant_id = $1 AND name = $2 AND version = $3`,
        [tenantId, reference.name, reference.version]
      );
      const manifest = result.rows[0];
      if (!manifest?.enabled || !manifest.capabilities.includes(reference.capability)) {
        throw new AsterError("PLUGIN_INCOMPATIBLE", 422, "Plugin reference is not enabled or compatible.");
      }
    }
  }

  public async validateManifest(tenantId: string, manifest: PluginManifest): Promise<void> {
    if (!manifest.enabled) {
      throw new AsterError("PLUGIN_INCOMPATIBLE", 422, "Plugin must be enabled before use.");
    }
    await this.query(
      `INSERT INTO plugin_manifests (tenant_id, name, version, capabilities, core_api_version, enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, name, version)
       DO UPDATE SET capabilities = EXCLUDED.capabilities,
                     core_api_version = EXCLUDED.core_api_version,
                     enabled = EXCLUDED.enabled,
                     updated_at = EXCLUDED.updated_at`,
      [
        tenantId,
        manifest.name,
        manifest.version,
        JSON.stringify(manifest.capabilities),
        manifest.coreApiVersion,
        manifest.enabled,
        new Date().toISOString()
      ]
    );
  }

  private async query<T extends Record<string, unknown>>(text: string, values: readonly unknown[]) {
    try {
      const client = this.transactionClient.getStore();
      return client ? await client.query<T>(text, [...values]) : await this.pool.query<T>(text, [...values]);
    } catch {
      throw new AsterError("DEPENDENCY_UNAVAILABLE", 503, "Database operation failed.");
    }
  }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const existing = this.transactionClient.getStore();
    if (existing) return fn(existing);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof AsterError) throw error;
      throw new AsterError("DEPENDENCY_UNAVAILABLE", 503, "Database transaction failed.");
    } finally {
      client.release();
    }
  }
}

interface PersonaRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly updated_at: string;
  readonly version: number;
}

interface PersonaVersionRow extends Record<string, unknown> {
  readonly persona_id: string;
  readonly tenant_id: string;
  readonly version: number;
  readonly status: PersonaVersion["status"];
  readonly contract_json: string | PersonaVersion["contract"];
  readonly content_hash: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly updated_at: string;
}

interface AuditEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly before_hash: string | null;
  readonly after_hash: string | null;
  readonly created_at: string;
}

const personaFromRow = (row: PersonaRow): Persona => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  createdAt: row.created_at,
  createdBy: row.created_by,
  updatedAt: row.updated_at,
  version: row.version
});

const versionFromRow = (row: PersonaVersionRow): PersonaVersion => ({
  personaId: row.persona_id,
  tenantId: row.tenant_id,
  version: row.version,
  status: row.status,
  contract: parseJson<PersonaVersion["contract"]>(row.contract_json),
  contentHash: row.content_hash,
  createdAt: row.created_at,
  createdBy: row.created_by,
  updatedAt: row.updated_at
});

const auditFromRow = (row: AuditEventRow): AuditEvent => ({
  id: row.id,
  tenantId: row.tenant_id,
  actorId: row.actor_id,
  action: row.action,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  reason: row.reason,
  correlationId: row.correlation_id,
  ...(row.before_hash ? { beforeHash: row.before_hash } : {}),
  ...(row.after_hash ? { afterHash: row.after_hash } : {}),
  createdAt: row.created_at
});

const parseJson = <T>(value: string | T): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);

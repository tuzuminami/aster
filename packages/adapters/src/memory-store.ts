import { AsterError } from "../../core/src/errors.ts";
import type { AuditLog, IdempotencyStore, PersonaRepository, PluginRegistry } from "../../core/src/ports.ts";
import type { AuditEvent, CompiledBundle, Persona, PersonaVersion, PluginManifest } from "../../core/src/types.ts";

export class InMemoryAsterStore implements PersonaRepository, AuditLog, IdempotencyStore, PluginRegistry {
  private readonly personas = new Map<string, Persona>();
  private readonly versions = new Map<string, PersonaVersion>();
  private readonly bundles = new Map<string, CompiledBundle>();
  private readonly idempotency = new Map<string, unknown>();
  private readonly audits: AuditEvent[] = [];
  private readonly plugins = new Map<string, PluginManifest>();

  public async createPersona(persona: Persona): Promise<void> {
    this.personas.set(key(persona.tenantId, persona.id), persona);
  }

  public async getPersona(tenantId: string, personaId: string): Promise<Persona | undefined> {
    return this.personas.get(key(tenantId, personaId));
  }

  public async createVersion(version: PersonaVersion): Promise<PersonaVersion> {
    const existingVersions = [...this.versions.values()].filter(
      (candidate) => candidate.tenantId === version.tenantId && candidate.personaId === version.personaId
    );
    const nextVersion = existingVersions.length + 1;
    const created = { ...version, version: nextVersion };
    this.versions.set(versionKey(version.tenantId, version.personaId, nextVersion), created);
    return created;
  }

  public async getVersion(tenantId: string, personaId: string, version: number): Promise<PersonaVersion | undefined> {
    return this.versions.get(versionKey(tenantId, personaId, version));
  }

  public async updateVersionStatus(
    tenantId: string,
    personaId: string,
    version: number,
    status: PersonaVersion["status"],
    updatedAt: string
  ): Promise<PersonaVersion | undefined> {
    const existing = await this.getVersion(tenantId, personaId, version);
    if (!existing) return undefined;
    const updated = { ...existing, status, updatedAt };
    this.versions.set(versionKey(tenantId, personaId, version), updated);
    return updated;
  }

  public async saveBundle(bundle: CompiledBundle, tenantId: string, actorId: string): Promise<void> {
    void actorId;
    this.bundles.set(`${tenantId}:${bundle.personaId}:${bundle.version}:${bundle.compilerVersion}`, bundle);
  }

  public async getBundle(
    tenantId: string,
    personaId: string,
    version: number,
    compilerVersion: string
  ): Promise<CompiledBundle | undefined> {
    return this.bundles.get(`${tenantId}:${personaId}:${version}:${compilerVersion}`);
  }

  public async listAuditEvents(tenantId: string, resourceId: string): Promise<readonly AuditEvent[]> {
    return this.audits.filter((event) => event.tenantId === tenantId && event.resourceId === resourceId);
  }

  public async append(event: AuditEvent): Promise<void> {
    this.audits.push(event);
  }

  public async replay<T>(tenantId: string, idempotencyKey: string | undefined, operation: string): Promise<T | undefined> {
    if (!idempotencyKey) return undefined;
    return this.idempotency.get(`${tenantId}:${operation}:${idempotencyKey}`) as T | undefined;
  }

  public async record<T>(tenantId: string, idempotencyKey: string | undefined, operation: string, response: T): Promise<void> {
    if (!idempotencyKey) return;
    this.idempotency.set(`${tenantId}:${operation}:${idempotencyKey}`, response);
  }

  public async validateReferences(
    references: readonly { name: string; version: string; capability: string }[]
  ): Promise<void> {
    for (const reference of references) {
      const manifest = this.plugins.get(`${reference.name}@${reference.version}`);
      if (
        !manifest ||
        !manifest.enabled ||
        !manifest.capabilities.some((capability) => capability === reference.capability)
      ) {
        throw new AsterError("PLUGIN_INCOMPATIBLE", 422, "Plugin reference is not enabled or compatible.");
      }
    }
  }

  public async validateManifest(manifest: PluginManifest): Promise<void> {
    if (!manifest.enabled) {
      throw new AsterError("PLUGIN_INCOMPATIBLE", 422, "Plugin must be enabled before use.");
    }
    this.plugins.set(`${manifest.name}@${manifest.version}`, manifest);
  }
}

export class SystemClock {
  public nowIso(): string {
    return new Date().toISOString();
  }
}

export class DeterministicClock {
  private readonly value: string;

  public constructor(value = "2026-01-01T00:00:00.000Z") {
    this.value = value;
  }

  public nowIso(): string {
    return this.value;
  }
}

export class SequentialIdGenerator {
  private count = 0;

  public nextId(prefix: string): string {
    this.count += 1;
    return `${prefix}_${this.count.toString().padStart(6, "0")}`;
  }
}

const key = (tenantId: string, id: string): string => `${tenantId}:${id}`;
const versionKey = (tenantId: string, personaId: string, version: number): string => `${tenantId}:${personaId}:${version}`;

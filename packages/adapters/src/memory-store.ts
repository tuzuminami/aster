import { randomUUID } from "node:crypto";
import { AsterError } from "../../core/src/errors.ts";
import type { AtomicMutationPorts, AtomicMutationScope, AtomicMutationStore, AuditLog, BundleSaveResult, IdempotencyStore, PersonaRepository, PluginRegistry } from "../../core/src/ports.ts";
import type { AuditEvent, CompiledBundle, Persona, PersonaVersion, PluginManifest } from "../../core/src/types.ts";

export class InMemoryAsterStore implements PersonaRepository, AuditLog, IdempotencyStore, PluginRegistry, AtomicMutationStore {
  private readonly personas = new Map<string, Persona>();
  private readonly versions = new Map<string, PersonaVersion>();
  private readonly bundles = new Map<string, CompiledBundle>();
  private readonly idempotency = new Map<string, unknown>();
  private readonly audits: AuditEvent[] = [];
  private readonly plugins = new Map<string, PluginManifest>();
  private atomicTail: Promise<void> = Promise.resolve();

  public async runAtomically<T>(_scope: AtomicMutationScope, operation: (ports: AtomicMutationPorts) => Promise<T>): Promise<T> {
    const previous = this.atomicTail;
    let release: () => void = () => undefined;
    this.atomicTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = {
      personas: new Map(this.personas), versions: new Map(this.versions), bundles: new Map(this.bundles),
      idempotency: new Map(this.idempotency), audits: [...this.audits], plugins: new Map(this.plugins)
    };
    try {
      return await operation({ repository: this, audit: this, idempotency: this });
    } catch (error) {
      restore(this.personas, snapshot.personas); restore(this.versions, snapshot.versions); restore(this.bundles, snapshot.bundles);
      restore(this.idempotency, snapshot.idempotency); restore(this.plugins, snapshot.plugins);
      this.audits.splice(0, this.audits.length, ...snapshot.audits);
      throw error;
    } finally {
      release();
    }
  }

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

  public async saveBundle(bundle: CompiledBundle, tenantId: string, actorId: string): Promise<BundleSaveResult> {
    void actorId;
    const bundleKey = `${tenantId}:${bundle.personaId}:${bundle.version}:${bundle.compilerVersion}`;
    if (this.bundles.has(bundleKey)) return "existing";
    this.bundles.set(bundleKey, structuredClone(bundle));
    return "created";
  }

  public async getBundle(
    tenantId: string,
    personaId: string,
    version: number,
    compilerVersion: string
  ): Promise<CompiledBundle | undefined> {
    const bundle = this.bundles.get(`${tenantId}:${personaId}:${version}:${compilerVersion}`);
    return bundle ? structuredClone(bundle) : undefined;
  }

  public async listAuditEvents(tenantId: string, resourceId: string): Promise<readonly AuditEvent[]> {
    return this.audits.filter((event) => event.tenantId === tenantId && event.resourceId === resourceId);
  }

  public async append(event: AuditEvent): Promise<void> {
    this.audits.push(event);
  }

  public async replay<T>(tenantId: string, idempotencyKey: string | undefined, operation: string): Promise<T | undefined> {
    if (!idempotencyKey) return undefined;
    const response = this.idempotency.get(`${tenantId}:${operation}:${idempotencyKey}`);
    return response === undefined ? undefined : structuredClone(response as T);
  }

  public async record<T>(tenantId: string, idempotencyKey: string | undefined, operation: string, response: T): Promise<void> {
    if (!idempotencyKey) return;
    this.idempotency.set(`${tenantId}:${operation}:${idempotencyKey}`, structuredClone(response));
  }

  public async validateReferences(
    tenantId: string,
    references: readonly { name: string; version: string; capability: string }[]
  ): Promise<void> {
    for (const reference of references) {
      const manifest = this.plugins.get(`${tenantId}:${reference.name}@${reference.version}`);
      if (
        !manifest ||
        !manifest.enabled ||
        !manifest.capabilities.some((capability) => capability === reference.capability)
      ) {
        throw new AsterError("PLUGIN_INCOMPATIBLE", 422, "Plugin reference is not enabled or compatible.");
      }
    }
  }

  public async validateManifest(tenantId: string, manifest: PluginManifest): Promise<void> {
    if (!manifest.enabled) {
      throw new AsterError("PLUGIN_INCOMPATIBLE", 422, "Plugin must be enabled before use.");
    }
    this.plugins.set(`${tenantId}:${manifest.name}@${manifest.version}`, manifest);
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

export class CryptoIdGenerator {
  public nextId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

const restore = <T>(target: Map<string, T>, snapshot: Map<string, T>): void => {
  target.clear();
  for (const [key, value] of snapshot) target.set(key, value);
};

const key = (tenantId: string, id: string): string => `${tenantId}:${id}`;
const versionKey = (tenantId: string, personaId: string, version: number): string => `${tenantId}:${personaId}:${version}`;

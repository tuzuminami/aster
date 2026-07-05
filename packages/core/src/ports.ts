import type { AuditEvent, CompiledBundle, Persona, PersonaVersion, PluginManifest } from "./types.ts";

export interface Clock {
  nowIso(): string;
}

export interface IdGenerator {
  nextId(prefix: string): string;
}

export interface PersonaRepository {
  createPersona(persona: Persona): Promise<void>;
  getPersona(tenantId: string, personaId: string): Promise<Persona | undefined>;
  createVersion(version: PersonaVersion): Promise<PersonaVersion>;
  getVersion(tenantId: string, personaId: string, version: number): Promise<PersonaVersion | undefined>;
  updateVersionStatus(
    tenantId: string,
    personaId: string,
    version: number,
    status: PersonaVersion["status"],
    updatedAt: string
  ): Promise<PersonaVersion | undefined>;
  saveBundle(bundle: CompiledBundle, tenantId: string, actorId: string): Promise<void>;
  getBundle(
    tenantId: string,
    personaId: string,
    version: number,
    compilerVersion: string
  ): Promise<CompiledBundle | undefined>;
  listAuditEvents(tenantId: string, resourceId: string): Promise<readonly AuditEvent[]>;
}

export interface PluginRegistry {
  validateReferences(
    tenantId: string,
    references: readonly { name: string; version: string; capability: string }[]
  ): Promise<void>;
  validateManifest(tenantId: string, manifest: PluginManifest): Promise<void>;
}

export interface IdempotencyStore {
  replay<T>(tenantId: string, key: string | undefined, operation: string): Promise<T | undefined>;
  record<T>(tenantId: string, key: string | undefined, operation: string, response: T): Promise<void>;
}

export interface AuditLog {
  append(event: AuditEvent): Promise<void>;
}

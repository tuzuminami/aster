import { sha256Hex } from "./canonical.js";
import { compilePersonaContract } from "./compiler.js";
import { AsterError } from "./errors.js";
import type { AuditLog, Clock, IdGenerator, IdempotencyStore, PersonaRepository, PluginRegistry } from "./ports.js";
import type { CompiledBundle, Persona, PersonaContract, PersonaDiff, PersonaVersion, PluginManifest, RequestContext } from "./types.js";
import { assertPublished, parsePersonaContract, parsePluginManifest } from "./validation.js";

export interface AsterServicePorts {
  readonly repository: PersonaRepository;
  readonly plugins: PluginRegistry;
  readonly idempotency: IdempotencyStore;
  readonly audit: AuditLog;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class AsterService {
  private readonly ports: AsterServicePorts;

  public constructor(ports: AsterServicePorts) {
    this.ports = ports;
  }

  public async createPersona(context: RequestContext, input: { readonly name: string }): Promise<Persona> {
    this.requireTenant(context);
    return this.idempotent(context, "createPersona", async () => {
      if (input.name.trim().length === 0) {
        throw new AsterError("VALIDATION_FAILED", 422, "Persona name is required.", ["name is required"]);
      }
      const now = this.ports.clock.nowIso();
      const persona: Persona = {
        id: this.ports.ids.nextId("per"),
        tenantId: context.tenantId,
        name: input.name,
        createdAt: now,
        createdBy: context.actorId,
        updatedAt: now,
        version: 1
      };
      await this.ports.repository.createPersona(persona);
      await this.audit(context, "persona.created", "persona", persona.id, undefined, sha256Hex(persona));
      return persona;
    });
  }

  public async createVersion(
    context: RequestContext,
    input: { readonly personaId: string; readonly contract: unknown }
  ): Promise<PersonaVersion> {
    this.requireTenant(context);
    return this.idempotent(context, "createVersion", async () => {
      const persona = await this.ports.repository.getPersona(context.tenantId, input.personaId);
      if (!persona) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona was not found.");
      const contract = parsePersonaContract(input.contract);
      await this.ports.plugins.validateReferences(contract.plugins ?? []);
      const now = this.ports.clock.nowIso();
      const personaVersion: PersonaVersion = {
        personaId: input.personaId,
        tenantId: context.tenantId,
        version: 1,
        status: "draft",
        contract,
        contentHash: sha256Hex(contract),
        createdAt: now,
        createdBy: context.actorId,
        updatedAt: now
      };
      const created = await this.ports.repository.createVersion(personaVersion);
      await this.audit(
        context,
        "persona_version.created",
        "persona_version",
        `${input.personaId}:${created.version}`,
        undefined,
        created.contentHash
      );
      return created;
    });
  }

  public async publishVersion(
    context: RequestContext,
    input: { readonly personaId: string; readonly version: number }
  ): Promise<PersonaVersion> {
    this.requireTenant(context);
    const existing = await this.ports.repository.getVersion(context.tenantId, input.personaId, input.version);
    if (!existing) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona version was not found.");
    if (existing.status !== "draft") {
      throw new AsterError("VERSION_CONFLICT", 409, "Only draft persona versions can be published.");
    }
    const updated = await this.ports.repository.updateVersionStatus(
      context.tenantId,
      input.personaId,
      input.version,
      "published",
      this.ports.clock.nowIso()
    );
    if (!updated) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona version was not found.");
    await this.audit(
      context,
      "persona_version.published",
      "persona_version",
      `${input.personaId}:${input.version}`,
      existing.contentHash,
      updated.contentHash
    );
    return updated;
  }

  public async replacePublishedVersionContract(
    context: RequestContext,
    input: { readonly personaId: string; readonly version: number; readonly contract: PersonaContract }
  ): Promise<never> {
    this.requireTenant(context);
    void input.contract;
    const existing = await this.ports.repository.getVersion(context.tenantId, input.personaId, input.version);
    if (!existing) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona version was not found.");
    if (existing.status === "published") {
      throw new AsterError("VERSION_CONFLICT", 409, "Published persona versions are immutable.");
    }
    throw new AsterError("VERSION_CONFLICT", 409, "Use createVersion to create a new draft version.");
  }

  public async compileVersion(
    context: RequestContext,
    input: { readonly personaId: string; readonly version: number }
  ): Promise<CompiledBundle> {
    this.requireTenant(context);
    const personaVersion = await this.ports.repository.getVersion(context.tenantId, input.personaId, input.version);
    if (!personaVersion) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona version was not found.");
    assertPublished(personaVersion.status);
    await this.ports.plugins.validateReferences(personaVersion.contract.plugins ?? []);
    const bundle = compilePersonaContract(
      input.personaId,
      input.version,
      personaVersion.contract,
      this.ports.clock.nowIso()
    );
    await this.ports.repository.saveBundle(bundle, context.tenantId, context.actorId);
    await this.audit(
      context,
      "persona_version.compiled",
      "compiled_bundle",
      `${input.personaId}:${input.version}`,
      personaVersion.contentHash,
      bundle.contentHash
    );
    return bundle;
  }

  public async diffVersions(
    context: RequestContext,
    input: { readonly personaId: string; readonly fromVersion: number; readonly toVersion: number }
  ): Promise<PersonaDiff> {
    this.requireTenant(context);
    const from = await this.ports.repository.getVersion(context.tenantId, input.personaId, input.fromVersion);
    const to = await this.ports.repository.getVersion(context.tenantId, input.personaId, input.toVersion);
    if (!from || !to) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona version was not found.");
    const fromComponents = new Map(from.contract.components.map((component) => [component.id, sha256Hex(component)]));
    const changedComponents = to.contract.components
      .filter((component) => fromComponents.get(component.id) !== sha256Hex(component))
      .map((component) => component.id);
    const fromPolicies = new Set(from.contract.policyReferences.map((policy) => `${policy.id}@${policy.version}:${policy.required}`));
    const changedPolicyReferences = to.contract.policyReferences
      .filter((policy) => !fromPolicies.has(`${policy.id}@${policy.version}:${policy.required}`))
      .map((policy) => `${policy.id}@${policy.version}`);
    return {
      personaId: input.personaId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      changedComponents,
      changedPolicyReferences
    };
  }

  public async validatePlugin(context: RequestContext, input: unknown): Promise<{ readonly valid: true }> {
    this.requireTenant(context);
    const manifest: PluginManifest = parsePluginManifest(input);
    await this.ports.plugins.validateManifest(manifest);
    return { valid: true };
  }

  private async idempotent<T>(context: RequestContext, operation: string, create: () => Promise<T>): Promise<T> {
    const replayed = await this.ports.idempotency.replay<T>(context.tenantId, context.idempotencyKey, operation);
    if (replayed) return replayed;
    const response = await create();
    await this.ports.idempotency.record(context.tenantId, context.idempotencyKey, operation, response);
    return response;
  }

  private requireTenant(context: RequestContext): void {
    if (context.tenantId.length === 0 || context.actorId.length === 0) {
      throw new AsterError("TENANT_SCOPE_DENIED", 403, "Request cannot access this resource.");
    }
  }

  private async audit(
    context: RequestContext,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeHash: string | undefined,
    afterHash: string | undefined
  ): Promise<void> {
    await this.ports.audit.append({
      id: this.ports.ids.nextId("aud"),
      tenantId: context.tenantId,
      actorId: context.actorId,
      action,
      resourceType,
      resourceId,
      reason: "api_request",
      correlationId: context.correlationId,
      ...(beforeHash ? { beforeHash } : {}),
      ...(afterHash ? { afterHash } : {}),
      createdAt: this.ports.clock.nowIso()
    });
  }
}

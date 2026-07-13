import { canonicalJson, sha256Hex } from "./canonical.ts";
import { COMPILER_VERSION, compilePersonaContract, parseVerifiedCompiledBundle } from "./compiler.ts";
import { AsterError } from "./errors.ts";
import type { AtomicMutationPorts, AtomicMutationStore, AuditLog, Clock, IdGenerator, IdempotencyStore, PersonaRepository, PluginRegistry } from "./ports.ts";
import type { CompiledBundle, Persona, PersonaContract, PersonaDiff, PersonaVersion, PluginManifest, RequestContext } from "./types.ts";
import { assertPublished, parsePersonaContract, parsePluginManifest } from "./validation.ts";

export interface AsterServicePorts {
  readonly repository: PersonaRepository;
  readonly plugins: PluginRegistry;
  readonly idempotency: IdempotencyStore;
  readonly audit: AuditLog;
  readonly transactions: AtomicMutationStore;
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
    return this.idempotent(context, "createPersona", { actorId: context.actorId, input }, async (mutation) => {
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
      await mutation.repository.createPersona(persona);
      await this.audit(mutation.audit, context, "persona.created", "persona", persona.id, undefined, sha256Hex(persona));
      return persona;
    });
  }

  public async createVersion(
    context: RequestContext,
    input: { readonly personaId: string; readonly contract: unknown }
  ): Promise<PersonaVersion> {
    this.requireTenant(context);
    return this.idempotent(context, "createVersion", { actorId: context.actorId, input }, async (mutation) => {
      const persona = await mutation.repository.getPersona(context.tenantId, input.personaId);
      if (!persona) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona was not found.");
      const contract = parsePersonaContract(input.contract);
      await this.ports.plugins.validateReferences(context.tenantId, contract.plugins ?? []);
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
      const created = await mutation.repository.createVersion(personaVersion);
      await this.audit(
        mutation.audit,
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
    return this.idempotent(context, "publishVersion", { actorId: context.actorId, input }, async (mutation) => {
      const existing = await mutation.repository.getVersion(context.tenantId, input.personaId, input.version);
      if (!existing) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona version was not found.");
      if (existing.status !== "draft") {
        throw new AsterError("VERSION_CONFLICT", 409, "Only draft persona versions can be published.");
      }
      const updated = await mutation.repository.updateVersionStatus(
        context.tenantId,
        input.personaId,
        input.version,
        "published",
        this.ports.clock.nowIso()
      );
      if (!updated) throw new AsterError("RESOURCE_NOT_FOUND", 404, "Persona version was not found.");
      await this.audit(
        mutation.audit,
        context,
        "persona_version.published",
        "persona_version",
        `${input.personaId}:${input.version}`,
        existing.contentHash,
        updated.contentHash
      );
      return updated;
    });
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
    if (sha256Hex(personaVersion.contract) !== personaVersion.contentHash) {
      throw new AsterError("DEPENDENCY_UNAVAILABLE", 503, "Stored persona contract failed content-hash verification.");
    }
    await this.ports.plugins.validateReferences(context.tenantId, personaVersion.contract.plugins ?? []);
    const expectedBundle = compilePersonaContract(
      input.personaId,
      input.version,
      personaVersion.contract,
      personaVersion.updatedAt
    );
    const operation = `compileVersion:${COMPILER_VERSION}`;
    return this.idempotent(
      context,
      operation,
      { actorId: context.actorId, input, compilerVersion: COMPILER_VERSION, contractVersion: "1.1.0", expectedContentHash: expectedBundle.contentHash },
      async (mutation) => {
      const existingBundle = await mutation.repository.getBundle(
        context.tenantId,
        input.personaId,
        input.version,
        COMPILER_VERSION
      );
      if (existingBundle) {
        return this.verifyExpectedCompiledBundle(existingBundle, expectedBundle);
      }
      const bundle = expectedBundle;
      const saveResult = await mutation.repository.saveBundle(bundle, context.tenantId, context.actorId);
      if (saveResult === "existing") {
        const persistedBundle = await mutation.repository.getBundle(
          context.tenantId,
          input.personaId,
          input.version,
          COMPILER_VERSION
        );
        if (!persistedBundle) {
          throw new AsterError("DEPENDENCY_UNAVAILABLE", 503, "Stored compiled bundle was unavailable after a concurrent write.");
        }
        return this.verifyExpectedCompiledBundle(persistedBundle, expectedBundle);
      }
      if (saveResult === "created") {
        await this.audit(
          mutation.audit,
          context,
          "persona_version.compiled",
          "compiled_bundle",
          `${input.personaId}:${input.version}`,
          personaVersion.contentHash,
          bundle.contentHash
        );
      }
      return bundle;
      },
      (replayed) => this.verifyExpectedCompiledBundle(replayed, expectedBundle)
    );
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
    return this.idempotent(context, "validatePlugin", { actorId: context.actorId, manifest }, async () => {
      await this.ports.plugins.validateManifest(context.tenantId, manifest);
      return { valid: true };
    });
  }

  private async idempotent<T>(
    context: RequestContext,
    operation: string,
    request: unknown,
    create: (mutation: AtomicMutationPorts) => Promise<T>,
    replayValidator?: (replayed: unknown) => T
  ): Promise<T> {
    const idempotencyKey = context.idempotencyKey;
    if (!idempotencyKey) {
      throw new AsterError("IDEMPOTENCY_CONFLICT", 409, "State-changing operations require an idempotency key.");
    }
    const requestHash = sha256Hex(request);
    return this.ports.transactions.runAtomically({ tenantId: context.tenantId, idempotencyKey, operation }, async (mutation) => {
      const replayed = await mutation.idempotency.replay<unknown>(context.tenantId, idempotencyKey, operation, requestHash);
      if (replayed !== undefined) return replayValidator ? replayValidator(replayed) : replayed as T;
      const response = await create(mutation);
      await mutation.idempotency.record(context.tenantId, idempotencyKey, operation, requestHash, response);
      return response;
    });
  }

  private verifyExpectedCompiledBundle(candidate: unknown, expected: CompiledBundle): CompiledBundle {
    try {
      const verified = parseVerifiedCompiledBundle(candidate);
      if (canonicalJson(verified) !== canonicalJson(expected)) {
        throw new Error("Stored compiled bundle differs from the published persona version.");
      }
      return verified;
    } catch {
      throw new AsterError("DEPENDENCY_UNAVAILABLE", 503, "Stored compiled bundle failed integrity verification.");
    }
  }

  private requireTenant(context: RequestContext): void {
    if (context.tenantId.length === 0 || context.actorId.length === 0) {
      throw new AsterError("TENANT_SCOPE_DENIED", 403, "Request cannot access this resource.");
    }
  }

  private async audit(
    audit: AuditLog,
    context: RequestContext,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeHash: string | undefined,
    afterHash: string | undefined
  ): Promise<void> {
    await audit.append({
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

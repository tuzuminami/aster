export type VersionStatus = "draft" | "published" | "deprecated";

export interface RequestContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
}

export interface Persona {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface PersonaContract {
  readonly schemaVersion: "1.0";
  readonly persona: {
    readonly displayName: string;
    readonly purpose: string;
    readonly voice: readonly string[];
  };
  readonly components: readonly PersonaComponent[];
  readonly policyReferences: readonly PolicyReference[];
  readonly plugins?: readonly PluginReference[];
}

export interface PersonaComponent {
  readonly id: string;
  readonly type: "instruction" | "boundary" | "context";
  readonly body: string;
  readonly dependsOn?: readonly string[];
}

export interface PolicyReference {
  readonly id: string;
  readonly version: string;
  readonly required: boolean;
}

export interface PluginReference {
  readonly name: string;
  readonly version: string;
  readonly capability: "context_injector" | "renderer";
}

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly PluginReference["capability"][];
  readonly coreApiVersion: "v1";
  readonly enabled: boolean;
}

export interface PersonaVersion {
  readonly personaId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly status: VersionStatus;
  readonly contract: PersonaContract;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
}

export interface CompiledBundle {
  readonly personaId: string;
  readonly version: number;
  readonly compilerVersion: string;
  readonly contentHash: string;
  readonly provenance: {
    readonly sourceContractHash: string;
    readonly compiledAt: string;
    readonly componentIds: readonly string[];
    readonly policyReferenceIds: readonly string[];
    readonly pluginReferenceIds: readonly string[];
  };
  readonly context: {
    readonly displayName: string;
    readonly purpose: string;
    readonly instructions: readonly string[];
    readonly boundaries: readonly string[];
    readonly contextBlocks: readonly string[];
    readonly policyReferences: readonly PolicyReference[];
    readonly pluginReferences: readonly PluginReference[];
  };
}

export interface AuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly createdAt: string;
}

export interface PersonaDiff {
  readonly personaId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly changedComponents: readonly string[];
  readonly changedPolicyReferences: readonly string[];
}

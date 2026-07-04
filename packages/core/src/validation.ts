import { AsterError, validationError } from "./errors.js";
import type { PersonaContract, PluginManifest } from "./types.js";

const componentTypes = new Set(["instruction", "boundary", "context"]);
const pluginCapabilities = new Set(["context_injector", "renderer"]);

export const parsePersonaContract = (input: unknown): PersonaContract => {
  const value = asRecord(input, "contract");
  const errors: string[] = [];
  if (value.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");
  const persona = asOptionalRecord(value.persona);
  if (!persona) errors.push("persona is required");
  if (persona && typeof persona.displayName !== "string") errors.push("persona.displayName is required");
  if (persona && typeof persona.purpose !== "string") errors.push("persona.purpose is required");
  if (persona && !isStringArray(persona.voice)) errors.push("persona.voice must be a string array");
  if (!Array.isArray(value.components)) errors.push("components must be an array");
  if (!Array.isArray(value.policyReferences)) errors.push("policyReferences must be an array");
  if (value.plugins !== undefined && !Array.isArray(value.plugins)) errors.push("plugins must be an array");

  if (errors.length > 0) throw validationError(errors);

  const componentIds = new Set<string>();
  const components = (value.components as unknown[]).map((component, index) => {
    const item = asRecord(component, `components[${index}]`);
    if (typeof item.id !== "string" || item.id.length === 0) errors.push(`components[${index}].id is required`);
    if (typeof item.type !== "string" || !componentTypes.has(item.type)) {
      errors.push(`components[${index}].type is unknown`);
    }
    if (typeof item.body !== "string" || item.body.length === 0) errors.push(`components[${index}].body is required`);
    if (item.dependsOn !== undefined && !isStringArray(item.dependsOn)) {
      errors.push(`components[${index}].dependsOn must be a string array`);
    }
    if (typeof item.id === "string" && componentIds.has(item.id)) errors.push(`duplicate component id ${item.id}`);
    if (typeof item.id === "string") componentIds.add(item.id);
    const parsed = {
      id: String(item.id),
      type: item.type as "instruction" | "boundary" | "context",
      body: String(item.body)
    };
    return item.dependsOn === undefined ? parsed : { ...parsed, dependsOn: item.dependsOn as readonly string[] };
  });

  for (const component of components) {
    for (const dependency of component.dependsOn ?? []) {
      if (!componentIds.has(dependency)) errors.push(`component ${component.id} depends on missing ${dependency}`);
    }
  }
  detectCycles(components.map((component) => ({ id: component.id, dependsOn: component.dependsOn ?? [] })), errors);

  const policyReferences = (value.policyReferences as unknown[]).map((policy, index) => {
    const item = asRecord(policy, `policyReferences[${index}]`);
    if (typeof item.id !== "string" || item.id.length === 0) errors.push(`policyReferences[${index}].id is required`);
    if (typeof item.version !== "string" || item.version.length === 0) {
      errors.push(`policyReferences[${index}].version is required`);
    }
    if (typeof item.required !== "boolean") errors.push(`policyReferences[${index}].required is required`);
    return { id: String(item.id), version: String(item.version), required: Boolean(item.required) };
  });

  const plugins = (value.plugins as unknown[] | undefined)?.map((plugin, index) => {
    const item = asRecord(plugin, `plugins[${index}]`);
    if (typeof item.name !== "string" || item.name.length === 0) errors.push(`plugins[${index}].name is required`);
    if (typeof item.version !== "string" || item.version.length === 0) errors.push(`plugins[${index}].version is required`);
    if (typeof item.capability !== "string" || !pluginCapabilities.has(item.capability)) {
      errors.push(`plugins[${index}].capability is unknown`);
    }
    return {
      name: String(item.name),
      version: String(item.version),
      capability: item.capability as "context_injector" | "renderer"
    };
  });

  if (errors.length > 0) throw validationError(errors);
  return {
    schemaVersion: "1.0",
    persona: {
      displayName: String(persona?.displayName),
      purpose: String(persona?.purpose),
      voice: persona?.voice as readonly string[]
    },
    components,
    policyReferences,
    ...(plugins ? { plugins } : {})
  };
};

export const parsePluginManifest = (input: unknown): PluginManifest => {
  const value = asRecord(input, "manifest");
  const errors: string[] = [];
  if (typeof value.name !== "string" || value.name.length === 0) errors.push("name is required");
  if (typeof value.version !== "string" || value.version.length === 0) errors.push("version is required");
  if (!Array.isArray(value.capabilities)) errors.push("capabilities must be an array");
  if (value.coreApiVersion !== "v1") errors.push("coreApiVersion must be v1");
  if (typeof value.enabled !== "boolean") errors.push("enabled is required");
  for (const capability of Array.isArray(value.capabilities) ? value.capabilities : []) {
    if (typeof capability !== "string" || !pluginCapabilities.has(capability)) {
      errors.push(`unknown capability ${String(capability)}`);
    }
  }
  if (errors.length > 0) throw validationError(errors);
  return value as PluginManifest;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  const record = asOptionalRecord(value);
  if (!record) throw validationError([`${label} must be an object`]);
  return record;
};

const asOptionalRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const detectCycles = (
  components: readonly { id: string; dependsOn: readonly string[] }[],
  errors: string[]
): void => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(components.map((component) => [component.id, component.dependsOn]));
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`cyclic component reference at ${id}`);
      return;
    }
    visiting.add(id);
    for (const dependency of byId.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const component of components) visit(component.id);
};

export const assertPublished = (status: string): void => {
  if (status !== "published") {
    throw new AsterError("VERSION_CONFLICT", 409, "Persona version must be published before compilation.");
  }
};

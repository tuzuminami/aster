import { ASTER_CANONICALIZATION, ASTER_INTEGRITY_ENCODING, canonicalJson, sha256Hex } from "./canonical.ts";
import { validationError } from "./errors.ts";
import type { CompiledBundle, CompiledBundleCanonicalInput, PersonaContract } from "./types.ts";

export const COMPILER_VERSION = "aster-compiler/0.2.0";

export const compilePersonaContract = (
  personaId: string,
  version: number,
  contract: PersonaContract,
  compiledAt: string
): CompiledBundle => {
  const instructions = contract.components
    .filter((component) => component.type === "instruction")
    .map((component) => component.body);
  const boundaries = contract.components
    .filter((component) => component.type === "boundary")
    .map((component) => component.body);
  const contextBlocks = contract.components
    .filter((component) => component.type === "context")
    .map((component) => component.body);
  const sourceContractHash = sha256Hex(contract);
  const canonicalInput: CompiledBundleCanonicalInput = {
    personaId,
    version,
    compilerVersion: COMPILER_VERSION,
    sourceContractHash,
    compiledAt,
    componentIds: contract.components.map((component) => component.id),
    policyReferenceIds: contract.policyReferences.map((policy) => `${policy.id}@${policy.version}`),
    pluginReferenceIds: (contract.plugins ?? []).map((plugin) => `${plugin.name}@${plugin.version}:${plugin.capability}`),
    persona: contract.persona,
    instructions,
    boundaries,
    contextBlocks,
    policyReferences: contract.policyReferences,
    pluginReferences: contract.plugins ?? []
  };
  const contentHash = sha256Hex(canonicalJson(canonicalInput));
  return {
    personaId,
    version,
    compilerVersion: COMPILER_VERSION,
    contentHash,
    integrity: {
      algorithm: "sha256",
      canonicalization: ASTER_CANONICALIZATION,
      encoding: ASTER_INTEGRITY_ENCODING,
      canonicalInput
    },
    provenance: {
      sourceContractHash,
      compiledAt,
      componentIds: canonicalInput.componentIds,
      policyReferenceIds: canonicalInput.policyReferenceIds,
      pluginReferenceIds: canonicalInput.pluginReferenceIds
    },
    context: {
      displayName: contract.persona.displayName,
      purpose: contract.persona.purpose,
      instructions,
      boundaries,
      contextBlocks,
      policyReferences: contract.policyReferences,
      pluginReferences: contract.plugins ?? []
    }
  };
};

const hasValidCompiledBundleIntegrity = (bundle: CompiledBundle): boolean =>
  bundle.compilerVersion === COMPILER_VERSION &&
  bundle.integrity.algorithm === "sha256" &&
  bundle.integrity.canonicalization === ASTER_CANONICALIZATION &&
  bundle.integrity.encoding === ASTER_INTEGRITY_ENCODING &&
  bundle.integrity.canonicalInput.personaId === bundle.personaId &&
  bundle.integrity.canonicalInput.version === bundle.version &&
  bundle.integrity.canonicalInput.compilerVersion === bundle.compilerVersion &&
  bundle.integrity.canonicalInput.sourceContractHash === bundle.provenance.sourceContractHash &&
  bundle.integrity.canonicalInput.compiledAt === bundle.provenance.compiledAt &&
  canonicalJson(bundle.integrity.canonicalInput.componentIds) === canonicalJson(bundle.provenance.componentIds) &&
  canonicalJson(bundle.integrity.canonicalInput.policyReferenceIds) === canonicalJson(bundle.provenance.policyReferenceIds) &&
  canonicalJson(bundle.integrity.canonicalInput.pluginReferenceIds) === canonicalJson(bundle.provenance.pluginReferenceIds) &&
  bundle.integrity.canonicalInput.persona.displayName === bundle.context.displayName &&
  bundle.integrity.canonicalInput.persona.purpose === bundle.context.purpose &&
  canonicalJson(bundle.integrity.canonicalInput.instructions) === canonicalJson(bundle.context.instructions) &&
  canonicalJson(bundle.integrity.canonicalInput.boundaries) === canonicalJson(bundle.context.boundaries) &&
  canonicalJson(bundle.integrity.canonicalInput.contextBlocks) === canonicalJson(bundle.context.contextBlocks) &&
  canonicalJson(bundle.integrity.canonicalInput.policyReferences) === canonicalJson(bundle.context.policyReferences) &&
  canonicalJson(bundle.integrity.canonicalInput.pluginReferences) === canonicalJson(bundle.context.pluginReferences) &&
  sha256Hex(canonicalJson(bundle.integrity.canonicalInput)) === bundle.contentHash;

/**
 * Validates untrusted CompiledBundle JSON against the closed v1.1 contract,
 * checks its projections, and recomputes its hash before returning it.
 */
export const parseVerifiedCompiledBundle = (input: unknown): CompiledBundle => {
  const errors: string[] = [];
  const bundle = record(input, "bundle", errors);
  exactKeys(bundle, ["personaId", "version", "compilerVersion", "contentHash", "integrity", "provenance", "context"], "bundle", errors);
  nonEmptyString(bundle.personaId, "bundle.personaId", errors);
  positiveInteger(bundle.version, "bundle.version", errors);
  literal(bundle.compilerVersion, COMPILER_VERSION, "bundle.compilerVersion", errors);
  hash(bundle.contentHash, "bundle.contentHash", errors);

  const integrity = record(bundle.integrity, "bundle.integrity", errors);
  exactKeys(integrity, ["algorithm", "canonicalization", "encoding", "canonicalInput"], "bundle.integrity", errors);
  literal(integrity.algorithm, "sha256", "bundle.integrity.algorithm", errors);
  literal(integrity.canonicalization, ASTER_CANONICALIZATION, "bundle.integrity.canonicalization", errors);
  literal(integrity.encoding, ASTER_INTEGRITY_ENCODING, "bundle.integrity.encoding", errors);
  validateCanonicalInput(record(integrity.canonicalInput, "bundle.integrity.canonicalInput", errors), errors);

  validateProvenance(record(bundle.provenance, "bundle.provenance", errors), errors);
  validateContext(record(bundle.context, "bundle.context", errors), errors);
  if (errors.length > 0) throw validationError(errors);

  const parsed = input as CompiledBundle;
  if (!hasValidCompiledBundleIntegrity(parsed)) {
    throw validationError(["bundle integrity projection or contentHash is invalid"]);
  }
  return parsed;
};

const validateCanonicalInput = (value: Record<string, unknown>, errors: string[]): void => {
  exactKeys(value, ["personaId", "version", "compilerVersion", "sourceContractHash", "compiledAt", "componentIds", "policyReferenceIds", "pluginReferenceIds", "persona", "instructions", "boundaries", "contextBlocks", "policyReferences", "pluginReferences"], "bundle.integrity.canonicalInput", errors);
  nonEmptyString(value.personaId, "bundle.integrity.canonicalInput.personaId", errors);
  positiveInteger(value.version, "bundle.integrity.canonicalInput.version", errors);
  literal(value.compilerVersion, COMPILER_VERSION, "bundle.integrity.canonicalInput.compilerVersion", errors);
  hash(value.sourceContractHash, "bundle.integrity.canonicalInput.sourceContractHash", errors);
  isoTimestamp(value.compiledAt, "bundle.integrity.canonicalInput.compiledAt", errors);
  nonEmptyStringArray(value.componentIds, "bundle.integrity.canonicalInput.componentIds", errors);
  nonEmptyStringArray(value.policyReferenceIds, "bundle.integrity.canonicalInput.policyReferenceIds", errors);
  nonEmptyStringArray(value.pluginReferenceIds, "bundle.integrity.canonicalInput.pluginReferenceIds", errors);
  validatePersona(record(value.persona, "bundle.integrity.canonicalInput.persona", errors), "bundle.integrity.canonicalInput.persona", errors);
  nonEmptyStringArray(value.instructions, "bundle.integrity.canonicalInput.instructions", errors);
  nonEmptyStringArray(value.boundaries, "bundle.integrity.canonicalInput.boundaries", errors);
  nonEmptyStringArray(value.contextBlocks, "bundle.integrity.canonicalInput.contextBlocks", errors);
  validatePolicyReferences(value.policyReferences, "bundle.integrity.canonicalInput.policyReferences", errors);
  validatePluginReferences(value.pluginReferences, "bundle.integrity.canonicalInput.pluginReferences", errors);
};

const validateProvenance = (value: Record<string, unknown>, errors: string[]): void => {
  exactKeys(value, ["sourceContractHash", "compiledAt", "componentIds", "policyReferenceIds", "pluginReferenceIds"], "bundle.provenance", errors);
  hash(value.sourceContractHash, "bundle.provenance.sourceContractHash", errors);
  isoTimestamp(value.compiledAt, "bundle.provenance.compiledAt", errors);
  nonEmptyStringArray(value.componentIds, "bundle.provenance.componentIds", errors);
  nonEmptyStringArray(value.policyReferenceIds, "bundle.provenance.policyReferenceIds", errors);
  nonEmptyStringArray(value.pluginReferenceIds, "bundle.provenance.pluginReferenceIds", errors);
};

const validateContext = (value: Record<string, unknown>, errors: string[]): void => {
  exactKeys(value, ["displayName", "purpose", "instructions", "boundaries", "contextBlocks", "policyReferences", "pluginReferences"], "bundle.context", errors);
  nonEmptyString(value.displayName, "bundle.context.displayName", errors);
  nonEmptyString(value.purpose, "bundle.context.purpose", errors);
  nonEmptyStringArray(value.instructions, "bundle.context.instructions", errors);
  nonEmptyStringArray(value.boundaries, "bundle.context.boundaries", errors);
  nonEmptyStringArray(value.contextBlocks, "bundle.context.contextBlocks", errors);
  validatePolicyReferences(value.policyReferences, "bundle.context.policyReferences", errors);
  validatePluginReferences(value.pluginReferences, "bundle.context.pluginReferences", errors);
};

const validatePersona = (value: Record<string, unknown>, path: string, errors: string[]): void => {
  exactKeys(value, ["displayName", "purpose", "voice"], path, errors);
  nonEmptyString(value.displayName, `${path}.displayName`, errors);
  nonEmptyString(value.purpose, `${path}.purpose`, errors);
  nonEmptyStringArray(value.voice, `${path}.voice`, errors);
};

const validatePolicyReferences = (value: unknown, path: string, errors: string[]): void => {
  for (const [index, item] of array(value, path, errors).entries()) {
    const referencePath = `${path}[${index}]`;
    const reference = record(item, referencePath, errors);
    exactKeys(reference, ["id", "version", "required"], referencePath, errors);
    nonEmptyString(reference.id, `${referencePath}.id`, errors);
    nonEmptyString(reference.version, `${referencePath}.version`, errors);
    if (typeof reference.required !== "boolean") errors.push(`${referencePath}.required must be boolean`);
  }
};

const validatePluginReferences = (value: unknown, path: string, errors: string[]): void => {
  for (const [index, item] of array(value, path, errors).entries()) {
    const referencePath = `${path}[${index}]`;
    const reference = record(item, referencePath, errors);
    exactKeys(reference, ["name", "version", "capability"], referencePath, errors);
    nonEmptyString(reference.name, `${referencePath}.name`, errors);
    nonEmptyString(reference.version, `${referencePath}.version`, errors);
    if (reference.capability !== "context_injector" && reference.capability !== "renderer") {
      errors.push(`${referencePath}.capability is invalid`);
    }
  }
};

const record = (value: unknown, path: string, errors: string[]): Record<string, unknown> => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  errors.push(`${path} must be an object`);
  return {};
};
const array = (value: unknown, path: string, errors: string[]): readonly unknown[] => {
  if (Array.isArray(value)) return value;
  errors.push(`${path} must be an array`);
  return [];
};
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]): void => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
  for (const key of allowed) if (!(key in value)) errors.push(`${path}.${key} is required`);
};
const nonEmptyString = (value: unknown, path: string, errors: string[]): void => {
  if (typeof value !== "string" || value.length === 0) errors.push(`${path} must be a non-empty string`);
};
const nonEmptyStringArray = (value: unknown, path: string, errors: string[]): void => {
  for (const [index, item] of array(value, path, errors).entries()) nonEmptyString(item, `${path}[${index}]`, errors);
};
const positiveInteger = (value: unknown, path: string, errors: string[]): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) errors.push(`${path} must be a positive safe integer`);
};
const literal = (value: unknown, expected: string, path: string, errors: string[]): void => {
  if (value !== expected) errors.push(`${path} must be ${expected}`);
};
const hash = (value: unknown, path: string, errors: string[]): void => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) errors.push(`${path} must be a SHA-256 hash`);
};
const isoTimestamp = (value: unknown, path: string, errors: string[]): void => {
  if (typeof value !== "string") {
    errors.push(`${path} must be an RFC 3339 timestamp`);
    return;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    errors.push(`${path} must be an RFC 3339 timestamp`);
    return;
  }
  const yearValue = Number(match[1]!);
  const monthValue = Number(match[2]!);
  const dayValue = Number(match[3]!);
  const hourValue = Number(match[4]!);
  const minuteValue = Number(match[5]!);
  const secondValue = Number(match[6]!);
  const zone = match[7]!;
  const validDate =
    yearValue >= 0 && monthValue >= 1 && monthValue <= 12 &&
    dayValue >= 1 && dayValue <= new Date(Date.UTC(yearValue, monthValue, 0)).getUTCDate() &&
    hourValue <= 23 && minuteValue <= 59 && secondValue <= 59 &&
    (zone === "Z" || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59));
  if (!validDate || Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an RFC 3339 timestamp`);
  }
};

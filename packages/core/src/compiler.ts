import { canonicalJson, sha256Hex } from "./canonical.js";
import type { CompiledBundle, PersonaContract } from "./types.js";

export const COMPILER_VERSION = "aster-compiler/0.1.0";

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
  const body = {
    compilerVersion: COMPILER_VERSION,
    sourceContractHash,
    persona: contract.persona,
    instructions,
    boundaries,
    contextBlocks,
    policyReferences: contract.policyReferences
  };
  const contentHash = sha256Hex(canonicalJson(body));
  return {
    personaId,
    version,
    compilerVersion: COMPILER_VERSION,
    contentHash,
    provenance: {
      sourceContractHash,
      compiledAt,
      componentIds: contract.components.map((component) => component.id),
      policyReferenceIds: contract.policyReferences.map((policy) => `${policy.id}@${policy.version}`)
    },
    context: {
      displayName: contract.persona.displayName,
      purpose: contract.persona.purpose,
      instructions,
      boundaries,
      contextBlocks,
      policyReferences: contract.policyReferences
    }
  };
};

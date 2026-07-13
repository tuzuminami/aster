import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compilePersonaContract } from "../packages/core/src/compiler.ts";
import { parsePersonaContract } from "../packages/core/src/validation.ts";

test("AT-AST-022 compiled bundle schema and fixture are versioned compiler output", () => {
  const schema = JSON.parse(readFileSync("packages/contracts/schemas/compiled-bundle.schema.json", "utf8"));
  const fixture = JSON.parse(readFileSync("packages/contracts/fixtures/compiled-bundle.v1.json", "utf8"));
  const source = JSON.parse(readFileSync("examples/persona-contract.json", "utf8"));
  const compiled = compilePersonaContract("persona_contract_fixture", 1, parsePersonaContract(source), "2026-07-13T00:00:00.000Z");

  assert.equal(schema.$id, "https://tuzuminami.github.io/aster/contracts/compiled-bundle/1.0.0/schema.json");
  assert.equal(schema["x-aster-contract-version"], "1.0.0");
  assert.equal(schema.properties.contentHash.pattern, "^[a-f0-9]{64}$");
  assert.deepEqual(fixture, compiled);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compilePersonaContract } from "../packages/core/src/compiler.ts";
import { parsePersonaContract } from "../packages/core/src/validation.ts";

const input = JSON.parse(readFileSync("examples/persona-contract.json", "utf8"));
const fixture = compilePersonaContract("persona_contract_fixture", 1, parsePersonaContract(input), "2026-07-13T00:00:00.000Z");
const output = `${JSON.stringify(fixture, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const checkedIn = readFileSync("packages/contracts/fixtures/compiled-bundle.v1.json", "utf8");
  if (checkedIn !== output) throw new Error("CompiledBundle fixture is stale; regenerate it with scripts/generate-compiled-bundle-fixture.ts.");
} else {
  process.stdout.write(output);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--check")) {
  console.log("CompiledBundle fixture is current.");
}

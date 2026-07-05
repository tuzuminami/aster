import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

interface DryRunPackFile {
  readonly path: string;
}

interface DryRunPackResult {
  readonly files: readonly DryRunPackFile[];
}

test("AT-AST-011 package dry-run excludes local-only control and data paths", () => {
  const raw = execFileSync("pnpm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(raw) as DryRunPackResult | readonly DryRunPackResult[];
  const result: DryRunPackResult | undefined = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!result) assert.fail("pnpm pack dry-run did not return a package manifest");

  const packedPaths = result.files.map((file: DryRunPackFile) => file.path);
  assert.ok(packedPaths.includes("LICENSE"));
  assert.ok(packedPaths.includes("README.md"));
  assert.ok(packedPaths.includes("packages/contracts/openapi/openapi.yaml"));
  assert.ok(packedPaths.includes("packages/contracts/schemas/persona-contract.schema.json"));
  assert.ok(packedPaths.includes("examples/persona-contract.json"));

  const forbiddenPathPatterns = [/\.private/i, /^docs\/(?:0[0-9]|10)_/, /private-fixtures/i, /evidence-private/i];
  const leakedPath = packedPaths.find((path: string) => forbiddenPathPatterns.some((pattern) => pattern.test(path)));
  assert.equal(leakedPath, undefined);
});

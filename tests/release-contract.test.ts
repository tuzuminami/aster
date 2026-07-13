import assert from "node:assert/strict";
import test from "node:test";

const scriptPath = import.meta.url.includes("/dist/tests/")
  ? new URL("../../scripts/check-release-contract.mjs", import.meta.url)
  : new URL("../scripts/check-release-contract.mjs", import.meta.url);
const { validateReleaseContract } = await import(scriptPath.href);

test("AT-AST-023 release contract aligns the package and OpenAPI versions", () => {
  const compileContract = `
paths:
  /v1/personas/{personaId}/versions/{version}/compile:
    post:
      responses:
        "200":
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CompiledBundle"
components:
  schemas:
    CompiledBundle:
      $ref: "../schemas/compiled-bundle.schema.json"
`;
  assert.doesNotThrow(() => validateReleaseContract({ packageVersion: "1.2.3", openApi: `openapi: 3.1.0\ninfo:\n  version: 1.2.3\n${compileContract}` }));
  assert.throws(() => validateReleaseContract({ packageVersion: "1.2.3", openApi: `openapi: 3.1.0\ninfo:\n  version: 1.2.2\n${compileContract}` }), /must equal package version/);
});

import { readFileSync } from "node:fs";

export function validateReleaseContract({ packageVersion, openApi }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
    throw new Error("release-contract: package version must be SemVer");
  }
  const openApiVersion = /^info:\n(?:.*\n)*?  version:\s*([^\s#]+)\s*$/m.exec(openApi)?.[1];
  if (openApiVersion !== packageVersion) {
    throw new Error(`release-contract: OpenAPI info.version must equal package version ${packageVersion}`);
  }
  const compilePath = openApi.indexOf("/v1/personas/{personaId}/versions/{version}/compile:");
  const nextPath = openApi.indexOf("\n  /", compilePath + 1);
  const compileOperation = compilePath === -1 ? "" : openApi.slice(compilePath, nextPath === -1 ? undefined : nextPath);
  if (!compileOperation.includes('$ref: "#/components/schemas/CompiledBundle"')) {
    throw new Error("release-contract: compile response must expose CompiledBundle");
  }
  if (!openApi.includes('CompiledBundle:\n      $ref: "../schemas/compiled-bundle.schema.json"')) {
    throw new Error("release-contract: CompiledBundle must reference the versioned public schema");
  }
}

if (process.argv[1]?.endsWith("check-release-contract.mjs")) {
  const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  validateReleaseContract({ packageVersion, openApi: readFileSync("packages/contracts/openapi/openapi.yaml", "utf8") });
  console.log(`Release contract check passed for ASTER v${packageVersion}.`);
}

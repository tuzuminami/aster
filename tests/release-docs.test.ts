import assert from "node:assert/strict";
import test from "node:test";

const scriptPath = import.meta.url.includes("/dist/tests/")
  ? new URL("../../scripts/check-release-docs.mjs", import.meta.url)
  : new URL("../scripts/check-release-docs.mjs", import.meta.url);
const { validateReleaseDocs } = await import(scriptPath.href);

function docs(readmeExtra = "") {
  return `# ASTER

## v1 Scope

ASTER v1.0.0 established the first stable public release of the Persona Contract Compiler.

${readmeExtra}

## Compatibility and Composition

ASTER follows semantic versioning for its published package API. This is optional transport-level composition.`;
}

function releaseDocs(readmeExtra = "", security?: string) {
  return [
    { path: "README.md", content: docs(readmeExtra) },
    { path: "SECURITY.md", content: security ?? "ASTER v1.x receives security fixes for the latest supported v1 release." }
  ];
}

test("release documentation accepts historical pre-v1 migration language", () => {
  assert.doesNotThrow(() =>
    validateReleaseDocs({
      version: "1.0.0",
      docs: releaseDocs(`${""}\n\n## Migration History\n\nASTER v0.2 was the current stable release before v1.0.0.`)
    })
  );
});

test("release documentation rejects pre-v1 status drift", () => {
  assert.throws(
    () => validateReleaseDocs({ version: "1.0.0", docs: releaseDocs("ASTER v0.2 is the current stable release.") }),
    /must not present a pre-v1 release/
  );
});

test("release documentation rejects alternate pre-v1 current-release statements", () => {
  for (const status of ["Current stable release: ASTER v0.2.", "v0.2 is the latest release.", "The latest release is\nASTER v0.2."]) {
    assert.throws(() => validateReleaseDocs({ version: "1.0.0", docs: releaseDocs(status) }), /must not present a pre-v1 release/);
  }
});

test("release documentation permits an explicit historical negation", () => {
  assert.doesNotThrow(() =>
    validateReleaseDocs({ version: "1.0.0", docs: releaseDocs("ASTER v0.2 is no longer the current stable release.") })
  );
});

test("release documentation requires a v1 security support policy", () => {
  assert.throws(
    () => validateReleaseDocs({ version: "1.0.0", docs: releaseDocs("", "ASTER is pre-1.0.") }),
    /SECURITY.md must identify the supported v1 release series/
  );
});

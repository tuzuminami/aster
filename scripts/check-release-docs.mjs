import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function validateReleaseDocs({ version, docs }) {
  const firstStableVersion = "1.0.0";
  const readme = getDocument(docs, "README.md");
  const security = getDocument(docs, "SECURITY.md");
  const supportedMajor = version.split(".")[0];
  const v1Scope = section(readme, "## v1 Scope");

  check(/^\d+\.\d+\.\d+$/.test(version), "package version must be stable semver");
  check(
    v1Scope.includes(`ASTER v${firstStableVersion} established the first stable public release`),
    "README v1 Scope must preserve the historical first stable release"
  );
  check(readme.includes("## v1 Scope"), "README must identify the supported v1 release series");
  check(readme.includes("follows semantic versioning"), "README must publish the compatibility policy");
  check(
    readme.includes("optional transport-level composition"),
    "README must describe optional DRIFT composition without a runtime dependency"
  );
  check(
    security.includes(`ASTER v${supportedMajor}.x receives security fixes`),
    `SECURITY.md must identify the supported v${supportedMajor} release series`
  );
  check(!/\bpre[- ]1\.0\b/i.test(security), "SECURITY.md must not describe ASTER as pre-1.0");

  for (const doc of docs) {
    const currentFacingContent = doc.path === "README.md" ? withoutSections(doc.content, ["Migration History"]) : doc.content;
    check(
      !presentsPreV1AsCurrent(currentFacingContent),
      `${doc.path} must not present a pre-v1 release as current, latest, supported, or stable`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  validateReleaseDocs({
    version: packageJson.version,
    docs: [
      { path: "README.md", content: readFileSync("README.md", "utf8") },
      { path: "SECURITY.md", content: readFileSync("SECURITY.md", "utf8") }
    ]
  });
  console.log(`Release documentation check passed for ASTER v${packageJson.version}.`);
}

function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return "";
  const nextHeading = markdown.indexOf("\n## ", start + heading.length);
  return markdown.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

function getDocument(docs, path) {
  const document = docs.find((entry) => entry.path === path);
  if (!document) throw new Error(`RELEASE DOCS CHECK FAIL: missing required document ${path}`);
  return document.content;
}

function withoutSections(markdown, headings) {
  const lines = markdown.split("\n");
  let excluded = false;
  return lines.filter((line) => {
    if (/^##\s/.test(line)) excluded = headings.includes(line.replace(/^##\s+/, "").trim());
    return !excluded;
  }).join("\n");
}

function presentsPreV1AsCurrent(markdown) {
  const content = markdown.replace(/\s+/g, " ");
  const version = "(?:ASTER\\s+)?v0\\.\\d+(?:\\.\\d+)?";
  return [
    new RegExp(`\\b${version}\\b[^.]{0,100}\\b(?:is(?!\\s+no longer\\b)|remains|continues to be)\\b[^.]{0,100}\\b(?:current|latest|supported|stable)\\b`, "i"),
    new RegExp(`\\b(?:current|latest|supported|stable)(?:\\s+\\w+){0,4}\\s*:\\s*${version}\\b`, "i"),
    new RegExp(`\\b(?:current|latest|supported|stable)(?:\\s+release)?\\s+is\\s+${version}\\b`, "i")
  ].some((pattern) => pattern.test(content));
}

function check(condition, message) {
  if (!condition) throw new Error(`RELEASE DOCS CHECK FAIL: ${message}`);
}

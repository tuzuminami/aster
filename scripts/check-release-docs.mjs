import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readme = readFileSync("README.md", "utf8");

check(/^\d+\.\d+\.\d+$/.test(packageJson.version), "package version must be stable semver");
check(readme.includes(`ASTER v${packageJson.version} is the first stable public release`), "README must state the current stable release");
check(readme.includes("follows semantic versioning"), "README must publish the compatibility policy");
check(readme.includes("optional transport-level composition"), "README must describe optional DRIFT composition without a runtime dependency");
check(!/\bv0\.[0-9]+\b/i.test(readme), "README must not contain stale pre-v1 release language");

console.log(`Release documentation check passed for ASTER v${packageJson.version}.`);

function check(condition, message) {
  if (!condition) {
    console.error(`RELEASE DOCS CHECK FAIL: ${message}`);
    process.exit(1);
  }
}

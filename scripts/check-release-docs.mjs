import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const readme = readFileSync("README.md", "utf8");
const firstStableVersion = "1.0.0";

check(/^\d+\.\d+\.\d+$/.test(packageJson.version), "package version must be stable semver");
check(readme.includes(`ASTER v${firstStableVersion} established the first stable public release`), "README must preserve the historical first stable release");
check(readme.includes("## v1 Scope"), "README must identify the supported v1 release series");
check(readme.includes("follows semantic versioning"), "README must publish the compatibility policy");
check(readme.includes("optional transport-level composition"), "README must describe optional DRIFT composition without a runtime dependency");
check(!/This v0\.[0-9]+ foundation includes/i.test(readme), "README must not present a pre-v1 release as current scope");

console.log(`Release documentation check passed for ASTER v${packageJson.version}.`);

function check(condition, message) {
  if (!condition) {
    console.error(`RELEASE DOCS CHECK FAIL: ${message}`);
    process.exit(1);
  }
}

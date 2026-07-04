import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const prohibitedPath = /(^|\/)(CODEX(_AI_COMPANION_OSS)?_IMPLEMENTATION_HARNESS\.md|AGENTS_PRIVATE\.md|README_PRIVATE\.md|AGENTS\.private\.md|00_GLOSSARY\.md|01_BMA\.md|02_StRS\.md|03_SyRS\.md|04_AD\.md|05_DD\.md|06_API_CONTRACT\.md|07_VV_PLAN\.md|08_TRACEABILITY\.md|09_MVP_BACKLOG\.md|10_RELEASE_CRITERIA\.md|private-ai-control-plane|\.private|\.codex-private|docs\/(ai|private))($|\/)/;
const privateMarkers = [
  ["PRIVATE", "_SPECIFICATION", "_DO_NOT_COMMIT"].join(""),
  ["PRIVATE", "_OPERATOR", "_MATERIAL"].join(""),
  ["DO_NOT", "_COMMIT", "_OR_PUBLISH"].join("")
];
const prohibitedData = /(^|\/)(\.env$|[^/]+\.(sqlite|db|dump|jsonl)$|evidence-private|private-fixtures)($|\/)/;

const deleted = new Set(listGit(["diff", "--cached", "--name-only", "--diff-filter=D"]));
const tracked = listGit(["ls-files"]).filter((file) => !deleted.has(file));
const staged = listGit(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]);
const files = new Set([...tracked, ...staged]);
const failures = [];

for (const file of files) {
  if (prohibitedPath.test(file)) failures.push(`prohibited path: ${file}`);
  if (prohibitedData.test(file) && file !== ".env.example") failures.push(`prohibited local data: ${file}`);
  if (isReadableFile(file)) {
    const content = readFileSync(file, "utf8");
    if (privateMarkers.some((marker) => content.includes(marker))) failures.push(`private marker in: ${file}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`Private boundary check passed for ${files.size} files.`);

function listGit(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isReadableFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

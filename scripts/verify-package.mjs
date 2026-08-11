import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  createPackageArtifact,
  extractPackageArtifact,
  listPackageFiles,
  readJson,
  sha256,
} from "./package-artifact.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "stella-package-"));

try {
  const artifact = resolveArtifact(process.argv.slice(2));
  const packageRoot = extractPackageArtifact({ artifact, temporaryRoot });
  const files = listPackageFiles(packageRoot);
  const packageJson = readJson(join(packageRoot, "package.json"));
  const manifest = readJson(join(packageRoot, "openclaw.plugin.json"));
  const blockers = [];
  const required = [
    "dist/plugin.js",
    "dist/scenario/harness.js",
    "openclaw.plugin.json",
    "package.json",
    "README.md",
    "LICENSE",
    "NOTICE",
  ];
  const forbiddenPrefixes = [
    "sources/",
    "knowledge/",
    "test/",
    "tests/",
    "docs/quality/",
    "benchmarks/",
    "pilot/",
    "node_modules/",
    "personal-data/",
    "runtime-data/",
  ];
  const forbiddenExtensions = [
    ".docx",
    ".xlsx",
    ".xls",
    ".csv",
    ".heic",
    ".jpeg",
    ".jpg",
    ".png",
    ".webp",
  ];
  const forbiddenPaths = files.filter((path) =>
    forbiddenPrefixes.some((prefix) => path.startsWith(prefix)) ||
    forbiddenExtensions.some((extension) =>
      path.toLowerCase().endsWith(extension),
    ),
  );

  for (const path of required) {
    if (!files.includes(path)) {
      blockers.push(`Package is missing required file: ${path}`);
    }
  }
  for (const path of forbiddenPaths) {
    blockers.push(`Package includes forbidden path: ${path}`);
  }
  validateIdentity(packageJson, manifest, blockers);
  validateRecordingOnlySurface(packageJson, manifest, blockers);
  validateReleaseStatements(packageRoot, blockers);

  if (blockers.length > 0) {
    process.stderr.write(
      `Package verification failed:\n${blockers.map((blocker) => `- ${blocker}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${JSON.stringify({
        artifact,
        courseDerivativePaths: files.filter((path) =>
          path.startsWith("dist/program/fidelity/"),
        ).length,
        files: files.length,
        forbiddenPaths: 0,
        package: `${packageJson.name}@${packageJson.version}`,
        sha256: sha256(readFileSync(artifact)),
      })}\n`,
    );
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function resolveArtifact(args) {
  if (args.length === 0) {
    return createPackageArtifact({ workspace, temporaryRoot });
  }
  if (args.length !== 2 || args[0] !== "--artifact") {
    throw new Error("Usage: verify-package.mjs [--artifact <package.tgz>]");
  }
  return resolve(args[1]);
}

function validateIdentity(packageJson, manifest, blockers) {
  if (packageJson.name !== "@tower1229/stella-fitness") {
    blockers.push(`Unexpected package identity: ${String(packageJson.name)}`);
  }
  if (manifest.id !== "stella-fitness") {
    blockers.push(`Unexpected Plugin identity: ${String(manifest.id)}`);
  }
  if (manifest.version !== packageJson.version) {
    blockers.push("Plugin manifest version does not match package version");
  }
}

function validateRecordingOnlySurface(packageJson, manifest, blockers) {
  if (
    typeof packageJson.description !== "string" ||
    !packageJson.description.toLowerCase().includes("recording-only")
  ) {
    blockers.push("Package description must identify the recording-only scope");
  }
  const forbiddenSurface = /diagnos|nutrition|safety|policy|supervis|cron|periodic/iu;
  const exportNames = Object.keys(packageJson.exports ?? {});
  for (const exportName of exportNames) {
    if (forbiddenSurface.test(exportName)) {
      blockers.push(`Package exposes forbidden capability: ${exportName}`);
    }
  }
  const configProperties = Object.keys(
    manifest.configSchema?.properties ?? {},
  );
  for (const property of configProperties) {
    if (forbiddenSurface.test(property)) {
      blockers.push(`Plugin config exposes forbidden capability: ${property}`);
    }
  }
  const activationProperties = Object.keys(manifest.activation ?? {});
  for (const property of activationProperties) {
    if (property !== "onStartup") {
      blockers.push(`Plugin exposes unsupported activation: ${property}`);
    }
  }
  if (manifest.configSchema?.additionalProperties !== false) {
    blockers.push("Plugin config must fail closed on unknown capabilities");
  }
}

function validateReleaseStatements(packageRoot, blockers) {
  const readmePath = join(packageRoot, "README.md");
  if (!existsSync(readmePath)) {
    return;
  }
  const readme = readFileSync(readmePath, "utf8");
  const requiredStatements = [
    "Personal Data Directory",
    "Runtime Directory",
    "Sanitized Media Copy",
    "Tests demonstrate implementation fidelity only; they are not professional endorsement.",
  ];
  for (const statement of requiredStatements) {
    if (!readme.includes(statement)) {
      blockers.push(`README is missing release statement: ${statement}`);
    }
  }
}

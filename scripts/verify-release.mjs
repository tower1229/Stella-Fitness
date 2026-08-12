import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const temporaryRoot = mkdtempSync(join(tmpdir(), "stella-release-"));
const builtInWorkbookPath = "dist/assets/zhuoshu-workout-log.xlsx";

try {
  verifyRelease();
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function verifyRelease() {
  const options = parseOptions(process.argv.slice(2));
  const artifact = options.artifact ?? createArtifact();
  const packageRoot = extractPackageArtifact({ artifact, temporaryRoot });
  const packageJson = readJson(join(packageRoot, "package.json"));
  const derivativePaths = listPackageFiles(packageRoot).filter((path) =>
    path.startsWith("dist/program/fidelity/") ||
    path === builtInWorkbookPath
  );
  const blockers = [];

  if (packageJson.name !== "@tower1229/stella-fitness") {
    blockers.push(
      `Unexpected package identity: ${String(packageJson.name)}`,
    );
  }
  if (packageJson.private === true) {
    blockers.push(
      "package.json remains private until every public-release gate passes",
    );
  }
  if (derivativePaths.length === 0) {
    blockers.push("Artifact is missing the Built-in Program derivative");
  }

  const authorizationPath = options.authorization ??
    process.env.STELLA_RELEASE_AUTHORIZATION_PATH ??
    join(workspace, "release/course-derivative-authorization.json");
  if (!existsSync(authorizationPath)) {
    blockers.push(
      `Course-derivative authorization evidence is required: ${authorizationPath}`,
    );
    return blockRelease(blockers);
  }

  const authorization = readJson(authorizationPath);
  validateAuthorizationShape(authorization, blockers);
  const authorizationId = requiredString(
    authorization.authorizationId,
    "authorizationId",
    blockers,
  );
  const modifications = requiredString(
    authorization.modifications,
    "modifications",
    blockers,
  );
  const attribution = requiredString(
    authorization.attribution,
    "attribution",
    blockers,
  );
  const channels = stringArray(authorization.channels, "channels", blockers);

  if (!channels.includes("ClawHub")) {
    blockers.push("Authorization channels must include ClawHub");
  }
  if (
    authorization.authorizedPackage?.name !== packageJson.name ||
    authorization.authorizedPackage?.version !== packageJson.version
  ) {
    blockers.push(
      "Authorization package name/version does not match the artifact",
    );
  }

  const coveredDerivatives = authorization.coveredDerivatives;
  if (!Array.isArray(coveredDerivatives)) {
    blockers.push("Authorization coveredDerivatives must be an array");
  } else {
    validateDerivativeCoverage({
      coveredDerivatives,
      derivativePaths,
      packageRoot,
      blockers,
    });
  }
  validateEvidence(authorization.evidence, authorizationPath, blockers);
  validateRightsNotice({
    packageRoot,
    authorizationId,
    modifications,
    attribution,
    channels,
    blockers,
  });

  if (blockers.length > 0) {
    return blockRelease(blockers);
  }
  process.stdout.write(
    `${JSON.stringify({
      artifact: artifact,
      artifactSha256: sha256(readFileSync(artifact)),
      authorizationId,
      authorized: true,
      channels,
      coveredDerivatives: derivativePaths.length,
      package: `${packageJson.name}@${packageJson.version}`,
    })}\n`,
  );
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option !== "--artifact" && option !== "--authorization") {
      throw new Error(`Unknown release verification option: ${option}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }
    options[option.slice(2)] = resolve(value);
    index += 1;
  }
  return options;
}

function createArtifact() {
  return createPackageArtifact({ workspace, temporaryRoot });
}

function validateAuthorizationShape(authorization, blockers) {
  if (authorization.schemaVersion !== 1) {
    blockers.push("Authorization schemaVersion must be 1");
  }
  requiredString(authorization.authorizationId, "authorizationId", blockers);
  requiredString(authorization.rightsHolder, "rightsHolder", blockers);
  requiredString(authorization.grant, "grant", blockers);
  const authorizedAt = requiredString(
    authorization.authorizedAt,
    "authorizedAt",
    blockers,
  );
  if (
    authorizedAt !== undefined &&
    (!Number.isFinite(Date.parse(authorizedAt)) || !authorizedAt.includes("T"))
  ) {
    blockers.push("Authorization authorizedAt must be an ISO date-time");
  }
}

function validateDerivativeCoverage({
  coveredDerivatives,
  derivativePaths,
  packageRoot,
  blockers,
}) {
  const coveredPaths = new Set();
  for (const derivative of coveredDerivatives) {
    if (
      derivative === null ||
      typeof derivative !== "object" ||
      typeof derivative.path !== "string" ||
      typeof derivative.sha256 !== "string"
    ) {
      blockers.push(
        "Each covered derivative must identify a path and SHA-256 digest",
      );
      continue;
    }
    if (coveredPaths.has(derivative.path)) {
      blockers.push(`Authorization repeats derivative: ${derivative.path}`);
      continue;
    }
    coveredPaths.add(derivative.path);
    if (!derivativePaths.includes(derivative.path)) {
      blockers.push(
        `Authorization covers a derivative absent from artifact: ${derivative.path}`,
      );
      continue;
    }
    const actualDigest = sha256(readFileSync(join(packageRoot, derivative.path)));
    if (derivative.sha256 !== actualDigest) {
      blockers.push(
        `Authorization digest does not match ${derivative.path}`,
      );
    }
  }
  for (const derivativePath of derivativePaths) {
    if (!coveredPaths.has(derivativePath)) {
      blockers.push(
        `Authorization does not cover derivative: ${derivativePath}`,
      );
    }
  }
}

function validateEvidence(evidence, authorizationPath, blockers) {
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    typeof evidence.path !== "string" ||
    evidence.path.trim().length === 0 ||
    typeof evidence.sha256 !== "string"
  ) {
    blockers.push("Authorization must identify hashed external evidence");
    return;
  }
  const evidencePath = resolve(dirname(authorizationPath), evidence.path);
  if (!existsSync(evidencePath)) {
    blockers.push(`Authorization evidence does not exist: ${evidencePath}`);
    return;
  }
  if (sha256(readFileSync(evidencePath)) !== evidence.sha256) {
    blockers.push("Authorization evidence SHA-256 does not match");
  }
}

function validateRightsNotice({
  packageRoot,
  authorizationId,
  modifications,
  attribution,
  channels,
  blockers,
}) {
  const noticePath = join(packageRoot, "COURSE-RIGHTS-NOTICE");
  if (!existsSync(noticePath)) {
    blockers.push("Artifact is missing COURSE-RIGHTS-NOTICE");
    return;
  }
  const notice = readFileSync(noticePath, "utf8");
  const requiredLines = [
    ["Authorization", authorizationId],
    ["Attribution", attribution],
    ["Modifications", modifications],
    ["Channels", channels.join(", ")],
  ];
  for (const [label, value] of requiredLines) {
    if (value !== undefined && !notice.includes(`${label}: ${value}`)) {
      blockers.push(`COURSE-RIGHTS-NOTICE is missing ${label}`);
    }
  }
}

function requiredString(value, field, blockers) {
  if (typeof value !== "string" || value.trim().length === 0) {
    blockers.push(`Authorization ${field} must be a non-blank string`);
    return undefined;
  }
  return value;
}

function stringArray(value, field, blockers) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    blockers.push(`Authorization ${field} must be a non-empty string array`);
    return [];
  }
  return value;
}

function blockRelease(blockers) {
  process.stderr.write(
    `Public release blocked:\n${blockers.map((blocker) => `- ${blocker}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}

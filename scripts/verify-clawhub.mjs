import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createPackageArtifact, sha256 } from "./package-artifact.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "stella-clawhub-"));
const configuredClawHub = process.env.STELLA_CLAWHUB_BIN;
const clawhub = configuredClawHub === undefined
  ? resolve(workspace, "node_modules/.bin/clawhub")
  : resolve(configuredClawHub);

try {
  if (!existsSync(clawhub)) {
    throw new Error(
      "ClawHub CLI is unavailable; install the locked development dependencies",
    );
  }
  const cliVersion = run(clawhub, ["--cli-version"]);
  const actor = run(clawhub, ["whoami"]);
  if (actor !== "tower1229") {
    throw new Error(`ClawHub actor must be tower1229, got ${actor}`);
  }

  const validation = JSON.parse(
    run(clawhub, [
      "package",
      "validate",
      workspace,
      "--out",
      join(temporaryRoot, "reports"),
      "--json",
    ]),
  );
  if (
    validation.status !== "pass" ||
    validation.summary?.issueCount !== 0
  ) {
    throw new Error(
      `ClawHub package validation failed: ${JSON.stringify(validation.summary)}`,
    );
  }

  const artifact = createArtifact();
  const commit = run("git", ["rev-parse", "HEAD"]);
  const dryRun = JSON.parse(
    run(clawhub, [
      "package",
      "publish",
      artifact,
      "--family",
      "code-plugin",
      "--owner",
      "tower1229",
      "--source-repo",
      "tower1229/Stella-Fitness",
      "--source-commit",
      commit,
      "--dry-run",
      "--json",
    ]),
  );
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (
    dryRun.name !== packageJson.name ||
    dryRun.version !== packageJson.version ||
    dryRun.family !== "code-plugin" ||
    dryRun.commit !== commit
  ) {
    throw new Error(
      `ClawHub dry-run metadata mismatch: ${JSON.stringify(dryRun)}`,
    );
  }

  const blockers = [];
  if (run("git", ["status", "--porcelain"]) !== "") {
    blockers.push("Git worktree is not clean");
  }
  const remoteRefs = run("git", ["ls-remote", "origin"]);
  if (!remoteRefs.split("\n").some((line) => line.startsWith(`${commit}\t`))) {
    blockers.push(`Source commit is not reachable from an origin ref: ${commit}`);
  }
  if (blockers.length > 0) {
    process.stdout.write(
      `${JSON.stringify({
        actor,
        cliVersion,
        dryRun: true,
        package: `${dryRun.name}@${dryRun.version}`,
        ready: false,
        validation: validation.status,
      })}\n`,
    );
    process.stderr.write(
      `ClawHub release blocked:\n${blockers.map((blocker) => `- ${blocker}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${JSON.stringify({
        actor,
        artifactSha256: sha256(readFileSync(artifact)),
        cliVersion,
        commit,
        dryRun: true,
        family: dryRun.family,
        files: dryRun.files,
        package: `${dryRun.name}@${dryRun.version}`,
        ready: true,
        source: dryRun.source,
        validation: validation.status,
      })}\n`,
    );
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function createArtifact() {
  return createPackageArtifact({ workspace, temporaryRoot });
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

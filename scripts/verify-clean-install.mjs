import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "stella-clean-install-"));
const openclaw = resolve(workspace, "node_modules/.bin/openclaw");
const stateDir = join(temporaryRoot, "state");
const commandEnvironment = {
  ...process.env,
  OPENCLAW_HOME: join(temporaryRoot, "home"),
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json"),
  npm_config_cache: join(temporaryRoot, "npm-cache"),
};

function run(command, args) {
  return execFileSync(command, args, {
    cwd: workspace,
    env: commandEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

try {
  const tarball = run("npm", [
    "pack",
    "--pack-destination",
    temporaryRoot,
    "--cache",
    commandEnvironment.npm_config_cache,
  ]);
  run(openclaw, [
    "plugins",
    "install",
    `npm-pack:${join(temporaryRoot, tarball)}`,
    "--force",
  ]);
  run(openclaw, [
    "config",
    "set",
    "plugins.allow",
    '["stella-fitness"]',
  ]);
  run(openclaw, [
    "config",
    "set",
    "plugins.entries.stella-fitness.hooks.allowConversationAccess",
    "true",
  ]);

  const inspection = JSON.parse(
    run(openclaw, [
      "plugins",
      "inspect",
      "stella-fitness",
      "--runtime",
      "--json",
    ]),
  );
  const status = run(openclaw, ["stella-fitness", "status"]);
  const expectedStatus =
    "Stella Fitness: ready\ncontract: openclaw@2026.7.1-2\nscope: recording-only";

  if (inspection.plugin.status !== "loaded") {
    throw new Error(`Plugin did not load: ${inspection.plugin.status}`);
  }
  if (inspection.plugin.hookCount !== 2) {
    throw new Error(`Expected 2 conversation hooks, got ${inspection.plugin.hookCount}`);
  }
  if (!inspection.plugin.commands.includes("stella-status")) {
    throw new Error("Plugin command stella-status was not registered");
  }
  if (inspection.diagnostics.length !== 0) {
    throw new Error(
      `Plugin diagnostics are not empty: ${JSON.stringify(inspection.diagnostics)}`,
    );
  }
  if (status !== expectedStatus) {
    throw new Error(`Unexpected status response: ${JSON.stringify(status)}`);
  }

  process.stdout.write(
    `${JSON.stringify({ installed: true, loaded: true, hooks: 2, diagnostics: 0, status })}\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

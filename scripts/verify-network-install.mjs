import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "stella-fitness-network-install-"));
const environment = {
  ...process.env,
  NPM_CONFIG_CACHE: process.env.STELLA_VERIFICATION_NPM_CACHE
    ?? process.env.NPM_CONFIG_CACHE
    ?? join(root, "npm-cache"),
};

const run = (command, args, cwd = workspace) => execFileSync(command, args, {
  cwd,
  env: environment,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

try {
  const [{ filename }] = JSON.parse(run("npm", [
    "pack",
    "--json",
    "--pack-destination",
    root,
  ]));
  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  run("npm", ["init", "--yes"], consumer);
  run("npm", [
    "install",
    "--ignore-scripts",
    "--save-exact",
    join(root, filename),
  ], consumer);
  const installed = JSON.parse(readFileSync(
    join(consumer, "node_modules/@tower1229/stella-fitness/package.json"),
    "utf8",
  ));
  const expected = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8"));
  if (installed.name !== expected.name || installed.version !== expected.version) {
    throw new Error("Installed package identity does not match the workspace package");
  }
  process.stdout.write(`NETWORK_INSTALL_OK ${installed.name}@${installed.version}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

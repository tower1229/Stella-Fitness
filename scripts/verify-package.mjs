import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = new URL("../", import.meta.url);
const temporaryRoot = mkdtempSync(join(tmpdir(), "stella-package-"));

try {
  const output = execFileSync(
    "npm",
    [
      "pack",
      "--dry-run",
      "--json",
      "--cache",
      join(temporaryRoot, "npm-cache"),
    ],
    { cwd: workspace, encoding: "utf8" },
  );
  const [pack] = JSON.parse(output);
  const files = pack.files.map((entry) => entry.path);
  const required = [
    "dist/plugin.js",
    "dist/scenario/harness.js",
    "openclaw.plugin.json",
    "package.json",
    "LICENSE",
    "NOTICE",
  ];
  const forbiddenPrefixes = [
    "sources/",
    "knowledge/",
    "test/",
    "node_modules/",
  ];

  for (const path of required) {
    if (!files.includes(path)) {
      throw new Error(`Package is missing required file: ${path}`);
    }
  }
  for (const path of files) {
    if (forbiddenPrefixes.some((prefix) => path.startsWith(prefix))) {
      throw new Error(`Package includes forbidden path: ${path}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify({ package: pack.id, files: files.length, forbiddenPaths: 0 })}\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

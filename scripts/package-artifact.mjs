import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

export function createPackageArtifact({ workspace, temporaryRoot }) {
  const output = execFileSync(
    "npm",
    [
      "pack",
      "--json",
      "--pack-destination",
      temporaryRoot,
      "--cache",
      join(temporaryRoot, "npm-cache"),
    ],
    { cwd: workspace, encoding: "utf8" },
  );
  const [pack] = JSON.parse(output);
  return join(temporaryRoot, pack.filename);
}

export function extractPackageArtifact({ artifact, temporaryRoot }) {
  if (!existsSync(artifact)) {
    throw new Error(`Package artifact does not exist: ${artifact}`);
  }
  const members = execFileSync("tar", ["-tzf", artifact], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((member) => member.length > 0);
  for (const member of members) {
    const normalized = posix.normalize(member);
    if (
      member.startsWith("/") ||
      member.split("/").includes("..") ||
      (normalized !== "package" && !normalized.startsWith("package/"))
    ) {
      throw new Error(`Artifact contains unsafe package member: ${member}`);
    }
  }
  execFileSync("tar", ["-xzf", artifact, "-C", temporaryRoot]);
  const packageRoot = join(temporaryRoot, "package");
  if (!existsSync(packageRoot)) {
    throw new Error(`Artifact has no npm package root: ${artifact}`);
  }
  return packageRoot;
}

export function listPackageFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        files.push(relative(root, path).split(sep).join("/"));
      } else {
        throw new Error(
          `Artifact contains unsupported filesystem entry: ${relative(root, path)}`,
        );
      }
    }
  };
  visit(root);
  return files.sort();
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON ${path}`, { cause: error });
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

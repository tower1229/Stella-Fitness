import { lstat, open, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const MANAGED_HEADER =
  /^<!-- stella-fitness:managed:start path=([^\s]+) revision=\d+ checksum=sha256:[0-9a-f]{64} -->/u;

export async function findMarkedArtifactPaths(
  workspace: string,
): Promise<readonly string[]> {
  const paths: string[] = [];
  await collectMarkedArtifactPaths(workspace, workspace, paths);
  return paths.sort();
}

async function collectMarkedArtifactPaths(
  workspace: string,
  directory: string,
  output: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error("Managed workspace contains a symbolic link");
    }
    if (entry.isDirectory()) {
      await collectMarkedArtifactPaths(workspace, path, output);
      continue;
    }
    if (!metadata.isFile()) continue;
    const prefix = await readPrefix(path);
    if (!prefix.startsWith("<!-- stella-fitness:managed:start")) continue;
    const match = MANAGED_HEADER.exec(prefix);
    const artifactPath = relative(workspace, path);
    if (match?.[1] !== artifactPath) {
      throw new Error("Managed artifact marker path is invalid");
    }
    output.push(artifactPath);
  }
}

async function readPrefix(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

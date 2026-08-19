import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeDirectoryConfirmationSessionStore } from "../src/confirmation/runtime-store.js";

const roots: string[] = [];
const key = "a".repeat(64);
const state = {
  schemaVersion: "stella-fitness/workout-log-confirmation-session/v0.1" as const,
  confirmationId: "confirmation-1",
  issuedAt: "2026-08-18T06:11:23.374Z",
  values: { "exercises[0].sets[0].value": 10 },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("Runtime Directory confirmation session store", () => {
  it("persists a private session draft across store instances", async () => {
    const root = await temporaryRoot();
    const first = createRuntimeDirectoryConfirmationSessionStore({
      runtimeDirectory: () => root,
    });
    await first.register(key, state);

    const second = createRuntimeDirectoryConfirmationSessionStore({
      runtimeDirectory: () => root,
    });
    await expect(second.lookup(key)).resolves.toEqual(state);

    const directory = join(root, "workout-log-confirmation-sessions");
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, `${key}.json`))).mode & 0o777).toBe(0o600);
    expect(await second.delete(key)).toBe(true);
    await expect(second.lookup(key)).resolves.toBeUndefined();
  });

  it("fails closed on malformed state and rejects non-hash keys", async () => {
    const root = await temporaryRoot();
    const store = createRuntimeDirectoryConfirmationSessionStore({
      runtimeDirectory: () => root,
    });
    await store.register(key, state);
    const path = join(root, "workout-log-confirmation-sessions", `${key}.json`);
    await writeFile(path, JSON.stringify({ schemaVersion: "unexpected" }));

    await expect(store.lookup(key)).rejects.toThrow("Invalid confirmation session state");
    await expect(store.lookup("../../outside")).rejects.toThrow(
      "Invalid confirmation session key",
    );
    expect(await readFile(path, "utf8")).toContain("unexpected");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stella-confirmation-store-test-"));
  roots.push(root);
  return root;
}

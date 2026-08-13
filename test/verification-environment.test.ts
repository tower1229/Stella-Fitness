import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyEnvironmentBlock,
  executeVerification,
  resolveVerificationCache,
  VERIFICATION_EXIT,
} from "../scripts/verification-environment.mjs";
import { verificationProfiles } from "../scripts/verification-profiles.mjs";
import {
  loadVerificationReceipts,
  persistVerificationReceipt,
} from "../scripts/verification-receipt.mjs";

describe("unified verification environment", () => {
  it("exposes the same capability profiles as Stella Runtime", () => {
    expect(Object.keys(verificationProfiles)).toEqual([
      "pure",
      "network-install",
      "exact-host",
      "release",
    ]);
    expect(verificationProfiles.pure.requirements).toEqual([]);
    expect(verificationProfiles["exact-host"].requirements).toEqual([
      "network-install",
      "loopback",
      "exact-host",
    ]);
  });

  it("uses an isolated cache and classifies only scoped blockers", () => {
    expect(resolveVerificationCache({
      temporaryRoot: "/private/tmp/stella-fitness-verification",
      environment: { NPM_CONFIG_CACHE: "/Users/example/.npm" },
    })).toBe("/private/tmp/stella-fitness-verification/npm-cache");
    expect(classifyEnvironmentBlock({
      output: "listen EPERM 127.0.0.1",
      requirements: ["loopback"],
    })).toBe("LOOPBACK_PERMISSION_DENIED");
    expect(classifyEnvironmentBlock({
      output: "listen EPERM 127.0.0.1",
      requirements: [],
    })).toBeNull();
    expect(classifyEnvironmentBlock({
      output: "openclaw: Node.js >=24.15.0 <25 is required (current: v24.14.0).",
      requirements: ["exact-host"],
    })).toBe("EXACT_HOST_RUNTIME_INCOMPATIBLE");
  });

  it("returns exit code 3 for a known environment block", async () => {
    const receipt = await executeVerification({
      project: "fixture",
      profileName: "exact-host",
      profiles: {
        "exact-host": {
          requirements: ["loopback"],
          steps: [
            { name: "host", command: "fixture", args: [], requirements: ["loopback"] },
          ],
        },
      },
      cwd: "/private/tmp",
      runStep: async () => ({
        durationMs: 1,
        exitCode: 1,
        output: "listen EPERM 127.0.0.1",
        signal: null,
      }),
      writeLog: () => {},
    });

    expect(receipt.status).toBe("environment_blocked");
    expect(receipt.exitCode).toBe(VERIFICATION_EXIT.environmentBlocked);
  });

  it("persists source-bound receipts atomically and reloads them", async () => {
    const root = await mkdtemp(join(tmpdir(), "stella-fitness-receipt-"));
    const profiles = {
      pure: {
        requirements: [],
        steps: [{ name: "fixture", command: "fixture", args: [] }],
      },
      release: {
        requirements: [],
        steps: [
          { name: "first", command: "fixture", args: [] },
          { name: "second", command: "fixture", args: [] },
        ],
      },
    };
    try {
      const persisted = await persistVerificationReceipt({
        receipt: {
          schemaVersion: "verification-environment/v1",
          project: "fixture",
          profile: "pure",
          status: "passed",
          exitCode: 0,
          startedAt: "2026-08-13T01:00:00.000Z",
          finishedAt: "2026-08-13T01:00:01.000Z",
          steps: [{
            name: "fixture",
            status: "passed",
            exitCode: 0,
            durationMs: 1,
          }],
        },
        cwd: root,
        sourceState: { revision: "abc123", clean: true },
        profile: profiles.pure,
      });
      expect(persisted.relativePath).toBe(".stella/verification/pure.json");
      expect(JSON.parse(await readFile(persisted.path, "utf8"))).toMatchObject({
        profile: "pure",
        sourceRevision: "abc123",
        sourceClean: true,
      });
      expect(await loadVerificationReceipts({
        cwd: root,
        project: "fixture",
        profiles,
      })).toEqual({
        receipts: [persisted.receipt],
        invalidFiles: [],
      });
      await writeFile(join(root, ".stella/verification/broken.json"), "not json\n");
      await writeFile(join(root, ".stella/verification/failed.json"), JSON.stringify({
        ...persisted.receipt,
        profile: "failed",
        status: "passed",
        exitCode: 1,
      }));
      await writeFile(join(root, ".stella/verification/foreign.json"), JSON.stringify({
        ...persisted.receipt,
        profile: "foreign",
        project: "another-project",
      }));
      const release = await persistVerificationReceipt({
        receipt: {
          ...persisted.receipt,
          profile: "release",
          steps: profiles.release.steps.map((step) => ({
            name: step.name,
            status: "passed" as const,
            exitCode: 0,
            durationMs: 1,
          })),
        },
        cwd: root,
        sourceState: { revision: "abc123", clean: true },
        profile: profiles.release,
      });
      await writeFile(release.path, JSON.stringify({
        ...release.receipt,
        steps: release.receipt.steps?.slice(0, 1),
      }));
      expect((await loadVerificationReceipts({
        cwd: root,
        project: "fixture",
        profiles,
      })).invalidFiles).toEqual([
        "broken.json",
        "failed.json",
        "foreign.json",
        "release.json",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs capability-separated CI and uploads every receipt", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/verification.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toMatch(/pull_request:/u);
    expect(workflow).toMatch(/branches: \[master\]/u);
    expect(workflow).toMatch(/profile: \[pure, network-install, exact-host\]/u);
    expect(workflow).toMatch(
      /npm run verify:env -- "\$VERIFICATION_PROFILE" --json/u,
    );
    expect(workflow).toMatch(/if: always\(\)/u);
    expect(workflow).toMatch(
      /\.stella\/verification\/\$\{\{ matrix\.profile \}\}\.json/u,
    );
  });

  it("reloads a blocked profile prefix without losing its reason code", async () => {
    const root = await mkdtemp(join(tmpdir(), "stella-fitness-blocked-"));
    const profiles = {
      "exact-host": {
        requirements: ["exact-host"],
        steps: [
          { name: "build", command: "fixture", args: [] },
          { name: "host", command: "fixture", args: [], requirements: ["exact-host"] },
          { name: "never", command: "fixture", args: [] },
        ],
      },
    };
    try {
      await persistVerificationReceipt({
        receipt: {
          schemaVersion: "verification-environment/v1",
          project: "fixture",
          profile: "exact-host",
          status: "environment_blocked",
          reasonCode: "EXACT_HOST_UNAVAILABLE",
          exitCode: 3,
          startedAt: "2026-08-13T01:00:00.000Z",
          finishedAt: "2026-08-13T01:00:01.000Z",
          steps: [
            { name: "build", status: "passed", exitCode: 0, durationMs: 1 },
            {
              name: "host",
              status: "environment_blocked",
              reasonCode: "EXACT_HOST_UNAVAILABLE",
              exitCode: 1,
              durationMs: 1,
            },
          ],
        },
        cwd: root,
        sourceState: { revision: "abc123", clean: true },
        profile: profiles["exact-host"],
      });
      const loaded = await loadVerificationReceipts({
        cwd: root,
        project: "fixture",
        profiles,
      });
      expect(loaded.invalidFiles).toEqual([]);
      expect(loaded.receipts[0]?.reasonCode).toBe("EXACT_HOST_UNAVAILABLE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

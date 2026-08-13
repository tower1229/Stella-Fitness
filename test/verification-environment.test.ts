import { describe, expect, it } from "vitest";

import {
  classifyEnvironmentBlock,
  executeVerification,
  resolveVerificationCache,
  VERIFICATION_EXIT,
} from "../scripts/verification-environment.mjs";
import { verificationProfiles } from "../scripts/verification-profiles.mjs";

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
});

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveCleanInstallNpmCache } from "../scripts/clean-install-cache.mjs";

describe("clean-install npm cache isolation", () => {
  it("ignores npm-run cache injection by default", () => {
    expect(resolveCleanInstallNpmCache({
      temporaryRoot: "/private/tmp/stella-clean-install-test",
      environment: {
        NPM_CONFIG_CACHE: "/Users/example/.npm",
        npm_config_cache: "/Users/example/.npm",
      },
    })).toBe("/private/tmp/stella-clean-install-test/npm-cache");
  });

  it("accepts only an explicit absolute Stella cache override", () => {
    expect(resolveCleanInstallNpmCache({
      temporaryRoot: "/private/tmp/stella-clean-install-test",
      environment: {
        STELLA_CLEAN_INSTALL_NPM_CACHE: "/private/tmp/stella-shared-cache",
      },
    })).toBe("/private/tmp/stella-shared-cache");
    expect(() => resolveCleanInstallNpmCache({
      temporaryRoot: join("private", "tmp", "stella-clean-install-test"),
      environment: { STELLA_CLEAN_INSTALL_NPM_CACHE: "relative-cache" },
    })).toThrow("must be an absolute path");
  });
});

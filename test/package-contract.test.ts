import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("installable Plugin package contract", () => {
  it("locks identity, activation, host compatibility and configuration", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
    );
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const releaseGate = await readFile(
      new URL("../scripts/verify-release.mjs", import.meta.url),
      "utf8",
    );

    expect(packageJson).toMatchObject({
      name: "@tower1229/stella-fitness",
      private: true,
      scripts: {
        "verify:internal": expect.any(String),
        "test:deterministic": "vitest run",
        "test:live-model": expect.any(String),
        "verify:clean-install": "node scripts/verify-clean-install.mjs",
        "verify:clawhub": "node scripts/verify-clawhub.mjs",
        "verify:release": expect.stringContaining("verify:clawhub"),
      },
      peerDependencies: { openclaw: ">=2026.6.34" },
      openclaw: {
        extensions: ["./dist/plugin.js"],
        compat: {
          pluginApi: ">=2026.6.34",
          minGatewayVersion: "2026.6.34",
        },
      },
    });
    expect(manifest).toMatchObject({
      id: "stella-fitness",
      activation: { onStartup: true },
      configSchema: {
        type: "object",
        additionalProperties: false,
      },
    });
    expect(manifest.configSchema.properties).not.toHaveProperty("diagnosis");
    expect(manifest.configSchema.properties).not.toHaveProperty("nutrition");
    expect(manifest.configSchema.properties).not.toHaveProperty("safety");
    expect(manifest.configSchema.properties).not.toHaveProperty("cron");
    expect(packageJson.scripts["verify:internal"]).not.toBe(
      packageJson.scripts["verify:release"],
    );
    expect(releaseGate).toContain(
      "Course-derivative authorization evidence is required",
    );
    expect(releaseGate).not.toContain("STELLA_RELEASE_RIGHTS_APPROVED");
  });

});

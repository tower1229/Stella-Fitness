import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const releaseVerifier = new URL("../scripts/verify-release.mjs", import.meta.url);
const packageVerifier = new URL("../scripts/verify-package.mjs", import.meta.url);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("course-derivative release authorization gate", () => {
  it("fails closed when the artifact has no authorization evidence", async () => {
    const fixture = await createReleaseFixture();

    const result = runVerifier(fixture.tarball);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Course-derivative authorization evidence is required",
    );
  });

  it("rejects authorization that does not cover the exact derivative bytes", async () => {
    const fixture = await createReleaseFixture();
    const authorization = await createAuthorization(fixture, "0".repeat(64));

    const result = runVerifier(fixture.tarball, authorization);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Authorization digest does not match dist/program/fidelity/zhuoshu-v0.2.js",
    );
  });

  it("accepts evidence that identifies the grant, derivatives, changes, attribution and channel", async () => {
    const fixture = await createReleaseFixture();
    const authorization = await createAuthorization(
      fixture,
      sha256(fixture.derivative),
    );

    const result = runVerifier(fixture.tarball, authorization);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      authorizationId: "authorization-test-1",
      authorized: true,
      channels: ["ClawHub"],
      coveredDerivatives: 1,
    });
  });
});

describe("real distribution artifact inspection", () => {
  it("accepts the recording-only package contract and reports the exact artifact digest", async () => {
    const fixture = await createReleaseFixture();

    const result = runPackageVerifier(fixture.tarball);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      package: "@tower1229/stella-fitness@0.1.0",
      forbiddenPaths: 0,
      courseDerivativePaths: 1,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it("rejects raw Office sources even when npm includes them", async () => {
    const fixture = await createReleaseFixture({ includeRawWorkbook: true });

    const result = runPackageVerifier(fixture.tarball);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Package includes forbidden path: sources/originals/workout-log.xlsx",
    );
  });
});

type ReleaseFixture = {
  root: string;
  tarball: string;
  derivative: string;
};

async function createReleaseFixture(
  options: { includeRawWorkbook?: boolean } = {},
): Promise<ReleaseFixture> {
  const root = await mkdtemp(join(tmpdir(), "stella-release-test-"));
  temporaryRoots.push(root);
  const packageRoot = join(root, "package-source");
  const derivative = "export const program = 'course-derived';\n";
  await mkdir(join(packageRoot, "dist/program/fidelity"), { recursive: true });
  await Promise.all([
    writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "@tower1229/stella-fitness",
        version: "0.1.0",
        private: false,
        description: "Recording-only OpenClaw Plugin",
        files: [
          "dist",
          "openclaw.plugin.json",
          "COURSE-RIGHTS-NOTICE",
          "NOTICE",
          ...(options.includeRawWorkbook ? ["sources"] : []),
        ],
        exports: {
          ".": "./dist/plugin.js",
          "./scenario": "./dist/scenario/harness.js",
        },
      })}\n`,
    ),
    writeFile(
      join(packageRoot, "openclaw.plugin.json"),
      `${JSON.stringify({
        id: "stella-fitness",
        version: "0.1.0",
        activation: { onStartup: true },
        configSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            personalDataDirectory: { type: "string" },
            extraction: { type: "object" },
          },
        },
      })}\n`,
    ),
    writeFile(join(packageRoot, "dist/plugin.js"), "export default {};\n"),
    mkdir(join(packageRoot, "dist/scenario"), { recursive: true }).then(() =>
      writeFile(
        join(packageRoot, "dist/scenario/harness.js"),
        "export const scenario = true;\n",
      ),
    ),
    writeFile(
      join(packageRoot, "dist/program/fidelity/zhuoshu-v0.2.js"),
      derivative,
    ),
    writeFile(join(packageRoot, "LICENSE"), "Apache License 2.0 fixture.\n"),
    writeFile(
      join(packageRoot, "NOTICE"),
      "Course derivatives and user data require separate authorization.\n",
    ),
    writeFile(
      join(packageRoot, "README.md"),
      [
        "Personal Data Directory is canonical.",
        "Runtime Directory is rebuildable.",
        "Sanitized Media Copy is temporary.",
        "Tests demonstrate implementation fidelity only; they are not professional endorsement.",
        "",
      ].join("\n"),
    ),
    writeFile(
      join(packageRoot, "COURSE-RIGHTS-NOTICE"),
      [
        "Authorization: authorization-test-1",
        "Attribution: Zhuoshu course; used with permission.",
        "Modifications: Structured into deterministic executable data.",
        "Channels: ClawHub",
        "",
      ].join("\n"),
    ),
    ...(options.includeRawWorkbook
      ? [
          mkdir(join(packageRoot, "sources/originals"), {
            recursive: true,
          }).then(() =>
            writeFile(
              join(packageRoot, "sources/originals/workout-log.xlsx"),
              "raw workbook fixture",
            ),
          ),
        ]
      : []),
  ]);
  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", root],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: join(root, "npm-cache") },
    },
  );
  const [pack] = JSON.parse(packOutput) as [{ filename: string }];
  return { root, tarball: join(root, pack.filename), derivative };
}

async function createAuthorization(
  fixture: ReleaseFixture,
  derivativeDigest: string,
): Promise<string> {
  const evidence = "Signed course-derivative distribution grant fixture.\n";
  const evidencePath = join(fixture.root, "authorization-evidence.txt");
  const authorizationPath = join(fixture.root, "authorization.json");
  await writeFile(evidencePath, evidence);
  await writeFile(
    authorizationPath,
    `${JSON.stringify({
      schemaVersion: 1,
      authorizationId: "authorization-test-1",
      rightsHolder: "Course rights holder",
      authorizedAt: "2026-08-11T00:00:00.000Z",
      grant: "Redistribution of the covered derivatives is authorized.",
      authorizedPackage: {
        name: "@tower1229/stella-fitness",
        version: "0.1.0",
      },
      coveredDerivatives: [
        {
          path: "dist/program/fidelity/zhuoshu-v0.2.js",
          sha256: derivativeDigest,
        },
      ],
      modifications: "Structured into deterministic executable data.",
      attribution: "Zhuoshu course; used with permission.",
      channels: ["ClawHub"],
      evidence: {
        path: "authorization-evidence.txt",
        sha256: sha256(evidence),
      },
    })}\n`,
  );
  return authorizationPath;
}

function runVerifier(tarball: string, authorization?: string) {
  return spawnSync(
    process.execPath,
    [
      releaseVerifier.pathname,
      "--artifact",
      tarball,
      ...(authorization === undefined
        ? []
        : ["--authorization", authorization]),
    ],
    { encoding: "utf8" },
  );
}

function runPackageVerifier(tarball: string) {
  return spawnSync(
    process.execPath,
    [packageVerifier.pathname, "--artifact", tarball],
    { encoding: "utf8" },
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

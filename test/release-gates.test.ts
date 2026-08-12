import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
      "Authorization digest does not match dist/program/fidelity/zhuoshu-v0.2.yaml",
    );
  });

  it("rejects authorization that does not cover the exact workbook bytes", async () => {
    const fixture = await createReleaseFixture();
    const authorization = await createAuthorization(
      fixture,
      sha256(fixture.derivative),
      "0".repeat(64),
    );

    const result = runVerifier(fixture.tarball, authorization);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Authorization digest does not match dist/assets/zhuoshu-workout-log.xlsx",
    );
  });

  it("accepts evidence that identifies the grant, derivatives, changes, attribution and channel", async () => {
    const fixture = await createReleaseFixture();
    const authorization = await createAuthorization(
      fixture,
      sha256(fixture.derivative),
      sha256(fixture.workbook),
    );
    const channelSmoke = await createChannelSmoke(fixture);

    const result = runVerifier(fixture.tarball, authorization, channelSmoke);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      authorizationId: "authorization-test-1",
      authorized: true,
      channels: ["ClawHub"],
      coveredDerivatives: 2,
      liveChannelSmoke: "telegram",
    });
  });

  it("fails closed before release when the exact artifact has no real channel smoke", async () => {
    const fixture = await createReleaseFixture();
    const authorization = await createAuthorization(
      fixture,
      sha256(fixture.derivative),
      sha256(fixture.workbook),
    );

    const result = runVerifier(fixture.tarball, authorization);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Real Telegram channel smoke evidence is required");
  });

  it("rejects live channel smoke recorded against different package bytes", async () => {
    const fixture = await createReleaseFixture();
    const authorization = await createAuthorization(
      fixture,
      sha256(fixture.derivative),
      sha256(fixture.workbook),
    );
    const channelSmoke = await createChannelSmoke(fixture, "0".repeat(64));

    const result = runVerifier(fixture.tarball, authorization, channelSmoke);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Real Telegram channel smoke must identify the live adapter and exact package bytes/version",
    );
  });

  it("rejects self-asserted live smoke without hashed Telegram transcript evidence", async () => {
    const fixture = await createReleaseFixture();
    const authorization = await createAuthorization(
      fixture,
      sha256(fixture.derivative),
      sha256(fixture.workbook),
    );
    const channelSmoke = await createChannelSmoke(fixture, undefined, {
      omitEvidence: true,
    });

    const result = runVerifier(fixture.tarball, authorization, channelSmoke);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Real Telegram channel smoke must include hashed transcript evidence",
    );
  });

  it("rejects replaying transcript evidence from different package bytes", async () => {
    const fixture = await createReleaseFixture();
    const authorization = await createAuthorization(
      fixture,
      sha256(fixture.derivative),
      sha256(fixture.workbook),
    );
    const channelSmoke = await createChannelSmoke(fixture, undefined, {
      evidenceArtifactSha256: "0".repeat(64),
    });

    const result = runVerifier(fixture.tarball, authorization, channelSmoke);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Real Telegram transcript evidence does not bind the exact smoke receipt",
    );
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
      courseDerivativePaths: 2,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it.each([
    ["raw Office source", "sources/originals/workout-log.xlsx"],
    ["generated printable PDF", "dist/generated/week-1.pdf"],
    ["personal data", "personal-data/observations/user.json"],
    ["developer benchmark", "dist/benchmarks/case.json"],
    ["test fixture", "dist/fixtures/case.json"],
    ["pilot artifact", "dist/pilot/handwritten-case.json"],
  ])("rejects %s even when npm includes it", async (_label, forbiddenPath) => {
    const fixture = await createReleaseFixture({ forbiddenPath });

    const result = runPackageVerifier(fixture.tarball);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Package includes forbidden path: ${forbiddenPath}`,
    );
  });

  it("rejects modified bytes at the allowed built-in workbook path", async () => {
    const fixture = await createReleaseFixture({
      workbook: Buffer.from("modified workbook"),
    });

    const result = runPackageVerifier(fixture.tarball);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Built-in workout-log workbook digest does not match source",
    );
  });
});

type ReleaseFixture = {
  root: string;
  tarball: string;
  derivative: string;
  workbook: Buffer;
};

async function createReleaseFixture(
  options: { forbiddenPath?: string; workbook?: Buffer } = {},
): Promise<ReleaseFixture> {
  const root = await mkdtemp(join(tmpdir(), "stella-release-test-"));
  temporaryRoots.push(root);
  const packageRoot = join(root, "package-source");
  const derivative = "id: zhuoshu-12-week\nversion: fixture\n";
  const workbook = options.workbook ?? await readFile(new URL(
    "../sources/originals/zhuoshu-workout-log.xlsx",
    import.meta.url,
  ));
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
          ...(options.forbiddenPath === undefined ||
          options.forbiddenPath.startsWith("dist/")
            ? []
            : [options.forbiddenPath.split("/")[0]]),
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
      join(packageRoot, "dist/program/fidelity/zhuoshu-v0.2.yaml"),
      derivative,
    ),
    mkdir(join(packageRoot, "dist/assets"), { recursive: true }).then(() =>
      writeFile(
        join(packageRoot, "dist/assets/zhuoshu-workout-log.xlsx"),
        workbook,
      ),
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
    ...(options.forbiddenPath === undefined
      ? []
      : [writeForbiddenFixture(packageRoot, options.forbiddenPath)]),
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
  return { root, tarball: join(root, pack.filename), derivative, workbook };
}

async function writeForbiddenFixture(packageRoot: string, path: string) {
  await mkdir(join(packageRoot, dirname(path)), { recursive: true });
  await writeFile(join(packageRoot, path), "forbidden artifact fixture");
}

async function createAuthorization(
  fixture: ReleaseFixture,
  derivativeDigest: string,
  workbookDigest = sha256(fixture.workbook),
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
          path: "dist/program/fidelity/zhuoshu-v0.2.yaml",
          sha256: derivativeDigest,
        },
        {
          path: "dist/assets/zhuoshu-workout-log.xlsx",
          sha256: workbookDigest,
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

async function createChannelSmoke(
  fixture: ReleaseFixture,
  artifactSha256?: string,
  options: {
    omitEvidence?: boolean;
    evidenceArtifactSha256?: string;
  } = {},
): Promise<string> {
  const path = join(fixture.root, "live-channel-smoke.json");
  const testedAt = "2026-08-12T00:00:00.000Z";
  const packageArtifactSha256 =
    artifactSha256 ?? sha256(await readFile(fixture.tarball));
  const scenario = {
    bindingApproved: true,
    printableWorkbookVerified: true,
    journeyActivated: true,
    checkpointRecorded: true,
  };
  const evidence = `${JSON.stringify({
    adapter: "openclaw-telegram",
    testedAt,
    package: {
      name: "@tower1229/stella-fitness",
      version: "0.1.0",
      artifactSha256: options.evidenceArtifactSha256 ?? packageArtifactSha256,
    },
    botUserId: 616161,
    chatId: 515151,
    firstUpdateId: 1000,
    lastUpdateId: 1042,
    outboundMessageIds: [101, 102, 103],
    scenario,
  }, null, 2)}\n`;
  const evidencePath = join(fixture.root, "telegram-live-transcript.json");
  await writeFile(evidencePath, evidence);
  await writeFile(path, `${JSON.stringify({
    schemaVersion: 1,
    channel: "telegram",
    adapter: "openclaw-telegram",
    live: true,
    testedAt,
    package: {
      name: "@tower1229/stella-fitness",
      version: "0.1.0",
      artifactSha256: packageArtifactSha256,
    },
    scenario,
    ...(options.omitEvidence
      ? {}
      : {
          evidence: {
            path: "telegram-live-transcript.json",
            sha256: sha256(evidence),
          },
        }),
  }, null, 2)}\n`);
  return path;
}

function runVerifier(
  tarball: string,
  authorization?: string,
  channelSmoke?: string,
) {
  return spawnSync(
    process.execPath,
    [
      releaseVerifier.pathname,
      "--artifact",
      tarball,
      ...(authorization === undefined
        ? []
        : ["--authorization", authorization]),
      ...(channelSmoke === undefined ? [] : ["--channel-smoke", channelSmoke]),
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

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

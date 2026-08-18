import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runConfigurationPreflight } from "../src/preflight.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("configuration preflight", () => {
  it("blocks when the Personal Data Directory is missing", () => {
    const result = runConfigurationPreflight({
      userTimezone: "Asia/Shanghai",
      personalDataDirectory: undefined,
      runtimeDirectory: "/var/lib/openclaw/stella-fitness",
      conversationAccess: true,
      structuredMedia: true,
      extraction: "allowed",
    });

    expect(result).toMatchObject({
      readiness: "BLOCKED_CONFIGURATION",
      reasons: [
        {
          code: "PERSONAL_DATA_DIRECTORY_REQUIRED",
          message: "Configure an absolute Personal Data Directory",
        },
      ],
    });
  });

  it("reports ready for setup when only extraction selection is missing", () => {
    const { personalDataDirectory, runtimeDirectory } = isolatedDirectories();

    expect(
      runConfigurationPreflight({
        userTimezone: "Asia/Shanghai",
        personalDataDirectory,
        runtimeDirectory,
        conversationAccess: true,
        structuredMedia: true,
        extraction: "unconfigured",
      }),
    ).toMatchObject({
      readiness: "READY_FOR_SETUP",
      reasons: [
        {
          code: "EXTRACTION_MODEL_REQUIRED",
          message: "Configure an allowlisted extraction provider and model",
        },
      ],
    });
  });

  it("accepts an absolute readable and writable Personal Data Directory", () => {
    const { personalDataDirectory, runtimeDirectory } = isolatedDirectories();

    const result = runConfigurationPreflight({
        userTimezone: "Asia/Shanghai",
        personalDataDirectory,
        runtimeDirectory,
        conversationAccess: true,
        structuredMedia: true,
        extraction: "allowed",
      });

    expect(result).toMatchObject({
      readiness: "READY",
      reasons: [],
      capabilities: {
        personalDataDirectory: { status: "ready" },
        conversation: { status: "ready" },
        media: { status: "ready" },
        modelPermission: { status: "ready" },
      },
    });
    expect(readdirSync(personalDataDirectory)).toEqual([]);
  });

  it("rejects overlap through the nearest existing symlink parent", () => {
    const root = temporaryRoot();
    const personalDataDirectory = join(root, "personal");
    const runtimeParent = join(root, "runtime-link");
    mkdirSync(personalDataDirectory);
    symlinkSync(personalDataDirectory, runtimeParent, "dir");

    const result = runConfigurationPreflight({
      userTimezone: "Asia/Shanghai",
      personalDataDirectory,
      runtimeDirectory: join(runtimeParent, "stella-fitness"),
      conversationAccess: true,
      structuredMedia: true,
      extraction: "allowed",
    });

    expect(result).toMatchObject({
      readiness: "BLOCKED_CONFIGURATION",
      reasons: [expect.objectContaining({ code: "DATA_DIRECTORIES_OVERLAP" })],
    });
    expect(readdirSync(personalDataDirectory)).toEqual([]);
  });

  it.each([
    [
      "same directory",
      (root: string): [string, string] => [join(root, "data"), join(root, "data")],
    ],
    [
      "Personal Data Directory contains Runtime Directory",
      (root: string): [string, string] => [
        join(root, "data"),
        join(root, "data", "runtime"),
      ],
    ],
    [
      "Runtime Directory contains Personal Data Directory",
      (root: string): [string, string] => [
        join(root, "runtime", "data"),
        join(root, "runtime"),
      ],
    ],
  ])("rejects overlap when %s without leaving a probe", (_label, paths) => {
    const root = temporaryRoot();
    const [personalDataDirectory, runtimeDirectory] = paths(root);
    mkdirSync(personalDataDirectory, { recursive: true });
    mkdirSync(runtimeDirectory, { recursive: true });

    const result = runConfigurationPreflight({
      userTimezone: "Asia/Shanghai",
      personalDataDirectory,
      runtimeDirectory,
      conversationAccess: true,
      structuredMedia: true,
      extraction: "allowed",
    });

    expect(result).toMatchObject({
      readiness: "BLOCKED_CONFIGURATION",
      reasons: [
        {
          code: "DATA_DIRECTORIES_OVERLAP",
          message:
            "Personal Data Directory and Runtime Directory must not overlap",
        },
      ],
    });
    expect(readdirSync(personalDataDirectory)).toEqual(
      personalDataDirectory === runtimeDirectory ? [] : readdirWithoutNestedRuntime(personalDataDirectory, runtimeDirectory),
    );
  });

  it.each([
    [false, true, "allowed", "CONVERSATION_ACCESS_REQUIRED"],
    [true, true, "denied", "EXTRACTION_MODEL_NOT_ALLOWLISTED"],
  ] as const)(
    "blocks missing operator permission",
    (conversationAccess, structuredMedia, extraction, expectedCode) => {
      const { personalDataDirectory, runtimeDirectory } = isolatedDirectories();

      const result = runConfigurationPreflight({
        userTimezone: "Asia/Shanghai",
        personalDataDirectory,
        runtimeDirectory,
        conversationAccess,
        structuredMedia,
        extraction,
      });

      expect(result.readiness).toBe("BLOCKED_CONFIGURATION");
      expect(result.reasons.map(({ code }) => code)).toContain(expectedCode);
      expect(readdirSync(personalDataDirectory)).toEqual([]);
    },
  );

  it("reports limited readiness when structured media is unavailable", () => {
    const { personalDataDirectory, runtimeDirectory } = isolatedDirectories();

    expect(
      runConfigurationPreflight({
        userTimezone: "Asia/Shanghai",
        personalDataDirectory,
        runtimeDirectory,
        conversationAccess: true,
        structuredMedia: false,
        extraction: "allowed",
      }),
    ).toMatchObject({
      readiness: "READY_WITH_LIMITED_CAPABILITIES",
      reasons: [
        {
          code: "STRUCTURED_MEDIA_REQUIRED",
          message: "Enable OpenClaw structured media extraction",
        },
      ],
    });
  });

  it.each([
    [undefined, "USER_TIMEZONE_REQUIRED"],
    ["Mars/Olympus_Mons", "USER_TIMEZONE_INVALID"],
  ])("blocks an unusable OpenClaw user timezone", (userTimezone, expectedCode) => {
    const { personalDataDirectory, runtimeDirectory } = isolatedDirectories();

    const result = runConfigurationPreflight({
      userTimezone,
      personalDataDirectory,
      runtimeDirectory,
      conversationAccess: true,
      structuredMedia: true,
      extraction: "allowed",
    });

    expect(result).toMatchObject({
      readiness: "BLOCKED_CONFIGURATION",
      reasons: [expect.objectContaining({ code: expectedCode })],
      capabilities: { timeZone: { status: "blocked" } },
    });
  });
});

function isolatedDirectories(): {
  personalDataDirectory: string;
  runtimeDirectory: string;
} {
  const root = temporaryRoot();
  const personalDataDirectory = join(root, "personal");
  const runtimeDirectory = join(root, "runtime");
  mkdirSync(personalDataDirectory);
  mkdirSync(runtimeDirectory);
  return { personalDataDirectory, runtimeDirectory };
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "stella-preflight-test-"));
  temporaryRoots.push(root);
  return root;
}

function readdirWithoutNestedRuntime(
  personalDataDirectory: string,
  runtimeDirectory: string,
): string[] {
  return runtimeDirectory.startsWith(`${personalDataDirectory}/`)
    ? [runtimeDirectory.slice(personalDataDirectory.length + 1).split("/")[0]!]
    : [];
}

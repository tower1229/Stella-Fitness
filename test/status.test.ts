import { describe, expect, it } from "vitest";

import { createStatusResponse } from "../src/status.js";

describe("deterministic Plugin status", () => {
  it("reports each TechnicalReadiness capability independently", () => {
    expect(
      createStatusResponse({
        readiness: "READY_WITH_LIMITED_CAPABILITIES",
        reasons: [
          {
            code: "STRUCTURED_MEDIA_REQUIRED",
            message: "Enable OpenClaw structured media extraction",
          },
        ],
        capabilities: {
          personalDataDirectory: {
            status: "ready",
            message: "Personal Data Directory is readable and writable",
          },
          conversation: {
            status: "ready",
            message: "Plugin conversation hook access is enabled",
          },
          media: {
            status: "limited",
            message: "Enable OpenClaw structured media extraction",
          },
          modelPermission: {
            status: "ready",
            message: "Extraction provider and model are allowlisted",
          },
        },
      }).text,
    ).toContain(
      "technical-readiness: media: limited - Enable OpenClaw structured media extraction",
    );
  });

  it.each([
    ["personal-data-directory", "blocked"],
    ["conversation", "blocked"],
    ["media", "limited"],
    ["model-permission", "setup-required"],
  ] as const)("keeps %s remediation visible when it is %s", (name, status) => {
    const capabilities = {
      personalDataDirectory: {
        status: "blocked" as const,
        message: "Configure an absolute Personal Data Directory",
      },
      conversation: {
        status: "blocked" as const,
        message: "Enable Plugin conversation hook access",
      },
      media: {
        status: "limited" as const,
        message: "Enable OpenClaw structured media extraction",
      },
      modelPermission: {
        status: "setup-required" as const,
        message: "Configure an allowlisted extraction provider and model",
      },
    };
    const text = createStatusResponse({
      readiness: "BLOCKED_CONFIGURATION",
      reasons: [],
      capabilities,
    }).text;

    expect(text).toContain(`technical-readiness: ${name}: ${status} - `);
  });

  it("returns readiness and deterministic reasons", () => {
    expect(
      createStatusResponse({
        readiness: "BLOCKED_CONFIGURATION",
        reasons: [
          {
            code: "PERSONAL_DATA_DIRECTORY_REQUIRED",
            message: "Configure an absolute Personal Data Directory",
          },
        ],
      }),
    ).toEqual({
      text: "Stella Fitness: BLOCKED_CONFIGURATION\ncontract: openclaw>=2026.6.34\nscope: recording-only\nreason: PERSONAL_DATA_DIRECTORY_REQUIRED: Configure an absolute Personal Data Directory",
    });
    expect(createStatusResponse({ readiness: "READY", reasons: [] })).toEqual({
      text: "Stella Fitness: READY\ncontract: openclaw>=2026.6.34\nscope: recording-only\nreason: none",
    });
  });
});

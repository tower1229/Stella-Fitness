import { describe, expect, it } from "vitest";

import { createStatusResponse } from "../src/status.js";

describe("deterministic Plugin status", () => {
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

import { describe, expect, it } from "vitest";

import { createStatusResponse } from "../src/status.js";

describe("deterministic Plugin status", () => {
  it("returns the same recording-only status response", () => {
    expect(createStatusResponse("unconfigured")).toEqual({
      text: "Stella Fitness: ready\ncontract: openclaw@2026.7.1-2\nscope: recording-only\nextraction: unconfigured",
    });
    expect(createStatusResponse("configured")).toEqual({
      text: "Stella Fitness: ready\ncontract: openclaw@2026.7.1-2\nscope: recording-only\nextraction: configured",
    });
  });
});

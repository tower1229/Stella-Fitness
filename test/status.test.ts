import { describe, expect, it } from "vitest";

import { STATUS_TEXT, createStatusResponse } from "../src/status.js";

describe("deterministic Plugin status", () => {
  it("returns the same recording-only status response", () => {
    expect(createStatusResponse()).toEqual({ text: STATUS_TEXT });
    expect(STATUS_TEXT).toBe(
      "Stella Fitness: ready\ncontract: openclaw@2026.7.1-2\nscope: recording-only",
    );
  });
});

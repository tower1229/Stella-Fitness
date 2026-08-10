import type { ConfigurationPreflightResult } from "./preflight.js";

export function createStatusResponse(
  preflight: ConfigurationPreflightResult,
): { text: string } {
  const reasonLines =
    preflight.reasons.length === 0
      ? ["reason: none"]
      : preflight.reasons.map(
          ({ code, message }) => `reason: ${code}: ${message}`,
        );
  return {
    text: [
      `Stella Fitness: ${preflight.readiness}`,
      "contract: openclaw>=2026.6.34",
      "scope: recording-only",
      ...reasonLines,
    ].join("\n"),
  };
}

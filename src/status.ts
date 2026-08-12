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
  const capabilityLines = preflight.capabilities === undefined
    ? []
    : ([
        ["personal-data-directory", preflight.capabilities.personalDataDirectory],
        ["conversation", preflight.capabilities.conversation],
        ["media", preflight.capabilities.media],
        ["model-permission", preflight.capabilities.modelPermission],
      ] as const).map(
        ([name, capability]) =>
          `technical-readiness: ${name}: ${capability.status} - ${capability.message}`,
      );
  return {
    text: [
      `Stella Fitness: ${preflight.readiness}`,
      "contract: openclaw>=2026.6.34",
      "scope: recording-only",
      ...capabilityLines,
      ...reasonLines,
    ].join("\n"),
  };
}

export type ExtractionConfigurationState = "configured" | "unconfigured";

export function createStatusResponse(
  extraction: ExtractionConfigurationState,
): { text: string } {
  return {
    text: [
      "Stella Fitness: ready",
      "contract: openclaw@2026.7.1-2",
      "scope: recording-only",
      `extraction: ${extraction}`,
    ].join("\n"),
  };
}

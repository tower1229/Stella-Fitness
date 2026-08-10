import type { SanitizedMediaCopy } from "../../src/media/sanitized-copy.js";

export function sanitizedMediaFixture(
  bytes = Buffer.from("fixture-image"),
  fileName = "workout.jpg",
): SanitizedMediaCopy {
  return {
    bytes: Buffer.from(bytes),
    fileName,
    mime: "image/jpeg",
  } as SanitizedMediaCopy;
}

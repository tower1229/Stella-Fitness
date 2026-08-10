import type { SanitizedMediaCopy } from "../../src/media/sanitized-copy.js";
import type { RawMediaUpload } from "../../src/domain/media.js";

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

export function rawMediaUploadFixture(
  bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
): RawMediaUpload {
  return {
    bytes: Buffer.from(bytes),
    fileName: "workout.png",
    mime: "image/png",
    receivedAt: "2026-08-10T08:00:00.000Z",
    provenance: { channel: "test", messageId: "media-message-1" },
  };
}

export function alternateRawMediaUploadFixture(): RawMediaUpload {
  return rawMediaUploadFixture(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    ),
  );
}

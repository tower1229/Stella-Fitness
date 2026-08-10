import { createHash } from "node:crypto";

import sharp from "sharp";

import type { RawMediaUpload } from "../domain/media.js";
import type { SanitizedMediaCopy } from "./sanitized-copy.js";

export type SanitizedMediaLease = {
  readonly media: SanitizedMediaCopy;
  readonly transport: "buffer" | "runtime-file";
  readonly sha256: string;
  dispose(): Promise<void>;
};

export interface MediaSanitizer {
  sanitize(
    upload: RawMediaUpload,
    artifactId: string,
  ): Promise<SanitizedMediaLease>;
}

export function createBufferMediaSanitizer(): MediaSanitizer {
  return {
    async sanitize(upload, artifactId) {
      let bytes: Buffer;
      try {
        bytes = await sharp(upload.bytes, { failOn: "error" })
          .rotate()
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch (error) {
        throw new InvalidWorkoutLogImageError(error);
      }
      const media = {
        bytes,
        fileName: `${artifactId}.png`,
        mime: "image/png",
      } as SanitizedMediaCopy;
      return {
        media,
        transport: "buffer",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        async dispose() {
          bytes.fill(0);
        },
      };
    },
  };
}

export class InvalidWorkoutLogImageError extends Error {
  constructor(cause: unknown) {
    super("Workout-log upload is not a readable supported image", { cause });
    this.name = "InvalidWorkoutLogImageError";
  }
}

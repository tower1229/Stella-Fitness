import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

export function createRuntimeFileMediaSanitizer(
  runtimeDirectory: () => string,
): MediaSanitizer {
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
      const sanitizedDirectory = join(runtimeDirectory(), "sanitized-media");
      const runtimePath = join(
        sanitizedDirectory,
        `${artifactId}-${randomUUID()}.png`,
      );
      try {
        await mkdir(sanitizedDirectory, { recursive: true, mode: 0o700 });
        await writeFile(runtimePath, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        bytes.fill(0);
        throw error;
      }
      let disposed = false;
      return {
        media,
        transport: "buffer",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        async dispose() {
          if (disposed) return;
          disposed = true;
          try {
            await unlink(runtimePath);
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
              throw error;
            }
          } finally {
            bytes.fill(0);
          }
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

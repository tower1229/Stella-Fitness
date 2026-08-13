import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionRuntime,
} from "../src/extraction/runtime.js";
import type {
  MediaSanitizer,
  SanitizedMediaLease,
} from "../src/media/sanitizer.js";
import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";
import type { ConfigurationPreflightResult } from "../src/preflight.js";
import { workoutLogCandidate } from "./support/workout-log-candidate.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("workout-log Raw Artifact ingest", () => {
  it("preserves the original and submits only an oriented metadata-free payload", async () => {
    const directories = temporaryDirectories();
    const rawBytes = await orientedJpeg();
    const runtime = new InspectingExtractionRuntime(
      directories.runtimeDirectory,
    );
    const harness = readyHarness(runtime, directories);

    const output = await harness.ingestWorkoutLog({
      runId: "media-success",
      upload: upload(rawBytes),
      timeoutMs: 2_000,
    });

    const artifactPath = join(
      directories.personalDataDirectory,
      output.artifact.path,
    );
    expect(readFileSync(artifactPath)).toEqual(rawBytes);
    expect(output.artifact).toMatchObject({
      schemaVersion: "stella-fitness/raw-artifact/v0.1",
      sha256: sha256(rawBytes),
      size: rawBytes.length,
      originalFileName: "paper-log.jpg",
      mime: "image/jpeg",
      provenance: {
        kind: "openclaw-media",
        receivedAt: "2026-08-10T08:00:00.000Z",
        channel: "scenario",
        messageId: "message-9",
      },
    });
    expect(
      JSON.parse(
        readFileSync(join(dirname(artifactPath), "artifact.json"), "utf8"),
      ),
    ).toEqual(output.artifact);

    expect(runtime.requests).toHaveLength(1);
    expect(runtime.runtimeFilesDuringExtraction).toEqual([
      expect.stringMatching(/^sanitized-media\/[0-9a-f-]+\.png$/u),
    ]);
    expect(runtime.runtimeFileMode).toBe(0o600);
    expect(runtime.runtimeDirectoryMode).toBe(0o700);
    expect(runtime.runtimeFileBytes).toEqual(runtime.requests[0]!.media.bytes);
    const submitted = runtime.requests[0]!.media;
    expect(submitted.mime).toBe("image/png");
    expect(submitted.fileName).toMatch(/\.png$/u);
    const metadata = await sharp(submitted.bytes).metadata();
    expect(metadata).toMatchObject({ width: 10, height: 20, format: "png" });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    const orientedPixels = await sharp(submitted.bytes).raw().toBuffer();
    const top = orientedPixels.subarray(0, 3);
    const bottom = orientedPixels.subarray(-3);
    expect(top[0]).toBeGreaterThan(240);
    expect(top[1]).toBeLessThan(10);
    expect(top[2]).toBeLessThan(10);
    expect(bottom[0]).toBeLessThan(10);
    expect(bottom[1]).toBeLessThan(10);
    expect(bottom[2]).toBeGreaterThan(240);

    expect(output.processing).toMatchObject({
      schemaVersion: "stella-fitness/processing/workout-log/v0.1",
      operation: "workout-log-extraction",
      status: "succeeded",
      payload: {
        category: "sanitized-workout-log-image",
        transport: "buffer",
        mime: "image/png",
        sha256: sha256(submitted.bytes),
      },
      artifact: {
        id: output.artifact.id,
        path: output.artifact.path,
        sha256: sha256(rawBytes),
      },
      execution: {
        provider: "controlled",
        model: "fixture-v1",
        contentType: "json",
      },
    });
    expect(readJson(output.processing.path, directories)).toEqual(
      output.processing,
    );
    expect(
      runtime.transientMediaBytes[0]!.every((byte) => byte === 0),
    ).toBe(true);
    expect(filesUnder(directories.runtimeDirectory)).toEqual([]);
  });

  it("keeps an unreadable original but never submits it as model payload", async () => {
    const directories = temporaryDirectories();
    const runtime = new ControlledExtractionRuntime([]);
    const harness = readyHarness(runtime, directories);
    const rawBytes = Buffer.from("not-an-image");

    await expect(
      harness.ingestWorkoutLog({
        runId: "media-invalid",
        upload: upload(rawBytes),
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({ name: "InvalidWorkoutLogImageError" });

    const artifactFiles = filesUnder(directories.personalDataDirectory).filter(
      (path) =>
        path.includes("raw-artifacts/workout-log/") &&
        path.endsWith("original.jpg"),
    );
    expect(artifactFiles).toHaveLength(1);
    expect(
      readFileSync(join(directories.personalDataDirectory, artifactFiles[0]!)),
    ).toEqual(rawBytes);
    expect(runtime.requests).toEqual([]);
    const processing = singleProcessingRecord(directories);
    expect(processing).toMatchObject({
      status: "failed",
      errorCategory: "invalid-image",
    });
    expect(processing).not.toHaveProperty("payload");
  });

  it("cleans transient media and records a runtime failure", async () => {
    const directories = temporaryDirectories();
    const runtime = new RejectingExtractionRuntime(
      new Error("provider unavailable"),
    );
    const harness = readyHarness(
      runtime,
      directories,
    );

    await expect(
      harness.ingestWorkoutLog({
        runId: "media-failure",
        upload: upload(await orientedJpeg()),
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow("provider unavailable");

    expect(filesUnder(directories.runtimeDirectory)).toEqual([]);
    expect(singleProcessingRecord(directories)).toMatchObject({
      status: "failed",
      errorCategory: "extraction-failed",
    });
    expect(runtime.transientBytes!.every((byte) => byte === 0)).toBe(true);
  });

  it("owns the timeout and cleans transient media when the runtime never settles", async () => {
    const directories = temporaryDirectories();
    const runtime = new PendingExtractionRuntime();
    const harness = readyHarness(runtime, directories);

    await expect(
      harness.ingestWorkoutLog({
        runId: "media-timeout",
        upload: upload(await orientedJpeg()),
        timeoutMs: 20,
      }),
    ).rejects.toThrow("timed out");

    expect(filesUnder(directories.runtimeDirectory)).toEqual([]);
    expect(singleProcessingRecord(directories)).toMatchObject({
      status: "failed",
      errorCategory: "timeout",
    });
    expect(runtime.transientBytes!.every((byte) => byte === 0)).toBe(true);
  });

  it("cleans transient media after caller cancellation", async () => {
    const directories = temporaryDirectories();
    const runtime = new PendingExtractionRuntime();
    const harness = readyHarness(runtime, directories);
    const controller = new AbortController();
    const extraction = harness.ingestWorkoutLog({
      runId: "media-cancelled",
      upload: upload(await orientedJpeg()),
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(runtime.transientBytes).toBeDefined());

    controller.abort("user-cancelled");

    await expect(extraction).rejects.toMatchObject({ name: "AbortError" });
    expect(filesUnder(directories.runtimeDirectory)).toEqual([]);
    expect(singleProcessingRecord(directories)).toMatchObject({
      status: "failed",
      errorCategory: "cancelled",
    });
    expect(runtime.transientBytes!.every((byte) => byte === 0)).toBe(true);
  });

  it("aborts in-flight work and cleans transient media on shutdown", async () => {
    const directories = temporaryDirectories();
    const runtime = new PendingExtractionRuntime();
    const harness = readyHarness(runtime, directories);
    const extraction = harness.ingestWorkoutLog({
      runId: "media-shutdown",
      upload: upload(await orientedJpeg()),
      timeoutMs: 2_000,
    });
    await vi.waitFor(() => expect(runtime.transientBytes).toBeDefined());

    await harness.shutdown();

    await expect(extraction).rejects.toMatchObject({ name: "AbortError" });
    expect(filesUnder(directories.runtimeDirectory)).toEqual([]);
    expect(singleProcessingRecord(directories)).toMatchObject({
      status: "failed",
      errorCategory: "shutdown",
    });
    expect(runtime.transientBytes!.every((byte) => byte === 0)).toBe(true);
  });

  it("disposes a sanitized buffer that resolves after cancellation", async () => {
    const directories = temporaryDirectories();
    const sanitizer = new DelayedMediaSanitizer(directories.runtimeDirectory);
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      mediaSanitizer: sanitizer,
      personalDataDirectory: () => directories.personalDataDirectory,
      runtimeDirectory: () => directories.runtimeDirectory,
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    const controller = new AbortController();
    const extraction = harness.ingestWorkoutLog({
      runId: "media-late-sanitizer",
      upload: upload(await orientedJpeg()),
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(sanitizer.started).toBe(true));

    controller.abort("user-cancelled");
    await expect(extraction).rejects.toMatchObject({ name: "AbortError" });
    sanitizer.resolve();

    await vi.waitFor(() =>
      expect(sanitizer.bytes.every((byte) => byte === 0)).toBe(true),
    );
    expect(filesUnder(directories.runtimeDirectory)).toEqual([]);
  });

  it("keeps runtime execution metadata when candidate validation fails", async () => {
    const directories = temporaryDirectories();
    const runtime = new ControlledExtractionRuntime([
      {
        parsed: { stage: 1 },
        metadata: {
          provider: "controlled",
          model: "fixture-v1",
          contentType: "json",
        },
      },
    ]);
    const harness = readyHarness(runtime, directories);

    await expect(
      harness.ingestWorkoutLog({
        runId: "media-invalid-candidate",
        upload: upload(await orientedJpeg()),
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({ name: "InvalidWorkoutLogCandidateError" });

    expect(singleProcessingRecord(directories)).toMatchObject({
      status: "failed",
      errorCategory: "invalid-result",
      execution: {
        provider: "controlled",
        model: "fixture-v1",
        contentType: "json",
      },
    });
  });

  it("fails closed with an explicit crop-required error for a multi-session page", async () => {
    const directories = temporaryDirectories();
    const runtime = new ControlledExtractionRuntime([
      {
        parsed: {
          layout: "multi-session-page",
          reason: "multiple-session-blocks",
        },
        metadata: { provider: "controlled", model: "fixture-v1" },
      },
    ]);
    const harness = readyHarness(runtime, directories);

    await expect(harness.ingestWorkoutLog({
      runId: "media-multi-session-page",
      upload: upload(await orientedJpeg()),
      timeoutMs: 2_000,
    })).rejects.toMatchObject({
      name: "MultiSessionWorkoutLogPageError",
      message: expect.stringContaining("crop"),
    });

    expect(singleProcessingRecord(directories)).toMatchObject({
      status: "failed",
      errorCategory: "invalid-result",
      execution: { provider: "controlled", model: "fixture-v1" },
    });
  });
});

function readyHarness(
  extractionRuntime: ExtractionRuntime,
  directories: ReturnType<typeof temporaryDirectories>,
) {
  return createScenarioHarness({
    extractionRuntime,
    personalDataDirectory: () => directories.personalDataDirectory,
    runtimeDirectory: () => directories.runtimeDirectory,
    preflight: (): ConfigurationPreflightResult => ({
      readiness: "READY",
      reasons: [],
    }),
  });
}

class RejectingExtractionRuntime implements ExtractionRuntime {
  transientBytes?: Buffer;

  constructor(readonly error: Error) {}

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    this.transientBytes = request.media.bytes;
    throw this.error;
  }
}

class InspectingExtractionRuntime extends ControlledExtractionRuntime {
  runtimeFilesDuringExtraction: string[] = [];
  runtimeFileBytes?: Buffer;
  runtimeFileMode?: number;
  runtimeDirectoryMode?: number;

  constructor(readonly runtimeDirectory: string) {
    super([{
      parsed: candidate(),
      metadata: {
        provider: "controlled",
        model: "fixture-v1",
        contentType: "json",
      },
    }]);
  }

  override async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    this.runtimeFilesDuringExtraction = filesUnder(this.runtimeDirectory);
    const [runtimeFile] = this.runtimeFilesDuringExtraction;
    if (runtimeFile !== undefined) {
      const absolutePath = join(this.runtimeDirectory, runtimeFile);
      this.runtimeFileBytes = readFileSync(absolutePath);
      this.runtimeFileMode = statSync(absolutePath).mode & 0o777;
      this.runtimeDirectoryMode = statSync(dirname(absolutePath)).mode & 0o777;
    }
    return await super.extract(request);
  }
}

class PendingExtractionRuntime implements ExtractionRuntime {
  transientBytes?: Buffer;

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    this.transientBytes = request.media.bytes;
    return await new Promise<ExtractionResult>((_resolve, reject) => {
      request.signal.addEventListener(
        "abort",
        () => reject(request.signal.reason),
        { once: true },
      );
    });
  }
}

class DelayedMediaSanitizer implements MediaSanitizer {
  readonly bytes = Buffer.from("late-sanitized-buffer");
  started = false;
  #resolve?: (lease: SanitizedMediaLease) => void;

  constructor(readonly runtimeDirectory: string) {}

  async sanitize(): Promise<SanitizedMediaLease> {
    this.started = true;
    return await new Promise<SanitizedMediaLease>((resolve) => {
      this.#resolve = resolve;
    });
  }

  resolve(): void {
    const bytes = this.bytes;
    const directory = join(this.runtimeDirectory, "sanitized-media");
    const runtimePath = join(directory, "late.png");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(runtimePath, bytes, { flag: "wx", mode: 0o600 });
    this.#resolve?.({
      media: {
        bytes,
        fileName: "late.png",
        mime: "image/png",
      } as SanitizedMediaLease["media"],
      transport: "buffer",
      sha256: sha256(bytes),
      async dispose() {
        try {
          unlinkSync(runtimePath);
        } finally {
          bytes.fill(0);
        }
      },
    });
  }
}

function temporaryDirectories() {
  const root = mkdtempSync(join(tmpdir(), "stella-media-"));
  temporaryRoots.push(root);
  const personalDataDirectory = join(root, "personal");
  const runtimeDirectory = join(root, "runtime");
  mkdirSync(personalDataDirectory);
  mkdirSync(runtimeDirectory);
  return { personalDataDirectory, runtimeDirectory };
}

async function orientedJpeg(): Promise<Buffer> {
  const width = 20;
  const height = 10;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = x < width / 2 ? 255 : 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = x < width / 2 ? 0 : 255;
    }
  }
  return await sharp(pixels, {
    raw: { width, height, channels: 3 },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "Private Camera", Software: "Private Software" },
      IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" },
    })
    .toBuffer();
}

function upload(bytes: Buffer) {
  return {
    bytes,
    fileName: "paper-log.jpg",
    mime: "image/jpeg" as const,
    receivedAt: "2026-08-10T08:00:00.000Z",
    provenance: {
      channel: "scenario",
      messageId: "message-9",
    },
  };
}

function candidate() {
  return workoutLogCandidate();
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function filesUnder(root: string): string[] {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(root, join(entry.parentPath, entry.name)),
    )
    .sort();
}

function readJson(
  path: string,
  directories: ReturnType<typeof temporaryDirectories>,
) {
  return JSON.parse(
    readFileSync(join(directories.personalDataDirectory, path), "utf8"),
  ) as unknown;
}

function singleProcessingRecord(
  directories: ReturnType<typeof temporaryDirectories>,
) {
  const processingFiles = filesUnder(directories.personalDataDirectory).filter(
    (path) => path.startsWith("processing/workout-log/"),
  );
  expect(processingFiles).toHaveLength(1);
  return readJson(processingFiles[0]!, directories);
}

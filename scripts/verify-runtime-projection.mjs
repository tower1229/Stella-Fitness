import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createPackageArtifact } from "./package-artifact.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const runtimeWorkspace = resolveRuntimeWorkspace(process.argv.slice(2));
const temporaryRoot = mkdtempSync(join(tmpdir(), "stella-runtime-projection-"));
const consumerRoot = join(temporaryRoot, "consumer");
const npmCache = join(temporaryRoot, "npm-cache");

try {
  progress("building and packing Fitness");
  run("npm", ["run", "build"], workspace);
  const fitnessArtifact = createPackageArtifact({ workspace, temporaryRoot });
  progress("packing Runtime");
  const runtimeArtifact = createPackageArtifact({
    workspace: runtimeWorkspace,
    temporaryRoot,
  });
  mkdirSync(consumerRoot, { recursive: true });
  writeFileSync(join(consumerRoot, "package.json"), '{"private":true,"type":"module"}\n');
  progress("installing paired tarballs");
  run("npm", [
    "install",
    fitnessArtifact,
    runtimeArtifact,
    "--package-lock=false",
    "--audit=false",
    "--fund=false",
    "--cache",
    npmCache,
  ], consumerRoot);
  const result = await verifyPairedProjection(consumerRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

async function verifyPairedProjection(consumer) {
  const fitness = await import(resolvePackageEntry(
    consumer,
    "@tower1229/stella-fitness",
  ));
  const scenario = await import(resolvePackageEntry(
    consumer,
    "@tower1229/stella-fitness/scenario",
  ));
  const runtime = await import(resolvePackageEntry(
    consumer,
    "@tower1229/stella-cognitive-runtime",
  ));
  for (const name of [
    "ProjectionDeterminismLedger",
    "runProjectionConsumerConformance",
    "runProjectionProducerConformance",
  ]) {
    if (typeof runtime[name] !== "function") {
      throw new Error(`Runtime package does not export ${name}`);
    }
  }
  const repository = join(consumer, "repository");
  const personalDataDirectory = join(repository, "stella", "fitness");
  const publicationRoot = join(repository, "stella", "projections", "stella");
  mkdirSync(personalDataDirectory, { recursive: true });
  mkdirSync(publicationRoot, { recursive: true });
  const openclawConfig = locatorConfig(repository);
  const harness = scenario.createScenarioHarness({
    extractionRuntime: new scenario.ControlledExtractionRuntime([]),
    personalDataDirectory: () => personalDataDirectory,
    runtimeDirectory: () => join(consumer, "runtime"),
    preflight: () => ({ readiness: "READY", reasons: [] }),
  });
  let original;
  let correction;
  let first;
  let second;
  try {
    const recorded = await harness.recordBodyWeight({
      text: "68.4 kg",
      receivedAt: "2026-08-24T00:00:00.000Z",
      source: { channel: "paired-conformance", messageId: "f1" },
    });
    assert.equal(recorded.status, "recorded");
    original = recorded.observation;
    first = await fitness.publishFitnessContextProjection({
      openclawConfig,
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    const corrected = await harness.correctBodyWeight({
      replacesObservationId: original.id,
      text: "68.8 kg",
      receivedAt: "2026-08-24T01:00:00.000Z",
      source: { channel: "paired-conformance", messageId: "f2" },
    });
    assert.equal(corrected.status, "recorded");
    correction = corrected.observation;
    second = await fitness.publishFitnessContextProjection({
      openclawConfig,
      generatedAt: "2026-08-24T01:01:00.000Z",
    });
  } finally {
    await harness.shutdown();
  }
  const packed = readStoredPublication(publicationRoot, second.projectionRevision);
  const producer = runtime.runProjectionProducerConformance({
    instanceId: packed.manifest.instance_id,
    producerId: packed.manifest.producer_id,
    consumerId: packed.manifest.consumer_id,
    canonicalSourceSnapshot: {
      revision: packed.manifest.source.revision,
      sourceAsOf: packed.manifest.source.as_of,
    },
    determinismLedger: new runtime.ProjectionDeterminismLedger(),
    categories: packed.manifest.categories,
    sourceReferences: packed.manifest.source_references,
    conflicts: packed.manifest.conflicts,
    retractions: packed.manifest.retractions,
    capabilities: packed.manifest.capabilities,
    payloads: packed.payloads.map(({ metadata, bytes }) => ({
      stableId: metadata.stable_id,
      path: metadata.path,
      mediaType: metadata.media_type,
      value: bytes.toString("utf8"),
    })),
    generatedAt: packed.manifest.generated_at,
  });
  assert.deepEqual(producer.manifestBytes, packed.manifestBytes);
  assert.equal(producer.projectionRevision, second.projectionRevision);
  const consumed = await runtime.runProjectionConsumerConformance({
    instanceId: "instance-packed-corrective",
    producerId: "stella-fitness",
    consumerId: "stella-runtime",
    purpose: "fitness_history",
    port: {
      readPointer: async () => readFileSync(join(publicationRoot, "active.json")),
      readManifest: async (revision) => readFileSync(join(
        publicationRoot,
        "revisions",
        revision,
        "manifest.json",
      )),
      readPayload: async (revision, path) => readFileSync(join(
        publicationRoot,
        "revisions",
        revision,
        path,
      )),
    },
  });
  const packedText = packed.payloads.map(({ bytes }) => bytes.toString("utf8")).join("\n");
  assert.match(packedText, new RegExp(`body-weight:${correction.id}`, "u"));
  assert.doesNotMatch(packedText, new RegExp(`body-weight:${original.id}`, "u"));
  assert.doesNotMatch(
    JSON.stringify(packed.manifest),
    new RegExp(`body-weight-${original.id}`, "u"),
  );
  assert.notEqual(first.projectionRevision, second.projectionRevision);
  assert.equal(consumed.projectionRevision, second.projectionRevision);
  assert.equal(consumed.payloads.length, packed.manifest.payloads.length);
  return {
    producerConformance: "pass",
    consumerConformance: "pass",
    firstRevision: first.projectionRevision,
    secondRevision: second.projectionRevision,
    payloadCount: consumed.payloads.length,
    replacementOldDocumentHits: 0,
    replacementOldSourceReferenceHits: 0,
  };
}

function resolvePackageEntry(consumer, specifier) {
  return run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "process.stdout.write(import.meta.resolve(process.argv[1]))",
      specifier,
    ],
    consumer,
  );
}

function readStoredPublication(publicationRoot, revision) {
  const directory = join(publicationRoot, "revisions", revision);
  const manifestBytes = readFileSync(join(directory, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  return {
    manifest,
    manifestBytes,
    payloads: manifest.payloads.map((metadata) => ({
      metadata,
      bytes: readFileSync(join(directory, metadata.path)),
    })),
  };
}

function locatorConfig(repository) {
  return {
    plugins: {
      entries: {
        "cognitive-runtime": {
          config: {
            runtime: { instance_id: "instance-packed-corrective" },
            stella: {
              schema_version: "stella.personal-data-locator/v1",
              instance_id: "instance-packed-corrective",
              personal_data_repository: repository,
            },
          },
        },
      },
    },
  };
}

function resolveRuntimeWorkspace(args) {
  if (args.length !== 2 || args[0] !== "--runtime-workspace") {
    throw new Error(
      "Usage: verify-runtime-projection.mjs --runtime-workspace <absolute-path>",
    );
  }
  if (!isAbsolute(args[1])) {
    throw new Error("Runtime workspace path must be absolute");
  }
  return resolve(args[1]);
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function progress(message) {
  process.stderr.write(`[runtime-projection] ${message}\n`);
}

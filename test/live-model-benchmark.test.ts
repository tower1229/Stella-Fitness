import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { workoutLogCandidate } from "./support/workout-log-candidate.js";
import {
  loadLiveBenchmark,
  resolveLiveBenchmarkManifest,
  runLiveBenchmark,
  scoreLiveBenchmarkCase,
  summarizeLiveBenchmark,
} from "../scripts/live-model-benchmark.mjs";

describe("live-model benchmark manifest", () => {
  it("uses a private local default and accepts only an absolute override", () => {
    expect(resolveLiveBenchmarkManifest({
      workingDirectory: "/workspace/stella-fitness",
      environment: {},
    })).toBe("/workspace/stella-fitness/.stella-benchmark/manifest.json");
    expect(resolveLiveBenchmarkManifest({
      workingDirectory: "/workspace/stella-fitness",
      environment: { STELLA_LIVE_MODEL_BENCHMARK: "/private/benchmark.json" },
    })).toBe("/private/benchmark.json");
    expect(() => resolveLiveBenchmarkManifest({
      workingDirectory: "/workspace/stella-fitness",
      environment: { STELLA_LIVE_MODEL_BENCHMARK: "relative/benchmark.json" },
    })).toThrow("STELLA_LIVE_MODEL_BENCHMARK must be an absolute path");
  });

  it("fails closed until every ground-truth case is human-approved", async () => {
    const root = await mkdtemp(join(tmpdir(), "stella-live-benchmark-test-"));
    await mkdir(join(root, "cases"), { recursive: true });
    await writeFile(join(root, "cases", "week-1-monday.png"), "fixture");
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      provider: "codex",
      model: "gpt-5.6-sol",
      cases: [{
        id: "week-1-monday",
        image: "cases/week-1-monday.png",
        reviewStatus: "pending",
        expected: { kind: "ordinary" },
      }],
    }));

    await expect(loadLiveBenchmark(manifestPath)).rejects.toThrow(
      "week-1-monday ground truth is not human-approved",
    );
  });

  it("rejects images outside the private benchmark directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "stella-live-benchmark-test-"));
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      provider: "codex",
      model: "gpt-5.6-sol",
      cases: [{
        id: "escaped",
        image: "../outside.png",
        reviewStatus: "approved",
        expected: { kind: "crop-required" },
      }],
    }));

    await expect(loadLiveBenchmark(manifestPath)).rejects.toThrow(
      "escaped image must stay inside the benchmark directory",
    );
  });

  it("rejects a benchmark image symlink that resolves outside the directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "stella-live-benchmark-test-"));
    await mkdir(join(root, "cases"));
    const outside = join(tmpdir(), `stella-outside-${Date.now()}.png`);
    await writeFile(outside, "outside");
    await symlink(outside, join(root, "cases", "escaped.png"));
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      provider: "codex",
      model: "gpt-5.6-sol",
      cases: [{
        id: "escaped-symlink",
        image: "cases/escaped.png",
        reviewStatus: "approved",
        expected: { kind: "crop-required" },
      }],
    }));

    await expect(loadLiveBenchmark(manifestPath)).rejects.toThrow(
      "escaped-symlink image must stay inside the benchmark directory",
    );
  });

  it("rejects approved ground truth when its bound digest changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "stella-live-benchmark-test-"));
    await mkdir(join(root, "cases"));
    const image = Buffer.from("approved-image");
    await writeFile(join(root, "cases", "approved.png"), image);
    const expected = { kind: "crop-required" };
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      provider: "codex",
      model: "gpt-5.6-sol",
      cases: [{
        id: "approved",
        image: "cases/approved.png",
        reviewStatus: "approved",
        expected: { ...expected, changedAfterApproval: true },
        approval: approvalFor(image, expected),
      }],
    }));

    await expect(loadLiveBenchmark(manifestPath)).rejects.toThrow(
      "approved ground truth changed after approval",
    );
  });

  it("fails the gate on any record-affecting numeric error", () => {
    const summary = summarizeLiveBenchmark([
      {
        outcome: "ordinary",
        expectedOutcome: "ordinary",
        coverage: "stage-1-ordinary",
        structuredValid: true,
        identity: { correct: 5, total: 5 },
        exactFields: { correct: 14, total: 15 },
        criticalNumeric: { errors: 1, total: 2 },
        blankPreservation: { correct: 6, total: 6 },
        setSemantics: { correct: 1, total: 1 },
        abstention: { truePositive: 1, falsePositive: 0, falseNegative: 0 },
        planLeakage: { errors: 0, total: 6 },
        correctionsRequired: 1,
        latencyMs: 1200,
      },
    ]);

    expect(summary).toMatchObject({
      cases: 1,
      criticalNumericErrorRate: 0.5,
      correctionBurden: 1,
      medianLatencyMs: 1200,
      gatePassed: false,
    });
  });

  it("fails the gate when required template layouts are not represented", () => {
    const summary = summarizeLiveBenchmark([
      {
        outcome: "ordinary",
        expectedOutcome: "ordinary",
        coverage: "stage-1-ordinary",
        structuredValid: true,
        identity: { correct: 1, total: 1 },
        exactFields: { correct: 1, total: 1 },
        criticalNumeric: { errors: 0, total: 1 },
        blankPreservation: { correct: 1, total: 1 },
        setSemantics: { correct: 1, total: 1 },
        abstention: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
        planLeakage: { errors: 0, total: 1 },
        correctionsRequired: 0,
        latencyMs: 100,
      },
    ], {
      requiredCoverage: ["stage-1-ordinary", "stage-2-ordinary"],
    });

    expect(summary).toMatchObject({
      requiredCoverage: 2,
      coveredRequiredLayouts: 1,
      coveragePassed: false,
      gatePassed: false,
    });
  });
});

describe("live-model benchmark metrics", () => {
  it("scores critical numbers, blank preservation, semantics, and abstention", () => {
    const expected = {
      kind: "ordinary",
      identity: {
        stage: 1,
        week: 1,
        weekday: "monday",
        sessionType: "full-body",
      },
      exercises: [{
        exerciseId: "goblet-squat",
        load: { visibility: "visible", value: { kind: "kg", value: 15 } },
        setSemantic: "repetitions",
        sets: [
          { visibility: "visible", value: 10 },
          { visibility: "absent" },
          { visibility: "absent" },
          { visibility: "absent" },
          { visibility: "absent" },
          { visibility: "absent" },
        ],
        actionQuality: { visibility: "ambiguous" },
        problemNote: { visibility: "absent" },
      }],
    };
    const actual = {
      layout: { value: "zhuoshu-three-stage-workbook", confidence: "high" },
      stage: { value: 1, confidence: "low" },
      week: { value: 1, confidence: "high" },
      weekday: { value: "monday", confidence: "high" },
      sessionType: { value: "full-body", confidence: "high" },
      exercises: [{
        rawLabel: { value: "高脚杯深蹲", confidence: "high" },
        exerciseId: { value: "goblet-squat", confidence: "high" },
        load: {
          value: { kind: "kg", value: 15, unit: "kg", raw: "15" },
          confidence: "high",
        },
        sets: [
          { value: 10, confidence: "high" },
          { value: null, confidence: "high" },
        ],
        actionQuality: { value: null, confidence: "low" },
        problemNote: { value: null, confidence: "high" },
      }],
      uncertainFields: [
        { path: "stage.value", kind: "low-confidence" },
        {
          path: "exercises[0].actionQuality.value",
          kind: "low-confidence",
        },
      ],
    };

    expect(scoreLiveBenchmarkCase(expected, actual)).toMatchObject({
      outcome: "ordinary",
      structuredValid: true,
      identity: { correct: 5, total: 5 },
      criticalNumeric: { errors: 0, total: 2 },
      blankPreservation: { correct: 6, total: 6 },
      loadSemantics: { correct: 1, total: 1 },
      layoutClassification: { correct: 1, total: 1 },
      setSemantics: { correct: 1, total: 1 },
      abstention: { truePositive: 1, falsePositive: 1, falseNegative: 0 },
      correctionsRequired: 0,
    });
  });

  it("scores strength-test layout, identity, and numeric results", () => {
    const actual = {
      layout: { value: "zhuoshu-strength-test-block", confidence: "high" },
      stage: { value: 1, confidence: "high" },
      week: { value: 4, confidence: "high" },
      weekday: { value: "friday", confidence: "high" },
      sessionType: { value: "strength_test", confidence: "high" },
      testResults: [{
        exerciseId: { value: "goblet-squat", confidence: "high" },
        test: "12RM",
        result: {
          value: { kind: "kg", value: 32, unit: "kg", raw: "32" },
          confidence: "high",
        },
      }],
      uncertainFields: [],
    };

    expect(scoreLiveBenchmarkCase({
      kind: "strength-test",
      identity: {
        stage: 1,
        week: 4,
        weekday: "friday",
        sessionType: "strength_test",
      },
      testResults: [{
        exerciseId: "goblet-squat",
        test: "12RM",
        result: {
          visibility: "visible",
          value: { kind: "kg", value: 32 },
        },
      }],
    }, actual)).toMatchObject({
      outcome: "strength-test",
      expectedOutcome: "strength-test",
      coverage: "strength-test",
      structuredValid: true,
      identity: { correct: 5, total: 5 },
      layoutClassification: { correct: 1, total: 1 },
      criticalNumeric: { errors: 0, total: 1 },
      correctionsRequired: 0,
    });
  });

  it("counts every critical number in a missing exercise row as an error", () => {
    const firstExercise = {
      exerciseId: "goblet-squat",
      load: { visibility: "visible", value: { kind: "kg", value: 20 } },
      setSemantic: "repetitions",
      sets: [
        { visibility: "visible", value: 10 },
        ...Array.from({ length: 5 }, () => ({ visibility: "absent" })),
      ],
      actionQuality: { visibility: "ambiguous" },
      problemNote: { visibility: "absent" },
    };
    const missingExercise = {
      exerciseId: "dumbbell-bench-press",
      load: { visibility: "visible", value: { kind: "kg", value: 15 } },
      setSemantic: "repetitions",
      sets: [
        { visibility: "visible", value: 8 },
        ...Array.from({ length: 5 }, () => ({ visibility: "absent" })),
      ],
      actionQuality: { visibility: "ambiguous" },
      problemNote: { visibility: "absent" },
    };

    const score = scoreLiveBenchmarkCase({
      kind: "ordinary",
      identity: {
        stage: 1,
        week: 1,
        weekday: "monday",
        sessionType: "full-body",
      },
      exercises: [firstExercise, missingExercise],
    }, workoutLogCandidate());

    expect(score).toMatchObject({
      identity: { correct: 5, total: 6 },
      criticalNumeric: { errors: 2, total: 4 },
      blankPreservation: { correct: 6, total: 12 },
      setSemantics: { correct: 1, total: 2 },
    });
  });

  it("runs approved cases through the provider seam", async () => {
    const root = await mkdtemp(join(tmpdir(), "stella-live-benchmark-test-"));
    await mkdir(join(root, "cases"), { recursive: true });
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(root, "cases", "full.png"), image);
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      provider: "codex",
      model: "gpt-5.6-sol",
      cases: [{
        id: "full",
        image: "cases/full.png",
        reviewStatus: "approved",
        expected: { kind: "crop-required" },
        approval: approvalFor(image, { kind: "crop-required" }),
      }],
    }));
    const requests: Array<Readonly<Record<string, unknown>>> = [];

    const report = await runLiveBenchmark({
      manifestPath,
      extractStructured: async (request) => {
        requests.push(request);
        return {
          parsed: {
            layout: "multi-session-page",
            reason: "multiple-session-blocks",
          },
        };
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      provider: "codex",
      model: "gpt-5.6-sol",
      mime: "image/png",
    });
    expect(report.cases[0]).toMatchObject({
      id: "full",
      score: { outcome: "crop-required", structuredValid: true },
    });
    expect(report.summary).toMatchObject({
      cases: 1,
      requiredCoverage: 5,
      coveredRequiredLayouts: 1,
      gatePassed: false,
    });
  });
});

function approvalFor(image: Buffer, expected: Readonly<Record<string, unknown>>) {
  return {
    reviewer: "human-reviewer",
    approvedAt: "2026-08-13T00:00:00.000Z",
    imageSha256: sha256(image),
    expectedSha256: sha256(Buffer.from(JSON.stringify(expected))),
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

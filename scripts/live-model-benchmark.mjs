import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  normalizeWorkoutLogExtraction,
  parseWorkoutLogCandidate,
  WORKOUT_LOG_CANDIDATE_SCHEMA,
} from "../src/extraction/candidate.ts";
import { WORKOUT_LOG_EXTRACTION_INSTRUCTIONS } from "../src/extraction/instructions.ts";

export const REQUIRED_LIVE_BENCHMARK_COVERAGE = [
  "crop-required",
  "stage-1-ordinary",
  "stage-2-ordinary",
  "stage-3-ordinary",
  "strength-test",
];

export async function loadLiveBenchmark(manifestPath) {
  const absoluteManifestPath = resolve(manifestPath);
  const rootDirectory = dirname(absoluteManifestPath);
  const realRootDirectory = await realpath(rootDirectory);
  const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) {
    throw new Error("Live-model benchmark schemaVersion must be 1");
  }
  if (typeof manifest.provider !== "string" || typeof manifest.model !== "string") {
    throw new Error("Live-model benchmark provider and model are required");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error("Live-model benchmark requires at least one case");
  }
  const additionalCoverage = manifest.requiredCoverage ?? [];
  if (!Array.isArray(additionalCoverage) ||
    !additionalCoverage.every((value) => typeof value === "string")) {
    throw new Error("Live-model benchmark requiredCoverage must contain unique strings");
  }
  const requiredCoverage = [...new Set([
    ...REQUIRED_LIVE_BENCHMARK_COVERAGE,
    ...additionalCoverage,
  ])];
  const providerEvidence = await loadProviderEvidence({
    value: manifest.providerEvidence,
    rootDirectory,
    realRootDirectory,
  });
  const cases = await Promise.all(manifest.cases.map(async (entry) => {
    if (entry.reviewStatus !== "approved") {
      throw new Error(`${String(entry.id)} ground truth is not human-approved`);
    }
    const imagePath = resolve(rootDirectory, entry.image);
    const unresolvedRelativeImagePath = relative(rootDirectory, imagePath);
    if (
      unresolvedRelativeImagePath.startsWith("..") ||
      unresolvedRelativeImagePath.length === 0
    ) {
      throw new Error(
        `${String(entry.id)} image must stay inside the benchmark directory`,
      );
    }
    const realImagePath = await realpath(imagePath);
    const relativeImagePath = relative(realRootDirectory, realImagePath);
    if (relativeImagePath.startsWith("..") || relativeImagePath.length === 0) {
      throw new Error(
        `${String(entry.id)} image must stay inside the benchmark directory`,
      );
    }
    const approval = entry.approval;
    if (
      typeof approval?.reviewer !== "string" ||
      approval.reviewer.trim().length === 0 ||
      typeof approval.approvedAt !== "string" ||
      Number.isNaN(Date.parse(approval.approvedAt)) ||
      typeof approval.imageSha256 !== "string" ||
      typeof approval.expectedSha256 !== "string"
    ) {
      throw new Error(`${String(entry.id)} approval provenance is incomplete`);
    }
    const imageSha256 = sha256(await readFile(realImagePath));
    if (imageSha256 !== approval.imageSha256) {
      throw new Error(`${String(entry.id)} image changed after approval`);
    }
    const expectedSha256 = sha256(Buffer.from(JSON.stringify(entry.expected)));
    if (expectedSha256 !== approval.expectedSha256) {
      throw new Error(`${String(entry.id)} ground truth changed after approval`);
    }
    return {
      id: entry.id,
      imagePath: realImagePath,
      expected: entry.expected,
      approval,
    };
  }));
  return {
    manifestPath: absoluteManifestPath,
    rootDirectory,
    provider: manifest.provider,
    model: manifest.model,
    requiredCoverage,
    providerEvidence,
    cases,
  };
}

export function resolveLiveBenchmarkManifest({ workingDirectory, environment }) {
  const override = environment.STELLA_LIVE_MODEL_BENCHMARK?.trim();
  if (override === undefined || override.length === 0) {
    return resolve(workingDirectory, ".stella-benchmark/manifest.json");
  }
  if (!isAbsolute(override)) {
    throw new Error("STELLA_LIVE_MODEL_BENCHMARK must be an absolute path");
  }
  return override;
}

export function scoreLiveBenchmarkCase(expected, actual) {
  if (expected.kind === "crop-required") {
    const matched = isRecord(actual) &&
      actual.layout === "multi-session-page" &&
      actual.reason === "multiple-session-blocks";
    const score = emptyScore(
      matched ? "crop-required" : "invalid",
      matched,
      "crop-required",
      "crop-required",
    );
    score.layoutClassification.total = 1;
    if (matched) score.layoutClassification.correct = 1;
    return score;
  }

  let candidate;
  try {
    candidate = parseWorkoutLogCandidate(actual);
  } catch {
    return emptyScore(
      "invalid",
      false,
      "ordinary",
      coverageForExpected(expected),
    );
  }
  if (expected.kind === "strength-test" && "testResults" in candidate) {
    return scoreStrengthTest(expected, candidate);
  }
  if (expected.kind !== "ordinary" || !("exercises" in candidate)) {
    return emptyScore(
      "invalid",
      false,
      "ordinary",
      coverageForExpected(expected),
    );
  }

  const score = emptyScore(
    "ordinary",
    true,
    "ordinary",
    coverageForExpected(expected),
  );
  score.layoutClassification.total = 1;
  score.layoutClassification.correct = 1;
  const uncertainPaths = new Set(candidate.uncertainFields.map((field) => field.path));
  for (const key of ["stage", "week", "weekday", "sessionType"]) {
    score.identity.total += 1;
    score.exactFields.total += 1;
    if (candidate[key].value === expected.identity[key]) {
      score.identity.correct += 1;
      score.exactFields.correct += 1;
    } else {
      score.correctionsRequired += 1;
    }
    if (uncertainPaths.has(`${key}.value`)) {
      score.abstention.falsePositive += 1;
    }
  }

  const actualByExerciseId = new Map(candidate.exercises.map((exercise, index) => [
    exercise.exerciseId.value,
    { exercise, index },
  ]));
  for (const expectedExercise of expected.exercises) {
    score.identity.total += 1;
    score.exactFields.total += 1;
    const matched = actualByExerciseId.get(expectedExercise.exerciseId);
    if (matched === undefined) {
      score.correctionsRequired += 1;
      scoreMissingExercise(expectedExercise, score);
      continue;
    }
    score.identity.correct += 1;
    score.exactFields.correct += 1;
    if (uncertainPaths.has(`exercises[${matched.index}].exerciseId.value`)) {
      score.abstention.falsePositive += 1;
    }
    scoreExpectedField({
      expected: expectedExercise.load,
      actualValue: projectLoad(matched.exercise.load.value),
      path: `exercises[${matched.index}].load.value`,
      uncertainPaths,
      score,
      criticalNumeric: expectedExercise.load.value?.kind === "kg",
    });
    score.loadSemantics.total += 1;
    if (projectLoad(matched.exercise.load.value)?.kind === expectedExercise.load.value?.kind) {
      score.loadSemantics.correct += 1;
    } else {
      score.correctionsRequired += 1;
    }
    expectedExercise.sets.forEach((expectedSet, setIndex) => {
      const actualSet = matched.exercise.sets[setIndex];
      const path = `exercises[${matched.index}].sets[${setIndex}].value`;
      scoreExpectedField({
        expected: expectedSet,
        actualValue: actualSet?.value ?? null,
        path,
        uncertainPaths,
        score,
        criticalNumeric: expectedSet.visibility === "visible",
      });
      if (expectedSet.visibility === "visible") {
        score.setSemantics.total += 1;
        if (actualSet?.semantic === expectedExercise.setSemantic) {
          score.setSemantics.correct += 1;
        } else {
          score.correctionsRequired += 1;
        }
      }
    });
    scoreExpectedField({
      expected: expectedExercise.actionQuality,
      actualValue: matched.exercise.actionQuality.value,
      path: `exercises[${matched.index}].actionQuality.value`,
      uncertainPaths,
      score,
    });
    scoreExpectedField({
      expected: expectedExercise.problemNote,
      actualValue: matched.exercise.problemNote.value,
      path: `exercises[${matched.index}].problemNote.value`,
      uncertainPaths,
      score,
    });
  }
  scoreUnexpectedRows({
    actualIds: candidate.exercises.map((exercise) => exercise.exerciseId.value),
    expectedIds: expected.exercises.map((exercise) => exercise.exerciseId),
    score,
  });
  return score;
}

function scoreStrengthTest(expected, candidate) {
  const score = emptyScore(
    "strength-test",
    true,
    "strength-test",
    "strength-test",
  );
  score.layoutClassification.total = 1;
  score.layoutClassification.correct = 1;
  const uncertainPaths = new Set(candidate.uncertainFields.map((field) => field.path));
  for (const key of ["stage", "week", "weekday", "sessionType"]) {
    score.identity.total += 1;
    score.exactFields.total += 1;
    if (candidate[key].value === expected.identity[key]) {
      score.identity.correct += 1;
      score.exactFields.correct += 1;
    } else {
      score.correctionsRequired += 1;
    }
    if (uncertainPaths.has(`${key}.value`)) score.abstention.falsePositive += 1;
  }
  const actualByExerciseId = new Map(candidate.testResults.map((result, index) => [
    result.exerciseId.value,
    { result, index },
  ]));
  for (const expectedResult of expected.testResults) {
    score.identity.total += 1;
    score.exactFields.total += 1;
    const matched = actualByExerciseId.get(expectedResult.exerciseId);
    if (matched === undefined || matched.result.test !== expectedResult.test) {
      score.correctionsRequired += 1;
      scoreMissingField(expectedResult.result, score, {
        criticalNumeric: expectedResult.result.visibility === "visible",
      });
      continue;
    }
    score.identity.correct += 1;
    score.exactFields.correct += 1;
    scoreExpectedField({
      expected: expectedResult.result,
      actualValue: projectStrengthTestResult(matched.result.result.value),
      path: `testResults[${matched.index}].result.value`,
      uncertainPaths,
      score,
      criticalNumeric: expectedResult.result.visibility === "visible",
    });
  }
  scoreUnexpectedRows({
    actualIds: candidate.testResults.map((result) => result.exerciseId.value),
    expectedIds: expected.testResults.map((result) => result.exerciseId),
    score,
  });
  return score;
}

function scoreUnexpectedRows({ actualIds, expectedIds, score }) {
  const remaining = new Map();
  for (const expectedId of expectedIds) {
    remaining.set(expectedId, (remaining.get(expectedId) ?? 0) + 1);
  }
  for (const actualId of actualIds) {
    const count = remaining.get(actualId) ?? 0;
    if (count > 0) {
      remaining.set(actualId, count - 1);
      continue;
    }
    score.identity.total += 1;
    score.exactFields.total += 1;
    score.correctionsRequired += 1;
  }
}

function scoreMissingExercise(expectedExercise, score) {
  scoreMissingField(expectedExercise.load, score, {
    criticalNumeric: expectedExercise.load.value?.kind === "kg",
  });
  score.loadSemantics.total += 1;
  score.correctionsRequired += 1;
  for (const expectedSet of expectedExercise.sets) {
    scoreMissingField(expectedSet, score, {
      criticalNumeric: expectedSet.visibility === "visible",
    });
    if (expectedSet.visibility === "visible") {
      score.setSemantics.total += 1;
      score.correctionsRequired += 1;
    }
  }
  scoreMissingField(expectedExercise.actionQuality, score);
  scoreMissingField(expectedExercise.problemNote, score);
}

function scoreMissingField(expected, score, { criticalNumeric = false } = {}) {
  const shouldAbstain = expected.visibility === "ambiguous" ||
    expected.visibility === "cropped";
  if (shouldAbstain) {
    score.abstention.falseNegative += 1;
    score.correctionsRequired += 1;
    return;
  }
  score.exactFields.total += 1;
  score.correctionsRequired += 1;
  if (criticalNumeric) {
    score.criticalNumeric.total += 1;
    score.criticalNumeric.errors += 1;
  }
  if (expected.visibility === "absent") {
    score.blankPreservation.total += 1;
    score.planLeakage.total += 1;
  }
}

export async function runLiveBenchmark(options) {
  const benchmark = await loadLiveBenchmark(options.manifestPath);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const cases = [];
  for (const benchmarkCase of benchmark.cases) {
    const bytes = await readFile(benchmarkCase.imagePath);
    const startedAt = performance.now();
    let parsed;
    let execution;
    let errorMessage;
    try {
      const result = await options.extractStructured({
        provider: benchmark.provider,
        model: benchmark.model,
        bytes,
        fileName: basename(benchmarkCase.imagePath),
        mime: "image/png",
        timeoutMs,
        instructions: WORKOUT_LOG_EXTRACTION_INSTRUCTIONS,
        schemaName: "stella_workout_log_candidate_v2",
        jsonSchema: WORKOUT_LOG_CANDIDATE_SCHEMA,
      });
      execution = validateExecutionEvidence({
        execution: result.execution,
        provider: benchmark.provider,
        model: benchmark.model,
        exactHost: benchmark.providerEvidence?.exactHost,
      });
      parsed = normalizeWorkoutLogExtraction(result.parsed);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      bytes.fill(0);
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const score = {
      ...scoreLiveBenchmarkCase(benchmarkCase.expected, parsed),
      latencyMs,
    };
    cases.push({
      id: benchmarkCase.id,
      latencyMs,
      ...(parsed === undefined ? {} : { parsed }),
      ...(execution === undefined ? {} : { execution }),
      ...(errorMessage === undefined ? {} : { error: errorMessage }),
      score,
    });
  }
  const executionReceipts = cases
    .map((entry) => entry.execution?.requestId)
    .filter((requestId) => requestId !== undefined);
  const boundProviderEvidence = {
    ...benchmark.providerEvidence,
    adapterSha256: options.adapterSha256,
    executionReceipts,
    executionEvidenceComplete: executionReceipts.length === cases.length &&
      new Set(executionReceipts).size === executionReceipts.length,
  };
  return {
    cases,
    evidence: boundProviderEvidence,
    summary: summarizeLiveBenchmark(cases.map((entry) => entry.score), {
      requiredCoverage: benchmark.requiredCoverage,
      providerEvidence: boundProviderEvidence,
    }),
  };
}

function validateExecutionEvidence({ execution, provider, model, exactHost }) {
  if (!isRecord(execution) ||
    execution.provider !== provider ||
    execution.model !== model ||
    typeof execution.host !== "string" || execution.host.trim().length === 0 ||
    (exactHost !== undefined && execution.host !== exactHost) ||
    typeof execution.requestId !== "string" || execution.requestId.trim().length === 0 ||
    execution.operatorPermissionVerified !== true) {
    throw new Error("Live-model adapter execution evidence did not match the request");
  }
  return execution;
}

async function loadProviderEvidence({ value, rootDirectory, realRootDirectory }) {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.termsReceipt !== "string") {
    throw new Error("Live-model provider evidence requires a termsReceipt path");
  }
  const receiptPath = resolve(rootDirectory, value.termsReceipt);
  const unresolvedRelative = relative(rootDirectory, receiptPath);
  if (unresolvedRelative.startsWith("..") || unresolvedRelative.length === 0) {
    throw new Error("Live-model terms receipt must stay inside the benchmark directory");
  }
  const realReceiptPath = await realpath(receiptPath);
  const resolvedRelative = relative(realRootDirectory, realReceiptPath);
  if (resolvedRelative.startsWith("..") || resolvedRelative.length === 0) {
    throw new Error("Live-model terms receipt must stay inside the benchmark directory");
  }
  const actualSha256 = sha256(await readFile(realReceiptPath));
  if (actualSha256 !== value.termsReceiptSha256) {
    throw new Error("Live-model terms receipt changed after review");
  }
  return {
    ...value,
    termsReceipt: relative(rootDirectory, realReceiptPath),
  };
}

function scoreExpectedField({
  expected,
  actualValue,
  path,
  uncertainPaths,
  score,
  criticalNumeric = false,
}) {
  const predictedAbstention = uncertainPaths.has(path);
  const shouldAbstain = expected.visibility === "ambiguous" ||
    expected.visibility === "cropped";
  if (shouldAbstain) {
    if (predictedAbstention) score.abstention.truePositive += 1;
    else {
      score.abstention.falseNegative += 1;
      score.correctionsRequired += 1;
    }
    return;
  }
  if (predictedAbstention) score.abstention.falsePositive += 1;

  const expectedValue = expected.visibility === "absent" ? null : expected.value;
  const correct = equivalentValue(actualValue, expectedValue);
  score.exactFields.total += 1;
  if (correct) score.exactFields.correct += 1;
  else score.correctionsRequired += 1;

  if (expected.visibility === "absent") {
    score.blankPreservation.total += 1;
    if (correct) score.blankPreservation.correct += 1;
    else score.planLeakage.errors += 1;
    score.planLeakage.total += 1;
  }
  if (criticalNumeric) {
    score.criticalNumeric.total += 1;
    if (!correct) score.criticalNumeric.errors += 1;
  }
}

function projectLoad(load) {
  if (load === null) return null;
  if (load.kind === "kg") return { kind: "kg", value: load.value };
  return { kind: load.kind };
}

function projectStrengthTestResult(result) {
  if (result === null) return null;
  return { kind: result.kind, value: result.value };
}

function equivalentValue(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function summarizeLiveBenchmark(scores, options = {}) {
  const requiredCoverageValues = options.requiredCoverage ?? [];
  const observedCoverage = new Set(scores.map((score) => score.coverage));
  const coveredRequiredLayouts = requiredCoverageValues.filter((value) =>
    observedCoverage.has(value)).length;
  const coveragePassed = coveredRequiredLayouts === requiredCoverageValues.length;
  const providerEvidencePassed = isProviderEvidenceComplete(options.providerEvidence);
  const totals = {
    cases: scores.length,
    structuredValid: scores.filter((score) => score.structuredValid).length,
    cropExpected: scores.filter((score) => score.expectedOutcome === "crop-required").length,
    cropCorrect: scores.filter((score) =>
      score.expectedOutcome === "crop-required" && score.outcome === "crop-required").length,
    identityCorrect: sum(scores, (score) => score.identity.correct),
    identityTotal: sum(scores, (score) => score.identity.total),
    exactCorrect: sum(scores, (score) => score.exactFields.correct),
    exactTotal: sum(scores, (score) => score.exactFields.total),
    numericErrors: sum(scores, (score) => score.criticalNumeric.errors),
    numericTotal: sum(scores, (score) => score.criticalNumeric.total),
    blankCorrect: sum(scores, (score) => score.blankPreservation.correct),
    blankTotal: sum(scores, (score) => score.blankPreservation.total),
    loadSemanticsCorrect: sum(scores, (score) => score.loadSemantics.correct),
    loadSemanticsTotal: sum(scores, (score) => score.loadSemantics.total),
    layoutCorrect: sum(scores, (score) => score.layoutClassification.correct),
    layoutTotal: sum(scores, (score) => score.layoutClassification.total),
    semanticsCorrect: sum(scores, (score) => score.setSemantics.correct),
    semanticsTotal: sum(scores, (score) => score.setSemantics.total),
    abstentionTruePositive: sum(scores, (score) => score.abstention.truePositive),
    abstentionFalsePositive: sum(scores, (score) => score.abstention.falsePositive),
    abstentionFalseNegative: sum(scores, (score) => score.abstention.falseNegative),
    leakageErrors: sum(scores, (score) => score.planLeakage.errors),
    leakageTotal: sum(scores, (score) => score.planLeakage.total),
    corrections: sum(scores, (score) => score.correctionsRequired),
  };
  const structuredValidity = ratio(totals.structuredValid, totals.cases);
  const cropRequiredAccuracy = ratio(totals.cropCorrect, totals.cropExpected);
  const identityAccuracy = ratio(totals.identityCorrect, totals.identityTotal);
  const exactFieldAccuracy = ratio(totals.exactCorrect, totals.exactTotal);
  const criticalNumericErrorRate = errorRate(totals.numericErrors, totals.numericTotal);
  const blankPreservationAccuracy = ratio(totals.blankCorrect, totals.blankTotal);
  const loadSemanticAccuracy = ratio(
    totals.loadSemanticsCorrect,
    totals.loadSemanticsTotal,
  );
  const layoutClassificationAccuracy = ratio(
    totals.layoutCorrect,
    totals.layoutTotal,
  );
  const setSemanticAccuracy = ratio(totals.semanticsCorrect, totals.semanticsTotal);
  const abstentionPrecision = ratio(
    totals.abstentionTruePositive,
    totals.abstentionTruePositive + totals.abstentionFalsePositive,
  );
  const abstentionRecall = ratio(
    totals.abstentionTruePositive,
    totals.abstentionTruePositive + totals.abstentionFalseNegative,
  );
  const planLeakageRate = errorRate(totals.leakageErrors, totals.leakageTotal);
  const correctionBurden = totals.corrections;
  const medianLatencyMs = median(scores.map((score) => score.latencyMs));
  const metricEvidencePassed = totals.numericTotal > 0 &&
    totals.blankTotal > 0 &&
    totals.loadSemanticsTotal > 0 &&
    totals.layoutTotal > 0 &&
    totals.semanticsTotal > 0 &&
    totals.abstentionTruePositive + totals.abstentionFalseNegative > 0;
  return {
    cases: totals.cases,
    structuredValidity,
    cropRequiredAccuracy,
    identityAccuracy,
    exactFieldAccuracy,
    criticalNumericErrorRate,
    blankPreservationAccuracy,
    loadSemanticAccuracy,
    layoutClassificationAccuracy,
    setSemanticAccuracy,
    abstentionPrecision,
    abstentionRecall,
    planLeakageRate,
    correctionBurden,
    medianLatencyMs,
    requiredCoverage: requiredCoverageValues.length,
    coveredRequiredLayouts,
    coveragePassed,
    metricEvidencePassed,
    providerEvidencePassed,
    gatePassed: structuredValidity === 1 &&
      coveragePassed &&
      metricEvidencePassed &&
      providerEvidencePassed &&
      cropRequiredAccuracy === 1 &&
      identityAccuracy === 1 &&
      exactFieldAccuracy === 1 &&
      criticalNumericErrorRate === 0 &&
      blankPreservationAccuracy === 1 &&
      loadSemanticAccuracy === 1 &&
      layoutClassificationAccuracy === 1 &&
      setSemanticAccuracy === 1 &&
      abstentionPrecision === 1 &&
      abstentionRecall === 1 &&
      planLeakageRate === 0 &&
      correctionBurden === 0,
  };
}

function isProviderEvidenceComplete(value) {
  return isRecord(value) &&
    value.operatorPermissionVerified === true &&
    typeof value.exactHost === "string" && value.exactHost.trim().length > 0 &&
    typeof value.termsReviewedAt === "string" &&
    !Number.isNaN(Date.parse(value.termsReviewedAt)) &&
    typeof value.costCurrency === "string" && value.costCurrency.trim().length > 0 &&
    typeof value.totalCost === "number" && Number.isFinite(value.totalCost) &&
    value.totalCost >= 0 &&
    typeof value.adapterSha256 === "string" && /^[0-9a-f]{64}$/u.test(value.adapterSha256) &&
    Array.isArray(value.executionReceipts) && value.executionReceipts.length > 0 &&
    value.executionReceipts.every((entry) => typeof entry === "string" && entry.length > 0) &&
    new Set(value.executionReceipts).size === value.executionReceipts.length &&
    value.executionEvidenceComplete === true &&
    typeof value.termsReceiptSha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(value.termsReceiptSha256);
}

function emptyScore(outcome, structuredValid, expectedOutcome, coverage) {
  return {
    outcome,
    expectedOutcome,
    coverage,
    structuredValid,
    identity: { correct: 0, total: 0 },
    exactFields: { correct: 0, total: 0 },
    criticalNumeric: { errors: 0, total: 0 },
    blankPreservation: { correct: 0, total: 0 },
    loadSemantics: { correct: 0, total: 0 },
    layoutClassification: { correct: 0, total: 0 },
    setSemantics: { correct: 0, total: 0 },
    abstention: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
    planLeakage: { errors: 0, total: 0 },
    correctionsRequired: 0,
  };
}

function coverageForExpected(expected) {
  if (expected.kind === "crop-required") return "crop-required";
  if (expected.kind === "ordinary") {
    return `stage-${String(expected.identity?.stage)}-ordinary`;
  }
  if (expected.kind === "strength-test") return "strength-test";
  return "unknown";
}

function sum(values, select) {
  return values.reduce((total, value) => total + select(value), 0);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function errorRate(errors, total) {
  return total === 0 ? 0 : errors / total;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadLiveModelAdapter(environment) {
  const adapterPath = environment.STELLA_LIVE_MODEL_ADAPTER?.trim();
  if (adapterPath === undefined || adapterPath.length === 0 || !isAbsolute(adapterPath)) {
    throw new Error("STELLA_LIVE_MODEL_ADAPTER must be an absolute path");
  }
  const realAdapterPath = await realpath(adapterPath);
  const adapter = await import(pathToFileURL(realAdapterPath).href);
  if (typeof adapter.extractStructured !== "function") {
    throw new Error("Live-model adapter must export extractStructured(request)");
  }
  return {
    extractStructured: adapter.extractStructured,
    sha256: sha256(await readFile(realAdapterPath)),
  };
}

async function main() {
  const manifestPath = resolveLiveBenchmarkManifest({
    workingDirectory: process.cwd(),
    environment: process.env,
  });
  const benchmark = await loadLiveBenchmark(manifestPath);
  const adapter = await loadLiveModelAdapter(process.env);
  const report = await runLiveBenchmark({
    manifestPath: benchmark.manifestPath,
    extractStructured: adapter.extractStructured,
    adapterSha256: adapter.sha256,
  });
  const resultsDirectory = join(benchmark.rootDirectory, "results");
  await mkdir(resultsDirectory, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const resultPath = join(resultsDirectory, `${timestamp}.json`);
  await writeFile(resultPath, `${JSON.stringify({
    schemaVersion: 1,
    provider: benchmark.provider,
    model: benchmark.model,
    recordedAt: new Date().toISOString(),
    ...report,
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    ...report.summary,
    result: relative(process.cwd(), resultPath),
  }, null, 2)}\n`);
  if (!report.summary.gatePassed) process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `Live-model benchmark blocked: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

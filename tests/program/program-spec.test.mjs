import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ProgramSpecValidationError,
  parseProgramSpecYaml,
} from "../../dist/programs/program-spec.js";

const sourcePath = new URL(
  "../../knowledge/programs/zhuoshu-12-week/program-spec.v0.1.yaml",
  import.meta.url,
);
const source = readFileSync(sourcePath, "utf8");

test("draft source ProgramSpec parses as a complete 12-week structure", () => {
  const spec = parseProgramSpecYaml(source);

  assert.equal(spec.id, "zhuoshu-12-week");
  assert.equal(spec.status, "draft");
  assert.equal(spec.weeks.length, 12);
  assert.deepEqual(
    spec.weeks.map((week) => week.week),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
});

test("Week 4 Friday remains explicitly unresolved", () => {
  const spec = parseProgramSpecYaml(source);
  const week4 = spec.weeks.find((week) => week.week === 4);
  const friday = week4?.sessions.find((session) => session.day === "friday");

  assert.ok(friday);
  assert.equal(friday.status, "unresolved");
  assert.equal(friday.reason, "source_missing");
  assert.equal(friday.exercises, undefined);
  assert.ok(spec.knownGapIds.includes("week-04-friday"));
});

test("a program with unresolved sessions cannot be promoted to canonical", () => {
  const canonicalized = source.replace("status: draft", "status: canonical");

  assert.throws(
    () => parseProgramSpecYaml(canonicalized),
    (error) =>
      error instanceof ProgramSpecValidationError &&
      error.issues.some((issue) => issue.includes("canonical programs cannot")),
  );
});

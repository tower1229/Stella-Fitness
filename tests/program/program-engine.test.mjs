import assert from "node:assert/strict";
import test from "node:test";

import { resolvePlannedSession } from "../../dist/engines/program-engine.js";
import { UnresolvedProgramSessionError } from "../../dist/domain/program.js";

const baseKey = {
  programId: "zhuoshu-12-week",
  programVersion: "0.1.0-draft",
  week: 4,
  day: "friday",
};

test("Program Engine fails closed for unresolved source sessions", () => {
  const repository = {
    getSession() {
      return {
        ...baseKey,
        status: "unresolved",
        kind: "full-body",
        reason: "source_missing",
      };
    },
  };

  assert.throws(
    () => resolvePlannedSession(repository, baseKey),
    UnresolvedProgramSessionError,
  );
});

test("Program Engine returns resolved source sessions unchanged", () => {
  const resolved = {
    ...baseKey,
    week: 3,
    status: "resolved",
    kind: "full-body",
  };

  const repository = {
    getSession() {
      return resolved;
    },
  };

  assert.deepEqual(
    resolvePlannedSession(repository, { ...baseKey, week: 3 }),
    resolved,
  );
});

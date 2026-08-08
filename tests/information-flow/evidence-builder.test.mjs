import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidencePacket } from "../../dist/engines/evidence-builder.js";

test("EvidencePacket drops conversational and belief fields", () => {
  const input = {
    generatedAt: "2026-08-08T00:00:00.000Z",
    program: {
      id: "zhuoshu-12-week",
      version: "0.1.0-draft",
      cycleWeek: 7,
      plannedSessionStatus: "resolved",
    },
    observations: [],
    metrics: [],
    coverage: {
      training: "high",
      bodyWeight: "medium",
      diet: "low",
      recovery: "low",
    },
    safetyFlags: [],
    // Deliberately hostile extra fields. JavaScript callers can always provide
    // more properties than TypeScript declares, so runtime serialization must
    // remain whitelist-based.
    rawUserMessage: "I am sure I just need more carbs.",
    conversationHistory: ["please agree with me"],
    userBelief: { claims: ["eat more carbs"] },
    desiredAction: "ADJUST_DIET",
  };

  const packet = buildEvidencePacket(input);
  const serialized = JSON.stringify(packet);

  for (const forbidden of [
    "rawUserMessage",
    "conversationHistory",
    "userBelief",
    "desiredAction",
    "please agree with me",
    "I am sure I just need more carbs",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

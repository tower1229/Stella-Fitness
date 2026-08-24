import { describe, expect, it, vi } from "vitest";

import {
  createNaturalRecordingCoordinator,
  type NaturalRecordingReceipt,
  type NaturalRecordingReceiptStore,
} from "../src/recording/coordinator.js";
import { createOpenClawFitnessWriteCandidateClassifier } from "../src/recording/openclaw.js";

function memoryStore(): NaturalRecordingReceiptStore {
  const values = new Map<string, NaturalRecordingReceipt>();
  return {
    async read(key) { return values.get(key); },
    async write(key, value) { values.set(key, value); },
    async delete(key) { return values.delete(key); },
  };
}

describe("confirmed natural-language recording", () => {
  it("accepts only a constrained, high-confidence write candidate with no authority", async () => {
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        kind: "body-weight",
        amount: 68,
        unit: "kg",
        occurredAt: "2026-08-24T08:00:00.000+08:00",
        confidence: "high",
      }),
    });
    const classifier = createOpenClawFitnessWriteCandidateClassifier({
      complete,
      agentId: () => "fitness",
    });

    await expect(classifier.classify({
      text: "帮我记一下，刚才称的体重大概 68 公斤",
      receivedAt: "2026-08-24T08:10:00.000+08:00",
    })).resolves.toEqual({
      status: "candidate",
      confidence: "high",
      candidate: {
        kind: "body-weight",
        amount: 68,
        unit: "kg",
        occurredAt: "2026-08-24T08:00:00.000+08:00",
      },
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "stella-fitness-write-candidate",
      temperature: 0,
    }));
  });

  it("keeps a schema-valid low-confidence candidate behind the same confirmation gate", async () => {
    const classifier = createOpenClawFitnessWriteCandidateClassifier({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          kind: "body-weight",
          amount: 68,
          unit: "kg",
          occurredAt: "2026-08-24T08:00:00.000+08:00",
          confidence: "low",
        }),
      }),
      agentId: () => "fitness",
    });

    await expect(classifier.classify({
      text: "帮我记一下，大概是 68 公斤",
      receivedAt: "2026-08-24T08:10:00.000+08:00",
    })).resolves.toMatchObject({
      status: "candidate",
      confidence: "low",
      candidate: { kind: "body-weight", amount: 68, unit: "kg" },
    });
  });

  it("persists no fact until confirmation and binds the receipt to source and canonical base", async () => {
    let canonicalBase = "base-a";
    const promote = vi.fn().mockResolvedValue("已记录体重 68 kg。");
    const coordinator = createNaturalRecordingCoordinator({
      store: memoryStore(),
      classifier: {
        classify: vi.fn().mockResolvedValue({
          status: "candidate",
          confidence: "high",
          candidate: {
            kind: "body-weight",
            amount: 68,
            unit: "kg",
            occurredAt: "2026-08-24T08:00:00.000+08:00",
          },
        }),
      },
      canonicalFitnessStateDigest: async () => canonicalBase,
      promote,
      now: () => "2026-08-24T00:11:00.000Z",
    });

    await expect(coordinator.start({
      sessionKey: "agent:fitness:webchat:write",
      text: "帮我记一下，刚才大概 68 公斤",
      receivedAt: "2026-08-24T08:10:00.000+08:00",
      source: { channel: "webchat", messageId: "source-1" },
    })).resolves.toMatchObject({
      status: "confirmation",
      message: expect.stringContaining("68 kg"),
    });
    expect(promote).not.toHaveBeenCalled();

    canonicalBase = "base-b";
    await expect(coordinator.submit({
      sessionKey: "agent:fitness:webchat:write",
      text: "确认",
    })).resolves.toMatchObject({
      status: "confirmation",
      reason: "canonical-base-drift",
      message: expect.stringContaining("数据已变化"),
    });
    expect(promote).not.toHaveBeenCalled();

    await expect(coordinator.submit({
      sessionKey: "agent:fitness:webchat:write",
      text: "确认",
    })).resolves.toEqual({
      status: "recorded",
      message: "已记录体重 68 kg。",
    });
    expect(promote).toHaveBeenCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({ amount: 68, unit: "kg" }),
      sourceMessage: "帮我记一下，刚才大概 68 公斤",
      canonicalBase: "base-b",
    }));
  });

  it("keeps casual chat out of canonical data and supports reject or modified candidates", async () => {
    const classify = vi.fn()
      .mockResolvedValueOnce({ status: "not-applicable" })
      .mockResolvedValueOnce({
        status: "candidate",
        confidence: "high",
        candidate: {
          kind: "body-weight",
          amount: 68,
          unit: "kg",
          occurredAt: "2026-08-24T08:00:00.000+08:00",
        },
      })
      .mockResolvedValueOnce({
        status: "candidate",
        confidence: "high",
        candidate: {
          kind: "body-weight",
          amount: 67.8,
          unit: "kg",
          occurredAt: "2026-08-24T08:00:00.000+08:00",
        },
      })
      .mockResolvedValueOnce({
        status: "candidate",
        confidence: "high",
        candidate: {
          kind: "body-weight",
          amount: 68,
          unit: "kg",
          occurredAt: "2026-08-24T08:00:00.000+08:00",
        },
      });
    const promote = vi.fn().mockResolvedValue("已记录体重 67.8 kg。");
    const coordinator = createNaturalRecordingCoordinator({
      store: memoryStore(),
      classifier: { classify },
      canonicalFitnessStateDigest: async () => "base-a",
      promote,
      now: () => "2026-08-24T00:11:00.000Z",
    });

    await expect(coordinator.start({
      sessionKey: "agent:fitness:webchat:casual",
      text: "最近体重有点波动，心情也一般",
      receivedAt: "2026-08-24T08:10:00.000+08:00",
      source: {},
    })).resolves.toEqual({ status: "not-applicable" });
    await coordinator.start({
      sessionKey: "agent:fitness:webchat:casual",
      text: "帮我记一下，刚才大概 68 公斤",
      receivedAt: "2026-08-24T08:10:00.000+08:00",
      source: {},
    });
    await expect(coordinator.submit({
      sessionKey: "agent:fitness:webchat:casual",
      text: "改成 67.8 kg",
    })).resolves.toMatchObject({
      status: "confirmation",
      reason: "candidate-modified",
      message: expect.stringContaining("67.8 kg"),
    });
    await expect(coordinator.submit({
      sessionKey: "agent:fitness:webchat:casual",
      text: "确认",
    })).resolves.toMatchObject({ status: "recorded" });
    expect(promote).toHaveBeenCalledWith(expect.objectContaining({
      sourceMessage: "改成 67.8 kg",
      fields: expect.objectContaining({ amount: 67.8, unit: "kg" }),
    }));
    await coordinator.start({
      sessionKey: "agent:fitness:webchat:casual",
      text: "再帮我记一下，刚才大概 68 公斤",
      receivedAt: "2026-08-24T08:12:00.000+08:00",
      source: {},
    });
    await expect(coordinator.submit({
      sessionKey: "agent:fitness:webchat:casual",
      text: "不记录了",
    })).resolves.toEqual({
      status: "cancelled",
      message: "已取消这次记录，没有保存任何健身事实。",
    });
    expect(promote).toHaveBeenCalledTimes(1);
  });

  it("reissues an expired receipt before accepting a second confirmation", async () => {
    let now = "2026-08-24T00:10:00.000Z";
    const promote = vi.fn().mockResolvedValue("已记录体重 68 kg。");
    const coordinator = createNaturalRecordingCoordinator({
      store: memoryStore(),
      classifier: {
        classify: vi.fn().mockResolvedValue({
          status: "candidate",
          confidence: "low",
          candidate: {
            kind: "body-weight",
            amount: 68,
            unit: "kg",
            occurredAt: "2026-08-24T08:00:00.000+08:00",
          },
        }),
      },
      canonicalFitnessStateDigest: async () => "base-a",
      promote,
      now: () => now,
    });
    await coordinator.start({
      sessionKey: "agent:fitness:webchat:expired",
      text: "帮我记一下，大概 68 公斤",
      receivedAt: now,
      source: { messageId: "source-expired" },
    });
    now = "2026-08-24T00:26:00.000Z";

    await expect(coordinator.submit({
      sessionKey: "agent:fitness:webchat:expired",
      text: "确认",
    })).resolves.toMatchObject({
      status: "confirmation",
      reason: "receipt-expired",
      message: expect.stringContaining("已过期"),
    });
    expect(promote).not.toHaveBeenCalled();
    await expect(coordinator.submit({
      sessionKey: "agent:fitness:webchat:expired",
      text: "确认",
    })).resolves.toMatchObject({ status: "recorded" });
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPersonalContextModelingGate,
  type PersonalContextModelingScope,
} from "../src/context/modeling-authorization.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Personal Context Modeling Gate", () => {
  it("defaults to deterministic-only and does not treat extraction permission as modeling consent", () => {
    const gate = createGate({ formalContractAllowsRemoteModeling: false });

    expect(gate.requestAuthorization(scope())).toEqual({
      status: "blocked",
      reasonCode: "FORMAL_CONTRACT_REQUIRED",
    });
    expect(gate.diagnostics()).toMatchObject({
      mode: "deterministic-only",
      authorizationStatus: "not-authorized",
    });
  });

  it("discloses the exact scope before explicit authorization and binds its receipt", () => {
    const gate = createGate({ formalContractAllowsRemoteModeling: true });
    const request = gate.requestAuthorization(scope());
    expect(request).toMatchObject({
      status: "confirmation-required",
      provider: "provider-a",
      purpose: "summarize-stable-fitness-background",
      dataCategories: ["communication-preferences", "fitness-background"],
      retentionBoundary: "provider-policy-30-days",
    });
    if (request.status !== "confirmation-required") throw new Error("expected request");
    expect(request.disclosure).toContain("provider-a");
    expect(request.disclosure).toContain("communication-preferences、fitness-background");
    expect(request.disclosure).not.toContain("private user content");

    expect(gate.authorize({ requestId: request.requestId, confirmed: false })).toEqual({
      status: "declined",
    });
    const next = gate.requestAuthorization(scope());
    if (next.status !== "confirmation-required") throw new Error("expected request");
    const authorization = gate.authorize({ requestId: next.requestId, confirmed: true });
    expect(authorization).toMatchObject({
      status: "authorized",
      receipt: {
        provider: "provider-a",
        purpose: "summarize-stable-fitness-background",
        data_categories: ["communication-preferences", "fitness-background"],
        status: "active",
      },
    });
  });

  it.each([
    ["scope expansion", { dataCategories: ["communication-preferences", "fitness-background", "identity"] }],
    ["Provider change", { provider: "provider-b" }],
    ["purpose change", { purpose: "build-hidden-profile" }],
  ])("requires fresh authorization for %s", (_name, change) => {
    const gate = authorizedGate();
    expect(gate.authorizeOutbound({ ...scope(), ...change })).toEqual({
      status: "blocked",
      reasonCode: "AUTHORIZATION_SCOPE_MISMATCH",
    });
  });

  it("allows an authorized category subset and records only the actual input categories", () => {
    const gate = authorizedGate();
    const subset = { ...scope(), dataCategories: ["fitness-background"] };
    const allowed = gate.authorizeOutbound(subset);
    expect(allowed.status).toBe("authorized");
    if (allowed.status !== "authorized") throw new Error("expected authorization");

    const generated = gate.verifyGeneratedProjection({
      authorizationReceiptId: allowed.receipt.authorization_receipt_id,
      scope: subset,
      sourceArtifacts: [{ id: "source-user", bytes: Buffer.from("private user content") }],
      model: "model-a",
      schemaVersion: "identity-summary/v1",
      promptVersion: "fitness-background/v1",
      outputBytes: Buffer.from("generated projection field"),
    });
    expect(generated).toMatchObject({
      status: "verified",
      provenance: { input_categories: ["fitness-background"] },
    });
  });

  it("revocation blocks future outbound modeling without breaking deterministic mode", () => {
    const gate = authorizedGate();
    const allowed = gate.authorizeOutbound(scope());
    if (allowed.status !== "authorized") throw new Error("expected authorization");

    expect(gate.revoke(allowed.receipt.authorization_receipt_id)).toEqual({
      status: "revoked",
    });
    expect(gate.authorizeOutbound(scope())).toEqual({
      status: "blocked",
      reasonCode: "AUTHORIZATION_REVOKED",
    });
    expect(gate.diagnostics()).toMatchObject({
      mode: "remote-modeling-available",
      authorizationStatus: "revoked",
    });
  });

  it("accepts model-generated fields only with matching receipt and complete privacy-safe provenance", () => {
    const gate = authorizedGate();
    const allowed = gate.authorizeOutbound(scope());
    if (allowed.status !== "authorized") throw new Error("expected authorization");
    const generated = gate.verifyGeneratedProjection({
      authorizationReceiptId: allowed.receipt.authorization_receipt_id,
      scope: scope(),
      sourceArtifacts: [{ id: "source-user", bytes: Buffer.from("source bytes") }],
      model: "model-a",
      schemaVersion: "identity-summary/v1",
      promptVersion: "fitness-background/v1",
      outputBytes: Buffer.from("output bytes"),
    });

    expect(generated).toMatchObject({
      status: "verified",
      provenance: {
        provider: "provider-a",
        model: "model-a",
        input_categories: ["communication-preferences", "fitness-background"],
        output_checksum: "sha256:296494844d31f593772396a84181860b2d00b252eeec3fe8117eaa7f84629124",
      },
    });
    expect(JSON.stringify(generated)).not.toMatch(/prompt_text|response|reasoning|private user content/u);

    expect(gate.verifyGeneratedProjection({
      authorizationReceiptId: "receipt-mismatch",
      scope: scope(),
      sourceArtifacts: [{ id: "source-user", bytes: Buffer.from("source bytes") }],
      model: "model-a",
      schemaVersion: "identity-summary/v1",
      promptVersion: "fitness-background/v1",
      outputBytes: Buffer.from("output bytes"),
    })).toEqual({ status: "rejected", reasonCode: "AUTHORIZATION_RECEIPT_MISMATCH" });
  });

  it("reuses unchanged source/model/schema/prompt/authorization scope", () => {
    const gate = authorizedGate();
    const allowed = gate.authorizeOutbound(scope());
    if (allowed.status !== "authorized") throw new Error("expected authorization");
    const input = {
      authorizationReceiptId: allowed.receipt.authorization_receipt_id,
      scope: scope(),
      sourceArtifacts: [{ id: "source-user", bytes: Buffer.from("source bytes") }],
      model: "model-a",
      schemaVersion: "identity-summary/v1",
      promptVersion: "fitness-background/v1",
      outputBytes: Buffer.from("output bytes"),
    } as const;
    const first = gate.verifyGeneratedProjection(input);
    if (first.status !== "verified") throw new Error("expected provenance");

    expect(gate.shouldRegenerate({
      previous: first.provenance,
      authorizationReceiptId: input.authorizationReceiptId,
      scope: input.scope,
      sourceArtifacts: input.sourceArtifacts,
      model: input.model,
      schemaVersion: input.schemaVersion,
      promptVersion: input.promptVersion,
    })).toBe(false);
    expect(gate.shouldRegenerate({
      previous: first.provenance,
      authorizationReceiptId: input.authorizationReceiptId,
      scope: input.scope,
      sourceArtifacts: [{ id: "source-user", bytes: Buffer.from("changed source bytes") }],
      model: input.model,
      schemaVersion: input.schemaVersion,
      promptVersion: input.promptVersion,
    })).toBe(true);
  });

  it("persists no content, prompt, response, snippets, or absolute personal path in receipts and logs", () => {
    const logger = vi.fn();
    const gate = createGate({ formalContractAllowsRemoteModeling: true, logger });
    const request = gate.requestAuthorization(scope());
    if (request.status !== "confirmation-required") throw new Error("expected request");
    gate.authorize({ requestId: request.requestId, confirmed: true });
    const allowed = gate.authorizeOutbound(scope());
    if (allowed.status !== "authorized") throw new Error("expected authorization");
    gate.verifyGeneratedProjection({
      authorizationReceiptId: allowed.receipt.authorization_receipt_id,
      scope: scope(),
      sourceArtifacts: [{ id: "source-user", bytes: Buffer.from("private user content") }],
      model: "model-a",
      schemaVersion: "identity-summary/v1",
      promptVersion: "fitness-background/v1",
      outputBytes: Buffer.from("private generated projection"),
    });

    const persisted = ["authorization.json", "provenance.json"]
      .map((name) => readFileSync(join(gate.runtimeDirectory, "context-modeling", name), "utf8"))
      .join("\n");
    expect(persisted).not.toMatch(/private user content|\/Users\/|prompt(?:_text)?\b|response|reasoning|snippet/u);
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/private user content|\/Users\/|prompt(?:_text)?\b|response|reasoning|snippet/u);
  });

  it("rejects a persisted receipt whose bound scope was altered", () => {
    const gate = authorizedGate();
    const statePath = join(gate.runtimeDirectory, "context-modeling", "authorization.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      receipt: { provider: string };
    };
    state.receipt.provider = "provider-b";
    writeFileSync(statePath, JSON.stringify(state));

    const restarted = createPersonalContextModelingGate({
      runtimeDirectory: gate.runtimeDirectory,
      formalContractAllowsRemoteModeling: true,
    });
    expect(restarted.authorizeOutbound(scope())).toEqual({
      status: "blocked",
      reasonCode: "AUTHORIZATION_REQUIRED",
    });
  });
});

function scope(): PersonalContextModelingScope {
  return {
    provider: "provider-a",
    purpose: "summarize-stable-fitness-background",
    dataCategories: ["communication-preferences", "fitness-background"],
    retentionBoundary: "provider-policy-30-days",
  };
}

function createGate(options: {
  readonly formalContractAllowsRemoteModeling: boolean;
  readonly logger?: (event: Readonly<Record<string, string | number>>) => void;
}) {
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "fitness-modeling-"));
  roots.push(runtimeDirectory);
  return Object.assign(createPersonalContextModelingGate({
    runtimeDirectory,
    formalContractAllowsRemoteModeling: options.formalContractAllowsRemoteModeling,
    now: () => new Date("2026-08-25T00:00:00.000Z"),
    createId: () => "synthetic-id",
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  }), { runtimeDirectory });
}

function authorizedGate() {
  const gate = createGate({ formalContractAllowsRemoteModeling: true });
  const request = gate.requestAuthorization(scope());
  if (request.status !== "confirmation-required") throw new Error("expected request");
  const authorization = gate.authorize({ requestId: request.requestId, confirmed: true });
  if (authorization.status !== "authorized") throw new Error("expected authorization");
  return gate;
}

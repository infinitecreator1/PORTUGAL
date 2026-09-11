import { describe, expect, it } from "vitest";
import { ConflictError } from "@imovel/core";
import { assertTransition, canTransition, isTerminal } from "../src/stateMachine";
import { signWebhook, verifyWebhookSignature } from "../src/webhooks";

describe("state machine", () => {
  it("allows the happy path", () => {
    const path = ["queued", "generating", "generated", "gating", "gated_pass", "narrating", "narrated", "publishing", "published"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    expect(isTerminal("published")).toBe(true);
  });

  it("allows the review and regenerate branches", () => {
    expect(canTransition("gating", "needs_review")).toBe(true);
    expect(canTransition("needs_review", "narrating")).toBe(true);
    expect(canTransition("gating", "gated_fail")).toBe(true);
    expect(canTransition("gated_fail", "generating")).toBe(true);
  });

  it("rejects nonsense transitions", () => {
    expect(canTransition("published", "generating")).toBe(false);
    expect(() => assertTransition({ id: "j", status: "queued" }, "published")).toThrow(ConflictError);
  });
});

describe("webhook signatures", () => {
  it("round-trips and rejects tampering", () => {
    const sig = signWebhook("s3cr3t-s3cr3t-s3cr3t", "1700000000", '{"a":1}');
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(verifyWebhookSignature("s3cr3t-s3cr3t-s3cr3t", "1700000000", '{"a":1}', sig)).toBe(true);
    expect(verifyWebhookSignature("s3cr3t-s3cr3t-s3cr3t", "1700000000", '{"a":2}', sig)).toBe(false);
    expect(verifyWebhookSignature("other-secret-other", "1700000000", '{"a":1}', sig)).toBe(false);
  });
});

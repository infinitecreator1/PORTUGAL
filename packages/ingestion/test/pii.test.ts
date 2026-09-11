import { sampleListingInput } from "@imovel/core/fixtures";
import { describe, expect, it } from "vitest";
import { applyPiiPolicy, redactForLog } from "../src/pii";

describe("applyPiiPolicy", () => {
  it("clears agent contacts and stored_key for third_party listings", () => {
    const input = sampleListingInput({
      ownership: "third_party",
      photos: [{ url: "https://example.org/1.jpg", room: null, order: 0, stored_key: "k/1.jpg" }],
    });
    const out = applyPiiPolicy(input);
    expect(out.agent.phone).toBeNull();
    expect(out.agent.email).toBeNull();
    expect(out.photos[0]?.stored_key).toBeNull();
    expect(out.photos[0]?.url).toBe("https://example.org/1.jpg");
  });

  it("leaves owned and represented listings untouched", () => {
    for (const ownership of ["owned", "represented"] as const) {
      const input = sampleListingInput({ ownership });
      const out = applyPiiPolicy(input);
      expect(out).toEqual(input);
    }
  });
});

describe("redactForLog", () => {
  it("drops phone, email and address", () => {
    const input = sampleListingInput();
    const redacted = redactForLog(input);
    expect(redacted.agent).not.toHaveProperty("phone");
    expect(redacted.agent).not.toHaveProperty("email");
    expect(redacted.location).not.toHaveProperty("address");
    expect(redacted.location.municipality).toBe(input.location.municipality);
  });
});

import type { NormalizeContext } from "@imovel/core";
import { describe, expect, it } from "vitest";
import { finalizeListingInput } from "../../src/normalize/index";

const ctx: NormalizeContext = { tenant_id: "t1", ownership_default: "third_party", agency_ids: ["lisboa-prime"] };

describe("finalizeListingInput", () => {
  it("resolves ownership to 'owned' when the agent's agency_id matches a tenant agency", () => {
    const input = finalizeListingInput(
      {
        source: "csv-feed",
        source_id: "LP-1",
        transaction: "sale",
        property_type: "apartamento",
        district: "Lisboa",
        municipality: "Lisboa",
        agency_id: "lisboa-prime",
        agent_phone: "+351911111111",
        agent_email: "a@b.com",
      },
      ctx,
    );
    expect(input.ownership).toBe("owned");
    // Owned listings keep agent contacts.
    expect(input.agent.phone).toBe("+351911111111");
    expect(input.agent.email).toBe("a@b.com");
  });

  it("matches the tenant agency case-insensitively", () => {
    const input = finalizeListingInput(
      {
        source: "csv-feed",
        source_id: "LP-2",
        transaction: "sale",
        property_type: "apartamento",
        district: "Lisboa",
        municipality: "Lisboa",
        agency_id: "LISBOA-PRIME",
      },
      ctx,
    );
    expect(input.ownership).toBe("owned");
  });

  it("falls back to an explicit ownership field, then to ctx.ownership_default", () => {
    const explicit = finalizeListingInput(
      {
        source: "csv-feed",
        source_id: "X-1",
        transaction: "sale",
        property_type: "apartamento",
        district: "Porto",
        municipality: "Porto",
        ownership: "represented",
      },
      ctx,
    );
    expect(explicit.ownership).toBe("represented");

    const defaulted = finalizeListingInput(
      {
        source: "csv-feed",
        source_id: "X-2",
        transaction: "sale",
        property_type: "apartamento",
        district: "Porto",
        municipality: "Porto",
      },
      ctx,
    );
    expect(defaulted.ownership).toBe("third_party");
  });

  it("applies the PII policy for third_party listings: contacts and stored_key cleared", () => {
    const input = finalizeListingInput(
      {
        source: "casafari",
        source_id: "Y-1",
        transaction: "sale",
        property_type: "apartamento",
        district: "Porto",
        municipality: "Porto",
        agent_phone: "+351900000000",
        agent_email: "agent@example.org",
        photos: [{ url: "https://example.org/a.jpg", stored_key: "tenant/a.jpg" }],
      },
      ctx,
    );
    expect(input.ownership).toBe("third_party");
    expect(input.agent.phone).toBeNull();
    expect(input.agent.email).toBeNull();
    expect(input.photos[0]?.stored_key).toBeNull();
    expect(input.photos[0]?.url).toBe("https://example.org/a.jpg");
  });

  it("keeps agent contacts and stored_key for 'represented' listings", () => {
    const input = finalizeListingInput(
      {
        source: "casafari",
        source_id: "Y-2",
        transaction: "sale",
        property_type: "apartamento",
        district: "Porto",
        municipality: "Porto",
        ownership: "represented",
        agent_phone: "+351900000000",
        photos: [{ url: "https://example.org/a.jpg", stored_key: "tenant/a.jpg" }],
      },
      ctx,
    );
    expect(input.agent.phone).toBe("+351900000000");
    expect(input.photos[0]?.stored_key).toBe("tenant/a.jpg");
  });

  it("throws when transaction or source_id is missing", () => {
    expect(() =>
      finalizeListingInput({ source: "csv-feed", district: "Lisboa", municipality: "Lisboa" }, ctx),
    ).toThrow();
    expect(() =>
      finalizeListingInput(
        { source: "csv-feed", source_id: "Z-1", district: "Lisboa", municipality: "Lisboa" },
        ctx,
      ),
    ).toThrow();
  });
});

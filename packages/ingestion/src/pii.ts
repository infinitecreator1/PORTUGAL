import type { AgentInfo, ListingInput, Location } from "@imovel/core";

/**
 * Third-party listings never keep agent contacts and never get photos downloaded
 * (`stored_key` cleared; URLs stay for analytics). Owned and represented keep everything.
 */
export function applyPiiPolicy(input: ListingInput): ListingInput {
  if (input.ownership !== "third_party") return input;
  return {
    ...input,
    agent: { ...input.agent, phone: null, email: null },
    photos: input.photos.map((p) => ({ ...p, stored_key: null })),
  };
}

export type RedactedListingInput = Omit<ListingInput, "agent" | "location"> & {
  agent: Omit<AgentInfo, "phone" | "email">;
  location: Omit<Location, "address">;
};

/** Copy safe for logs: no phone, email or street address. */
export function redactForLog(input: ListingInput): RedactedListingInput {
  const { phone: _phone, email: _email, ...agent } = input.agent;
  const { address: _address, ...location } = input.location;
  return { ...input, agent, location };
}

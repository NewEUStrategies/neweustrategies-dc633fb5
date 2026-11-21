// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  countryFromHeaders,
  normalizeMetaEmail,
  resolveMetaMatchKeys,
  sha256Hex,
  type MetaMatchDeps,
} from "../metaCapiMatch.server";
import { buildMetaCapiPayload } from "../metaCapiContract";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload-part.signature-part";

function deps(overrides: Partial<MetaMatchDeps> = {}): MetaMatchDeps {
  return {
    verifyUser: async () => ({ id: "user-1", email: " Jan@Example.PL ", emailConfirmed: true }),
    profileTenant: async () => "tenant-1",
    ...overrides,
  };
}

function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({ authorization: `Bearer ${TOKEN}`, "cf-ipcountry": "PL", ...extra });
}

describe("Meta CAPI match keys", () => {
  it("hashes the signed-in account email (normalised) and account ID", async () => {
    const keys = await resolveMetaMatchKeys(headers(), "tenant-1", deps());
    expect(keys.em).toBe(await sha256Hex("jan@example.pl"));
    expect(keys.externalId).toBe(await sha256Hex("user-1"));
    expect(keys.em).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never sends an account email from another tenant", async () => {
    const keys = await resolveMetaMatchKeys(
      headers(),
      "tenant-1",
      deps({ profileTenant: async () => "tenant-2" }),
    );
    expect(keys.em).toBeUndefined();
    expect(keys.externalId).toBeUndefined();
  });

  it("skips an unconfirmed email but keeps the account ID", async () => {
    const keys = await resolveMetaMatchKeys(
      headers(),
      "tenant-1",
      deps({ verifyUser: async () => ({ id: "user-1", email: "a@b.pl", emailConfirmed: false }) }),
    );
    expect(keys.em).toBeUndefined();
    expect(keys.externalId).toBe(await sha256Hex("user-1"));
  });

  it("guests get only the hashed country, no account keys", async () => {
    const keys = await resolveMetaMatchKeys(
      new Headers({ "cf-ipcountry": "PL" }),
      "tenant-1",
      deps(),
    );
    expect(keys).toEqual({ country: await sha256Hex("pl") });
  });

  it("ignores unknown or Tor country codes", () => {
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "T1" }))).toBeNull();
    expect(normalizeMetaEmail("not-an-email")).toBeNull();
  });

  it("puts the hashes into user_data of every event", () => {
    const payload = buildMetaCapiPayload(
      {
        events: [
          {
            event_name: "PageView",
            event_id: "PageView_1",
            event_time: 1_800_000_000,
            event_source_url: "https://neweuropeanstrategies.com/pl",
          },
        ],
      },
      {
        clientIp: null,
        userAgent: "UA",
        nowS: 1_800_000_001,
        match: { em: "h1", externalId: "h2", country: "h3" },
      },
    );
    expect(payload.data[0]?.user_data).toMatchObject({
      em: ["h1"],
      external_id: ["h2"],
      country: ["h3"],
    });
  });
});

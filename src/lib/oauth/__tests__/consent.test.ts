// Czyste reguły strony zgody OAuth: walidacja wejścia, cel powrotu po
// logowaniu i bezpieczeństwo przekierowania do klienta.
import { describe, expect, it } from "vitest";

import { loginSearch, parseLoginSearch } from "@/lib/access/paywallLinks";
import {
  OAUTH_CONSENT_PATH,
  consentReturnPath,
  describeScopes,
  needsConsent,
  parseConsentSearch,
  redirectHost,
  safeClientRedirect,
  safeLogoUri,
} from "@/lib/oauth/consent";

const ID = "3f2a8c1e-4b5d-4e6f-8a7b-9c0d1e2f3a4b";

describe("parseConsentSearch", () => {
  it("przyjmuje UUID żądania", () => {
    expect(parseConsentSearch({ authorization_id: ` ${ID} ` })).toEqual({ authorization_id: ID });
  });

  it.each([undefined, 42, "", "not-a-uuid", `${ID}&x=1`, "../../etc"])(
    "odrzuca %j jako pusty identyfikator",
    (value) => {
      expect(parseConsentSearch({ authorization_id: value })).toEqual({ authorization_id: "" });
    },
  );
});

describe("powrót po logowaniu", () => {
  it("adres strony zgody przechodzi przez sanitizację `/login?next=`", () => {
    const next = consentReturnPath(ID);
    expect(next).toBe(`${OAUTH_CONSENT_PATH}?authorization_id=${ID}`);
    expect(loginSearch({ mode: "signin", next }).next).toBe(next);
    expect(parseLoginSearch({ mode: "signin", next }).next).toBe(next);
  });
});

describe("needsConsent", () => {
  it("rozróżnia szczegóły do decyzji od gotowego przekierowania", () => {
    expect(needsConsent({ redirect_url: "https://client.example.com/cb?code=x" })).toBe(false);
    expect(
      needsConsent({
        authorization_id: ID,
        redirect_uri: "https://client.example.com/cb",
        client: { id: "c", name: "Client", uri: "", logo_uri: "" },
        user: { id: "u", email: "u@example.com" },
        scope: "openid",
      }),
    ).toBe(true);
  });
});

describe("safeClientRedirect", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback?code=abc",
    "http://localhost:33418/callback?code=abc",
    "http://127.0.0.1:8080/cb",
    "http://[::1]:9000/cb",
    "cursor://anysphere.cursor-mcp/oauth/callback?code=abc",
  ])("przepuszcza adres klienta %s", (url) => {
    expect(safeClientRedirect(url)).toBe(new URL(url).href);
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "http://evil.example.com/cb",
    "/relative/path",
    "",
    null,
    undefined,
  ])("odrzuca %j", (url) => {
    expect(safeClientRedirect(url)).toBeNull();
  });
});

describe("safeLogoUri", () => {
  it("wpuszcza tylko https", () => {
    expect(safeLogoUri("https://cdn.example.com/logo.png")).toBe(
      "https://cdn.example.com/logo.png",
    );
    expect(safeLogoUri("http://cdn.example.com/logo.png")).toBeNull();
    expect(safeLogoUri("data:image/svg+xml,<svg/>")).toBeNull();
    expect(safeLogoUri("")).toBeNull();
  });
});

describe("describeScopes", () => {
  it("dzieli zakresy na znane i pozostałe bez duplikatów", () => {
    expect(describeScopes(" openid email  email custom:read ")).toEqual({
      known: ["openid", "email"],
      other: ["custom:read"],
    });
    expect(describeScopes("")).toEqual({ known: [], other: [] });
  });
});

describe("redirectHost", () => {
  it("pokazuje domenę powrotu albo nic dla błędnego adresu", () => {
    expect(redirectHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHost("nie adres")).toBeNull();
  });
});

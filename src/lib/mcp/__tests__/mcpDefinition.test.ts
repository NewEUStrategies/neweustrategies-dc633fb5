// Definicja serwera MCP: wystawca tokenów, polityka OAuth i skład narzędzi.
//
// NAJWAŻNIEJSZE ASERCJE: `auth` istnieje ZAWSZE (SDK bez `auth` obsługuje
// każdego), wystawca pochodzi z referencji projektu z budowy (nie z
// runtime'owego adresu pośrednika), a brak referencji zamyka endpoint
// wystawcą `.invalid` zamiast rzucać przy imporcie.
import { afterEach, describe, expect, it, vi } from "vitest";

import { MCP_UNCONFIGURED_ISSUER, issuerForProjectRef } from "@/lib/mcp/index";

const REF = "abcdefghijklmnopqrst";

async function loadDefinition(ref: string | undefined) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_PROJECT_ID", ref);
  const mod = await import("@/lib/mcp/index");
  return mod.default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("issuerForProjectRef", () => {
  it("buduje bezpośredni adres wystawcy projektu", () => {
    expect(issuerForProjectRef(REF)).toBe(`https://${REF}.supabase.co/auth/v1`);
  });

  it("toleruje białe znaki wokół referencji", () => {
    expect(issuerForProjectRef(`  ${REF} `)).toBe(`https://${REF}.supabase.co/auth/v1`);
  });

  it.each([undefined, "", "short", "ABCDEFGHIJKLMNOPQRST", "abcdefghijklmnopqrs.", `${REF}x`])(
    "zamyka endpoint dla referencji %j",
    (ref) => {
      expect(issuerForProjectRef(ref)).toBe(MCP_UNCONFIGURED_ISSUER);
    },
  );
});

describe("definicja MCP", () => {
  it("ma tożsamość projektu i trzy unikalne narzędzia tylko do odczytu", async () => {
    const mcp = await loadDefinition(REF);
    expect(mcp.name).toBe("new-european-strategies");
    expect(mcp.title).toBe("New European Strategies");
    const names = mcp.tools.map((tool) => tool.name);
    expect(names).toEqual(["list_recent_posts", "search_posts", "get_post"]);
    for (const tool of mcp.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).not.toBe(true);
    }
  });

  it("weryfikuje tokeny wystawcy projektu, publiczności `authenticated` i z claimem klienta", async () => {
    const mcp = await loadDefinition(REF);
    const auth = mcp.auth;
    if (!auth) throw new Error("test: definicja bez `auth` obsługiwałaby każdego");
    expect(auth.issuer).toBe(`https://${REF}.supabase.co/auth/v1`);
    expect(auth.acceptedAudiences).toEqual(["authenticated"]);
    expect(auth.jwksUri).toBe(`https://${REF}.supabase.co/auth/v1/.well-known/jwks.json`);
    expect(auth.requireOAuthClientClaim).toBe(true);
    expect(auth.requiredScopes ?? []).toEqual([]);
  });

  it("bez referencji projektu importuje się bez wyjątku i ZOSTAJE zamknięta", async () => {
    const mcp = await loadDefinition(undefined);
    const auth = mcp.auth;
    if (!auth) throw new Error("test: definicja bez `auth` obsługiwałaby każdego");
    expect(auth.issuer).toBe(MCP_UNCONFIGURED_ISSUER);
    expect(auth.requireOAuthClientClaim).toBe(true);
  });
});

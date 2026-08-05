// Podpisywanie poświadczeń hosta na krawędzi.
//
// Weryfikator siedzi w bazie i jest napisany w SQL, więc jedynym sposobem, żeby
// pilnować zgodności obu stron bez uruchamiania Postgresa, jest policzenie HMAC
// NIEZALEŻNIE (node:crypto) nad tekstem, który baza podpisuje:
// `v1:<kid>:<host>:<exp>`. Rozjazd choćby o bajt = martwy szczebel VERIFIED.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

import {
  parseTenantAssertion,
  tenantAssertionExpiry,
  tenantAssertionMessage,
  toBase64Url,
} from "@/lib/http/tenantAssertion";
import {
  mintTenantHostAssertion,
  resetTenantAssertionCache,
  tenantAssertionConfigured,
  tenantAssertionKey,
} from "@/lib/server/tenantAssertion.server";

const SECRET = "unit-test-assertion-secret-0123456789";

function expectedSignature(kid: string, host: string, exp: number): string {
  return toBase64Url(
    new Uint8Array(
      createHmac("sha256", SECRET)
        .update(tenantAssertionMessage(kid, host, exp))
        .digest(),
    ),
  );
}

describe("mintTenantHostAssertion", () => {
  beforeEach(() => {
    resetTenantAssertionCache();
    delete process.env.TENANT_HOST_ASSERTION_KEY;
    delete process.env.TENANT_HOST_ASSERTION_KID;
  });

  afterEach(() => {
    delete process.env.TENANT_HOST_ASSERTION_KEY;
    delete process.env.TENANT_HOST_ASSERTION_KID;
    resetTenantAssertionCache();
  });

  it("bez klucza nie wystawia niczego - i to jest poprawny stan", () => {
    // Instalacja bez klucza działa jak przed zmianą: żądania idą szczeblem
    // ASSERTED, a baza degraduje w stronę BEZPIECZNĄ (tenant domowy).
    expect(tenantAssertionConfigured()).toBe(false);
    return expect(mintTenantHostAssertion("b.example")).resolves.toBeNull();
  });

  it("odrzuca sekret krótszy niż 32 znaki zamiast podpisywać nim cokolwiek", () => {
    process.env.TENANT_HOST_ASSERTION_KEY = "too-short";
    expect(tenantAssertionKey()).toBeNull();
    return expect(mintTenantHostAssertion("b.example")).resolves.toBeNull();
  });

  it("odrzuca kid spoza wzorca przyjmowanego przez bazę", () => {
    process.env.TENANT_HOST_ASSERTION_KEY = SECRET;
    process.env.TENANT_HOST_ASSERTION_KID = "KID WITH SPACE";
    expect(tenantAssertionKey()).toBeNull();
  });

  it("podpisuje dokładnie ten tekst, który weryfikuje baza", async () => {
    process.env.TENANT_HOST_ASSERTION_KEY = SECRET;
    const token = await mintTenantHostAssertion("b.example");
    expect(token).not.toBeNull();

    const parsed = parseTenantAssertion(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.kid).toBe("edge1");
    expect(parsed!.host).toBe("b.example");
    expect(parsed!.signature).toBe(expectedSignature(parsed!.kid, parsed!.host, parsed!.expiresAt));
  });

  it("honoruje własny kid wdrożenia (rotacja klucza)", async () => {
    process.env.TENANT_HOST_ASSERTION_KEY = SECRET;
    process.env.TENANT_HOST_ASSERTION_KID = "edge2";
    const parsed = parseTenantAssertion(await mintTenantHostAssertion("b.example"));
    expect(parsed!.kid).toBe("edge2");
    expect(parsed!.signature).toBe(expectedSignature("edge2", "b.example", parsed!.expiresAt));
  });

  it("normalizuje host przed podpisaniem (port, wielkość liter)", async () => {
    process.env.TENANT_HOST_ASSERTION_KEY = SECRET;
    const parsed = parseTenantAssertion(await mintTenantHostAssertion("B.Example:8443"));
    expect(parsed!.host).toBe("b.example");
  });

  it("jest deterministyczne w obrębie kroku - jeden token na host na krok", async () => {
    process.env.TENANT_HOST_ASSERTION_KEY = SECRET;
    const first = await mintTenantHostAssertion("b.example");
    const second = await mintTenantHostAssertion("b.example");
    // Ta sama wartość dla dwóch żądań: dokument SSR cache'uje się bez mnożenia
    // wariantów, a `Set-Cookie` leci najwyżej raz na krok.
    expect(second).toBe(first);
    expect(parseTenantAssertion(first)!.expiresAt).toBe(
      tenantAssertionExpiry(Math.floor(Date.now() / 1000)),
    );
  });

  it("różne hosty dostają różne poświadczenia (wiązanie hosta)", async () => {
    process.env.TENANT_HOST_ASSERTION_KEY = SECRET;
    const a = await mintTenantHostAssertion("b.example");
    const b = await mintTenantHostAssertion("nes.example");
    expect(a).not.toBe(b);
    expect(parseTenantAssertion(b)!.host).toBe("nes.example");
  });

  it("bez hosta nie ma czego poświadczać", async () => {
    process.env.TENANT_HOST_ASSERTION_KEY = SECRET;
    await expect(mintTenantHostAssertion(null)).resolves.toBeNull();
    await expect(mintTenantHostAssertion("")).resolves.toBeNull();
  });
});

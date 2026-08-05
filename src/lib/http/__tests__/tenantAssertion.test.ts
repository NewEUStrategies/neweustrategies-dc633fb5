// Kontrakt formatu poświadczenia hosta - bliźniak weryfikatora w bazie
// (`public.verify_tenant_host_assertion()`, migracja 20260805090000).
//
// Te dwa parsery MUSZĄ się zgadzać co do znaku: rozjazd znaczy albo martwy
// szczebel VERIFIED (poświadczenia odrzucane, plan degraduje na deklarację),
// albo - gorzej - przyjęcie kształtu, którego baza nie sprawdza. Dlatego testy
// pilnują REGUŁ ODRZUCANIA, nie tylko szczęśliwej ścieżki.
import { describe, it, expect } from "vitest";

import {
  DEFAULT_TENANT_ASSERTION_KID,
  TENANT_ASSERTION_COOKIE,
  TENANT_ASSERTION_STEP_SECONDS,
  TENANT_ASSERTION_TTL_SECONDS,
  browserTenantAssertion,
  formatTenantAssertion,
  fromBase64Url,
  isTenantAssertionUsable,
  parseTenantAssertion,
  readTenantAssertionCookie,
  tenantAssertionCookieHeader,
  tenantAssertionExpiry,
  tenantAssertionMessage,
  toBase64Url,
} from "@/lib/http/tenantAssertion";

const SIGNATURE = new Uint8Array(32).fill(7);
const EXP = 4_000_000_000;

function assertion(host = "b.example", exp = EXP, kid = "edge1"): string {
  return formatTenantAssertion(kid, host, exp, SIGNATURE);
}

describe("base64url", () => {
  it("koduje bez dopełnienia i w alfabecie URL-safe", () => {
    const encoded = toBase64Url(new TextEncoder().encode("b.example?/+"));
    expect(encoded).not.toMatch(/[=+/]/);
  });

  it("dekoduje własne wyjście (round-trip, także dla IDN)", () => {
    for (const value of ["b.example", "xn--brgermeister-hzb.example", "[::1]", "a".repeat(200)]) {
      const bytes = fromBase64Url(toBase64Url(new TextEncoder().encode(value)));
      expect(bytes).not.toBeNull();
      expect(new TextDecoder().decode(bytes!)).toBe(value);
    }
  });

  it("wejście spoza alfabetu daje null, nie wyjątek", () => {
    expect(fromBase64Url("!!!")).toBeNull();
    expect(fromBase64Url("")).toBeNull();
  });

  it("przyjmuje wariant z dopełnieniem (tolerancja jak w b64url_decode)", () => {
    const padded = `${toBase64Url(new TextEncoder().encode("ab"))}==`;
    expect(fromBase64Url(padded)).not.toBeNull();
  });
});

describe("tenantAssertionExpiry", () => {
  it("kwantyzuje do kroku - ten sam host w kroku daje ten sam token", () => {
    const step = TENANT_ASSERTION_STEP_SECONDS;
    const base = 1_800_000_000;
    const start = Math.ceil(base / step) * step;
    // Dwie chwile w tym samym kroku muszą dać identyczne `exp`, inaczej cache
    // dokumentów mnożyłby warianty odpowiedzi, a `Set-Cookie` leciałby zawsze.
    expect(tenantAssertionExpiry(start - step + 1)).toBe(tenantAssertionExpiry(start - 1));
    expect(tenantAssertionExpiry(start + 1)).toBeGreaterThan(tenantAssertionExpiry(start - 1));
  });

  it("daje ważność nie krótszą niż TTL", () => {
    const now = 1_800_000_123;
    expect(tenantAssertionExpiry(now) - now).toBeGreaterThanOrEqual(TENANT_ASSERTION_TTL_SECONDS);
  });
});

describe("parseTenantAssertion", () => {
  it("rozkłada poprawne poświadczenie i odtwarza podpisywany tekst", () => {
    const parsed = parseTenantAssertion(assertion());
    expect(parsed).not.toBeNull();
    expect(parsed!.kid).toBe("edge1");
    expect(parsed!.host).toBe("b.example");
    expect(parsed!.expiresAt).toBe(EXP);
    expect(parsed!.signedMessage).toBe(tenantAssertionMessage("edge1", "b.example", EXP));
  });

  it("host jest zakodowany, więc kropka w domenie nie rozjeżdża parsera", () => {
    const raw = assertion("deep.sub.domain.example");
    expect(raw.split(".")).toHaveLength(5);
    expect(parseTenantAssertion(raw)!.host).toBe("deep.sub.domain.example");
  });

  it("odrzuca zły kształt: wersję, liczbę pól, kid, exp, alfabet", () => {
    const good = assertion();
    const parts = good.split(".");
    expect(parseTenantAssertion(null)).toBeNull();
    expect(parseTenantAssertion("")).toBeNull();
    expect(parseTenantAssertion(good.replace("v1.", "v2."))).toBeNull();
    expect(parseTenantAssertion(parts.slice(0, 4).join("."))).toBeNull();
    expect(parseTenantAssertion(`${good}.extra`)).toBeNull();
    expect(
      parseTenantAssertion(`v1.KID WITH SPACE.${parts[2]}.${parts[3]}.${parts[4]}`),
    ).toBeNull();
    expect(parseTenantAssertion(`v1.edge1.${parts[2]}.notanumber.${parts[4]}`)).toBeNull();
    expect(parseTenantAssertion(`v1.edge1.!!!.${parts[3]}.${parts[4]}`)).toBeNull();
    expect(parseTenantAssertion(`v1.edge1.${parts[2]}.${parts[3]}.!!!`)).toBeNull();
  });

  it("odrzuca wejście dłuższe niż limit nagłówka", () => {
    expect(parseTenantAssertion(assertion("a".repeat(600)))).toBeNull();
  });

  it("normalizuje kid i host do małych liter (jak baza)", () => {
    const parsed = parseTenantAssertion(
      formatTenantAssertion("EDGE1", "B.Example", EXP, SIGNATURE),
    );
    expect(parsed!.kid).toBe("edge1");
    expect(parsed!.host).toBe("b.example");
  });
});

describe("isTenantAssertionUsable", () => {
  const now = 1_800_000_000;

  it("wymaga zgodności hosta - poświadczenie innej domeny jest bezużyteczne", () => {
    const parsed = parseTenantAssertion(assertion("b.example"));
    expect(isTenantAssertionUsable(parsed, "b.example", now)).toBe(true);
    expect(isTenantAssertionUsable(parsed, "nes.example", now)).toBe(false);
  });

  it("odrzuca poświadczenie, które wygaśnie w trakcie lotu żądania", () => {
    const parsed = parseTenantAssertion(assertion("b.example", now + 10));
    expect(isTenantAssertionUsable(parsed, "b.example", now)).toBe(false);
    expect(isTenantAssertionUsable(parsed, "b.example", now, 0)).toBe(true);
  });

  it("null / brak hosta to zawsze false", () => {
    expect(isTenantAssertionUsable(null, "b.example", now)).toBe(false);
    expect(isTenantAssertionUsable(parseTenantAssertion(assertion()), null, now)).toBe(false);
  });
});

describe("transport cookie", () => {
  it("czyta wartość spośród innych cookies", () => {
    const value = assertion();
    const header = `nes_gpc=1; ${TENANT_ASSERTION_COOKIE}=${encodeURIComponent(value)}; lang=pl`;
    expect(readTenantAssertionCookie(header)).toBe(value);
  });

  it("brak cookie / puste cookie -> null", () => {
    expect(readTenantAssertionCookie(null)).toBeNull();
    expect(readTenantAssertionCookie("lang=pl")).toBeNull();
    expect(readTenantAssertionCookie(`${TENANT_ASSERTION_COOKIE}=`)).toBeNull();
  });

  it("nie łapie cookie o nazwie będącej sufiksem", () => {
    expect(readTenantAssertionCookie(`x_${TENANT_ASSERTION_COOKIE}=abc`)).toBeNull();
  });

  it("Set-Cookie jest Lax, ścieżkowy i Secure tylko po https", () => {
    const secure = tenantAssertionCookieHeader(assertion(), true);
    expect(secure).toContain("SameSite=Lax");
    expect(secure).toContain("Path=/");
    expect(secure).toContain(`Max-Age=${TENANT_ASSERTION_STEP_SECONDS}`);
    expect(secure).toContain("Secure");
    // Dev po http nie może dostać Secure - inaczej cookie nie doleci wcale.
    expect(tenantAssertionCookieHeader(assertion(), false)).not.toContain("Secure");
  });

  it("cookie NIE jest HttpOnly - klient anon musi je przepisać do nagłówka", () => {
    // Świadoma decyzja, nie przeoczenie: poświadczenie nie jest poświadczeniem
    // tożsamości, a jego konsumentem jest fetch przeglądarki do PostgREST
    // (inny origin, więc samo cookie tam nie dojedzie).
    expect(tenantAssertionCookieHeader(assertion(), true)).not.toContain("HttpOnly");
  });

  it("poza przeglądarką browserTenantAssertion() zwraca null", () => {
    expect(browserTenantAssertion()).toBeNull();
  });
});

describe("domyślny kid", () => {
  it("jest zgodny z wzorcem, który przyjmuje baza", () => {
    expect(DEFAULT_TENANT_ASSERTION_KID).toMatch(/^[a-z0-9][a-z0-9_-]{1,31}$/);
  });
});

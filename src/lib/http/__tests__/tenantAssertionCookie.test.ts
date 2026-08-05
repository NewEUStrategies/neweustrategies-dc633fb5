// Transport poświadczenia hosta do przeglądarki - czysta część decyzji.
//
// Middleware sam wymaga kontekstu żądania TanStack Start, ale JEGO DECYZJA jest
// czystą funkcją i to ona odpowiada za dwie rzeczy, które łatwo zepsuć bez
// zauważenia: (1) `Set-Cookie` nie może lecieć przy każdym dokumencie, bo
// poświadczenie jest stałe w obrębie kroku, (2) `Secure` musi zależeć od
// FAKTYCZNEGO protokołu (za proxy - z `X-Forwarded-Proto`), inaczej w dev po
// http cookie nie doleci wcale i szczebel VERIFIED umiera po cichu.
import { describe, it, expect } from "vitest";

import {
  planTenantAssertionCookie,
  type TenantAssertionRequest,
} from "@/lib/http/tenantAssertionCookie";
import { TENANT_ASSERTION_COOKIE, formatTenantAssertion } from "@/lib/http/tenantAssertion";

const ASSERTION = formatTenantAssertion("edge1", "b.example", 4_000_000_000, new Uint8Array(32));

/** Request bez konstruktora przeglądarki - `Cookie` jest nagłówkiem zakazanym. */
function request(
  headers: Record<string, string>,
  url = "https://b.example/post",
): TenantAssertionRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url,
    method: "GET",
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
  };
}

describe("planTenantAssertionCookie", () => {
  it("wystawia cookie, gdy przeglądarka jeszcze go nie ma", () => {
    const cookie = planTenantAssertionCookie(request({}), ASSERTION);
    expect(cookie).toContain(`${TENANT_ASSERTION_COOKIE}=`);
    expect(cookie).toContain("Secure");
  });

  it("NIE wystawia cookie, gdy przeglądarka ma już tę samą wartość", () => {
    // Poświadczenie jest deterministyczne w obrębie kroku, więc bez tego
    // warunku każdy dokument nosiłby zbędne Set-Cookie.
    const carried = request({
      cookie: `${TENANT_ASSERTION_COOKIE}=${encodeURIComponent(ASSERTION)}`,
    });
    expect(planTenantAssertionCookie(carried, ASSERTION)).toBeNull();
  });

  it("odświeża cookie, gdy niesiona wartość jest inna (rotacja kroku/klucza)", () => {
    const stale = formatTenantAssertion("edge1", "b.example", 3_000_000_000, new Uint8Array(32));
    const carried = request({ cookie: `${TENANT_ASSERTION_COOKIE}=${encodeURIComponent(stale)}` });
    expect(planTenantAssertionCookie(carried, ASSERTION)).toContain(encodeURIComponent(ASSERTION));
  });

  it("bez poświadczenia nie ma czego wysyłać", () => {
    expect(planTenantAssertionCookie(request({}), null)).toBeNull();
  });

  it("Secure idzie za FAKTYCZNYM protokołem, także za proxy", () => {
    // Origin https, ale proxy mówi http (dev za terminatorem TLS): bez tego
    // rozróżnienia cookie z Secure nigdy nie dotarłoby do klienta.
    expect(
      planTenantAssertionCookie(request({ "x-forwarded-proto": "http" }), ASSERTION),
    ).not.toContain("Secure");
    // Łańcuch proxy dopisuje wartości po przecinku - liczy się pierwsza.
    expect(
      planTenantAssertionCookie(request({ "x-forwarded-proto": "https, http" }), ASSERTION),
    ).toContain("Secure");
    // Bez nagłówka decyduje protokół URL-a.
    expect(
      planTenantAssertionCookie(request({}, "http://localhost:3000/"), ASSERTION),
    ).not.toContain("Secure");
  });

  it("uszkodzony URL nie wywraca decyzji (degradacja do bez-Secure)", () => {
    expect(planTenantAssertionCookie(request({}, "nonsense"), ASSERTION)).not.toContain("Secure");
  });

  it("cookie nosza tylko dokumenty - POST serverFn nie", () => {
    const post: TenantAssertionRequest = { ...request({}), method: "POST" };
    expect(planTenantAssertionCookie(post, ASSERTION)).toBeNull();
  });
});

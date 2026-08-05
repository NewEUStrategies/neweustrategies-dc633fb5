// Transport poświadczenia hosta do przeglądarki - CZYSTA część decyzji.
//
// Rozdział jak w `lib/consent/gpc.ts` / `gpc.server.ts`: tutaj żyje logika, w
// module `*.server.ts` - middleware, które ją stosuje. Dzięki temu decyzja
// (jedyne miejsce, gdzie łatwo o cichy błąd) jest testowalna bez kontekstu
// żądania frameworka.
//
// Po co całe to cookie: baza rozstrzyga tenanta ze szczeblem zaufania hosta
// (migracja 20260805090000). Krawędź podpisuje własne żądania bez trudu, ale
// plan anon przeglądarki woła PostgREST BEZPOŚREDNIO, z innego originu - i nie
// ma skąd wziąć podpisu. Dokument HTML wychodzi więc z cookie
// `nes_tenant_assert`, a `fetchWithTenantHost` przepisuje je do nagłówka
// `x-tenant-assert`. Cookie jest per-host Z DEFINICJI, więc karta nigdy nie
// dostanie poświadczenia domeny, której nie odwiedziła - transport sam z siebie
// utrzymuje wiązanie hosta.
import { readTenantAssertionCookie, tenantAssertionCookieHeader } from "@/lib/http/tenantAssertion";

/**
 * Minimalny wycinek Requestu, od którego zależy decyzja - to samo zawężenie co
 * w `GpcTransportRequest`: dokumentuje pełną powierzchnię decyzji i pozwala
 * testować bez konstruktora `Request` przeglądarki (który wycina `Cookie`).
 */
export type TenantAssertionRequest = Pick<Request, "url" | "method"> & {
  headers: Pick<Headers, "get">;
};

/** Czy połączenie jest https (świadomie proxy-aware, jak reszta start.ts). */
function isSecureRequest(request: TenantAssertionRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Tylko dokumenty niosą cookie - POST-y serverFn i API nie mają po co. */
export function carriesTenantAssertionCookie(request: TenantAssertionRequest): boolean {
  return request.method === "GET" || request.method === "HEAD";
}

/**
 * Czysta decyzja: wartość `Set-Cookie` albo null, gdy nie ma czego wysyłać.
 *
 * Cookie leci TYLKO gdy się zmieniło. Poświadczenie jest deterministyczne w
 * obrębie kroku kwantyzacji (godzina), więc czytelnik dostaje `Set-Cookie`
 * najwyżej raz na godzinę zamiast przy każdym dokumencie.
 */
export function planTenantAssertionCookie(
  request: TenantAssertionRequest,
  assertion: string | null,
): string | null {
  if (!assertion) return null;
  if (!carriesTenantAssertionCookie(request)) return null;
  if (readTenantAssertionCookie(request.headers.get("cookie")) === assertion) return null;
  return tenantAssertionCookieHeader(assertion, isSecureRequest(request));
}

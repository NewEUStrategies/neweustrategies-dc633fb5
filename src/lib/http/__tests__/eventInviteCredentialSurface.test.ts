// ZAPROSZENIE Z PAKIETU (`/events/invite/<token>`) NIE WCHODZI DO WSPÓLNEGO
// CACHE'U DOKUMENTÓW.
//
// CO BYŁO ŹLE. Adres zaproszenia niesie klucz do opłaconego miejsca W ŚCIEŻCE
// (`packageInviteUrl`), a trasa jest `ssr: false`: nie ma loadera, który
// zadeklarowałby `no-store`. Na deny-liście dokumentów stały dwie z trzech
// powierzchni tej klasy (`/tickets`, `/certificates`, pozycja S26) - trzeciej
// zabrakło, więc dokument zaproszenia dostawał domyślne `public, s-maxage=900`
// i był zapisywany w magazynie pod kluczem zawierającym token.
//
// CZEGO TEN PLIK PILNUJE. Trzech konsumentów JEDNEJ listy naraz - bo dopisanie
// prefiksu działa tylko wtedy, gdy każdy z nich go czyta:
//   1. plan magazynu (`planDocumentCache`) - BYPASS, żaden klucz z tokenem;
//   2. polityka domyślna (`planDefaultCacheControl`) - jawne `private, no-store`;
//   3. Speculation Rules - przeglądarka nie pobiera adresu z wyprzedzeniem.
// I jednej rzeczy, której zmiana NIE MA PRAWA ruszyć: katalog i strony
// wydarzeń zostają cache'owalne (prefiks ma dwa segmenty, nie jeden).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { redactCredentialPath } from "@/lib/analytics/redactTrackedUrl";
import { packageInviteUrl } from "@/lib/events/packagesApi";
import { cacheControlHeader } from "@/lib/http/cachePolicy";
import { planDefaultCacheControl } from "@/lib/http/defaultCacheControl";
import { planDocumentCache, type DocumentCacheRequest } from "@/lib/http/documentCache";
import { speculationRulesJson } from "@/lib/seo/speculationRules";

const ORIGIN = "https://tenant-a.eu";
const HOST = "tenant-a.eu";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const NO_STORE = cacheControlHeader({ cacheable: false });

/** Ścieżka DOKŁADNIE taka, jaką składa produkcja - nie przepisana z ręki. */
const INVITE_PATH = new URL(packageInviteUrl(ORIGIN, TOKEN)).pathname;

function req(path: string): DocumentCacheRequest {
  return { url: `${ORIGIN}${path}`, method: "GET", headers: new Headers() };
}

const HTML_OK = {
  status: 200,
  headers: { get: (name: string) => (name === "content-type" ? "text/html" : null) },
};

describe("zaproszenie z pakietu jako powierzchnia z poświadczeniem w ścieżce", () => {
  it("fikstura jest adresem produkcyjnym i niesie token w ścieżce", () => {
    expect(INVITE_PATH).toBe(`/events/invite/${TOKEN}`);
  });

  it.each([INVITE_PATH, `/en${INVITE_PATH}`])("magazyn dokumentów omija %s", (path) => {
    const plan = planDocumentCache(req(path), HOST);
    expect(plan).toEqual({ kind: "bypass", reason: "path" });
    // Sedno: w planie nie ma klucza, więc token nie może stać się kluczem.
    expect(JSON.stringify(plan)).not.toContain(TOKEN);
  });

  it.each([INVITE_PATH, `/en${INVITE_PATH}`])(
    "odpowiedź dla %s dostaje jawne `private, no-store`",
    (path) => {
      expect(planDefaultCacheControl(req(path), HTML_OK)).toBe(NO_STORE);
    },
  );

  it("dyrektywa `public` z trasy nie obchodzi tej bariery", () => {
    expect(
      planDefaultCacheControl(req(INVITE_PATH), HTML_OK, "public, max-age=60, s-maxage=900"),
    ).toBe(NO_STORE);
  });

  it("Speculation Rules wykluczają adres zaproszenia w obu językach", () => {
    expect(speculationRulesJson()).toContain("/{en/}?events/invite{/*}?");
  });

  it("KATALOG I STRONY WYDARZEŃ ZOSTAJĄ W CACHE - prefiks ma dwa segmenty", () => {
    for (const path of [
      "/events",
      "/events/kongres",
      "/events/kongres/agenda",
      "/en/events/kongres",
      // Sąsiad po nazwie: dopasowanie idzie po CAŁYCH segmentach.
      "/events/invite-only-briefing",
    ]) {
      expect(planDocumentCache(req(path), HOST).kind, path).toBe("lookup");
      expect(planDefaultCacheControl(req(path), HTML_OK), path).toContain("s-maxage=900");
    }
  });

  it("deny-lista i maska analityki obejmują ten sam adres zaproszenia", () => {
    // Analityka maskowała ten segment, zanim trafił na deny-listę - rozjazd
    // tych dwóch miejsc był dokładnie naprawianym defektem.
    expect(redactCredentialPath(INVITE_PATH)).toBe("/events/invite/[redacted]");
    expect(planDocumentCache(req(INVITE_PATH), HOST).kind).toBe("bypass");
  });
});

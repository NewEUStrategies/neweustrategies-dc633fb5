// PUBLICZNY ORIGIN TENANTA - reguła, z której kokpit SEO bierze adres sond,
// linków „na żywo" i hosta w podglądach kart.
//
// PRZEDMIOT DOWODU. Kokpit ma publikować TEN SAM origin, co powierzchnie
// maszynowe (`crawlerPublishOrigin`), a nie własną wariację: gdyby karta
// fundamentów sondowała inny origin niż ten, na którym robots.txt ogłasza
// mapę strony, „wszystko zielone" w panelu nie mówiłoby nic o tym, co widzi
// Search Console. Każdy przypadek niżej ma więc parę: wynik reguły kokpitu
// i wynik reguły maszynowej dla tego samego hosta.
import { describe, expect, it } from "vitest";
import { CANONICAL_SITE_ORIGIN, crawlerPublishOrigin } from "@/lib/http/host";
import {
  claimedDomainHost,
  panelHostServesOrigin,
  tenantPublicOrigin,
} from "@/lib/seo/tenantPublicOrigin";

describe("tenantPublicOrigin - domena zajęta w bazie", () => {
  it("tenant z własną domeną dostaje SWÓJ origin, nie origin marki", () => {
    expect(tenantPublicOrigin({ domain: "analizy.example.org", host: "localhost:8080" })).toBe(
      "https://analizy.example.org",
    );
  });

  it("domena z bazy wygrywa z hostem karty - panel bywa otwarty na podglądzie", () => {
    // Host podglądu mówi tylko, że to podgląd - nie którego serwisu.
    expect(
      tenantPublicOrigin({ domain: "analizy.example.org", host: "id-preview--abc.pages.dev" }),
    ).toBe("https://analizy.example.org");
  });

  it("domena marki w bazie (tenant domyślny) daje origin kanoniczny", () => {
    expect(tenantPublicOrigin({ domain: "neweuropeanstrategies.com", host: null })).toBe(
      CANONICAL_SITE_ORIGIN,
    );
    expect(tenantPublicOrigin({ domain: "www.neweuropeanstrategies.com", host: null })).toBe(
      CANONICAL_SITE_ORIGIN,
    );
  });

  it("wpis z protokołem, ścieżką, portem i wielkimi literami daje sam origin", () => {
    // `normalizeHost("https://x")` zwróciłby „https" - wpis wklejony z paska
    // adresu nie może zamienić originu w `https://https`.
    expect(tenantPublicOrigin({ domain: "  HTTPS://Analizy.Example.org:443/blog/ " })).toBe(
      "https://analizy.example.org",
    );
  });

  it("domena wskazująca alias hostingu NIE otwiera originu aliasu", () => {
    // Ta sama kolejność reguł, co na powierzchniach maszynowych: alias
    // hostingu zbiega się na marce nawet wpisany do katalogu domen.
    expect(tenantPublicOrigin({ domain: "serwis.pages.dev" })).toBe(
      crawlerPublishOrigin("serwis.pages.dev"),
    );
    expect(tenantPublicOrigin({ domain: "serwis.pages.dev" })).toBe(CANONICAL_SITE_ORIGIN);
  });
});

describe("tenantPublicOrigin - brak domeny w bazie (spadek na host karty)", () => {
  it.each([
    ["localhost:3000"],
    ["127.0.0.1:5173"],
    ["id-preview--abc.lovable.app"],
    ["serwis.pages.dev"],
    ["neweuropeanstrategies.com"],
    ["www.neweuropeanstrategies.com"],
  ])("host %s zbiega się na originie kanonicznym - jak na powierzchniach maszynowych", (host) => {
    expect(tenantPublicOrigin({ domain: null, host })).toBe(CANONICAL_SITE_ORIGIN);
    expect(tenantPublicOrigin({ domain: null, host })).toBe(crawlerPublishOrigin(host));
  });

  it("własna domena w hoście karty zostaje originem (bez portu)", () => {
    expect(tenantPublicOrigin({ domain: null, host: "analizy.example.org:443" })).toBe(
      "https://analizy.example.org",
    );
  });

  it("pusta albo biała domena traktowana jak brak, nie jak host „”", () => {
    expect(tenantPublicOrigin({ domain: "   ", host: "analizy.example.org" })).toBe(
      "https://analizy.example.org",
    );
    expect(tenantPublicOrigin({ domain: "", host: "analizy.example.org" })).toBe(
      "https://analizy.example.org",
    );
  });

  it("SSR (brak hosta i brak domeny) daje origin kanoniczny, a nie pustkę", () => {
    expect(tenantPublicOrigin({})).toBe(CANONICAL_SITE_ORIGIN);
    expect(tenantPublicOrigin({ domain: undefined, host: null })).toBe(CANONICAL_SITE_ORIGIN);
  });
});

describe("tenantPublicOrigin - tenant, który NIE jest domyślny", () => {
  // Powierzchnie maszynowe rozstrzygają tenanta po hoście żądania: host marki
  // i host podglądu należą do tenanta DOMYŚLNEGO. Inny tenant bez zajętej
  // domeny nie ma więc adresu publicznego - spadek na host karty dawał mu
  // origin marki (zielony stan plików marki, walidatory na stronie marki).
  it.each([["localhost:3000"], ["id-preview--abc.lovable.app"], ["neweuropeanstrategies.com"]])(
    "bez domeny na hoście %s: brak originu (null), nie origin marki",
    (host) => {
      expect(tenantPublicOrigin({ domain: null, isDefault: false, host })).toBeNull();
    },
  );

  it("bez domeny NAWET na własnym hoście karty: host niezajęty w katalogu jest fail-closed", () => {
    expect(
      tenantPublicOrigin({ domain: null, isDefault: false, host: "analizy.example.org" }),
    ).toBeNull();
  });

  it("z własną domeną dostaje SWÓJ origin, niezależnie od hosta karty", () => {
    expect(
      tenantPublicOrigin({ domain: "analizy.example.org", isDefault: false, host: "localhost" }),
    ).toBe("https://analizy.example.org");
  });

  it("domena zbiegająca się na marce (alias hostingu) to też brak originu", () => {
    expect(tenantPublicOrigin({ domain: "serwis.pages.dev", isDefault: false })).toBeNull();
  });

  it("tenant domyślny bez domeny zostaje na originie kanonicznym (marka)", () => {
    expect(tenantPublicOrigin({ domain: null, isDefault: true, host: "localhost:3000" })).toBe(
      CANONICAL_SITE_ORIGIN,
    );
  });

  it("nieznane `is_default` (odczyt w locie/padł) zostaje przy spadku na host karty", () => {
    expect(tenantPublicOrigin({ domain: null, isDefault: null, host: "localhost:3000" })).toBe(
      CANONICAL_SITE_ORIGIN,
    );
  });
});

describe("panelHostServesOrigin - czy same-origin to pliki TEGO serwisu", () => {
  it("marka na hoście podglądu/localhost: tak (oba zbiegają się na originie kanonicznym)", () => {
    expect(panelHostServesOrigin("localhost:3000", CANONICAL_SITE_ORIGIN)).toBe(true);
    expect(panelHostServesOrigin("id-preview--abc.lovable.app", CANONICAL_SITE_ORIGIN)).toBe(true);
  });

  it("tenant na WŁASNEJ domenie: tak", () => {
    expect(panelHostServesOrigin("analizy.example.org", "https://analizy.example.org")).toBe(true);
  });

  it("tenant oglądany z hosta marki albo podglądu: NIE - tam leżą pliki marki", () => {
    expect(panelHostServesOrigin("localhost:3000", "https://analizy.example.org")).toBe(false);
    expect(panelHostServesOrigin("neweuropeanstrategies.com", "https://analizy.example.org")).toBe(
      false,
    );
  });

  it("brak hosta (SSR) albo brak originu: nie wiadomo, więc nie", () => {
    expect(panelHostServesOrigin(null, CANONICAL_SITE_ORIGIN)).toBe(false);
    expect(panelHostServesOrigin("localhost:3000", null)).toBe(false);
  });
});

describe("claimedDomainHost", () => {
  it("zdejmuje protokół, ścieżkę i port", () => {
    expect(claimedDomainHost("https://Example.org:8443/x/y")).toBe("example.org");
    expect(claimedDomainHost("example.org")).toBe("example.org");
  });

  it("pusty wpis to brak domeny", () => {
    expect(claimedDomainHost(null)).toBeNull();
    expect(claimedDomainHost(undefined)).toBeNull();
    expect(claimedDomainHost("  ")).toBeNull();
    expect(claimedDomainHost("https://")).toBeNull();
  });
});

// Mapa świata: odsyłacz końca łuku podpiętego pod publiczny profil eksperta.
//
// Co udowadniamy i dlaczego:
//   * Hub eksperta budują te same pomocniki co reszta aplikacji: `profileHref`
//     (ścieżka `/author/<slug>` z zakodowanym slugiem) i `localizedPath`
//     (prefiks języka strony). Wcześniej `pointHref` sklejał
//     `/author/${slug}`: punkt na mapie strony EN prowadził do profilu PL,
//     a slug ze znakami specjalnymi („/", „?", „#", spacja) rozcinał ścieżkę
//     albo doklejał zapytanie i kotwicę.
//   * Link własny łuku wpisał redaktor - zostaje dokładnie taki, jak go podał,
//     w każdym języku (bez prefiksu i bez kodowania).
//
// Warstwa jest czysta (bez Reacta i zapytań), więc testujemy jej wynik wprost.
import { describe, expect, it } from "vitest";
import type { WidgetContent } from "../types";
import { worldMapArcs, type WorldMapProfile } from "../worldMapContent";

type Lang = "pl" | "en";

/** Slug ze znakami, które rozcinają ścieżkę albo doklejają zapytanie i kotwicę. */
const ODD_SLUG = "anna/nowak ?x#1";
const ODD_PATH = "/author/anna%2Fnowak%20%3Fx%231";

const CASES: ReadonlyArray<[label: string, lang: Lang, slug: string, href: string]> = [
  ["PL bez prefiksu", "pl", "anna-nowak", "/author/anna-nowak"],
  ["EN z prefiksem /en", "en", "anna-nowak", "/en/author/anna-nowak"],
  ["PL, slug ze znakami specjalnymi zakodowany", "pl", ODD_SLUG, ODD_PATH],
  ["EN, slug ze znakami specjalnymi zakodowany", "en", ODD_SLUG, `/en${ODD_PATH}`],
];

/** Łuk Bruksela -> Warszawa; profil podpinamy pod wskazany koniec. */
function content(over: Record<string, unknown>): WidgetContent {
  return {
    source: "experts",
    connections: [
      {
        id: "c1",
        startLabel_pl: "Bruksela",
        startLabel_en: "Brussels",
        startLat: 50.85,
        startLng: 4.35,
        startUserId: "",
        endLabel_pl: "Warszawa",
        endLabel_en: "Warsaw",
        endLat: 52.23,
        endLng: 21.01,
        endUserId: "",
        href: "",
        ...over,
      },
    ],
  } as unknown as WidgetContent;
}

function profile(userId: string, slug: string): WorldMapProfile {
  return { userId, displayName: "Anna Nowak", slug, avatarUrl: "", role: "" };
}

describe("worldMapArcs: koniec łuku z profilem prowadzi do huba eksperta", () => {
  it.each(CASES)("koniec - %s", (_label, lang, slug, href) => {
    const [arc] = worldMapArcs(content({ endUserId: "u-1" }), lang, [profile("u-1", slug)]);
    expect(arc.end.href).toBe(href);
  });

  it.each(CASES)("początek - %s", (_label, lang, slug, href) => {
    const [arc] = worldMapArcs(content({ startUserId: "u-1" }), lang, [profile("u-1", slug)]);
    expect(arc.start.href).toBe(href);
  });
});

describe("worldMapArcs: link własny łuku wpisany przez redaktora", () => {
  it.each(["pl", "en"] as const)("zostaje nietknięty na końcu bez profilu (%s)", (lang) => {
    const own = "/kontakt?temat=mapa ekspertów#formularz";
    const [arc] = worldMapArcs(content({ endUserId: "u-1", href: own }), lang, [
      profile("u-1", "anna-nowak"),
    ]);
    // Koniec z profilem idzie do huba, koniec bez profilu - do linku własnego.
    expect(arc.start.href).toBe(own);
    expect(arc.end.href).toBe(lang === "en" ? "/en/author/anna-nowak" : "/author/anna-nowak");
  });

  it("profil bez sluga zostawia link własny także w EN", () => {
    const [arc] = worldMapArcs(content({ endUserId: "u-1", href: "/eksperci" }), "en", [
      profile("u-1", ""),
    ]);
    expect(arc.end.href).toBe("/eksperci");
  });
});

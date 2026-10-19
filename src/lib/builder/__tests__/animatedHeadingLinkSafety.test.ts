// LINKI ANIMOWANEGO NAGŁÓWKA: BEZPIECZEŃSTWO ADRESU I ODTWORZENIE STANU PANELU.
//
// Co ten plik udowadnia:
//
// 1. `toAnimatedHeadingLink` odrzuca adres `javascript:` także w postaci
//    zaciemnionej tak, jak robi to przeglądarka: parser URL wycina z adresu
//    tabulatory i znaki nowej linii, a z początku - znaki sterujące i spacje.
//    "java\tscript:alert(1)" wykonuje się więc jak "javascript:alert(1)", a do
//    2026-10-18 przechodził przez filtr (`/^\s*javascript:/i`) jako „bezpieczny".
//    React 19 i tak blokuje taki `href` przy renderze - ten kontrakt jest
//    drugą linią obrony i obietnicą samej funkcji („tylko bezpieczny URL").
// 2. `toWidgetLink` odtwarza stan `LinkPicker`: rodzaj odnośnika spoza
//    katalogu to "external", pola o złym typie nie przechodzą jako śmieci
//    (liczba w `refId`, napis "true" w `nofollow`), a link bez adresu nie
//    istnieje.
// 3. `rel` nie dubluje wartości, gdy redaktor wpisał "nofollow" ręcznie
//    i jednocześnie zaznaczył przełącznik.
//
// Bez atrap - obie funkcje są czyste.
import { describe, expect, it } from "vitest";
import { toAnimatedHeadingLink, toWidgetLink } from "../animatedHeadingLinks";

describe("toAnimatedHeadingLink - adresy wykonywalne", () => {
  it.each([
    ["tabulator w nazwie schematu", "java\tscript:alert(1)"],
    ["nowa linia w nazwie schematu", "java\nscript:alert(1)"],
    ["CR LF w nazwie schematu", "jav\r\nascript:alert(1)"],
    ["znak sterujący na początku", "\u0001javascript:alert(1)"],
    ["wersaliki i spacje na początku", "  JAVASCRIPT:alert(1)"],
  ])("odrzuca %s", (_, url) => {
    expect(toAnimatedHeadingLink({ url })).toBeUndefined();
  });

  it.each([
    "/raporty/2026",
    "https://example.com/javascript-kurs",
    "#sekcja",
    "mailto:redakcja@example.com",
  ])("przepuszcza zwykły adres %s bez zmian", (url) => {
    expect(toAnimatedHeadingLink({ url })?.href).toBe(url);
  });

  it("zwraca adres przycięty z białych znaków, nie postać użytą do sprawdzenia", () => {
    expect(toAnimatedHeadingLink({ url: "  /raporty  " })?.href).toBe("/raporty");
  });

  it("nie dubluje nofollow wpisanego ręcznie i zaznaczonego przełącznikiem", () => {
    expect(toAnimatedHeadingLink({ url: "/a", rel: "nofollow  ugc", nofollow: true })?.rel).toBe(
      "nofollow ugc",
    );
  });

  it("pusta etykieta dostępności i nieznany cel nie trafiają do linku", () => {
    expect(toAnimatedHeadingLink({ url: "/a", ariaLabel: "", target: "_top" })).toEqual({
      href: "/a",
      target: "_self",
      rel: undefined,
      ariaLabel: undefined,
    });
  });
});

describe("toWidgetLink - odtworzenie stanu panelu", () => {
  it.each(["post", "page", "media", "category", "tag"] as const)(
    "zachowuje rodzaj odnośnika %s z katalogu LinkPicker",
    (kind) => {
      expect(toWidgetLink({ url: "/x", kind })?.kind).toBe(kind);
    },
  );

  it.each([undefined, "plik", 7])("rodzaj spoza katalogu (%s) czyta jako zewnętrzny", (kind) => {
    expect(toWidgetLink({ url: "https://example.com", kind })?.kind).toBe("external");
  });

  it("odrzuca pola o złym typie zamiast przenosić je do panelu", () => {
    expect(
      toWidgetLink({
        url: "/wpis",
        kind: "post",
        refId: 42,
        refLabel: { pl: "x" },
        target: "blank",
        rel: ["nofollow"],
        nofollow: "true",
        ariaLabel: 0,
      }),
    ).toEqual({
      url: "/wpis",
      kind: "post",
      refId: undefined,
      refLabel: undefined,
      target: "_self",
      rel: undefined,
      nofollow: false,
      ariaLabel: undefined,
    });
  });

  it("zachowuje pełny zapis linku wpisu z nową kartą", () => {
    expect(
      toWidgetLink({
        url: "/wpis",
        kind: "post",
        refId: "p-1",
        refLabel: "Raport",
        target: "_blank",
        rel: "ugc",
        nofollow: true,
        ariaLabel: "Czytaj raport",
      }),
    ).toEqual({
      url: "/wpis",
      kind: "post",
      refId: "p-1",
      refLabel: "Raport",
      target: "_blank",
      rel: "ugc",
      nofollow: true,
      ariaLabel: "Czytaj raport",
    });
  });

  it.each([null, "/wpis", ["/wpis"], { url: "" }, { url: 5 }])(
    "zapis bez adresu (%j) nie daje linku",
    (value) => {
      expect(toWidgetLink(value)).toBeUndefined();
    },
  );
});

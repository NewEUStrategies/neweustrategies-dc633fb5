// Nagłówek H1 strony głównej dla czytników ekranu.
//
// CO TO DOWODZI. Strona główna musi mieć DOKŁADNIE JEDEN nagłówek poziomu 1.
// Zero `h1` to strona bez tytułu dla czytnika ekranu i dla wyszukiwarki; DWA
// `h1` to ten sam defekt, który audyt zgłosił dla stron buildera (2026-08-06,
// korekta 2): kanwa renderuje własny nagłówek, a bezwarunkowy `h1` dokładał
// drugi. Dlatego widoczność tego nagłówka MUSI zależeć od tego, czy dokument
// buildera niesie już nagłówek na szczycie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `builderDocHasTopHeading` ma własne testy
// w `src/lib/builder/__tests__/`; tutaj sprawdzamy DECYZJĘ o renderze, nie
// wykrywanie nagłówka w dokumencie.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { emptyDocument, type BuilderDocument, type SectionNode } from "@/lib/builder/types";

import { HomeSrHeading } from "../HomeSrHeading";

/** Dokument z sekcją niosącą nagłówek na szczycie. */
function docWithHeading(): BuilderDocument {
  const heading: SectionNode = {
    id: "s0",
    kind: "section",
    children: [
      {
        id: "c0",
        kind: "column",
        span: { desktop: 12 },
        // `builderDocHasTopHeading` czyta pole „Tag (SEO)" widgetu
        // (`content.tag`), a nie poziom nagłówka - to jawny wybór redakcji.
        children: [{ id: "w0", kind: "widget", type: "heading", content: { tag: "h1" } }],
      },
    ],
  };
  return { ...emptyDocument(), sections: [heading] };
}

function headings(container: HTMLElement): string[] {
  return [...container.querySelectorAll("h1")].map((el) => el.textContent ?? "");
}

describe("HomeSrHeading", () => {
  it("renderuje h1, gdy dokumentu nie ma (tryb listy wpisów)", () => {
    const { container } = render(<HomeSrHeading doc={null} lang="pl" />);
    expect(headings(container)).toHaveLength(1);
  });

  it("renderuje h1 dla dokumentu BEZ nagłówka na szczycie", () => {
    const { container } = render(<HomeSrHeading doc={emptyDocument()} lang="pl" />);
    expect(headings(container)).toHaveLength(1);
  });

  it("NIE renderuje h1, gdy kanwa sama niesie nagłówek", () => {
    // To jest sedno: drugi `h1` na tej samej stronie jest defektem dostępności,
    // nie kosmetyką.
    const { container } = render(<HomeSrHeading doc={docWithHeading()} lang="pl" />);
    expect(headings(container)).toEqual([]);
  });

  it("nagłówek jest ukryty wizualnie, ale czytany przez czytnik ekranu", () => {
    // `sr-only` zamiast `display:none` - inaczej czytnik ekranu też go nie widzi.
    const { container } = render(<HomeSrHeading doc={null} lang="pl" />);
    expect(container.querySelector("h1")?.className).toContain("sr-only");
  });

  it.each([
    { lang: "pl" as const, fragment: "Strategiczne myślenie" },
    { lang: "en" as const, fragment: "Strategic thinking" },
  ])("wersja $lang ma własną treść", ({ lang, fragment }) => {
    const { container } = render(<HomeSrHeading doc={null} lang={lang} />);
    expect(headings(container)[0]).toContain(fragment);
  });

  // DŁUG I18N ZGŁOSZONY, NIE NAPRAWIONY (istniał przed wyprowadzeniem atomu -
  // treść przeniesiona znak w znak z `routes/index.tsx`).
  //
  // Tekst najważniejszego nagłówka SEO serwisu jest dwujęzycznym LITERAŁEM
  // w kodzie komponentu, a nie kluczem słownika. Konsekwencja: bramka parytetu
  // PL/EN nie ma czego porównywać, a redakcja nie może zmienić tego nagłówka
  // bez wdrożenia kodu - w odróżnieniu od każdego innego tekstu na stronie.
  //
  // Naprawa wymaga decyzji, do KTÓREGO bundle'a i18n klucz trafia: strona
  // główna nie woła żadnego `ensureI18n`, więc klucz musi wejść do słownika
  // bazowego (koszt w rozmiarze wejściowego chunku) albo strona musi zacząć
  // dociągać nakładkę (koszt w TTFB najważniejszej trasy). To decyzja
  // architektoniczna, nie refaktor pod test.
  it.fails("treść nagłówka pochodzi ze słownika i18n, nie z literału w kodzie", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/components/home/atoms/HomeSrHeading.tsx", "utf8"),
    );
    const literaly = /"New European Strategies - (Strategic|Strategiczne)/.test(source);
    expect({ dwujezycznyLiteralWKodzie: literaly }).toEqual({ dwujezycznyLiteralWKodzie: false });
  });
});

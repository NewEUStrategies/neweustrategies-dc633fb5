// Nagłówek poziomu 1 strony głównej - jedyny w serwisie.
//
// CO TO DOWODZI. Strona główna musi mieć DOKŁADNIE JEDEN `h1` - zawsze, także
// przy martwym backendzie. Zero `h1` to strona bez tytułu dla czytnika ekranu
// i dla crawlera (regresja odziedziczona z `main`: bramka
// `e2e/ssr-completeness.spec.ts` liczyła `0`, bo jedyny `h1` przeniósł się
// 2026-09-14 do chrome nagłówka, które przy braku `site_settings` w ogóle się
// nie renderowało). DWA `h1` to ten sam defekt, który audyt 2026-08-06 zgłosił
// dla stron buildera - i dlatego atom ustępuje dokumentowi, który sam niesie
// nagłówek poziomu 1.
//
// DLACZEGO NIE MA TU JUŻ WARUNKU O POWŁOCE. `HeaderSeoHeading` został z chrome
// usunięty, więc powłoka nie jest kandydatem na `h1`. Lustrzana kopia jego
// warunków stała tu przez chwilę i SAMA była defektem: po usunięciu atomu
// z powłoki wyciszała nagłówek na produkcyjnej stronie głównej, zostawiając
// `h1` wyłącznie na ścieżce zdegradowanej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wykrywania nagłówka w dokumencie
// (`builderDocHasTopHeading` ma własne testy w `src/lib/builder/__tests__/`)
// ani parsowania bloba SEO (`parseSeoSettings` w `src/lib/seo/__tests__/`) -
// tutaj sprawdzamy DECYZJĘ o renderze i ŹRÓDŁO treści.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SITE_DEFAULT_TITLE } from "@/lib/seo/meta";
import { emptyDocument, type BuilderDocument, type SectionNode } from "@/lib/builder/types";

import { HomeSrHeading } from "../HomeSrHeading";
import { homeSrHeadingText } from "../homeHeadingSource";

/** Dokument z realną treścią, ale BEZ nagłówka poziomu 1. */
function docWithoutTopHeading(): BuilderDocument {
  const section: SectionNode = {
    id: "s1",
    kind: "section",
    children: [
      {
        id: "c1",
        kind: "column",
        span: { desktop: 12 },
        children: [{ id: "w1", kind: "widget", type: "text", content: { html: "<p>Zdanie.</p>" } }],
      },
    ],
  };
  return { ...emptyDocument(), sections: [section] };
}

/** Dokument, którego kanwa sama niesie nagłówek poziomu 1. */
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

function renderHeading(props: Partial<Parameters<typeof HomeSrHeading>[0]> = {}) {
  return render(<HomeSrHeading title="New European Strategies" doc={null} {...props} />);
}

describe("HomeSrHeading - kiedy strona główna rysuje własny h1", () => {
  it("renderuje h1, gdy dokumentu nie ma (tryb listy wpisów, pustka, zasiew awaryjny)", () => {
    const { container } = renderHeading();
    expect(headings(container)).toEqual(["New European Strategies"]);
  });

  it("renderuje h1 dla dokumentu BEZ własnego nagłówka na szczycie", () => {
    const { container } = renderHeading({ doc: emptyDocument() });
    expect(headings(container)).toHaveLength(1);
  });

  it("renderuje h1 dla dokumentu Z TREŚCIĄ, ale bez nagłówka poziomu 1", () => {
    // Najczęstszy układ produkcyjny: kanwa ma sekcje i widgety, a nagłówek
    // poziomu 1 nie jest w niej zaprojektowany. Ta gałąź była przez chwilę
    // wyciszona lustrzanym warunkiem o powłoce - efektem była PRODUKCYJNA
    // strona główna bez żadnego `h1`.
    const { container } = renderHeading({ doc: docWithoutTopHeading() });
    expect(headings(container)).toEqual(["New European Strategies"]);
  });

  it("NIE renderuje h1, gdy kanwa sama niesie nagłówek poziomu 1", () => {
    // To jest sedno: drugi `h1` na tej samej stronie jest defektem dostępności
    // i SEO, nie kosmetyką.
    const { container } = renderHeading({ doc: docWithHeading() });
    expect(headings(container)).toEqual([]);
  });

  it("nagłówek jest `sr-only`, nie widoczny paskiem nad treścią", () => {
    // Wymóg redakcyjny spisany przy przenosinach nagłówka do powłoki: `h1` ma
    // istnieć w kodzie strony, ale nie rysować się nad kanwą, która ma własny
    // hero. `sr-only`, a NIE `hidden` - nagłówek musi zostać w drzewie
    // dostępności.
    const { container } = renderHeading();
    expect(container.querySelector("h1")?.className).toBe("sr-only");
  });
});

describe("homeSrHeadingText - to samo źródło, co domyślny <title>", () => {
  it("bez ustawień spada na stałą marki w języku renderu", () => {
    // Martwy backend = pusta mapa ustawień. Nagłówek MUSI wtedy nadal nieść
    // nazwę serwisu, inaczej bramka SSR widzi pusty `h1`.
    expect(homeSrHeadingText({}, "pl")).toBe(SITE_DEFAULT_TITLE.pl);
    expect(homeSrHeadingText({}, "en")).toBe(SITE_DEFAULT_TITLE.en);
    expect(homeSrHeadingText({}, "pl")).toContain("New European Strategies");
  });

  it("redakcyjny tytuł serwisu BIJE stałą marki, osobno dla każdego języka", () => {
    const settings = { seo: { site_title_pl: "Tytuł redakcji", site_title_en: "Editorial title" } };
    expect(homeSrHeadingText(settings, "pl")).toBe("Tytuł redakcji");
    expect(homeSrHeadingText(settings, "en")).toBe("Editorial title");
  });

  it("tytuł z samych spacji NIE jest tytułem", () => {
    expect(homeSrHeadingText({ seo: { site_title_pl: "   " } }, "pl")).toBe(SITE_DEFAULT_TITLE.pl);
  });

  it("uszkodzony blob SEO nie zabiera nagłówka", () => {
    // `parseSeoSettings` toleruje śmieć; nagłówek najważniejszej trasy serwisu
    // nie może zniknąć przez jeden zepsuty wiersz ustawień.
    expect(homeSrHeadingText({ seo: "nie-obiekt" }, "pl")).toBe(SITE_DEFAULT_TITLE.pl);
  });
});

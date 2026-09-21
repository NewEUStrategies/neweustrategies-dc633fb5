// Zapasowy nagłówek poziomu 1 strony głównej.
//
// CO TO DOWODZI. Strona główna musi mieć DOKŁADNIE JEDEN `h1` - zawsze, także
// przy martwym backendzie. Zero `h1` to strona bez tytułu dla czytnika ekranu
// i dla crawlera (regresja odziedziczona z `main`: bramka
// `e2e/ssr-completeness.spec.ts` liczyła `0`, bo jedyny `h1` przeniósł się
// 2026-09-14 do chrome nagłówka, które przy braku `site_settings` w ogóle się
// nie renderuje). DWA `h1` to ten sam defekt, który audyt 2026-08-06 zgłosił
// dla stron buildera. Dlatego zapas jest WARUNKOWY i tutaj sprawdzamy obie
// przesłanki jego zniknięcia - powłokę i dokument.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wykrywania nagłówka w dokumencie
// (`builderDocHasTopHeading` ma własne testy w `src/lib/builder/__tests__/`)
// ani parsowania bloba SEO (`parseSeoSettings` w `src/lib/seo/__tests__/`) -
// tutaj sprawdzamy DECYZJĘ o renderze i ŹRÓDŁO treści.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SITE_DEFAULT_TITLE } from "@/lib/seo/meta";
import { emptyDocument, type BuilderDocument, type SectionNode } from "@/lib/builder/types";

import { HomeSrHeading, homeSrHeadingText, siteHeaderHasHomeHeading } from "../HomeSrHeading";

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

/** Kanwa nagłówka witryny w kształcie, który czyta `components/Header.tsx`. */
const HEADER_WITH_CANVAS = {
  header: { builder_data: { version: 1, sections: [{ id: "h1", kind: "section", children: [] }] } },
} as const;

function headings(container: HTMLElement): string[] {
  return [...container.querySelectorAll("h1")].map((el) => el.textContent ?? "");
}

function renderHeading(props: Partial<Parameters<typeof HomeSrHeading>[0]> = {}) {
  return render(
    <HomeSrHeading
      title="New European Strategies"
      doc={null}
      siteHeaderHasHeading={false}
      {...props}
    />,
  );
}

describe("HomeSrHeading - kiedy strona główna dorysowuje własny h1", () => {
  it("renderuje h1, gdy dokumentu nie ma (tryb listy wpisów, pustka, zasiew awaryjny)", () => {
    const { container } = renderHeading();
    expect(headings(container)).toEqual(["New European Strategies"]);
  });

  it("renderuje h1 dla dokumentu BEZ własnego nagłówka na szczycie", () => {
    const { container } = renderHeading({ doc: emptyDocument() });
    expect(headings(container)).toHaveLength(1);
  });

  it("NIE renderuje h1, gdy kanwa sama niesie nagłówek poziomu 1", () => {
    // To jest sedno: drugi `h1` na tej samej stronie jest defektem dostępności
    // i SEO, nie kosmetyką.
    const { container } = renderHeading({ doc: docWithHeading() });
    expect(headings(container)).toEqual([]);
  });

  it("NIE renderuje h1, gdy wypisuje go powłoka witryny", () => {
    // `HeaderSeoHeading` (chrome nagłówka) jest na stronie głównej pierwszy
    // w kolejności dokumentu - zapas musi mu wtedy ustąpić.
    const { container } = renderHeading({ siteHeaderHasHeading: true });
    expect(headings(container)).toEqual([]);
  });

  it("nagłówek jest `sr-only`, nie widoczny paskiem nad treścią", () => {
    // Wymóg redakcyjny (patrz `HeaderSeoHeading`): `h1` ma istnieć w kodzie
    // strony, ale nie rysować się nad kanwą, która ma własny hero. `sr-only`,
    // a NIE `hidden` - nagłówek musi zostać w drzewie dostępności.
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

describe("siteHeaderHasHomeHeading - czy powłoka wypisuje już h1", () => {
  it("dane ustawień, których NIE MA, nie mogą wyrenderować nagłówka", () => {
    // `dataUpdatedAt === 0` to zasiew awaryjny loadera: `Header` zwraca wtedy
    // `HeaderSkeleton`, czyli zero nagłówków. Dokładnie ten stan miała bramka
    // e2e przy placeholderowych poświadczeniach Supabase.
    expect(siteHeaderHasHomeHeading(HEADER_WITH_CANVAS, 0)).toBe(false);
  });

  it("ustawienia BEZ kanwy nagłówka też dają szkielet, nie nagłówek", () => {
    expect(siteHeaderHasHomeHeading({ reading: { posts_per_page: 2 } }, 1)).toBe(false);
    expect(siteHeaderHasHomeHeading({ header: { builder_data: null } }, 1)).toBe(false);
    expect(siteHeaderHasHomeHeading({ header: { builder_data: { sections: [] } } }, 1)).toBe(false);
  });

  it("świeże ustawienia z kanwą nagłówka = powłoka ma własny h1", () => {
    expect(siteHeaderHasHomeHeading(HEADER_WITH_CANVAS, 1)).toBe(true);
  });
});

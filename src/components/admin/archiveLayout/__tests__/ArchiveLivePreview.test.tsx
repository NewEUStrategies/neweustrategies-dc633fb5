// PODGLĄD NA ŻYWO UKŁADU ARCHIWUM. Do 19.08.2026 na zerze - 140 linii bez
// jednego wykonania.
//
// To jedyne miejsce, w którym redaktor widzi skutek ustawień archiwum przed
// zapisem, i jedyne, w którym prawdziwy komponent układu dostaje ATRAPY danych.
// Trzy reguły, których złamania nie widać w żadnym innym teście:
//
//   1. Podgląd musi renderować UKŁAD WYBRANY W USTAWIENIACH, a nie stały -
//      inaczej przełączanie wariantów nic nie zmienia na ekranie.
//   2. Lista atrap jest przycinana do `posts_per_page`, ale NIGDY do zera -
//      pusty podgląd redaktor odczyta jako „układ nie działa".
//   3. Podgląd jest nieinteraktywny i oznaczony `previewMode`; bez tego
//      kliknięcie karty wyrzuca administratora na publiczną stronę, a wewnętrzne
//      pobrania danych ruszają w panelu.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
  variants: [] as number[],
}));

// Prawdziwe warianty ciągną za sobą pół publicznego archiwum. Podmieniamy
// rejestr znacznikiem, żeby test mierzył DECYZJE podglądu, a nie cudzy układ.
vi.mock("@/components/archive/layouts/registry", () => ({
  getLayoutComponent: (variant: number) => {
    h.variants.push(variant);
    return (props: Record<string, unknown>) => {
      h.props.push(props);
      return (
        <div data-testid="uklad">
          {String(props.previewMode)}
          {props.extraBelow as React.ReactNode}
        </div>
      );
    };
  },
}));

import "@/lib/i18n-archive-layout";
import { ArchiveLivePreview } from "../ArchiveLivePreview";
import { DEFAULT_ARCHIVE_LAYOUT, type ArchiveLayoutSettings } from "@/lib/archive-layout-settings";

function setup(
  overrides: Partial<ArchiveLayoutSettings> = {},
  opts: { archiveType?: "category" | "tag"; lang?: "pl" | "en" } = {},
) {
  h.props.length = 0;
  h.variants.length = 0;
  const settings: ArchiveLayoutSettings = {
    id: "s1",
    archive_type: opts.archiveType ?? "category",
    ...DEFAULT_ARCHIVE_LAYOUT,
    ...overrides,
  };
  const view = render(
    <ArchiveLivePreview
      archiveType={opts.archiveType ?? "category"}
      settings={settings}
      lang={opts.lang ?? "pl"}
    />,
  );
  return { view, settings };
}

/** Właściwości przekazane do komponentu układu. */
const layoutProps = () => h.props.at(-1) ?? {};

describe("ArchiveLivePreview - wybór układu", () => {
  it.each([1, 2, 3, 4, 5, 6] as const)(
    "wariant %s trafia do rejestru układów",
    (layout_variant) => {
      // Stały układ oznaczałby, że przełącznik wariantów nie robi nic widocznego.
      setup({ layout_variant });
      expect(h.variants).toContain(layout_variant);
    },
  );

  it("renderuje komponent zwrócony przez rejestr", () => {
    setup();
    expect(screen.getByTestId("uklad")).toBeTruthy();
  });
});

describe("ArchiveLivePreview - atrapy wpisów", () => {
  it("przycina listę do liczby wpisów na stronę", () => {
    setup({ posts_per_page: 3 });
    expect((layoutProps().posts as unknown[]).length).toBe(3);
  });

  it("NIGDY nie schodzi do zera wpisów", () => {
    // Pusty podgląd redaktor odczyta jako awarię układu, a nie jako skutek
    // ustawienia paginacji.
    setup({ posts_per_page: 0 });
    expect((layoutProps().posts as unknown[]).length).toBe(1);
  });

  it("nie wymyśla wpisów ponad przygotowaną próbkę", () => {
    setup({ posts_per_page: 999 });
    expect((layoutProps().posts as unknown[]).length).toBe(8);
  });

  it("atrapy mają JAWNIE wypełnione pola sponsoringu", () => {
    // Pola są wymagane przez typ karty, żeby żadna realna lista nie mogła ich
    // pominąć - atrapa musi je podać tak samo jak produkcja.
    setup();
    const post = (layoutProps().posts as Record<string, unknown>[])[0];
    expect(post).toMatchObject({
      is_sponsored: false,
      sponsored_kind: null,
      sponsored_affiliate: false,
    });
  });

  it("atrapy mają malejące daty publikacji", () => {
    // Układy sortujące po dacie na identycznych znacznikach czasu pokazałyby
    // kolejność przypadkową.
    setup();
    const daty = (layoutProps().posts as { published_at: string }[]).map((p) =>
      Date.parse(p.published_at),
    );
    expect(daty).toEqual([...daty].sort((a, b) => b - a));
  });

  it("atrapy prowadzą donikąd", () => {
    // Kotwica „#preview" zamiast prawdziwego adresu - klik w podglądzie nie
    // może opuścić panelu.
    setup();
    for (const post of layoutProps().posts as { href: string }[]) {
      expect(post.href).toBe("#preview");
    }
  });
});

describe("ArchiveLivePreview - język i rodzaj archiwum", () => {
  it("tytuły atrap idą za językiem podglądu", () => {
    setup({}, { lang: "pl" });
    const pl = (layoutProps().posts as { title_pl: string }[])[0].title_pl;
    setup({}, { lang: "en" });
    const en = (layoutProps().posts as { title_pl: string }[])[0].title_pl;

    expect(pl).not.toBe(en);
  });

  it("KATEGORIA dostaje nazwę czytelną, TAG - postać slugu", () => {
    // Tag i kategoria wyglądają na stronie inaczej; podgląd pokazujący jedno
    // dla obu ukrywałby połowę różnicy.
    setup({}, { archiveType: "category" });
    const kategoria = (layoutProps().taxonomy as { name_pl: string }).name_pl;
    setup({}, { archiveType: "tag" });
    const tag = (layoutProps().taxonomy as { name_pl: string }).name_pl;

    expect(kategoria).toBe("Przykładowa kategoria");
    expect(tag).toBe("przyklad-tag");
  });

  it("angielski podgląd nazywa taksonomię po angielsku", () => {
    setup({}, { archiveType: "category", lang: "en" });
    expect((layoutProps().taxonomy as { name_en: string }).name_en).toBe("Sample category");
  });

  it("angielski tag też ma własną nazwę", () => {
    setup({}, { archiveType: "tag", lang: "en" });
    expect((layoutProps().taxonomy as { name_pl: string }).name_pl).toBe("sample-tag");
  });

  it("tekst pustej listy jest w języku podglądu", () => {
    setup({}, { lang: "en" });
    expect(layoutProps().emptyText).toBe("No posts.");
    setup({}, { lang: "pl" });
    expect(layoutProps().emptyText).toBe("Brak wpisów.");
  });
});

describe("ArchiveLivePreview - podcasty pod listą", () => {
  it("pojawiają się TYLKO przy włączonym ustawieniu", () => {
    const wlaczone = setup({ show_podcasts: true });
    expect(wlaczone.view.container.textContent).toContain("Podcasty");
    wlaczone.view.unmount();

    const wylaczone = setup({ show_podcasts: false });
    expect(wylaczone.view.container.textContent).not.toContain("Podcasty");
    expect(layoutProps().extraBelow).toBeNull();
  });

  it("nagłówek podcastów idzie za językiem", () => {
    const { view } = setup({ show_podcasts: true }, { lang: "en" });
    expect(view.container.textContent).toContain("Podcasts");
  });
});

describe("ArchiveLivePreview - izolacja podglądu", () => {
  it("oznacza render trybem podglądu", () => {
    // `previewMode` wyłącza w układach realne pobrania i nawigację.
    setup();
    expect(layoutProps().previewMode).toBe(true);
  });

  it("blokuje interakcję z zawartością podglądu", () => {
    const { view } = setup();
    expect(view.container.querySelector(".pointer-events-none")).toBeTruthy();
  });

  it("stronicowanie i sortowanie w podglądzie są bez skutku", () => {
    setup();
    expect(() => (layoutProps().onPageChange as (n: number) => void)(4)).not.toThrow();
    expect(() => (layoutProps().onSortChange as (s: string) => void)("oldest")).not.toThrow();
    expect(layoutProps().page).toBe(1);
  });

  it("opisuje panel dostępną nazwą w języku podglądu", () => {
    setup({}, { lang: "en" });
    expect(screen.getByLabelText("Archive layout live preview")).toBeTruthy();
  });

  it("przekazuje układowi CAŁE ustawienia, nie wybrane pola", () => {
    // Układ czyta z nich m.in. widgety paska bocznego i styl tła hero.
    const { settings } = setup({ show_sidebar: true, hero_bg_style: "image" });
    expect(layoutProps().settings).toEqual(settings);
  });
});

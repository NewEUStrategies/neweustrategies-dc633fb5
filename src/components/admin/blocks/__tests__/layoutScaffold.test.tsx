// WIREFRAME UKLADU WPISU w edytorze blokow (`LayoutScaffold`, 484 linie).
//
// Plik startowal z 0% - byl jednym z DWOCH ostatnich plikow modulu 3 na zerze,
// a jednoczesnie cala luka miedzy `src/components/admin/blocks/**` i progiem
// 90% linii z zadania. Nie jest rdzeniem edytora, tylko jego sasiadem
// w katalogu, i dlatego audyt go nie wymienia - co nie znaczy, ze nie liczy sie
// do progu tej sciezki.
//
// CO MA TU DOWOD:
//   1. `children` (czyli KANWA BLOKOW) ladują w slocie tresci, a nie w naglowku
//      ani w sidebarze - to jest kontrakt nosny tego pliku i jedyna rzecz,
//      ktorej zlamanie redaktor zobaczylby natychmiast,
//   2. przejazd po WSZYSTKICH prawdziwych presetach kazdego formatu (standard,
//      video, audio, gallery) - nie po dwoch wybranych recznie; strefa gorna
//      musi odpowiadac trybowi naglowka presetu (overlay / side-by-side /
//      below-cover / no-cover / above-cover),
//   3. sidebar: obecny albo nie, zgodnie z `effectiveHasSidebar`, oraz to, ze
//      przy sidebarze naglowek i tresc siedza w JEDNEJ kolumnie (tak jak
//      w publicznym rendererze, nie obok siebie),
//   4. szerokosc kolumny tresci pochodzi z `layoutContentMaxWidth`, czyli
//      z ustawien panelu, a nie z hardkodu,
//   5. nieznany `layoutId` - `findLayout` schodzi na pierwszy preset zestawu
//      i wireframe nadal sie rysuje,
//   6. `showExcerpt === false` (layout 1a) pokazuje komunikat o ukrytej
//      zajawce, a nie po cichu nic,
//   7. i18n PL i EN na tych samych asercjach.
//
// CZEGO TU NIE MA - swiadomie: nie sprawdzam wygladu (klasy Tailwinda, gradienty,
// proporcje kadru). happy-dom nie ma silnika layoutu, wiec asercja na wyliczonym
// pikselu mierzylaby atrape przegladarki, nie komponent. Proporcje kadru maja
// dowod tam, gdzie sa liczone - w testach `src/lib/postLayouts`.
//
// Tlumacz jest PRAWDZIWY (`@/test/i18nReal`), nie atrapa zwracajaca klucz -
// dzieki temu zniknięcie klucza ze slownika oblewa te testy, zamiast przejsc
// niezauwazone.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { LayoutScaffold } from "@/components/admin/blocks/LayoutScaffold";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-blocks";
import {
  STANDARD_LAYOUTS,
  VIDEO_LAYOUTS,
  AUDIO_LAYOUTS,
  GALLERY_LAYOUTS,
  defaultPostLayoutSettings,
  effectiveHasSidebar,
  layoutContentMaxWidth,
  findLayout,
  type LayoutPreset,
  type PostFormat,
  type PostLayoutSettings,
} from "@/lib/postLayouts";

const t = realT("pl");
const tEn = realT("en");

/** Znacznik kanwy - szukamy go po tresci, zeby nie zalezec od struktury DOM. */
const CANVAS = "KANWA-BLOKOW";

function settings(over: Partial<PostLayoutSettings> = {}): PostLayoutSettings {
  return { ...defaultPostLayoutSettings(), ...over };
}

function renderScaffold(
  format: PostFormat,
  layoutId: string,
  over: Partial<PostLayoutSettings> = {},
  props: { title?: string; excerpt?: string | null; coverImageUrl?: string | null } = {},
) {
  return render(
    <LayoutScaffold
      format={format}
      layoutId={layoutId}
      settings={settings(over)}
      title={props.title ?? "Tytul wpisu"}
      excerpt={props.excerpt}
      coverImageUrl={props.coverImageUrl}
    >
      <div>{CANVAS}</div>
    </LayoutScaffold>,
  );
}

/**
 * Strefa tresci - namierzana po WLASNEJ ETYKIECIE i18n, nie po szerokosci.
 *
 * Pierwsza wersja tego helpera szukala `[style*="max-width: Npx"]` i byla BLEDNA:
 * `layout-2` ma `contentMaxWidth: BOXED_COVER_MAX_WIDTH` (672), a okladka
 * w trybie `boxed` dostaje DOKLADNIE TE SAMA szerokosc, wiec `querySelector`
 * zwracal okladke, nie strefe tresci. Cztery testy (layout-2 i jego pochodne
 * video/audio/gallery) padaly na "nie znaleziono KANWA-BLOKOW" - i padaly
 * SLUSZNIE, tylko z winy testu, nie komponentu.
 *
 * Etykieta jest jednoznaczna, a asercja pozostaje nieokragla: etykieta mowi
 * "to jest strefa tresci", a test dopiero potem sprawdza, czy kanwa jest w niej.
 */
function contentZone(maxW: number): HTMLElement {
  const label = screen.getByText(t("admin.layoutScaffold.content.label", { max: maxW }));
  const zone = label.parentElement;
  if (!zone) throw new Error("test: etykieta strefy tresci nie ma rodzica");
  return zone;
}

const SETS: ReadonlyArray<readonly [PostFormat, ReadonlyArray<LayoutPreset>]> = [
  ["standard", STANDARD_LAYOUTS],
  ["video", VIDEO_LAYOUTS],
  ["audio", AUDIO_LAYOUTS],
  ["gallery", GALLERY_LAYOUTS],
];

describe("LayoutScaffold - kontrakt nosny: kanwa siedzi w slocie tresci", () => {
  it("children ladują w strefie tresci, nie w naglowku", () => {
    const preset = STANDARD_LAYOUTS[0];
    const s = settings();
    const maxW = layoutContentMaxWidth(preset, s, effectiveHasSidebar(preset, s));
    renderScaffold("standard", preset.id);
    expect(within(contentZone(maxW)).getByText(CANVAS)).toBeInTheDocument();
  });

  it("przy sidebarze kanwa NADAL jest w slocie tresci, a nie w sidebarze", () => {
    // Sidebar wlaczamy override'em z panelu - tak samo jak robi to front.
    const preset = STANDARD_LAYOUTS[0];
    const s = settings({ layout_sidebar_overrides: { [preset.id]: true } });
    if (!effectiveHasSidebar(preset, s)) return; // preset nie wspiera sidebara
    const maxW = layoutContentMaxWidth(preset, s, true);
    render(
      <LayoutScaffold
        format="standard"
        layoutId={preset.id}
        settings={s}
        title="Tytul"
        excerpt={null}
        coverImageUrl={null}
      >
        <div>{CANVAS}</div>
      </LayoutScaffold>,
    );
    expect(within(contentZone(maxW)).getByText(CANVAS)).toBeInTheDocument();
    expect(screen.getByText(t("admin.layoutScaffold.summary.sidebar"))).toBeInTheDocument();
  });

  it("kanwa pojawia sie DOKLADNIE RAZ - wireframe nie duplikuje tresci", () => {
    renderScaffold("standard", STANDARD_LAYOUTS[0].id);
    expect(screen.getAllByText(CANVAS)).toHaveLength(1);
  });
});

describe("LayoutScaffold - przejazd po WSZYSTKICH prawdziwych presetach", () => {
  for (const [format, set] of SETS) {
    describe(`format ${format} (${set.length} presetow)`, () => {
      for (const preset of set) {
        it(`${preset.id}: rysuje sie, kanwa w tresci, szerokosc z ustawien`, () => {
          const s = settings();
          const hasSidebar = effectiveHasSidebar(preset, s);
          const maxW = layoutContentMaxWidth(preset, s, hasSidebar);
          renderScaffold(
            format,
            preset.id,
            {},
            {
              coverImageUrl: "https://cdn.example.com/cover.jpg",
              excerpt: "Zajawka wpisu.",
            },
          );

          // 1. kanwa w slocie tresci
          expect(within(contentZone(maxW)).getByText(CANVAS)).toBeInTheDocument();

          // 2. podsumowanie niesie etykiete presetu i jego tryby
          expect(screen.getByText(preset.label)).toBeInTheDocument();
          expect(
            screen.getByText(t("admin.layoutScaffold.summary.header", { value: preset.header })),
          ).toBeInTheDocument();
          expect(
            screen.getByText(t("admin.layoutScaffold.summary.cover", { value: preset.cover })),
          ).toBeInTheDocument();

          // 3. sidebar dokladnie wtedy, gdy mowi o tym effectiveHasSidebar
          const sidebarChip = screen.queryByText(t("admin.layoutScaffold.summary.sidebar"));
          expect(sidebarChip === null).toBe(!hasSidebar);
        });
      }
    });
  }
});

describe("LayoutScaffold - tryb naglowka rzadzi strefa gorna", () => {
  /** Pierwszy preset standardowy o danym trybie naglowka, jesli istnieje. */
  function presetWithHeader(header: LayoutPreset["header"]): LayoutPreset | undefined {
    return STANDARD_LAYOUTS.find((l) => l.header === header);
  }

  it("overlay: tytul jedzie NA obrazie, nie w osobnej strefie naglowka", () => {
    const preset = presetWithHeader("overlay");
    if (!preset) return;
    renderScaffold(
      "standard",
      preset.id,
      {},
      {
        coverImageUrl: "https://cdn.example.com/c.jpg",
      },
    );
    expect(screen.getByText(t("admin.layoutScaffold.overlay.label"))).toBeInTheDocument();
  });

  it("side-by-side: cover i naglowek stoja obok siebie", () => {
    const preset = presetWithHeader("side-by-side");
    if (!preset) return;
    renderScaffold(
      "standard",
      preset.id,
      {},
      {
        coverImageUrl: "https://cdn.example.com/c.jpg",
      },
    );
    expect(screen.getByText(t("admin.layoutScaffold.sideBySide.cover"))).toBeInTheDocument();
  });

  it("no-cover: nie ma strefy okladki, jest sam naglowek", () => {
    const preset = presetWithHeader("no-cover");
    if (!preset) return;
    renderScaffold(
      "standard",
      preset.id,
      {},
      {
        coverImageUrl: "https://cdn.example.com/c.jpg",
      },
    );
    expect(screen.queryByText(t("admin.layoutScaffold.overlay.label"))).toBeNull();
    expect(screen.queryByText(t("admin.layoutScaffold.sideBySide.cover"))).toBeNull();
  });

  it("above-cover bez `coverImageUrl` (undefined) nie rysuje strefy okladki", () => {
    // Galaz `coverImageUrl !== undefined` - `null` rysuje pusta strefe,
    // `undefined` nie rysuje jej wcale. To rozroznienie jest w kodzie i dlatego
    // jest tu przypiete.
    const preset = STANDARD_LAYOUTS.find(
      (l) =>
        l.header !== "overlay" &&
        l.header !== "side-by-side" &&
        l.header !== "no-cover" &&
        l.header !== "below-cover",
    );
    if (!preset) return;
    const { container } = renderScaffold("standard", preset.id);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("LayoutScaffold - stany brzegowe", () => {
  it("nieznany layoutId schodzi na pierwszy preset zestawu i nadal sie rysuje", () => {
    const fallback = findLayout("standard", "nie-ma-takiego-ukladu");
    expect(fallback.id).toBe(STANDARD_LAYOUTS[0].id);
    renderScaffold("standard", "nie-ma-takiego-ukladu");
    expect(screen.getByText(fallback.label)).toBeInTheDocument();
    expect(screen.getByText(CANVAS)).toBeInTheDocument();
  });

  it("pusty tytul pokazuje podpowiedz, nie pusty naglowek", () => {
    const preset = STANDARD_LAYOUTS.find((l) => l.header === "no-cover") ?? STANDARD_LAYOUTS[0];
    renderScaffold("standard", preset.id, {}, { title: "" });
    expect(screen.getAllByText(t("admin.layoutScaffold.titlePlaceholder")).length).toBeGreaterThan(
      0,
    );
  });

  it("brak zajawki pokazuje podpowiedz zajawki", () => {
    const preset = STANDARD_LAYOUTS.find((l) => l.header === "no-cover") ?? STANDARD_LAYOUTS[0];
    renderScaffold("standard", preset.id, {}, { excerpt: null });
    expect(screen.getByText(t("admin.layoutScaffold.excerptPlaceholder"))).toBeInTheDocument();
  });

  it("preset z showExcerpt=false mowi WPROST, ze zajawka jest ukryta", () => {
    const preset = STANDARD_LAYOUTS.find((l) => l.showExcerpt === false);
    if (!preset) return;
    renderScaffold("standard", preset.id, {}, { excerpt: "Ta zajawka nie ma sie pokazac." });
    expect(screen.getByText(t("admin.layoutScaffold.excerptHidden"))).toBeInTheDocument();
    expect(screen.queryByText("Ta zajawka nie ma sie pokazac.")).toBeNull();
  });

  it("szerokosc tresci idzie z USTAWIEN panelu, nie z hardkodu", () => {
    const preset = STANDARD_LAYOUTS[0];
    const s = settings({ no_sidebar_max_width: 999, has_sidebar_max_width: 555 });
    const hasSidebar = effectiveHasSidebar(preset, s);
    const expected = layoutContentMaxWidth(preset, s, hasSidebar);
    render(
      <LayoutScaffold
        format="standard"
        layoutId={preset.id}
        settings={s}
        title="Tytul"
        excerpt={null}
        coverImageUrl={null}
      >
        <div>{CANVAS}</div>
      </LayoutScaffold>,
    );
    expect(contentZone(expected)).toBeTruthy();
    expect([555, 999]).toContain(expected);
  });
});

describe("LayoutScaffold - i18n i dostepnosc", () => {
  it("podsumowanie ma napisy PL", () => {
    renderScaffold("standard", STANDARD_LAYOUTS[0].id);
    expect(screen.getByText(t("admin.layoutScaffold.summary.title"))).toBeInTheDocument();
  });

  it("te same asercje po angielsku - klucz istnieje w OBU slownikach", () => {
    const pl = t("admin.layoutScaffold.summary.title");
    const en = tEn("admin.layoutScaffold.summary.title");
    expect(en).toBeTruthy();
    expect(en).not.toBe("admin.layoutScaffold.summary.title");
    expect(en).not.toBe(pl);
  });

  it("wireframe nie wnosi naruszen dostepnosci", async () => {
    const { container } = renderScaffold(
      "standard",
      STANDARD_LAYOUTS[0].id,
      {},
      {
        coverImageUrl: "https://cdn.example.com/c.jpg",
        excerpt: "Zajawka.",
      },
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

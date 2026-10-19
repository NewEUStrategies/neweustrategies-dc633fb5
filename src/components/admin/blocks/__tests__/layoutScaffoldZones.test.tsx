// WIREFRAME UKLADU WPISU (`LayoutScaffold`) - CO DOKLADNIE POKAZUJE KAZDA STREFA.
//
// Sasiedni `layoutScaffold.test.tsx` dowodzi kontraktu nosnego (kanwa w slocie
// tresci) i przejezdza po wszystkich presetach. Ten plik dowodzi tego, co
// autor wpisu CZYTA z wireframe'u i co ma odpowiadac publicznemu rendererowi:
//   * wysrodkowanie naglowka: ustawienie z panelu wygrywa, a gdy go brak -
//     domyslna wartosc presetu (layout-2 jest wysrodkowany z natury),
//   * okladka: obraz z adresem, podpowiedz bez adresu, nazwa wariantu
//     okladki, kadr policzony z ustawien panelu (presety "ratio") i
//     szerokosc okladki "boxed" rowna szerokosci z publicznego renderera,
//   * kolejnosc stref: `below-cover` stawia okladke NAD naglowkiem,
//     `above-cover` - pod nim,
//   * nakladka (`overlay`) i uklad obok siebie (`side-by-side`) pokazuja
//     zajawke i obraz, a pusty tytul zastepuja podpowiedzia,
//   * stopka wymienia DOKLADNIE wlaczone sekcje, a bez zadnej znika cala,
//   * podglad metadanych (autor / data / czas czytania) idzie za jezykiem
//     interfejsu.
//
// CZEGO TU NIE MA: klas Tailwinda i pikseli layoutu. Jedyne odczyty stylu to
// `aspectRatio` i `maxWidth` okladki - liczby, ktore komponent sam wylicza
// z presetu i ustawien (ta sama funkcja co w publicznym rendererze), a nie
// wynik silnika layoutu. Slownik jest prawdziwy (`realT`).
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { LayoutScaffold } from "@/components/admin/blocks/LayoutScaffold";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import {
  BOXED_COVER_MAX_WIDTH,
  coverAspectRatio,
  defaultPostLayoutSettings,
  findLayout,
  type PostFormat,
  type PostLayoutSettings,
} from "@/lib/postLayouts";

const t = realT("pl");

function ustawienia(over: Partial<PostLayoutSettings> = {}): PostLayoutSettings {
  return { ...defaultPostLayoutSettings(), ...over };
}

function zamontuj(
  layoutId: string,
  over: Partial<PostLayoutSettings> = {},
  props: { title?: string; excerpt?: string | null; coverImageUrl?: string | null } = {},
  format: PostFormat = "standard",
) {
  return render(
    <LayoutScaffold
      format={format}
      layoutId={layoutId}
      settings={ustawienia(over)}
      title={props.title ?? "Tytul wpisu"}
      excerpt={props.excerpt}
      coverImageUrl={props.coverImageUrl}
    >
      <div>KANWA</div>
    </LayoutScaffold>,
  );
}

/** Strefa okladki: rodzic etykiety „Cover - <wariant>". */
function strefaOkladki(wariant: string): HTMLElement {
  const etykieta = screen.getByText(t("admin.layoutScaffold.cover.label", { variant: wariant }));
  const strefa = etykieta.parentElement;
  if (!strefa) throw new Error("test: etykieta okladki nie ma rodzica");
  return strefa;
}

/** Czy element `a` stoi w dokumencie PRZED elementem `b`. */
function przed(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("LayoutScaffold - wysrodkowanie naglowka", () => {
  it("ustawienie panelu `center_header` wygrywa nad presetem", () => {
    zamontuj("layout-2", { center_header: false });

    expect(screen.getByText(t("admin.layoutScaffold.header.label"))).toBeInTheDocument();
    expect(screen.queryByText(t("admin.layoutScaffold.header.centered"))).toBeNull();
  });

  it("bez ustawienia w panelu decyduje domyslna wartosc presetu", () => {
    // Ustawienia sprzed wprowadzenia pola nie maja `center_header` wcale.
    const bezPola = { center_header: undefined } as unknown as Partial<PostLayoutSettings>;
    zamontuj("layout-2", bezPola);
    expect(screen.getByText(t("admin.layoutScaffold.header.centered"))).toBeInTheDocument();
    cleanup();

    // layout-1 nie ma domyslnego wysrodkowania - naglowek do lewej.
    zamontuj("layout-1", bezPola);
    expect(screen.getByText(t("admin.layoutScaffold.header.label"))).toBeInTheDocument();
  });
});

describe("LayoutScaffold - strefa okladki", () => {
  it("z adresem okladki pokazuje ten obraz w strefie wariantu presetu", () => {
    zamontuj("layout-1", {}, { coverImageUrl: "https://cdn.example.com/okladka.jpg" });

    const img = strefaOkladki("wide").querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/okladka.jpg");
    // Okladka jest dekoracja wireframe'u - tytul wpisu stoi obok jako tekst.
    expect(img).toHaveAttribute("alt", "");
  });

  it("bez adresu (null) pokazuje podpowiedz, gdzie ustawic okladke", () => {
    zamontuj("layout-1", {}, { coverImageUrl: null });

    expect(strefaOkladki("wide").querySelector("img")).toBeNull();
    expect(screen.getByText(t("admin.layoutScaffold.cover.empty"))).toBeInTheDocument();
  });

  it("kadr presetu „ratio” jest liczony z USTAWIEN panelu, jak u czytelnika", () => {
    const preset = findLayout("standard", "layout-6");
    zamontuj("layout-6", { featured_ratio_l6: 120 }, { coverImageUrl: null });

    const kadr = strefaOkladki("ratio").querySelector<HTMLElement>("div");
    expect(kadr?.style.aspectRatio).toBe(coverAspectRatio(preset, 120));
    expect(kadr?.style.aspectRatio).toBe("100 / 120");
  });

  it("okladka „boxed” ma szerokosc z publicznego renderera i jest wysrodkowana", () => {
    zamontuj("layout-2", {}, { coverImageUrl: null });

    const strefa = strefaOkladki("boxed");
    expect(strefa.style.maxWidth).toBe(`${BOXED_COVER_MAX_WIDTH}px`);
    expect(strefa.style.marginInline).toBe("auto");
  });

  it("`below-cover` stawia okladke NAD naglowkiem", () => {
    zamontuj("layout-8", {}, { coverImageUrl: null });

    const okladka = strefaOkladki("wide");
    const naglowek = screen.getByRole("heading", { level: 1 });
    expect(przed(okladka, naglowek)).toBe(true);
  });

  it("`above-cover` stawia naglowek NAD okladka", () => {
    zamontuj("layout-1", {}, { coverImageUrl: null });

    const okladka = strefaOkladki("wide");
    const naglowek = screen.getByRole("heading", { level: 1 });
    expect(przed(naglowek, okladka)).toBe(true);
  });
});

describe("LayoutScaffold - nakladka i uklad obok siebie", () => {
  it("nakladka pokazuje obraz, tytul i zajawke na okladce", () => {
    const { container } = zamontuj(
      "layout-4",
      {},
      { coverImageUrl: "https://cdn.example.com/hero.jpg", excerpt: "Zajawka na okladce." },
    );

    expect(container.querySelector('img[src="https://cdn.example.com/hero.jpg"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tytul wpisu");
    expect(screen.getByText("Zajawka na okladce.")).toBeInTheDocument();
  });

  it("nakladka z pustym tytulem i bez okladki pokazuje podpowiedz, a nie pustke", () => {
    const { container } = zamontuj("layout-4", {}, { title: "", coverImageUrl: null });

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      t("admin.layoutScaffold.titlePlaceholder"),
    );
  });

  it("uklad obok siebie pokazuje okladke, tytul i zajawke", () => {
    const { container } = zamontuj(
      "layout-7",
      {},
      { coverImageUrl: "https://cdn.example.com/bok.jpg", excerpt: "Zajawka obok." },
    );

    expect(container.querySelector('img[src="https://cdn.example.com/bok.jpg"]')).not.toBeNull();
    expect(screen.getByText("Tytul wpisu")).toBeInTheDocument();
    expect(screen.getByText("Zajawka obok.")).toBeInTheDocument();
  });

  it("uklad obok siebie z pustym tytulem pokazuje podpowiedz", () => {
    const { container } = zamontuj("layout-7", {}, { title: "", coverImageUrl: null });

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(t("admin.layoutScaffold.titlePlaceholder"))).toBeInTheDocument();
  });
});

describe("LayoutScaffold - stopka wpisu", () => {
  it("stopka wymienia DOKLADNIE wlaczone sekcje, w kolejnosci publicznej strony", () => {
    zamontuj("layout-1", {
      show_post_tags_bar: true,
      show_author_card: true,
      show_prev_next: false,
      show_bottom_newsletter: false,
      show_floating_share_bar: true,
      auto_load_next_post: true,
    });

    const etykieta = screen.getByText(t("admin.layoutScaffold.footer.label"));
    const chipy = Array.from(etykieta.parentElement?.querySelectorAll("span") ?? [])
      .filter((el) => el !== etykieta)
      .map((el) => el.textContent);
    expect(chipy).toEqual([
      t("admin.layoutScaffold.footer.tags"),
      t("admin.layoutScaffold.footer.authorCard"),
      t("admin.layoutScaffold.footer.floatingShare"),
      t("admin.layoutScaffold.footer.autoLoad"),
    ]);
  });

  it("bez zadnej wlaczonej sekcji stopka znika w calosci", () => {
    zamontuj("layout-1", {
      show_post_tags_bar: false,
      show_author_card: false,
      show_prev_next: false,
      show_bottom_newsletter: false,
      show_floating_share_bar: false,
      auto_load_next_post: false,
    });

    expect(screen.queryByText(t("admin.layoutScaffold.footer.label"))).toBeNull();
  });
});

describe("LayoutScaffold - podglad metadanych w jezyku interfejsu", () => {
  it("panel polski pokazuje polskie etykiety autora, daty i czasu czytania", () => {
    zamontuj("layout-1");

    expect(screen.getByText("Autor")).toBeInTheDocument();
    expect(screen.getByText("Opublikowano:")).toBeInTheDocument();
    expect(screen.getByText("X min czytania")).toBeInTheDocument();
  });

  it("panel angielski pokazuje angielskie etykiety", async () => {
    await i18n.changeLanguage("en");
    try {
      zamontuj("layout-1");

      expect(screen.getByText("By")).toBeInTheDocument();
      expect(screen.getByText("Published:")).toBeInTheDocument();
      expect(screen.getByText("X min read")).toBeInTheDocument();
      expect(screen.queryByText("Autor")).toBeNull();
    } finally {
      // Odmontowanie PRZED powrotem do polskiego - `changeLanguage`
      // przerenderowuje kazdy zamontowany komponent.
      cleanup();
      await i18n.changeLanguage("pl");
    }
  });
});

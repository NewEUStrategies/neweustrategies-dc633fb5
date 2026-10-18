// EDYTORY NARZĘDZI WPISU I NAWIGACJI (`breadcrumbs`, `reading-time`,
// `share-buttons`, `post-views`, `navigation`, `post-navigation-link`,
// `query-loop`) - ZAPIS I ZGODNOŚĆ Z RENDEREREM PUBLICZNYM.
//
// PO CO TEN PLIK. Te edytory nie mają własnej treści - ustawiają, jak strona
// narysuje okruszki, przyciski udostępniania czy pętlę wpisów. Panel jest
// więc wiarygodny tylko wtedy, gdy pokazuje TO, co narysuje renderer
// (`components/blocks/renderer/organisms.tsx` i widoki obok), a każde
// kliknięcie zapisuje dokładnie swój klucz.
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * każde pole zapisuje WŁASNY klucz w typie oczekiwanym przez renderer,
//    a `id`, `type` i reszta danych bloku przechodzą bez zmian,
//  * wartości tekstowe w złym kształcie (obiekt z migracji) nie wchodzą do
//    pól jako „[object Object]", a liczby-słowa nie dają `NaN`,
//  * lista sieci udostępniania nigdy nie zostaje PUSTA - renderer czyta pustą
//    listę jako „pokaż domyślne cztery", więc odznaczenie ostatniej sieci
//    obiecywało w panelu pasek bez przycisków, a strona rysowała cztery,
//  * kierunek linku do wpisu spoza {prev, next} czyta się jak „następny" -
//    tak jak w rendererze, a nie jak pierwsza opcja listy („poprzedni"),
//  * liczba wpisów pętli pokazuje i zapisuje wartość PO przycięciu do [1, 24],
//    które robi zapytanie `queryLoopBlockQueryOptions`.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli (import PIERWSZY):
// `sonner`, Radix `Select`/`Switch`, `<Link>` routera, klient Supabase,
// kontekst najemcy, `fetch`. i18n PRAWDZIWE (`realT`).
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor, type BlockEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import {
  BreadcrumbsBlock,
  PostViewsBlock,
  ReadingTimeBlock,
  ShareButtonsBlock,
} from "../PostUtilityBlocks";
import { NavigationBlock, PostNavigationLinkBlock, QueryLoopBlock } from "../NavLoopBlocks";

const t = realT("pl");
const pu = (key: string) => t(`blocks.editors.postUtility.${key}`) as string;
const nl = (key: string) => t(`blocks.editors.navLoop.${key}`) as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `nu-${type}`, type, data };
}

/**
 * Montaż, akcja redaktora i ostatni zapis - z kontrolą `id` i `type`.
 * Edytor jest odmontowywany po akcji, więc kolejne wywołanie w tym samym
 * teście startuje na czystym dokumencie.
 */
function zapisPo(Editor: BlockEditor, start: Block, akcja: () => void): Record<string, Json> {
  const { changes, unmount } = renderEditor(Editor, start);
  akcja();
  unmount();
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  const zapis = changes[changes.length - 1];
  expect(zapis.id).toBe(start.id);
  expect(zapis.type).toBe(start.type);
  return zapis.data;
}

const pole = (placeholder: string) => screen.getByPlaceholderText(placeholder) as HTMLInputElement;
const przelacznik = (nazwa: string) => screen.getByRole("checkbox", { name: nazwa });

describe("okruszki, czas czytania i wyświetlenia", () => {
  it("okruszki: separator i „Strona główna” zapisują własne klucze", () => {
    const start = blok("breadcrumbs", { separator: "/" });
    expect(
      zapisPo(BreadcrumbsBlock, start, () =>
        fireEvent.change(pole(pu("separatorPh")), { target: { value: "›" } }),
      ),
    ).toEqual({ separator: "›" });
  });

  it("okruszki: „Strona główna” jest domyślnie włączona i zapisuje WYŁĄCZENIE", () => {
    const zapis = zapisPo(BreadcrumbsBlock, blok("breadcrumbs", {}), () =>
      fireEvent.click(przelacznik(pu("showHome"))),
    );
    expect(zapis).toEqual({ showHome: false });
  });

  it("okruszki: separator w kształcie OBIEKTU pokazuje domyślny „/”", () => {
    renderEditor(BreadcrumbsBlock, blok("breadcrumbs", { separator: { pl: "›" } }));
    expect(pole(pu("separatorPh")).value).toBe("/");
  });

  it("czas czytania: tempo zapisuje się jako LICZBA, a puste pole wraca do 220", () => {
    const start = blok("reading-time", { wpm: 220 });
    expect(
      zapisPo(ReadingTimeBlock, start, () =>
        fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "300" } }),
      ),
    ).toEqual({ wpm: 300 });
    expect(
      zapisPo(ReadingTimeBlock, start, () =>
        fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } }),
      ),
    ).toEqual({ wpm: 220 });
  });

  it("czas czytania: tempo zapisane jako słowo pokazuje domyślne 220, a nie puste pole", () => {
    // `renderReadingTime` czyta „szybko" jako brak i liczy z 220 słów/min.
    renderEditor(ReadingTimeBlock, blok("reading-time", { wpm: "szybko" }));
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("220");
  });

  it("czas czytania: prefiks zapisuje się pod `prefix`", () => {
    const zapis = zapisPo(ReadingTimeBlock, blok("reading-time", {}), () =>
      fireEvent.change(pole(pu("prefixPh")), { target: { value: "Czytasz:" } }),
    );
    expect(zapis).toEqual({ prefix: "Czytasz:" });
  });

  it("wyświetlenia: sufiks zapisuje się, a sufiks-obiekt nie wchodzi do pola", () => {
    const zapis = zapisPo(PostViewsBlock, blok("post-views", {}), () =>
      fireEvent.change(pole(pu("suffixPh")), { target: { value: "odsłon" } }),
    );
    expect(zapis).toEqual({ suffix: "odsłon" });
    renderEditor(PostViewsBlock, blok("post-views", { suffix: { pl: "odsłon" } }));
    expect(pole(pu("suffixPh")).value).toBe("");
  });
});

describe("przyciski udostępniania", () => {
  const siec = (nazwa: string) => screen.getByRole("button", { name: nazwa });
  const aktywne = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);

  it("bez danych aktywne są domyślne sieci renderera, a stan jest ogłaszany", () => {
    // `ShareButtonsView` bez listy rysuje facebook, x, linkedin i copy.
    renderEditor(ShareButtonsBlock, blok("share-buttons", {}));
    expect(aktywne()).toEqual(["facebook", "x", "linkedin", "copy"]);
    expect(siec("email").getAttribute("aria-pressed")).toBe("false");
  });

  it("dołączenie sieci dopisuje ją NA KONIEC listy", () => {
    const zapis = zapisPo(ShareButtonsBlock, blok("share-buttons", { networks: ["x"] }), () =>
      fireEvent.click(siec("telegram")),
    );
    expect(zapis).toEqual({ networks: ["x", "telegram"] });
  });

  it("odznaczenie sieci usuwa TĘ sieć i zostawia kolejność pozostałych", () => {
    const start = blok("share-buttons", { networks: ["facebook", "x", "email"] });
    expect(zapisPo(ShareButtonsBlock, start, () => fireEvent.click(siec("x")))).toEqual({
      networks: ["facebook", "email"],
    });
  });

  it("odznaczenie OSTATNIEJ sieci nie zapisuje pustej listy", () => {
    // Pusta lista w rendererze znaczy „domyślne cztery" - zapis `[]` dawał
    // pasek bez przycisków w panelu i cztery przyciski na stronie.
    const { changes } = renderEditor(ShareButtonsBlock, blok("share-buttons", { networks: ["x"] }));
    fireEvent.click(siec("x"));
    expect(changes).toEqual([]);
    expect(aktywne()).toEqual(["x"]);
  });

  it("zapisana PUSTA lista jest pokazana tak, jak ją narysuje strona - domyślnie", () => {
    renderEditor(ShareButtonsBlock, blok("share-buttons", { networks: [] }));
    expect(aktywne()).toEqual(["facebook", "x", "linkedin", "copy"]);
  });

  it("lista z elementami innymi niż napisy czyta tylko napisy", () => {
    renderEditor(
      ShareButtonsBlock,
      blok("share-buttons", { networks: [{ id: "x" }, "linkedin", 7] as Json }),
    );
    expect(aktywne()).toEqual(["linkedin"]);
  });

  it("wariant wyglądu zapisuje się pod `variant`", () => {
    const zapis = zapisPo(ShareButtonsBlock, blok("share-buttons", {}), () => {
      const lista = screen.getByRole("combobox") as HTMLSelectElement;
      expect(Array.from(lista.options, (o) => o.text)).toEqual([
        pu("variantFilled"),
        pu("variantOutline"),
        pu("variantGhost"),
      ]);
      fireEvent.change(lista, { target: { value: "ghost" } });
    });
    expect(zapis).toEqual({ variant: "ghost" });
  });
});

describe("nawigacja i link do sąsiedniego wpisu", () => {
  it("nawigacja: klucz menu i układ zapisują własne klucze", () => {
    const start = blok("navigation", {});
    expect(
      zapisPo(NavigationBlock, start, () =>
        fireEvent.change(pole(nl("menuKeyPh")), { target: { value: "footer" } }),
      ),
    ).toEqual({ menuKey: "footer" });
    expect(
      zapisPo(NavigationBlock, start, () =>
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "vertical" } }),
      ),
    ).toEqual({ layout: "vertical" });
  });

  it("nawigacja: bez danych pokazuje menu „primary” w układzie poziomym", () => {
    renderEditor(NavigationBlock, blok("navigation", {}));
    expect(pole(nl("menuKeyPh")).value).toBe("primary");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("horizontal");
  });

  it("link do wpisu: kierunek i tytuł zapisują własne klucze", () => {
    const start = blok("post-navigation-link", { direction: "next" });
    expect(
      zapisPo(PostNavigationLinkBlock, start, () =>
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "prev" } }),
      ),
    ).toEqual({ direction: "prev" });
    expect(
      zapisPo(PostNavigationLinkBlock, start, () => fireEvent.click(przelacznik(nl("showTitle")))),
    ).toEqual({ direction: "next", showTitle: false });
  });

  it("zapisane ustawienia niedomyślne wracają do kontrolek po ponownym otwarciu", () => {
    // Odczyt zawęża wartości do zbioru opcji - ten test pilnuje, żeby
    // zawężenie nie połknęło też PRAWIDŁOWEJ wartości niedomyślnej.
    const nawigacja = renderEditor(
      NavigationBlock,
      blok("navigation", { menuKey: "footer", layout: "vertical" }),
    );
    expect(pole(nl("menuKeyPh")).value).toBe("footer");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("vertical");
    nawigacja.unmount();

    renderEditor(
      PostNavigationLinkBlock,
      blok("post-navigation-link", { direction: "prev", showTitle: false }),
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("prev");
    expect((przelacznik(nl("showTitle")) as HTMLInputElement).checked).toBe(false);
  });

  it("kierunek SPOZA {prev, next} czyta się jak „Następny” - tak jak na stronie", () => {
    // `renderPostNavigationLink` zamienia wszystko poza „prev" na „next".
    // Natywna lista z wartością spoza opcji pokazywała PIERWSZĄ opcję,
    // czyli „Poprzedni" - dokładnie odwrotność tego, co widzi czytelnik.
    renderEditor(PostNavigationLinkBlock, blok("post-navigation-link", { direction: "forward" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("next");
  });
});

describe("pętla zapytań", () => {
  const liczba = () => screen.getByRole("spinbutton") as HTMLInputElement;

  it("bez danych pokazuje domyślne renderera: 6 wpisów, siatka, data, wszystko widoczne", () => {
    renderEditor(QueryLoopBlock, blok("query-loop", {}));
    expect(liczba().value).toBe("6");
    const [uklad, kolejnosc] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(uklad.value).toBe("grid");
    expect(kolejnosc.value).toBe("date");
    for (const nazwa of [nl("showImage"), nl("showExcerpt")]) {
      expect((przelacznik(nazwa) as HTMLInputElement).checked).toBe(true);
    }
  });

  it.each([
    [nl("showImage"), "showImage"],
    [nl("showExcerpt"), "showExcerpt"],
  ])("przełącznik „%s” zapisuje WYŁĄCZENIE pod `%s`", (nazwa, klucz) => {
    const zapis = zapisPo(QueryLoopBlock, blok("query-loop", { limit: 3 }), () =>
      fireEvent.click(przelacznik(nazwa)),
    );
    expect(zapis).toEqual({ limit: 3, [klucz]: false });
  });

  it("przełącznik daty zapisuje `showDate: false`", () => {
    // Etykieta „Data" jest też opcją kolejności - przełącznik wybieramy po roli.
    const zapis = zapisPo(QueryLoopBlock, blok("query-loop", {}), () =>
      fireEvent.click(screen.getByRole("checkbox", { name: nl("showDate") })),
    );
    expect(zapis).toEqual({ showDate: false });
  });

  it("kategoria, układ i kolejność zapisują własne klucze", () => {
    const start = blok("query-loop", { limit: 4 });
    expect(
      zapisPo(QueryLoopBlock, start, () =>
        fireEvent.change(pole(nl("categoryPh")), { target: { value: "analizy" } }),
      ),
    ).toEqual({ limit: 4, categorySlug: "analizy" });
    expect(
      zapisPo(QueryLoopBlock, start, () =>
        fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "list" } }),
      ),
    ).toEqual({ limit: 4, layout: "list" });
    expect(
      zapisPo(QueryLoopBlock, start, () =>
        fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "title" } }),
      ),
    ).toEqual({ limit: 4, orderBy: "title" });
  });

  it("liczba wpisów zapisuje LICZBĘ, a puste pole wraca do 6", () => {
    const start = blok("query-loop", {});
    expect(
      zapisPo(QueryLoopBlock, start, () => fireEvent.change(liczba(), { target: { value: "9" } })),
    ).toEqual({ limit: 9 });
    expect(
      zapisPo(QueryLoopBlock, start, () => fireEvent.change(liczba(), { target: { value: "" } })),
    ).toEqual({ limit: 6 });
  });

  it("liczba z importu poza [1, 24] pokazuje to, co pobierze zapytanie", () => {
    // `queryLoopBlockQueryOptions` robi `.limit(Math.max(1, Math.min(24, …)))`.
    renderEditor(QueryLoopBlock, blok("query-loop", { limit: 1e9 }));
    expect(liczba().value).toBe("24");
  });

  it("wpis powyżej 24 zapisuje 24, a liczba-słowo z importu pokazuje domyślne 6", () => {
    expect(
      zapisPo(QueryLoopBlock, blok("query-loop", {}), () =>
        fireEvent.change(liczba(), { target: { value: "100" } }),
      ),
    ).toEqual({ limit: 24 });
    renderEditor(QueryLoopBlock, blok("query-loop", { limit: "dużo" }));
    expect(liczba().value).toBe("6");
  });

  it("zapisana lista, kolejność alfabetyczna i wyłączenia wracają do kontrolek", () => {
    renderEditor(
      QueryLoopBlock,
      blok("query-loop", {
        categorySlug: "analizy",
        limit: 12,
        layout: "list",
        orderBy: "title",
        showImage: false,
        showExcerpt: false,
        showDate: false,
      }),
    );
    expect(pole(nl("categoryPh")).value).toBe("analizy");
    expect(liczba().value).toBe("12");
    const [uklad, kolejnosc] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(uklad.value).toBe("list");
    expect(kolejnosc.value).toBe("title");
    for (const nazwa of [nl("showImage"), nl("showExcerpt"), nl("showDate")]) {
      expect((przelacznik(nazwa) as HTMLInputElement).checked, nazwa).toBe(false);
    }
  });

  it("układ i kolejność spoza listy czytają się jak siatka i data - tak jak w rendererze", () => {
    renderEditor(QueryLoopBlock, blok("query-loop", { layout: "masonry", orderBy: "views" }));
    const [uklad, kolejnosc] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(uklad.value).toBe("grid");
    expect(kolejnosc.value).toBe("date");
  });

  it("kategoria w kształcie OBIEKTU nie wpisuje „[object Object]”", () => {
    renderEditor(QueryLoopBlock, blok("query-loop", { categorySlug: { slug: "analizy" } }));
    expect(pole(nl("categoryPh")).value).toBe("");
  });
});

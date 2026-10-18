// EDYTORY BLOKÓW KONTEKSTU WPISU I WITRYNY (`post-*`, `site-*`) - CO REDAKTOR
// WIDZI I CO TRAFIA DO DOKUMENTU.
//
// PO CO TEN PLIK. Dziewięć edytorów z `ContextBlocks.tsx` nie ma treści -
// ich jedynym zadaniem jest ustawić, JAK publiczny renderer narysuje dane
// bieżącego wpisu (poziom nagłówka, format daty, proporcje obrazu). Panel
// jest więc wiarygodny tylko wtedy, gdy pokazuje TĘ SAMĄ wartość, której
// użyje renderer (`components/blocks/renderer/organisms.tsx`), a każde
// kliknięcie zapisuje dokładnie swój klucz.
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * każdy edytor podpisuje się swoją etykietą i pokazuje domyślne wartości
//    renderera na pustych danych, nie zapisując niczego na samym renderze,
//  * każda kontrolka zapisuje WŁASNY klucz, w typie, którego oczekuje
//    renderer (poziom jako LICZBA, przełącznik jako `boolean`), a `id`,
//    `type` i reszta danych bloku przechodzą bez zmian,
//  * przełącznik „domyślnie wyłączony" czyta wyłącznie prawdziwe `true` -
//    renderer (`bool(data, k, false)`) traktuje napis „false" i liczbę 1 jako
//    BRAK ustawienia, więc panel nie może pokazać ich jako włączonych,
//  * poziom tytułu wpisu i szerokość logo pokazują wartość PO przycięciu,
//    które robi strona (`PostTitleView` 1-4, `SiteLogoView` 32-480), a nie
//    surową liczbę z importu,
//  * slogan witryny jest WYŁĄCZNIE podglądem - nie ma czego edytować.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli (import PIERWSZY):
// `sonner`, Radix `Select`/`Switch`, `<Link>` routera, klient Supabase,
// kontekst najemcy, `fetch`. i18n PRAWDZIWE (`realT`) - zniknięcie klucza
// ze słownika oblewa test zamiast przechodzić na echu nazwy klucza.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor, type BlockEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import {
  PostAuthorBlock,
  PostDateBlock,
  PostExcerptBlock,
  PostFeaturedImageBlock,
  PostTermsBlock,
  PostTitleBlock,
  SiteLogoBlock,
  SiteTaglineBlock,
  SiteTitleBlock,
} from "../ContextBlocks";

const t = realT("pl");
const cb = (key: string) => t(`blocks.editors.contextBlocks.${key}`) as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `ctx-${type}`, type, data };
}

function ostatniZapis(changes: Block[], start: Block): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  const zapis = changes[changes.length - 1];
  expect(zapis.id).toBe(start.id);
  expect(zapis.type).toBe(start.type);
  return zapis;
}

/** Montaż + jedna akcja + ostatni zapis - dla kontraktów „ta kontrolka, ten klucz". */
function zapisPo(Editor: BlockEditor, start: Block, akcja: () => void): Record<string, Json> {
  const { changes } = renderEditor(Editor, start);
  akcja();
  return ostatniZapis(changes, start).data;
}

const wybor = () => screen.getByRole("combobox") as HTMLSelectElement;
const opcje = () => Array.from(wybor().options, (o) => o.textContent);
const przelacznik = (nazwa: string) => screen.getByRole("checkbox", { name: nazwa });

describe("blok świeżo wstawiony z palety", () => {
  it.each<[string, BlockEditor, BlockType, string]>([
    ["PostTitleBlock", PostTitleBlock, "post-title", "postTitle"],
    ["PostDateBlock", PostDateBlock, "post-date", "postDate"],
    ["PostAuthorBlock", PostAuthorBlock, "post-author", "postAuthor"],
    ["PostExcerptBlock", PostExcerptBlock, "post-excerpt", "postExcerpt"],
    ["PostFeaturedImageBlock", PostFeaturedImageBlock, "post-featured-image", "postFeaturedImage"],
    ["PostTermsBlock", PostTermsBlock, "post-terms", "postTerms"],
    ["SiteTitleBlock", SiteTitleBlock, "site-title", "siteTitle"],
    ["SiteTaglineBlock", SiteTaglineBlock, "site-tagline", "siteTagline"],
    ["SiteLogoBlock", SiteLogoBlock, "site-logo", "siteLogo"],
  ])("%s podpisuje się swoją etykietą i nie zapisuje na renderze", (_n, Editor, type, klucz) => {
    const { changes } = renderEditor(Editor, blok(type, {}));
    expect(screen.getByText(cb(klucz))).toBeTruthy();
    expect(changes).toEqual([]);
  });

  it("domyślne wartości są te same, których użyje renderer publiczny", () => {
    // `renderPostTitle` -> 1, `renderPostDate` -> "long" bez aktualizacji,
    // `renderPostFeaturedImage` -> "16/9" zaokrąglony, `renderSiteLogo` -> 120.
    const tytul = renderEditor(PostTitleBlock, blok("post-title", {}));
    expect(wybor().value).toBe("1");
    tytul.unmount();

    const data = renderEditor(PostDateBlock, blok("post-date", {}));
    expect(wybor().value).toBe("long");
    expect((przelacznik(cb("updated")) as HTMLInputElement).checked).toBe(false);
    data.unmount();

    const obraz = renderEditor(PostFeaturedImageBlock, blok("post-featured-image", {}));
    expect(wybor().value).toBe("16/9");
    expect((przelacznik(cb("rounded")) as HTMLInputElement).checked).toBe(true);
    obraz.unmount();

    renderEditor(SiteLogoBlock, blok("site-logo", {}));
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("120");
  });

  it("slogan witryny to SAM podgląd - bez żadnego pola do edycji", () => {
    // Treść sloganu pochodzi z ustawień witryny; drugie pole w bloku byłoby
    // drugim źródłem prawdy dla tej samej wartości.
    const { container } = renderEditor(SiteTaglineBlock, blok("site-tagline", {}));
    expect(container.querySelectorAll("input, select, textarea, button")).toHaveLength(0);
  });
});

describe("poziom nagłówka - tytuł wpisu i tytuł witryny", () => {
  it("tytuł wpisu oferuje H1-H4 i zapisuje poziom jako LICZBĘ", () => {
    const start = blok("post-title", { level: 1, notatka: "z importu" });
    const zapis = zapisPo(PostTitleBlock, start, () =>
      fireEvent.change(wybor(), { target: { value: "3" } }),
    );
    expect(opcje()).toEqual(["H1", "H2", "H3", "H4"]);
    expect(zapis).toEqual({ level: 3, notatka: "z importu" });
  });

  it("poziom tytułu wpisu POWYŻEJ 4 pokazuje H4 - tak go narysuje strona", () => {
    // `PostTitleView` przycina poziom do [1, 4]. Natywna lista z wartością
    // spoza opcji pokazuje PIERWSZĄ opcję - panel mówił „H1", a strona
    // renderowała `<h4>`.
    renderEditor(PostTitleBlock, blok("post-title", { level: 6 }));
    expect(wybor().value).toBe("4");
  });

  it("poziom zapisany jako napis „h2” (import WordPressa) czyta się jak domyślne H1", () => {
    // Renderer (`num`) nie umie przeczytać „h2" i bierze domyślne 1 - panel
    // ma pokazać to samo, a nie `NaN`.
    renderEditor(PostTitleBlock, blok("post-title", { level: "h2" }));
    expect(wybor().value).toBe("1");
  });

  it("tytuł witryny oferuje H1-H3 i zapisuje poziom jako LICZBĘ", () => {
    const start = blok("site-title", {});
    const zapis = zapisPo(SiteTitleBlock, start, () =>
      fireEvent.change(wybor(), { target: { value: "2" } }),
    );
    expect(opcje()).toEqual(["H1", "H2", "H3"]);
    expect(zapis).toEqual({ level: 2 });
  });
});

describe("data wpisu", () => {
  it("format zapisuje się pod `format`, a etykiety opcji pochodzą ze słownika", () => {
    const start = blok("post-date", { showUpdated: true });
    const zapis = zapisPo(PostDateBlock, start, () =>
      fireEvent.change(wybor(), { target: { value: "relative" } }),
    );
    expect(opcje()).toEqual([cb("dateLong"), cb("dateShort"), cb("dateRelative")]);
    expect(zapis).toEqual({ showUpdated: true, format: "relative" });
  });

  it("włączenie „Aktualizacja” zapisuje `showUpdated: true`", () => {
    const zapis = zapisPo(PostDateBlock, blok("post-date", {}), () =>
      fireEvent.click(przelacznik(cb("updated"))),
    );
    expect(zapis).toEqual({ showUpdated: true });
  });

  it.each<[string, Json]>([
    ["napis „false”", "false"],
    ["liczba 1", 1],
  ])("%s NIE jest pokazany jako włączony, bo renderer go nie uzna", (_opis, wartosc) => {
    // `renderPostDate` czyta `bool(data, "showUpdated", false)` - wszystko
    // poza prawdziwym `true` to „nie ustawiono". Panel z `Boolean(x)`
    // pokazywał zaznaczenie, którego strona nie stosuje.
    renderEditor(PostDateBlock, blok("post-date", { showUpdated: wartosc }));
    expect((przelacznik(cb("updated")) as HTMLInputElement).checked).toBe(false);
  });
});

describe("autor i zajawka wpisu", () => {
  it("awatar jest domyślnie włączony i zapisuje WYŁĄCZENIE", () => {
    const zapis = zapisPo(PostAuthorBlock, blok("post-author", {}), () =>
      fireEvent.click(przelacznik(cb("avatar"))),
    );
    expect(zapis).toEqual({ showAvatar: false });
  });

  it("bio jest domyślnie wyłączone i zapisuje WŁĄCZENIE", () => {
    const zapis = zapisPo(PostAuthorBlock, blok("post-author", { showAvatar: false }), () =>
      fireEvent.click(przelacznik(cb("bio"))),
    );
    expect(zapis).toEqual({ showAvatar: false, showBio: true });
  });

  it("bio zapisane jako napis „tak” NIE jest pokazane jako włączone", () => {
    renderEditor(PostAuthorBlock, blok("post-author", { showBio: "tak" }));
    expect((przelacznik(cb("bio")) as HTMLInputElement).checked).toBe(false);
  });

  it("„Czytaj dalej” w zajawce zapisuje `showMore: true`", () => {
    const zapis = zapisPo(PostExcerptBlock, blok("post-excerpt", { showMore: false }), () =>
      fireEvent.click(przelacznik(cb("readMore"))),
    );
    expect(zapis).toEqual({ showMore: true });
  });

  it("„Czytaj dalej” zapisane jako napis „0” NIE jest pokazane jako włączone", () => {
    renderEditor(PostExcerptBlock, blok("post-excerpt", { showMore: "0" }));
    expect((przelacznik(cb("readMore")) as HTMLInputElement).checked).toBe(false);
  });
});

describe("obraz wyróżniony i taksonomie", () => {
  it("proporcje zapisują się pod `aspect`, zaokrąglenie - jako WYŁĄCZENIE", () => {
    const start = blok("post-featured-image", {});
    expect(
      zapisPo(PostFeaturedImageBlock, start, () =>
        fireEvent.change(wybor(), { target: { value: "1/1" } }),
      ),
    ).toEqual({ aspect: "1/1" });
    expect(opcje()).toEqual(["16:9", "4:3", "1:1", "3:2"]);
  });

  it("odznaczenie „Zaokrąglony” zapisuje `rounded: false`", () => {
    const zapis = zapisPo(PostFeaturedImageBlock, blok("post-featured-image", {}), () =>
      fireEvent.click(przelacznik(cb("rounded"))),
    );
    expect(zapis).toEqual({ rounded: false });
  });

  it("taksonomia przełącza się z kategorii na tagi", () => {
    const start = blok("post-terms", {});
    const { changes } = renderEditor(PostTermsBlock, start);
    expect(wybor().value).toBe("categories");
    expect(opcje()).toEqual([cb("categories"), cb("tags")]);
    fireEvent.change(wybor(), { target: { value: "tags" } });
    expect(ostatniZapis(changes, start).data).toEqual({ taxonomy: "tags" });
  });

  it("taksonomia spoza listy czyta się jak kategorie - tak jak w rendererze", () => {
    renderEditor(PostTermsBlock, blok("post-terms", { taxonomy: "autorzy" }));
    expect(wybor().value).toBe("categories");
  });
});

describe("logo witryny - szerokość w granicach, które narysuje strona", () => {
  const pole = () => screen.getByRole("spinbutton") as HTMLInputElement;

  it("wpisana szerokość zapisuje się jako LICZBA", () => {
    const zapis = zapisPo(SiteLogoBlock, blok("site-logo", { width: 120 }), () =>
      fireEvent.change(pole(), { target: { value: "200" } }),
    );
    expect(zapis).toEqual({ width: 200 });
  });

  it("wyczyszczenie pola wraca do domyślnych 120 px, a nie zapisuje zera", () => {
    const zapis = zapisPo(SiteLogoBlock, blok("site-logo", { width: 300 }), () =>
      fireEvent.change(pole(), { target: { value: "" } }),
    );
    expect(zapis).toEqual({ width: 120 });
  });

  it("szerokość z importu POWYŻEJ 480 pokazuje 480 - tyle narysuje `SiteLogoView`", () => {
    renderEditor(SiteLogoBlock, blok("site-logo", { width: 1e9 }));
    expect(pole().value).toBe(pole().max);
  });

  it("wpis POWYŻEJ limitu zapisuje limit pola, a nie wpisaną liczbę", () => {
    const zapis = zapisPo(SiteLogoBlock, blok("site-logo", {}), () =>
      fireEvent.change(pole(), { target: { value: "5000" } }),
    );
    expect(zapis).toEqual({ width: 480 });
  });

  it("szerokość zapisana jako słowo pokazuje domyślne 120, a nie puste pole", () => {
    // Renderer czyta „szeroko" jako brak i rysuje 120 px. Panel dawał `NaN`
    // do atrybutu `value` - przeglądarka pokazywała puste pole.
    renderEditor(SiteLogoBlock, blok("site-logo", { width: "szeroko" }));
    expect(pole().value).toBe("120");
  });

  it("liczba PONIŻEJ minimum w trakcie pisania przechodzi bez przeskoku", () => {
    // „2" to stan przejściowy w drodze do „250". Klamra dolna na każdym
    // znaku zamieniałaby go na 32 i wpisanie trzycyfrowej szerokości z
    // klawiatury stawałoby się niemożliwe - stronę i tak domyka `SiteLogoView`.
    const zapis = zapisPo(SiteLogoBlock, blok("site-logo", {}), () =>
      fireEvent.change(pole(), { target: { value: "2" } }),
    );
    expect(zapis).toEqual({ width: 2 });
  });
});

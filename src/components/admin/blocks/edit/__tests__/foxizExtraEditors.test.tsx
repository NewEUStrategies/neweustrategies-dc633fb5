// EDYTORY BLOKÓW FOXIZ (`post-stats`, `post-rating`, `loginout`, `more-posts`)
// - ZAPIS I ZGODNOŚĆ Z RENDEREREM PUBLICZNYM.
//
// PO CO TEN PLIK. Cztery edytory z `FoxizExtraBlocks.tsx` ustawiają pasek
// meta wpisu, ocenę czytelnika, link logowania i pasek polecanych wpisów.
// Każdy z nich ma odpowiednik w `components/blocks/FoxizExtraViews.tsx`
// i czytnik w `renderer/organisms.tsx` - panel jest wiarygodny, gdy pokazuje
// to, co te warstwy narysują, a każde kliknięcie zapisuje swój klucz.
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * każdy edytor zapisuje WŁASNY klucz, w typie oczekiwanym przez renderer,
//    a `id`, `type` i reszta danych przechodzą bez zmian,
//  * pasek meta nigdy nie zostaje PUSTY: `PostStatsView` czyta pustą listę
//    jako „data, autor, czas czytania", więc odznaczenie ostatniej pozycji
//    dawało w panelu pusty pasek, a na stronie trzy pozycje; pozycje są
//    przyciskami-przełącznikami z ogłaszanym stanem (`aria-pressed`),
//  * napisy w złym kształcie (obiekt z migracji) nie wchodzą do pól jako
//    „[object Object]", a liczba polecanych wpisów pokazuje i zapisuje
//    wartość PO przycięciu do 12, które robi `MorePostsView`.
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
  LoginOutBlock,
  MorePostsBlock,
  PostRatingBlock,
  PostStatsBlock,
} from "../FoxizExtraBlocks";

const t = realT("pl");
const fx = (key: string) => t(`blocks.editors.foxizExtra.${key}`) as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `fx-${type}`, type, data };
}

/** Montaż, akcja, odmontowanie i ostatni zapis - z kontrolą `id` i `type`. */
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

describe("pasek meta wpisu", () => {
  const pozycja = (nazwa: string) => screen.getByRole("button", { name: nazwa });
  const aktywne = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);

  it("bez danych aktywne są pozycje domyślne renderera, a reszta jest ogłoszona jako wyłączona", () => {
    const { changes } = renderEditor(PostStatsBlock, blok("post-stats", {}));
    expect(aktywne()).toEqual(["date", "author", "reading"]);
    expect(pozycja("views").getAttribute("aria-pressed")).toBe("false");
    expect(pole(fx("separatorPh")).value).toBe("•");
    expect(changes).toEqual([]);
  });

  it("włączenie pozycji dopisuje ją NA KONIEC, wyłączenie usuwa właśnie ją", () => {
    const start = blok("post-stats", { items: ["date", "views"] });
    expect(zapisPo(PostStatsBlock, start, () => fireEvent.click(pozycja("comments")))).toEqual({
      items: ["date", "views", "comments"],
    });
    expect(zapisPo(PostStatsBlock, start, () => fireEvent.click(pozycja("date")))).toEqual({
      items: ["views"],
    });
  });

  it("wyłączenie OSTATNIEJ pozycji nie zapisuje pustej listy", () => {
    const { changes } = renderEditor(PostStatsBlock, blok("post-stats", { items: ["views"] }));
    fireEvent.click(pozycja("views"));
    expect(changes).toEqual([]);
    expect(aktywne()).toEqual(["views"]);
  });

  it("zapisana PUSTA lista i lista nie-napisów są pokazane jak na stronie", () => {
    const pusta = renderEditor(PostStatsBlock, blok("post-stats", { items: [] }));
    expect(aktywne()).toEqual(["date", "author", "reading"]);
    pusta.unmount();
    renderEditor(PostStatsBlock, blok("post-stats", { items: [{ id: "date" }, "views"] as Json }));
    expect(aktywne()).toEqual(["views"]);
  });

  it("separator zapisuje się pod `separator`, a separator-obiekt pokazuje „•”", () => {
    expect(
      zapisPo(PostStatsBlock, blok("post-stats", {}), () =>
        fireEvent.change(pole(fx("separatorPh")), { target: { value: "|" } }),
      ),
    ).toEqual({ separator: "|" });
    renderEditor(PostStatsBlock, blok("post-stats", { separator: { pl: "|" } }));
    expect(pole(fx("separatorPh")).value).toBe("•");
  });
});

describe("ocena czytelnika", () => {
  it("skala zapisuje się jako LICZBA, a etykieta pod `label`", () => {
    const start = blok("post-rating", { max: 5, label: "" });
    expect(
      zapisPo(PostRatingBlock, start, () => {
        const skala = screen.getByRole("combobox") as HTMLSelectElement;
        expect(Array.from(skala.options, (o) => o.text)).toEqual([fx("stars5"), fx("stars10")]);
        fireEvent.change(skala, { target: { value: "10" } });
      }),
    ).toEqual({ max: 10, label: "" });
    expect(
      zapisPo(PostRatingBlock, start, () =>
        fireEvent.change(pole(fx("labelPh")), { target: { value: "Oceń analizę" } }),
      ),
    ).toEqual({ max: 5, label: "Oceń analizę" });
  });

  it("etykieta-obiekt nie wpisuje „[object Object]”", () => {
    renderEditor(PostRatingBlock, blok("post-rating", { label: { pl: "Oceń" } }));
    expect(pole(fx("labelPh")).value).toBe("");
  });
});

describe("zaloguj / wyloguj", () => {
  it("bez danych link logowania to `/auth`, a awatar jest włączony", () => {
    renderEditor(LoginOutBlock, blok("loginout", {}));
    expect(pole(fx("loginHrefPh")).value).toBe("/auth");
    expect(
      (screen.getByRole("checkbox", { name: fx("showAvatar") }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("link i awatar zapisują własne klucze", () => {
    const start = blok("loginout", {});
    expect(
      zapisPo(LoginOutBlock, start, () =>
        fireEvent.change(pole(fx("loginHrefPh")), { target: { value: "/logowanie" } }),
      ),
    ).toEqual({ loginHref: "/logowanie" });
    expect(
      zapisPo(LoginOutBlock, start, () =>
        fireEvent.click(screen.getByRole("checkbox", { name: fx("showAvatar") })),
      ),
    ).toEqual({ showAvatar: false });
  });

  it("link-obiekt z importu pokazuje domyślny `/auth`", () => {
    renderEditor(LoginOutBlock, blok("loginout", { loginHref: { href: "/x" } }));
    expect(pole(fx("loginHrefPh")).value).toBe("/auth");
  });
});

describe("polecane wpisy", () => {
  const liczba = () => screen.getByRole("spinbutton") as HTMLInputElement;

  it("bez danych: 4 wpisy, strategia „najnowsze”, pusty nagłówek", () => {
    renderEditor(MorePostsBlock, blok("more-posts", {}));
    expect(liczba().value).toBe("4");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("latest");
    expect(pole(fx("headingPh")).value).toBe("");
  });

  it("liczba, strategia i nagłówek zapisują własne klucze", () => {
    const start = blok("more-posts", { heading: "Czytaj też" });
    expect(
      zapisPo(MorePostsBlock, start, () => fireEvent.change(liczba(), { target: { value: "8" } })),
    ).toEqual({ heading: "Czytaj też", limit: 8 });
    expect(
      zapisPo(MorePostsBlock, start, () =>
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "trending" } }),
      ),
    ).toEqual({ heading: "Czytaj też", strategy: "trending" });
    expect(
      zapisPo(MorePostsBlock, start, () =>
        fireEvent.change(pole(fx("headingPh")), { target: { value: "Polecamy" } }),
      ),
    ).toEqual({ heading: "Polecamy" });
  });

  it("wyczyszczenie liczby wraca do 4, a wpis powyżej 12 zapisuje 12", () => {
    const start = blok("more-posts", {});
    expect(
      zapisPo(MorePostsBlock, start, () => fireEvent.change(liczba(), { target: { value: "" } })),
    ).toEqual({ limit: 4 });
    expect(
      zapisPo(MorePostsBlock, start, () => fireEvent.change(liczba(), { target: { value: "50" } })),
    ).toEqual({ limit: 12 });
  });

  it("liczba z importu powyżej 12 pokazuje 12 - tyle pokaże `MorePostsView`", () => {
    renderEditor(MorePostsBlock, blok("more-posts", { limit: 1e9 }));
    expect(liczba().value).toBe("12");
  });

  it("liczba-słowo pokazuje domyślne 4, a nagłówek-obiekt - puste pole", () => {
    renderEditor(MorePostsBlock, blok("more-posts", { limit: "dużo", heading: { pl: "X" } }));
    expect(liczba().value).toBe("4");
    expect(pole(fx("headingPh")).value).toBe("");
  });

  it("strategia spoza listy czyta się jak „najnowsze” - tak jak w rendererze", () => {
    renderEditor(MorePostsBlock, blok("more-posts", { strategy: "losowe" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("latest");
  });
});

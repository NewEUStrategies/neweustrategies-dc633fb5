// INSERTER BLOKOW - paleta wstawiania (odpowiednik szybkiego insertera WP).
//
// CO MA TU DOWOD
//   * trzy tryby otwarcia (`fab` dla pustego dokumentu, `inline` miedzy blokami,
//     `controlled` dla menu slash) i to, ktory z nich cokolwiek renderuje przy
//     zamknietej palecie,
//   * dwustopniowosc palety: najpierw szesc najczesciej uzywanych typow +
//     "Przegladaj wszystko", potem pelna biblioteka pogrupowana kategoriami,
//   * PELNA NAWIGACJA KLAWIATURA po siatce wynikow. To nie ozdoba: paleta jest
//     `combobox` + `listbox` z `aria-activedescendant`, wiec bledna arytmetyka
//     strzalek (siatka ma STALE 3 kolumny) wstawia INNY blok, niz redaktor
//     widzi podswietlony. Sprawdzamy strzalki w obu osiach, Home/End,
//     przyciecie indeksu do konca listy i Enter,
//   * zakladka Wzorcow pojawia sie WYLACZNIE wtedy, gdy wolajacy potrafi przyjac
//     wiele blokow (`onInsertBlocks`) - inaczej klik we wzorzec wstawilby jeden
//     blok z kompozycji i reszta by przepadla,
//   * jezyk TRESCI wzorca idzie z `BlockEditorContext` (jezyk dokumentu), a nie
//     z jezyka interfejsu - to dwie rozne rzeczy i mieszanie ich daje polskie
//     akapity w wersji angielskiej wpisu.
//
// CZEGO TU NIE MA
//   * atrap warstw wlasnych - inserter dostaje prawdziwy rejestr blokow
//     (`lib/blocks/registry`), prawdziwe wyszukiwanie (`lib/blocks/search`)
//     i prawdziwe wzorce (`lib/blocks/patterns`). Nie ma tu ani jednego
//     `vi.mock`,
//   * asercji na tresc samych wzorcow - to jest domena `lib/blocks/patterns`.
//     Tutaj dowodzimy, ze inserter poda wzorcowi WLASCIWY jezyk i przekaze
//     CALA kompozycje.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import { BlockInserter } from "../BlockInserter";
import { BlockEditorProvider } from "../BlockEditorContext";
import { realT } from "@/test/i18nReal";

const t = realT("pl");

interface Opcje {
  variant?: "inline" | "fab" | "controlled";
  open?: boolean;
  wzorce?: boolean;
  lang?: "pl" | "en";
}

function zamontuj(opts: Opcje = {}) {
  const onInsert = vi.fn<(b: Block) => void>();
  const onInsertBlocks = vi.fn<(b: Block[]) => void>();
  const onOpenChange = vi.fn<(v: boolean) => void>();
  const view = render(
    <BlockEditorProvider lang={opts.lang ?? "pl"}>
      <BlockInserter
        variant={opts.variant ?? "inline"}
        open={opts.open}
        onOpenChange={onOpenChange}
        onInsert={onInsert}
        onInsertBlocks={opts.wzorce === false ? undefined : onInsertBlocks}
      />
    </BlockEditorProvider>,
  );
  return { onInsert, onInsertBlocks, onOpenChange, view };
}

function pole(): HTMLElement {
  return screen.getByRole("combobox");
}

/** Aktywna pozycja siatki - ta, ktora wskazuje `aria-activedescendant`. */
function aktywna(): HTMLElement {
  const id = pole().getAttribute("aria-activedescendant");
  const el = id ? document.getElementById(id) : null;
  if (!el) throw new Error("paleta nie wskazuje aktywnej pozycji");
  return el;
}

describe("BlockInserter - tryby otwarcia", () => {
  it("wariant fab przy zamkniętej palecie zachęca do pierwszego bloku", () => {
    zamontuj({ variant: "fab", open: false });
    expect(screen.getByRole("button", { name: t("blocks.firstBlock") })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("wariant inline przy zamkniętej palecie daje tylko przycisk dodania bloku", () => {
    zamontuj({ variant: "inline", open: false });
    expect(screen.getByRole("button", { name: t("blocks.addBlock") })).toBeInTheDocument();
  });

  it("wariant controlled przy zamkniętej palecie nie renderuje NICZEGO", () => {
    const { view } = zamontuj({ variant: "controlled", open: false });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("klik w przycisk dodania zgłasza otwarcie wołającemu", () => {
    const { onOpenChange } = zamontuj({ variant: "inline", open: false });
    fireEvent.click(screen.getByRole("button", { name: t("blocks.addBlock") }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("Escape w wyszukiwarce zamyka paletę", () => {
    const { onOpenChange } = zamontuj({ open: true });
    fireEvent.keyDown(pole(), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("przycisk zamknięcia zamyka paletę", () => {
    const { onOpenChange } = zamontuj({ open: true });
    fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.close") }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("BlockInserter - paleta dwustopniowa", () => {
  it("szybki panel pokazuje DOKŁADNIE sześć najczęściej używanych typów", () => {
    zamontuj({ open: true });
    const lista = screen.getByRole("listbox");
    expect(within(lista).getAllByRole("option")).toHaveLength(6);
    expect(
      within(lista).getByRole("option", { name: t("blocks.types.paragraph") }),
    ).toBeInTheDocument();
  });

  it("przycisk pełnej biblioteki rozwija pełną bibliotekę z nagłówkami kategorii", () => {
    zamontuj({ open: true });
    fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
    const lista = screen.getByRole("listbox");
    expect(within(lista).getAllByRole("option").length).toBeGreaterThan(6);
    expect(screen.getByText(t("blocks.categories.layout"))).toBeInTheDocument();
    expect(screen.getByText(t("blocks.categories.media"))).toBeInTheDocument();
  });

  it("zapytanie zawęża wyniki i chowa przycisk pełnej biblioteki", () => {
    zamontuj({ open: true });
    fireEvent.change(pole(), { target: { value: "cytat" } });
    const opcje = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(opcje.length).toBeGreaterThan(0);
    expect(opcje.length).toBeLessThan(6);
    expect(screen.queryByRole("button", { name: t("blocks.inserter.browseAll") })).toBeNull();
  });

  it("zapytanie bez trafień pokazuje komunikat o braku wyników", () => {
    zamontuj({ open: true });
    fireEvent.change(pole(), { target: { value: "qwertyzzz" } });
    expect(screen.getByText(t("blocks.noResults"))).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("klik w pozycję wstawia blok TEGO typu i zamyka paletę", () => {
    const { onInsert, onOpenChange } = zamontuj({ open: true });
    fireEvent.click(screen.getByRole("option", { name: t("blocks.types.quote") }));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0].type).toBe("quote");
    expect(onInsert.mock.calls[0][0].id).toBeTruthy();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("BlockInserter - nawigacja klawiaturą po siatce", () => {
  it("pierwsza pozycja jest aktywna od otwarcia", () => {
    zamontuj({ open: true });
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.paragraph"));
    expect(aktywna()).toHaveAttribute("aria-selected", "true");
  });

  it("strzałka w prawo przechodzi o JEDNĄ pozycję", () => {
    zamontuj({ open: true });
    fireEvent.keyDown(pole(), { key: "ArrowRight" });
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.heading"));
  });

  it("strzałka w dół przechodzi o WIERSZ (siatka ma trzy kolumny)", () => {
    zamontuj({ open: true });
    fireEvent.keyDown(pole(), { key: "ArrowDown" });
    // paragraph, heading, image | list, quote, separator
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.list"));
  });

  it("strzałka w górę wraca o wiersz, a na pierwszym wierszu nie wychodzi z listy", () => {
    zamontuj({ open: true });
    fireEvent.keyDown(pole(), { key: "ArrowDown" });
    fireEvent.keyDown(pole(), { key: "ArrowUp" });
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.paragraph"));
    fireEvent.keyDown(pole(), { key: "ArrowUp" });
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.paragraph"));
  });

  it("strzałka w lewo na pierwszej pozycji nie wychodzi z listy", () => {
    zamontuj({ open: true });
    fireEvent.keyDown(pole(), { key: "ArrowLeft" });
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.paragraph"));
  });

  it("End skacze na koniec listy, Home wraca na początek", () => {
    zamontuj({ open: true });
    fireEvent.keyDown(pole(), { key: "End" });
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.separator"));
    fireEvent.keyDown(pole(), { key: "Home" });
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.paragraph"));
  });

  it("Enter wstawia blok WSKAZANY przez aria-activedescendant, nie pierwszy z listy", () => {
    const { onInsert } = zamontuj({ open: true });
    fireEvent.keyDown(pole(), { key: "ArrowRight" });
    fireEvent.keyDown(pole(), { key: "ArrowRight" });
    const wskazany = aktywna().textContent;
    fireEvent.keyDown(pole(), { key: "Enter" });
    expect(onInsert.mock.calls[0][0].type).toBe("image");
    expect(wskazany).toContain(t("blocks.types.image"));
  });

  it("skrócenie listy po zapytaniu PRZYCINA aktywny indeks do ostatniej pozycji", () => {
    // Bez przycięcia `aria-activedescendant` wskazywałby pozycję, której już
    // nie ma w drzewie - a Enter wstawiłby wtedy niewłaściwy blok albo nic.
    const { onInsert } = zamontuj({ open: true });
    fireEvent.keyDown(pole(), { key: "End" });
    fireEvent.change(pole(), { target: { value: "cytat" } });
    expect(aktywna()).toBeInTheDocument();
    fireEvent.keyDown(pole(), { key: "Enter" });
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("najechanie myszą przestawia aktywną pozycję (spójność z klawiaturą)", () => {
    zamontuj({ open: true });
    fireEvent.mouseEnter(screen.getByRole("option", { name: t("blocks.types.quote") }));
    expect(aktywna()).toHaveAccessibleName(t("blocks.types.quote"));
  });

  it("Enter przy pustej liście wyników nie wstawia niczego", () => {
    const { onInsert } = zamontuj({ open: true });
    fireEvent.change(pole(), { target: { value: "qwertyzzz" } });
    fireEvent.keyDown(pole(), { key: "Enter" });
    expect(onInsert).not.toHaveBeenCalled();
  });
});

describe("BlockInserter - zakladka Wzorcow", () => {
  function otworzWzorce(opts: Opcje = {}) {
    const wynik = zamontuj({ open: true, ...opts });
    fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
    fireEvent.click(screen.getByRole("tab", { name: t("blocks.inserter.tabPatterns") }));
    return wynik;
  }

  it("zakładki są ukryte, dopóki wołający nie przyjmuje WIELU bloków", () => {
    zamontuj({ open: true, wzorce: false });
    fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("zakładki pojawiają się w pełnej bibliotece, gdy wzorce są dostępne", () => {
    zamontuj({ open: true });
    fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("blocks.inserter.tabBlocks") })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("klik we wzorzec wstawia CAŁĄ kompozycję (więcej niż jeden blok)", () => {
    const { onInsertBlocks, onOpenChange } = otworzWzorce();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("blocks.patterns.items.key-takeaways.name")),
      }),
    );
    expect(onInsertBlocks).toHaveBeenCalledTimes(1);
    const bloki = onInsertBlocks.mock.calls[0][0];
    expect(bloki.length).toBeGreaterThan(1);
    expect(bloki.map((b) => b.type)).toContain("heading");
    // Każdy blok kompozycji ma WŁASNE, świeże id.
    expect(new Set(bloki.map((b) => b.id)).size).toBe(bloki.length);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Enter w wyszukiwarce na zakładce Wzorców wstawia PIERWSZY dopasowany wzorzec", () => {
    const { onInsertBlocks } = otworzWzorce();
    fireEvent.change(pole(), {
      target: { value: t("blocks.patterns.items.expert-quote.name") },
    });
    fireEvent.keyDown(pole(), { key: "Enter" });
    expect(onInsertBlocks).toHaveBeenCalledTimes(1);
    expect(onInsertBlocks.mock.calls[0][0][0].type).toBe("pullquote");
  });

  it("zapytanie bez trafień na zakładce Wzorców pokazuje brak wyników", () => {
    const { onInsertBlocks } = otworzWzorce();
    fireEvent.change(pole(), { target: { value: "qwertyzzz" } });
    expect(screen.getByText(t("blocks.noResults"))).toBeInTheDocument();
    fireEvent.keyDown(pole(), { key: "Enter" });
    expect(onInsertBlocks).not.toHaveBeenCalled();
  });

  it("treść wzorca idzie z języka DOKUMENTU: pl", () => {
    const { onInsertBlocks } = otworzWzorce({ lang: "pl" });
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("blocks.patterns.items.key-takeaways.name")),
      }),
    );
    const naglowek = onInsertBlocks.mock.calls[0][0][0];
    expect(naglowek.data.text).toBe("Kluczowe wnioski");
  });

  it("treść wzorca idzie z języka DOKUMENTU: en (interfejs zostaje polski)", () => {
    const { onInsertBlocks } = otworzWzorce({ lang: "en" });
    // Nazwa wzorca w palecie nadal polska - to jest język INTERFEJSU.
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("blocks.patterns.items.key-takeaways.name")),
      }),
    );
    const naglowek = onInsertBlocks.mock.calls[0][0][0];
    expect(naglowek.data.text).toBe("Key takeaways");
  });

  it("powrót na zakładkę Bloków przywraca listbox z pozycjami", () => {
    otworzWzorce();
    fireEvent.click(screen.getByRole("tab", { name: t("blocks.inserter.tabBlocks") }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(6);
  });
});

describe("BlockInserter - i18n PL/EN", () => {
  it("etykiety palety istnieją w OBU językach i są różne", () => {
    const pl = realT("pl");
    const en = realT("en");
    for (const klucz of [
      "blocks.firstBlock",
      "blocks.addBlock",
      "blocks.search",
      "blocks.noResults",
      "blocks.inserter.browseAll",
      "blocks.inserter.tabBlocks",
      "blocks.inserter.tabPatterns",
      "blocks.inserter.close",
      "blocks.inserter.resultsLabel",
      "blocks.inserter.tabsLabel",
    ]) {
      expect(pl(klucz)).not.toBe(klucz);
      expect(en(klucz)).not.toBe(klucz);
      expect(pl(klucz)).not.toBe(en(klucz));
    }
  });
});

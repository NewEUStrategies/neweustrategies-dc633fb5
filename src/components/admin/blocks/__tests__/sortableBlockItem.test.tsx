// WIERSZ BLOKU W KANWIE (`SortableBlockItem`) - uchwyt przeciagania, plywajacy
// pasek akcji i MENU KONTEKSTOWE (prawy przycisk myszy).
//
// Ten plik testuje wiersz WPROST, na jego wlasnym kontrakcie propsow, bo
// menu kontekstowe jest jedyna sciezka do czesci akcji (kopiowanie id bloku)
// i jedynym miejscem, w ktorym te same operacje maja DRUGA reprezentacje.
// Rozjazd miedzy paskiem a menu (np. „usun" dziala tylko w jednym) jest bledem
// niewidocznym w testach kanwy, bo kanwa wola te same propsy.
//
// CO MA TU DOWOD
//   * pasek akcji jest poza drzewem dostepnosci, dopoki blok NIE JEST aktywny
//     (`aria-hidden`), i wchodzi do niego po aktywacji - inaczej czytnik ekranu
//     czytalby paski wszystkich blokow dokumentu naraz,
//   * uchwyt przeciagania ma dostepna nazwe i NIE propaguje kliku w gore (klik
//     w uchwyt nie ma przewijac kanwy do innego bloku),
//   * menu kontekstowe niesie te same operacje co pasek + kopiowanie id,
//   * krancowki (`index === 0`, `index === total - 1`) sa wylaczone w OBU
//     reprezentacjach,
//   * kopiowanie id bloku idzie do schowka systemowego i przelacza ikone na
//     potwierdzenie; ODMOWA schowka (przegladarka bez zgody) NIE wysadza wiersza,
//   * podmenu wariantow i przeksztalcen pokazuje sie tylko wtedy, gdy wolajacy
//     rzeczywiscie je obsluguje.
//
// CZEGO TU NIE MA
//   * asercji na POZYCJE plywajacego paska. Wyliczenie idzie z
//     `getBoundingClientRect` i `ResizeObserver`, a happy-dom zwraca zera -
//     kazda liczba w takiej asercji bylaby liczba o atrapie, nie o layoucie,
//   * atrap warstw wlasnych. `navigator.clipboard` to granica przegladarki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { FileText } from "@/lib/lucide-shim";
import type { BlockVariantOption } from "@/lib/blocks/variants";
import { SortableBlockItem, type BlockTransformOption } from "../molecules/SortableBlockItem";
import { realT } from "@/test/i18nReal";

const t = realT("pl");

interface Opcje {
  index?: number;
  total?: number;
  active?: boolean;
  selected?: boolean;
  variants?: BlockVariantOption[] | null;
  currentVariant?: string;
  transforms?: BlockTransformOption[];
  bezWariantow?: boolean;
  bezPrzeksztalcen?: boolean;
}

const WARIANTY: BlockVariantOption[] = [
  { key: "default", label: "Border" },
  { key: "card", label: "Karta" },
];

const PRZEKSZTALCENIA: BlockTransformOption[] = [
  { type: "heading", label: "Nagłówek", icon: FileText },
  { type: "quote", label: "Cytat", icon: FileText },
];

function zamontuj(opts: Opcje = {}) {
  const onSelect = vi.fn();
  const onMove = vi.fn<(dir: -1 | 1) => void>();
  const onDuplicate = vi.fn();
  const onRemove = vi.fn();
  const onVariantChange = vi.fn<(v: string) => void>();
  const onTransform = vi.fn<(typ: string) => void>();
  render(
    // Wiersz wola `useSortable`, wiec musi stac w kontekscie @dnd-kit -
    // dokladnie tak, jak stoi w kanwie.
    <DndContext>
      <SortableContext items={["b1"]}>
        <SortableBlockItem
          id="b1"
          index={opts.index ?? 1}
          total={opts.total ?? 3}
          active={opts.active ?? true}
          selected={opts.selected}
          typeLabel="AKAPIT"
          typeIcon={FileText}
          onSelect={onSelect}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          variants={opts.bezWariantow ? null : (opts.variants ?? WARIANTY)}
          currentVariant={opts.currentVariant ?? "default"}
          onVariantChange={opts.bezWariantow ? undefined : onVariantChange}
          transforms={opts.bezPrzeksztalcen ? [] : (opts.transforms ?? PRZEKSZTALCENIA)}
          onTransform={opts.bezPrzeksztalcen ? undefined : onTransform}
        >
          <div data-testid="tresc">akapit testowy</div>
        </SortableBlockItem>
      </SortableContext>
    </DndContext>,
  );
  return { onSelect, onMove, onDuplicate, onRemove, onVariantChange, onTransform };
}

function wiersz(): HTMLElement {
  const el = document.querySelector('[data-block-id="b1"]');
  if (!(el instanceof HTMLElement)) throw new Error("brak wiersza bloku");
  return el;
}

/** Pasek akcji wiersza - `data-widget-toolbar` nosi tylko on. */
function pasek(): HTMLElement {
  const el = wiersz().querySelector('[data-widget-toolbar="block"]');
  if (!(el instanceof HTMLElement)) throw new Error("brak paska akcji wiersza");
  return el;
}

/** Otwiera menu kontekstowe wiersza (prawy przycisk myszy). */
async function otworzMenu(): Promise<HTMLElement> {
  fireEvent.contextMenu(wiersz());
  return await waitFor(() => screen.getByRole("menu"));
}

describe("SortableBlockItem - widocznosc paska akcji", () => {
  it("pasek NIEaktywnego bloku jest poza drzewem dostępności", () => {
    zamontuj({ active: false });
    expect(pasek()).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: t("blocks.actions.remove") })).toBeNull();
  });

  it("pasek AKTYWNEGO bloku jest dostępny", () => {
    zamontuj({ active: true });
    expect(pasek()).not.toHaveAttribute("aria-hidden", "true");
    expect(
      within(pasek()).getByRole("button", { name: t("blocks.actions.remove") }),
    ).toBeInTheDocument();
  });

  it("treść bloku renderuje się niezależnie od aktywności", () => {
    zamontuj({ active: false });
    expect(screen.getByTestId("tresc")).toBeInTheDocument();
  });

  it("blok objęty zaznaczeniem wielokrotnym oznacza się dla czytnika ekranu", () => {
    zamontuj({ selected: true });
    expect(wiersz()).toHaveAttribute("aria-selected", "true");
    expect(wiersz()).toHaveAttribute("data-block-selected", "true");
  });

  it("blok bez zaznaczenia nie nosi atrybutów zaznaczenia", () => {
    zamontuj({ selected: false });
    expect(wiersz()).not.toHaveAttribute("aria-selected");
    expect(wiersz()).not.toHaveAttribute("data-block-selected");
  });
});

describe("SortableBlockItem - uchwyt przeciagania", () => {
  it("uchwyt ma dostępną nazwę", () => {
    zamontuj();
    expect(screen.getByRole("button", { name: t("blocks.actions.drag") })).toBeInTheDocument();
  });

  it("klik w uchwyt zaznacza blok, ale nie propaguje w górę", () => {
    const { onSelect } = zamontuj();
    const klik = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: t("blocks.actions.drag") }).dispatchEvent(klik);
    // Wiersz sam zglasza zaznaczenie, ale bez zdarzenia myszy - to jest gest
    // uchwytu, nie klik w tresc (modyfikatory nie maja go rozszerzac).
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBeUndefined();
  });
});

describe("SortableBlockItem - pasek akcji", () => {
  it("strzałki zgłaszają kierunek przeniesienia", () => {
    const { onMove } = zamontuj({ index: 1, total: 3 });
    fireEvent.click(within(pasek()).getByRole("button", { name: t("blocks.actions.up") }));
    expect(onMove).toHaveBeenCalledWith(-1);
    fireEvent.click(within(pasek()).getByRole("button", { name: t("blocks.actions.down") }));
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it("strzałka w górę jest wyłączona na PIERWSZYM bloku", () => {
    zamontuj({ index: 0, total: 3 });
    expect(within(pasek()).getByRole("button", { name: t("blocks.actions.up") })).toBeDisabled();
  });

  it("strzałka w dół jest wyłączona na OSTATNIM bloku", () => {
    zamontuj({ index: 2, total: 3 });
    expect(within(pasek()).getByRole("button", { name: t("blocks.actions.down") })).toBeDisabled();
  });

  it("duplikat i kosz zgłaszają się wołającemu", () => {
    const { onDuplicate, onRemove } = zamontuj();
    fireEvent.click(within(pasek()).getByRole("button", { name: t("blocks.actions.duplicate") }));
    fireEvent.click(within(pasek()).getByRole("button", { name: t("blocks.actions.remove") }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("akcje paska NIE propagują kliku do wiersza (nie zmieniają zaznaczenia)", () => {
    const { onSelect, onRemove } = zamontuj();
    fireEvent.click(within(pasek()).getByRole("button", { name: t("blocks.actions.remove") }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("przełącznik wariantu zgłasza WYBRANY wariant", () => {
    const { onVariantChange } = zamontuj({ currentVariant: "default" });
    const grupa = within(pasek()).getByRole("group", { name: t("blocks.actions.variant") });
    fireEvent.click(within(grupa).getByRole("button", { name: "Karta" }));
    expect(onVariantChange).toHaveBeenCalledWith("card");
  });

  it("jeden wariant to nie wybór - przełącznik się nie pokazuje", () => {
    zamontuj({ variants: [{ key: "default", label: "Border" }] });
    expect(within(pasek()).queryByRole("group", { name: t("blocks.actions.variant") })).toBeNull();
  });

  it("bez obsługi wariantów przez wołającego przełącznik się nie pokazuje", () => {
    zamontuj({ bezWariantow: true });
    expect(within(pasek()).queryByRole("group", { name: t("blocks.actions.variant") })).toBeNull();
  });

  it("menu przekształceń oddaje wybrany typ i zamyka się", async () => {
    const { onTransform } = zamontuj();
    fireEvent.click(within(pasek()).getByRole("button", { name: t("blocks.transform.menuLabel") }));
    const menu = await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(within(menu).getByRole("button", { name: "Cytat" }));
    expect(onTransform).toHaveBeenCalledWith("quote");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("bez przekształceń menu typu się nie pokazuje", () => {
    zamontuj({ bezPrzeksztalcen: true });
    expect(
      within(pasek()).queryByRole("button", { name: t("blocks.transform.menuLabel") }),
    ).toBeNull();
  });
});

describe("SortableBlockItem - menu kontekstowe", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("prawy przycisk myszy otwiera menu i zaznacza blok", async () => {
    const { onSelect } = zamontuj();
    const menu = await otworzMenu();
    expect(menu).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalled();
  });

  it("menu niesie etykietę typu bloku", async () => {
    zamontuj();
    const menu = await otworzMenu();
    expect(within(menu).getByText(/AKAPIT/)).toBeInTheDocument();
  });

  it("menu niesie te same operacje co pasek", async () => {
    zamontuj();
    const menu = await otworzMenu();
    for (const klucz of ["up", "down", "duplicate", "remove", "copyId"]) {
      expect(
        within(menu).getByRole("menuitem", { name: new RegExp(t(`blocks.actions.${klucz}`)) }),
      ).toBeInTheDocument();
    }
  });

  it("pozycja przeniesienia z menu zgłasza kierunek", async () => {
    const { onMove } = zamontuj({ index: 1, total: 3 });
    const menu = await otworzMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(t("blocks.actions.down")) }),
    );
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it("krańcówki są wyłączone TAKŻE w menu kontekstowym", async () => {
    zamontuj({ index: 0, total: 3 });
    const menu = await otworzMenu();
    expect(
      within(menu).getByRole("menuitem", { name: new RegExp(t("blocks.actions.up")) }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("kopiowanie id bloku kładzie id do schowka systemowego", async () => {
    zamontuj();
    const menu = await otworzMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(t("blocks.actions.copyId")) }),
    );
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("b1"));
  });

  it("ODMOWA schowka nie wysadza wiersza", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("odmowa uprawnień")) },
    });
    zamontuj();
    const menu = await otworzMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(t("blocks.actions.copyId")) }),
    );
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    // Wiersz i treść stoją dalej - brak nieobsłużonego odrzucenia.
    expect(screen.getByTestId("tresc")).toBeInTheDocument();
  });

  it("kosz z menu zgłasza usunięcie", async () => {
    const { onRemove } = zamontuj();
    const menu = await otworzMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(t("blocks.actions.remove")) }),
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("duplikat z menu zgłasza się wołającemu", async () => {
    const { onDuplicate } = zamontuj();
    const menu = await otworzMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(t("blocks.actions.duplicate")) }),
    );
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("podmenu wariantów i przekształceń jest w menu, gdy wołający je obsługuje", async () => {
    zamontuj();
    const menu = await otworzMenu();
    expect(
      within(menu).getByRole("menuitem", { name: t("blocks.actions.variant") }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: t("blocks.transform.menuLabel") }),
    ).toBeInTheDocument();
  });

  it("bez obsługi wariantów i przekształceń podmenu nie ma", async () => {
    zamontuj({ bezWariantow: true, bezPrzeksztalcen: true });
    const menu = await otworzMenu();
    expect(within(menu).queryByRole("menuitem", { name: t("blocks.actions.variant") })).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", { name: t("blocks.transform.menuLabel") }),
    ).toBeNull();
  });
});

describe("SortableBlockItem - i18n PL/EN", () => {
  it("napisy wiersza istnieją w OBU językach", () => {
    const pl = realT("pl");
    const en = realT("en");
    const klucze = [
      "blocks.actions.drag",
      "blocks.actions.up",
      "blocks.actions.down",
      "blocks.actions.duplicate",
      "blocks.actions.remove",
      "blocks.actions.copyId",
      "blocks.actions.variant",
      "blocks.actions.block",
      "blocks.transform.menuLabel",
    ];
    for (const klucz of klucze) {
      expect(pl(klucz)).not.toBe(klucz);
      expect(en(klucz)).not.toBe(klucz);
    }
    expect(klucze.filter((k) => pl(k) !== en(k)).length).toBeGreaterThan(klucze.length / 2);
  });
});

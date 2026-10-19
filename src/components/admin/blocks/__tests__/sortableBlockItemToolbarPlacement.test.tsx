// WIERSZ BLOKU W KANWIE (`SortableBlockItem`) - UMIESZCZENIE PLYWAJACEGO PASKA
// I PODMENU MENU KONTEKSTOWEGO.
//
// Sasiedni `sortableBlockItem.test.tsx` dowodzi operacji paska i menu, ale
// swiadomie omija GEOMETRIE (happy-dom zwraca zera). Tu ta granica jest
// przesunieta o krok: `getBoundingClientRect` to granica silnika layoutu, wiec
// podstawiamy mu prostokaty wiersza i paska - a przedmiotem dowodu jest
// ALGORYTM komponentu, nie przegladarka:
//   * pasek stoi NAD blokiem, wyrownany do jego prawej krawedzi, a gdy nad
//     blokiem brakuje miejsca (blok przy gornej krawedzi ekranu) - schodzi POD
//     blok, zamiast wyjechac poza ekran,
//   * pasek nie wychodzi poza LEWA ani PRAWA krawedz okna (margines 8 px),
//     takze dla bloku wezszego niz sam pasek,
//   * przewiniecie strony i zmiana rozmiaru okna PRZELICZAJA pozycje,
//   * menu kontekstowe podaje ZMIERZONY rozmiar bloku obok nazwy typu, a bez
//     nazwy typu - etykiete ogolna ze slownika,
//   * podmenu „Wariant" i „Przeksztalc w" (druga reprezentacja paska) oddaja
//     wybor wolajacemu, a klik w tlo paska i w panel przeksztalcen nie zmienia
//     zaznaczenia bloku.
//
// GRANICE: prostokaty sa podstawione na prototypie `HTMLElement` i rozpoznaja
// element po kontrakcie DOM komponentu (`data-block-id` wiersza,
// `data-widget-toolbar="block"` paska). Okno ma szerokosc happy-dom (1024 px).
// Radix ContextMenu/Popover sa prawdziwe; podmenu otwiera klawisz strzalki.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { FileText } from "@/lib/lucide-shim";
import type { BlockVariantOption } from "@/lib/blocks/variants";
import { SortableBlockItem, type BlockTransformOption } from "../molecules/SortableBlockItem";
import { realT } from "@/test/i18nReal";

const t = realT("pl");

interface Prostokat {
  left: number;
  top: number;
  width: number;
  height: number;
}

const geometria: { wiersz: Prostokat; pasek: Prostokat } = {
  wiersz: { left: 100, top: 300, width: 600, height: 80 },
  pasek: { left: 0, top: 0, width: 200, height: 30 },
};

function rect(p: Prostokat): DOMRect {
  return {
    ...p,
    x: p.left,
    y: p.top,
    right: p.left + p.width,
    bottom: p.top + p.height,
    toJSON: () => p,
  } as DOMRect;
}

const oryginalnyPomiar = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  geometria.wiersz = { left: 100, top: 300, width: 600, height: 80 };
  geometria.pasek = { left: 0, top: 0, width: 200, height: 30 };
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.matches('[data-widget-toolbar="block"]')) return rect(geometria.pasek);
    if (this.matches("[data-block-id]")) return rect(geometria.wiersz);
    return oryginalnyPomiar.call(this);
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = oryginalnyPomiar;
});

const WARIANTY: BlockVariantOption[] = [
  { key: "default", label: "Border" },
  { key: "card", label: "Karta" },
];

const PRZEKSZTALCENIA: BlockTransformOption[] = [
  { type: "heading", label: "Nagłówek", icon: FileText },
  { type: "quote", label: "Cytat", icon: FileText },
];

function zamontuj(opts: { typeLabel?: string; index?: number } = {}) {
  const onSelect = vi.fn();
  const onMove = vi.fn<(dir: -1 | 1) => void>();
  const onVariantChange = vi.fn<(v: string) => void>();
  const onTransform = vi.fn<(typ: string) => void>();
  render(
    <DndContext>
      <SortableContext items={["b1"]}>
        <SortableBlockItem
          id="b1"
          index={opts.index ?? 1}
          total={3}
          active
          typeLabel={opts.typeLabel}
          onSelect={onSelect}
          onMove={onMove}
          onDuplicate={vi.fn()}
          onRemove={vi.fn()}
          variants={WARIANTY}
          currentVariant="default"
          onVariantChange={onVariantChange}
          transforms={PRZEKSZTALCENIA}
          onTransform={onTransform}
        >
          <div>akapit testowy</div>
        </SortableBlockItem>
      </SortableContext>
    </DndContext>,
  );
  return { onSelect, onMove, onVariantChange, onTransform };
}

function wiersz(): HTMLElement {
  const el = document.querySelector('[data-block-id="b1"]');
  if (!(el instanceof HTMLElement)) throw new Error("brak wiersza bloku");
  return el;
}

function pasek(): HTMLElement {
  const el = wiersz().querySelector('[data-widget-toolbar="block"]');
  if (!(el instanceof HTMLElement)) throw new Error("brak paska akcji wiersza");
  return el;
}

/** Bezwzgledne krawedzie paska w oknie: pozycja wiersza + przesuniecie paska. */
function krawedziePaska(): { lewa: number; prawa: number } {
  const lewa = geometria.wiersz.left + parseFloat(pasek().style.left);
  return { lewa, prawa: lewa + geometria.pasek.width };
}

async function otworzMenu(): Promise<HTMLElement> {
  fireEvent.contextMenu(wiersz());
  return await waitFor(() => screen.getByRole("menu"));
}

/** Otwiera podmenu o danej nazwie klawiszem strzalki (tak jak klawiatura). */
async function otworzPodmenu(menu: HTMLElement, nazwa: string): Promise<HTMLElement> {
  const wyzwalacz = within(menu).getByRole("menuitem", { name: nazwa });
  fireEvent.keyDown(wyzwalacz, { key: "ArrowRight" });
  return await waitFor(() => {
    const menus = screen.getAllByRole("menu");
    if (menus.length < 2) throw new Error("podmenu jeszcze sie nie otworzylo");
    return menus[menus.length - 1];
  });
}

describe("SortableBlockItem - pasek nad blokiem albo pod nim", () => {
  it("przy miejscu nad blokiem pasek stoi NAD nim, wyrownany do prawej krawedzi", () => {
    zamontuj();

    // Prawa krawedz paska = prawa krawedz wiersza minus 4 px oddechu.
    expect(pasek().style.left).toBe(`${600 - 200 - 4}px`);
    expect(pasek().style.top).toBe(`${-30 - 4}px`);
  });

  it("blok przy GORNEJ krawedzi ekranu dostaje pasek POD soba", () => {
    // Nad blokiem jest 20 px, a pasek potrzebuje 30 + margines 8.
    geometria.wiersz = { left: 100, top: 20, width: 600, height: 80 };
    zamontuj();

    expect(pasek().style.top).toBe(`${80 + 4}px`);
  });

  it("blok wezszy niz pasek przy LEWEJ krawedzi okna nie wypycha paska za ekran", () => {
    geometria.wiersz = { left: 0, top: 300, width: 100, height: 80 };
    zamontuj();

    expect(krawedziePaska().lewa).toBe(8);
  });

  it("blok przy PRAWEJ krawedzi okna nie wypycha paska za ekran", () => {
    geometria.wiersz = { left: 900, top: 300, width: 300, height: 80 };
    geometria.pasek = { left: 0, top: 0, width: 250, height: 30 };
    zamontuj();

    expect(krawedziePaska().prawa).toBe(window.innerWidth - 8);
    expect(krawedziePaska().lewa).toBeGreaterThanOrEqual(8);
  });

  it("przewiniecie strony PRZELICZA pozycje - blok dojechal pod gorna krawedz", () => {
    zamontuj();
    expect(pasek().style.top).toBe("-34px");

    geometria.wiersz = { ...geometria.wiersz, top: 5 };
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(pasek().style.top).toBe("84px");
  });

  it("zmiana rozmiaru okna PRZELICZA pozycje", () => {
    zamontuj();

    geometria.wiersz = { ...geometria.wiersz, width: 400 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(pasek().style.left).toBe(`${400 - 200 - 4}px`);
  });
});

describe("SortableBlockItem - etykieta menu kontekstowego", () => {
  it("menu podaje nazwe typu i ZMIERZONY rozmiar bloku", async () => {
    zamontuj({ typeLabel: "AKAPIT" });

    const menu = await otworzMenu();

    expect(within(menu).getByText("AKAPIT · 600×80px")).toBeInTheDocument();
  });

  it("bez nazwy typu menu bierze etykiete ogolna ze slownika", async () => {
    zamontuj({ typeLabel: undefined });

    const menu = await otworzMenu();

    expect(within(menu).getByText(`${t("blocks.actions.block")} · 600×80px`)).toBeInTheDocument();
  });
});

describe("SortableBlockItem - podmenu i klikniecia, ktore nie zmieniaja zaznaczenia", () => {
  it("podmenu „Wariant” oddaje wybrany wariant", async () => {
    const { onVariantChange } = zamontuj();
    const menu = await otworzMenu();

    const podmenu = await otworzPodmenu(menu, t("blocks.actions.variant"));
    fireEvent.click(within(podmenu).getByRole("menuitemradio", { name: "Karta" }));

    expect(onVariantChange).toHaveBeenCalledWith("card");
  });

  it("podmenu „Przeksztalc w” oddaje wybrany typ", async () => {
    const { onTransform } = zamontuj();
    const menu = await otworzMenu();

    const podmenu = await otworzPodmenu(menu, t("blocks.transform.menuLabel"));
    fireEvent.click(within(podmenu).getByRole("menuitem", { name: "Cytat" }));

    expect(onTransform).toHaveBeenCalledWith("quote");
  });

  it("„W gore” z menu kontekstowego zglasza kierunek -1", async () => {
    const { onMove } = zamontuj({ index: 1 });
    const menu = await otworzMenu();

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(t("blocks.actions.up")) }),
    );

    expect(onMove).toHaveBeenCalledWith(-1);
  });

  it("klik w TLO paska akcji nie zaznacza bloku", () => {
    const { onSelect } = zamontuj();

    fireEvent.click(pasek());

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("klik w panel przeksztalcen (poza pozycja) nie zaznacza bloku", async () => {
    // Panel jest w portalu, ale zdarzenia Reacta i tak bablaja do wiersza -
    // bez zatrzymania klik w naglowek panelu przestawialby zaznaczenie.
    const { onSelect, onTransform } = zamontuj();
    fireEvent.click(within(pasek()).getByRole("button", { name: t("blocks.transform.menuLabel") }));
    const panel = await waitFor(() => screen.getByRole("dialog"));

    fireEvent.click(within(panel).getByText(t("blocks.transform.menuLabel")));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onTransform).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

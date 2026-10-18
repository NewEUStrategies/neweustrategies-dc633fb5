// GLOWNY EDYTOR WPISU (`PostBlockEditor`) - PODLACZENIE PANELU BOCZNEGO
// DO HISTORII DOKUMENTU.
//
// Sasiedni `postBlockEditor.test.tsx` dowodzi historii z poziomu KANWY
// (przyciski, skroty, jezyki, echo autosave'u). Panel boczny ma do dokumentu
// DWIE wlasne drogi zapisu, ktore omijaja kanwe - i obie musza przechodzic
// przez TEN SAM stos undo/redo:
//   * inspektor bloku (`updateActive`): zmiana metadanych aktywnego bloku jest
//     natychmiastowym krokiem historii, pisze WYLACZNIE do tego bloku i daje
//     sie cofnac,
//   * lista dokumentu (`onReorder`): przeciagniecie wiersza przestawia bloki
//     najwyzszego poziomu w dokumencie oddanym rodzicowi - tez jako krok.
// Do tego kontrakt nawigacji miedzy kanwa a panelem po naprawie z 2026-10-18:
//   * klik w blok KANWY otwiera inspektor tego bloku (zakladka „Blok"),
//   * wybor bloku z LISTY dokumentu zaznacza go w kanwie, ale panel zostaje na
//     liscie - redaktor nawigujacy po strukturze nie jest z niej wyrzucany,
// oraz odmowa: Alt+strzalka z aktywnym blokiem, ktory zniknal z dokumentu
// (podmiana tresci z zewnatrz), nie przestawia niczego.
//
// GRANICE (jak w pliku sasiednim): `sonner` i `CoachmarkTour` sa atrapami.
// Gest myszy @dnd-kit nie dziala pod happy-dom (brak prostokatow), wiec
// PRAWDZIWY `DndContext` zostaje w drzewie, a test przechwytuje `onDragEnd`
// TEGO kontekstu, ktory owija drzewo listy dokumentu (`role="tree"`) - to
// samo obejscie co w `blockListView.test.tsx`. Przedmiotem dowodu jest
// podlaczenie listy do historii, nie biblioteka.
import { describe, expect, it, vi } from "vitest";
import { isValidElement, useState, type ReactNode } from "react";
import { act, fireEvent, render, within } from "@testing-library/react";
import type { Block, BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-core";

type Upuszczenie = { active: { id: string }; over: { id: string } | null };
type Uchwyt = (e: Upuszczenie) => void;

const dnd = vi.hoisted(() => ({ lista: null as ((e: unknown) => void) | null }));

/** Czy poddrzewo elementow Reacta (bez renderu) zawiera `role="tree"`. */
function zawieraDrzewo(node: ReactNode, glebokosc = 0): boolean {
  if (glebokosc > 4 || !isValidElement(node)) return false;
  const props = node.props as { role?: string; children?: ReactNode };
  if (props.role === "tree") return true;
  const dzieci = Array.isArray(props.children) ? props.children : [props.children];
  return dzieci.some((d) => zawieraDrzewo(d as ReactNode, glebokosc + 1));
}

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  const Real = actual.DndContext;
  return {
    ...actual,
    DndContext: (props: { onDragEnd?: Uchwyt; children?: ReactNode }) => {
      // Najswiezszy handler LISTY dokumentu (kanwa ma wlasny kontekst obok).
      if (props.onDragEnd && zawieraDrzewo(props.children)) {
        dnd.lista = props.onDragEnd as (e: unknown) => void;
      }
      return createElement(Real, props as never);
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@/components/admin/onboarding/CoachmarkTour", () => ({
  CoachmarkTour: () => null,
}));

const { PostBlockEditor } = await import("../PostBlockEditor");

const t = realT("pl");

function akapit(id: string, tekst: string): Block {
  return { id, type: "paragraph", data: { html: `<p>${tekst}</p>` } } as Block;
}

function naglowek(id: string, tekst: string, anchor = ""): Block {
  return { id, type: "heading", data: { level: 2, text: tekst, anchor } } as Block;
}

function wartosc(pl: Block[]): LocalizedBlocks {
  return { pl: { version: 1, blocks: pl }, en: { version: 1, blocks: [] } } as LocalizedBlocks;
}

/** Rodzic jak formularz wpisu: trzyma `value` i oddaje edytorowi to, co dostal. */
function zamontuj(startowa: LocalizedBlocks) {
  dnd.lista = null;
  const zmiany: LocalizedBlocks[] = [];
  let ustaw: ((next: LocalizedBlocks) => void) | null = null;
  function Rodzic() {
    const [v, setV] = useState(startowa);
    ustaw = setV;
    return (
      <PostBlockEditor
        value={v}
        onChange={(next) => {
          zmiany.push(next);
          setV(next);
        }}
        documentPane={<div data-testid="panel-dokumentu" />}
      />
    );
  }
  render(<Rodzic />);
  return {
    zmiany,
    zZewnatrz(next: LocalizedBlocks) {
      act(() => ustaw?.(next));
    },
  };
}

function panel(): HTMLElement {
  const el = document.querySelector('[data-tour="blocks-sidebar"]');
  if (!(el instanceof HTMLElement)) throw new Error("brak panelu bocznego");
  return el;
}

function wierszKanwy(blockId: string): HTMLElement {
  const el = document.querySelector(`[data-block-canvas] [data-block-id="${blockId}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`brak bloku ${blockId} w kanwie`);
  return el;
}

function przyciskHistorii(nazwa: string): HTMLElement {
  const pasek = document.querySelector('[data-tour="blocks-history"]');
  if (!(pasek instanceof HTMLElement)) throw new Error("brak paska historii dokumentu");
  return within(pasek).getByRole("button", { name: nazwa });
}

function ostatniPl(zmiany: LocalizedBlocks[]): BlocksDoc {
  const ostatnia = zmiany.at(-1);
  if (!ostatnia) throw new Error("edytor nie oddal zadnej zmiany");
  return ostatnia.pl;
}

describe("PostBlockEditor - nawigacja miedzy kanwa a panelem", () => {
  it("klik w blok KANWY otwiera w panelu inspektor tego bloku", () => {
    zamontuj(wartosc([akapit("p1", "wstep"), naglowek("h1", "Sekcja", "sekcja")]));

    fireEvent.click(wierszKanwy("h1"));

    expect(within(panel()).getByRole("tab", { name: t("blocks.sidebar.block") })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(within(panel()).getByDisplayValue("sekcja")).toBeInTheDocument();
  });

  it("wybor z LISTY dokumentu zaznacza blok, ale panel zostaje na liscie", () => {
    zamontuj(wartosc([akapit("p1", "wstep"), naglowek("h1", "Sekcja")]));
    const drzewo = within(panel()).getByRole("tree", { name: t("blocks.listView.title") });

    fireEvent.click(
      within(drzewo)
        .getAllByRole("button")
        .find((b) => b.textContent?.includes("Sekcja")) as HTMLElement,
    );

    expect(
      within(panel()).getByRole("tab", { name: t("blocks.sidebar.document") }),
    ).toHaveAttribute("data-state", "active");
    // Zaznaczenie dotarlo do kanwy: aktywny blok ma dostepny pasek akcji.
    expect(wierszKanwy("h1").querySelector('[data-widget-toolbar="block"]')).not.toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(panel()).getByRole("tab", { name: t("blocks.sidebar.block") })).toBeEnabled();
  });
});

describe("PostBlockEditor - inspektor bloku pisze przez historie", () => {
  it("zmiana w inspektorze trafia WYLACZNIE do aktywnego bloku i daje sie cofnac", () => {
    const sasiad = akapit("p1", "wstep");
    const { zmiany } = zamontuj(wartosc([sasiad, naglowek("h1", "Sekcja", "stary")]));
    fireEvent.click(wierszKanwy("h1"));

    fireEvent.change(within(panel()).getByDisplayValue("stary"), { target: { value: "nowy" } });

    const po = ostatniPl(zmiany);
    expect(po.blocks.map((b) => b.id)).toEqual(["p1", "h1"]);
    expect(po.blocks[1].data).toEqual({ level: 2, text: "Sekcja", anchor: "nowy" });
    // Sasiad przechodzi przez zapis NIETKNIETY - tym samym obiektem.
    expect(po.blocks[0]).toBe(sasiad);
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeEnabled();

    fireEvent.click(przyciskHistorii(t("blocks.actions.undo")));

    expect(ostatniPl(zmiany).blocks[1].data.anchor).toBe("stary");
  });

  it("kazda zmiana w inspektorze to OSOBNY krok - dwa cofniecia zdejmuja dwie zmiany", () => {
    // Inspektor zapisuje natychmiast (`immediate`), wiec okno scalajace pisania
    // w kanwie nie zlewa zmian metadanych w jeden krok.
    const { zmiany } = zamontuj(wartosc([naglowek("h1", "Sekcja", "a")]));
    fireEvent.click(wierszKanwy("h1"));
    const pole = within(panel()).getByDisplayValue("a");

    fireEvent.change(pole, { target: { value: "ab" } });
    fireEvent.change(pole, { target: { value: "abc" } });
    fireEvent.click(przyciskHistorii(t("blocks.actions.undo")));
    expect(ostatniPl(zmiany).blocks[0].data.anchor).toBe("ab");
    fireEvent.click(przyciskHistorii(t("blocks.actions.undo")));

    expect(ostatniPl(zmiany).blocks[0].data.anchor).toBe("a");
  });
});

describe("PostBlockEditor - przestawienie z listy dokumentu", () => {
  it("upuszczenie wiersza listy przestawia bloki w dokumencie i daje sie cofnac", () => {
    const { zmiany } = zamontuj(
      wartosc([akapit("p1", "pierwszy"), akapit("p2", "drugi"), akapit("p3", "trzeci")]),
    );
    expect(dnd.lista).not.toBeNull();

    act(() => dnd.lista?.({ active: { id: "p3" }, over: { id: "p1" } }));

    expect(ostatniPl(zmiany).blocks.map((b) => b.id)).toEqual(["p3", "p1", "p2"]);
    fireEvent.click(przyciskHistorii(t("blocks.actions.undo")));
    expect(ostatniPl(zmiany).blocks.map((b) => b.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("PostBlockEditor - odmowy skrotu Alt+strzalka", () => {
  it("aktywny blok, ktory zniknal z dokumentu, nie jest przestawiany", () => {
    // Podmiana tresci z zewnatrz (wczytanie rewizji) zostawia `activeId`
    // wskazujace blok, ktorego juz nie ma - skrot nie moze wtedy ruszyc
    // zadnego innego bloku.
    const { zmiany, zZewnatrz } = zamontuj(
      wartosc([akapit("p1", "pierwszy"), akapit("p2", "drugi")]),
    );
    fireEvent.click(wierszKanwy("p2"));
    zZewnatrz(wartosc([akapit("x1", "rewizja A"), akapit("x2", "rewizja B")]));
    const ileZmian = zmiany.length;

    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true });

    expect(zmiany).toHaveLength(ileZmian);
    expect(
      Array.from(document.querySelectorAll("[data-block-canvas] [data-block-id]")).map((el) =>
        el.getAttribute("data-block-id"),
      ),
    ).toEqual(["x1", "x2"]);
  });
});

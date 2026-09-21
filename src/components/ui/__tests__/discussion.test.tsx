// CO TEN PLIK DOWODZI
// 1. Prymityw ZACHOWUJE SEMANTYKĘ DOKUMENTU powierzchni, która go użyła:
//    `Discussion` daje `<ul>` albo `<div>`, `DiscussionItem` `<li>`/`<div>`/
//    `<article>`. To nie kosmetyka - Radix domyślnie renderuje `<div>`, a `<div>`
//    wprost w `<ul>` to niepoprawny HTML: psuje nawigację czytnikiem ekranu
//    i selektor potomka `li li`, na którym stoi wcięcie zagnieżdżonych odpowiedzi.
// 2. Zagnieżdżenie `li > … > ul > li` faktycznie powstaje w DOM.
// 3. Kontrakt zbioru `collapsed`: PUSTY zbiór = gałąź OTWARTA. Domyślnie nic nie
//    znika czytelnikowi, akordeon tylko DODAJE zwijanie.
// 4. Kliknięcie wyzwalacza woła `onToggle(id, nowyStan)` - osobno dla zwinięcia
//    i rozwinięcia.
// 5. Tłumaczenie zdarzenia Radiksa (TABLICA otwartych) na pojedyncze
//    przełączenie: wywołanie dostaje ID tylko tego rodzeństwa, którego stan się
//    zmienił; nietknięte rodzeństwo nie generuje wywołań.
// 6. Dwa zagnieżdżone `Discussion` są od siebie niezależne - zwinięcie rodzica
//    nie miesza stanu dziecka.
// 7. `DiscussionExpand` pokazuje etykietę podaną propsem i tylko JĄ (jeden napis
//    w drzewie dostępności), a `aria-expanded` zgadza się ze stanem.
// 8. `discussionSpineClass()` zwraca wcięcie i gradientową linię - czysta
//    funkcja, dowód bez montowania drzewa.
// 9. Wyzwalacz nosi `data-testid="discussion-expand"` - punkt zaczepienia, na
//    którym stoją testy powierzchni (wątek klubowy, komentarze).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
// - Reguł przenoszenia stanu między gałęziami (`countDescendants`, `toggleBranch`,
//   `revealBranch`) - to `src/lib/discussion/__tests__/branches.test.ts`; tutaj
//   zbiór `collapsed` jest podawany z ręki, żeby dowód dotyczył prymitywu.
// - Tego, jak powierzchnie liczą etykietę ("pokaż 3 odpowiedzi") i skąd biorą
//   klucze i18n - etykieta wchodzi propsem, więc jej treść jest sprawą wywołującego.
// - Wyglądu poza kontraktem klasy grzbietu: nie sprawdzam kolorów ani animacji,
//   bo happy-dom i tak nie liczy stylów kaskady.
//
// DLACZEGO STAN ZWINIĘCIA ASERTUJĘ NA `data-state` WYZWALACZA. Radix trzyma
// treść `Accordion.Content` przez `Presence`, które przy zamknięciu czeka na
// koniec animacji CSS. Pod happy-dom animacje nie lecą, więc treść znika
// natychmiast - ZMIERZONE, nie założone - i razem z nią znika `aria-controls`
// z wyzwalacza. Dlatego elementu treści szukam po `aria-controls` TYLKO przy
// gałęzi otwartej, a zwinięcie dowodzę atrybutami wyzwalacza (`data-state`,
// `aria-expanded`) plus brakiem treści w DOM. Odwrotnie byłoby kruche: asercja
// wisiałaby na harmonogramie animacji, którego w tym środowisku nie ma.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Discussion,
  DiscussionExpand,
  DiscussionItem,
  DiscussionReplies,
  discussionSpineClass,
} from "../discussion";

afterEach(cleanup);

/** Element treści danej gałęzi - Radix wiąże wyzwalacz z treścią przez `aria-controls`. */
function contentOf(trigger: HTMLElement): HTMLElement {
  const id = trigger.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  const content = document.getElementById(id as string);
  expect(content).toBeTruthy();
  return content as HTMLElement;
}

/**
 * Powierzchnia-atrapa: stan zwiniętych gałęzi żyje NAD prymitywem, dokładnie tak
 * jak w wątku klubowym i w komentarzach. `onToggle` to szpieg, ale stan realnie
 * się przestawia - inaczej drugie kliknięcie testowałoby martwy komponent.
 */
function Harness({
  ids,
  initialCollapsed = [],
  onToggle,
  element,
  itemElement,
}: {
  ids: readonly string[];
  initialCollapsed?: readonly string[];
  onToggle?: (id: string, open: boolean) => void;
  element?: "ul" | "div";
  itemElement?: "li" | "div" | "article";
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(initialCollapsed));
  return (
    <Discussion
      element={element}
      siblingIds={ids}
      collapsed={collapsed}
      onToggle={(id, open) => {
        onToggle?.(id, open);
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (open) next.delete(id);
          else next.add(id);
          return next;
        });
      }}
    >
      {ids.map((id) => (
        <DiscussionItem key={id} value={id} element={itemElement}>
          <p>tekst {id}</p>
          <DiscussionExpand label={`odpowiedzi ${id}`} />
          <DiscussionReplies>
            <p>gałąź {id}</p>
          </DiscussionReplies>
        </DiscussionItem>
      ))}
    </Discussion>
  );
}

describe("Discussion - semantyka dokumentu", () => {
  it("renderuje <ul> domyślnie i <li> dla wpisu", () => {
    const { container } = render(<Harness ids={["a"]} />);
    const list = container.querySelector("ul");
    expect(list).toBeTruthy();
    expect(list?.firstElementChild?.tagName).toBe("LI");
    // Radiksowy <div> nie wszedł wprost do listy.
    expect(list?.querySelector(":scope > div")).toBeNull();
  });

  it('renderuje <div> przy element="div" - bez sieroty <li> poza listą', () => {
    const { container } = render(<Harness ids={["a"]} element="div" itemElement="div" />);
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("li")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("renderuje <article> jako wpis, gdy powierzchnia tego chce", () => {
    const { container } = render(<Harness ids={["a"]} element="div" itemElement="article" />);
    expect(container.querySelector("article")).toBeTruthy();
  });

  it("tworzy realne zagnieżdżenie li > … > ul > li", () => {
    const { container } = render(
      <Discussion siblingIds={["p1"]} collapsed={new Set()} onToggle={() => {}}>
        <DiscussionItem value="p1">
          <DiscussionExpand label="rozwiń rodzica" />
          <DiscussionReplies>
            <Discussion siblingIds={["c1"]} collapsed={new Set()} onToggle={() => {}}>
              <DiscussionItem value="c1">
                <p>dziecko</p>
              </DiscussionItem>
            </Discussion>
          </DiscussionReplies>
        </DiscussionItem>
      </Discussion>,
    );
    expect(container.querySelectorAll("li li")).toHaveLength(1);
  });
});

describe("Discussion - kontrakt zbioru `collapsed`", () => {
  it('pusty zbiór = gałąź otwarta: data-state="open" i treść w DOM', () => {
    render(<Harness ids={["a"]} />);
    const trigger = screen.getByTestId("discussion-expand");
    expect(trigger).toHaveAttribute("data-state", "open");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("gałąź a")).toBeInTheDocument();
  });

  it('id w zbiorze = gałąź zwinięta: data-state="closed"', () => {
    render(<Harness ids={["a"]} initialCollapsed={["a"]} />);
    const trigger = screen.getByTestId("discussion-expand");
    expect(trigger).toHaveAttribute("data-state", "closed");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("zwija tylko wskazane rodzeństwo, resztę zostawia otwartą", () => {
    render(<Harness ids={["a", "b"]} initialCollapsed={["b"]} />);
    const [first, second] = screen.getAllByTestId("discussion-expand");
    expect(first).toHaveAttribute("data-state", "open");
    expect(second).toHaveAttribute("data-state", "closed");
  });
});

describe("Discussion - przełączanie", () => {
  it("kliknięcie otwartej gałęzi woła onToggle(id, false)", () => {
    const onToggle = vi.fn();
    render(<Harness ids={["a"]} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("discussion-expand"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("a", false);
    expect(screen.getByTestId("discussion-expand")).toHaveAttribute("data-state", "closed");
  });

  it("kliknięcie zwiniętej gałęzi woła onToggle(id, true) i pokazuje treść", () => {
    const onToggle = vi.fn();
    render(<Harness ids={["a"]} initialCollapsed={["a"]} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("discussion-expand"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("a", true);
    const trigger = screen.getByTestId("discussion-expand");
    expect(trigger).toHaveAttribute("data-state", "open");
    expect(screen.getByText("gałąź a")).toBeInTheDocument();
  });

  it("zgłasza WYŁĄCZNIE rodzeństwo, którego stan się zmienił", () => {
    const onToggle = vi.fn();
    render(<Harness ids={["a", "b", "c"]} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByTestId("discussion-expand")[1]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("b", false);
    // Sąsiedzi nie dostali ani jednego wywołania.
    expect(onToggle.mock.calls.map(([id]) => id)).toEqual(["b"]);
    const triggers = screen.getAllByTestId("discussion-expand");
    expect(triggers[0]).toHaveAttribute("data-state", "open");
    expect(triggers[2]).toHaveAttribute("data-state", "open");
  });

  it("dwa przełączenia z rzędu wracają do stanu wyjściowego", () => {
    const onToggle = vi.fn();
    render(<Harness ids={["a"]} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("discussion-expand"));
    fireEvent.click(screen.getByTestId("discussion-expand"));
    expect(onToggle.mock.calls).toEqual([
      ["a", false],
      ["a", true],
    ]);
    expect(screen.getByTestId("discussion-expand")).toHaveAttribute("data-state", "open");
  });
});

/** Rodzic i dziecko trzymają OSOBNE zbiory zwiniętych - jak w wątku klubowym. */
function NestedHarness({
  onParent,
  onChild,
}: {
  onParent: (id: string, open: boolean) => void;
  onChild: (id: string, open: boolean) => void;
}) {
  const [parentCollapsed, setParentCollapsed] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [childCollapsed, setChildCollapsed] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const flip =
    (set: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void) =>
    (id: string, open: boolean) => {
      set((prev) => {
        const next = new Set(prev);
        if (open) next.delete(id);
        else next.add(id);
        return next;
      });
    };
  return (
    <Discussion
      siblingIds={["p1"]}
      collapsed={parentCollapsed}
      onToggle={(id, open) => {
        onParent(id, open);
        flip(setParentCollapsed)(id, open);
      }}
    >
      <DiscussionItem value="p1">
        <DiscussionExpand label="gałąź rodzica" />
        <DiscussionReplies>
          <Discussion
            siblingIds={["c1"]}
            collapsed={childCollapsed}
            onToggle={(id, open) => {
              onChild(id, open);
              flip(setChildCollapsed)(id, open);
            }}
          >
            <DiscussionItem value="c1">
              <DiscussionExpand label="gałąź dziecka" />
              <DiscussionReplies>
                <p>wnuk</p>
              </DiscussionReplies>
            </DiscussionItem>
          </Discussion>
        </DiscussionReplies>
      </DiscussionItem>
    </Discussion>
  );
}

describe("Discussion - zagnieżdżone gałęzie", () => {
  it("zwinięcie rodzica nie rusza stanu dziecka", () => {
    const onParent = vi.fn();
    const onChild = vi.fn();
    render(<NestedHarness onParent={onParent} onChild={onChild} />);

    const [parentTrigger] = screen.getAllByTestId("discussion-expand");
    fireEvent.click(parentTrigger);

    expect(onParent).toHaveBeenCalledWith("p1", false);
    expect(onChild).not.toHaveBeenCalled();
    expect(screen.getByTestId("discussion-expand")).toHaveAttribute("data-state", "closed");
  });

  it("dziecko zwija się niezależnie, rodzic zostaje otwarty", () => {
    const onParent = vi.fn();
    const onChild = vi.fn();
    render(<NestedHarness onParent={onParent} onChild={onChild} />);

    const triggers = screen.getAllByTestId("discussion-expand");
    fireEvent.click(triggers[1]);

    expect(onChild).toHaveBeenCalledWith("c1", false);
    expect(onParent).not.toHaveBeenCalled();
    const after = screen.getAllByTestId("discussion-expand");
    expect(after[0]).toHaveAttribute("data-state", "open");
    expect(after[1]).toHaveAttribute("data-state", "closed");
  });

  it("rozwinięcie rodzica przywraca dziecko w stanie, w jakim je zostawiono", () => {
    const onParent = vi.fn();
    const onChild = vi.fn();
    render(<NestedHarness onParent={onParent} onChild={onChild} />);

    fireEvent.click(screen.getAllByTestId("discussion-expand")[1]); // zwiń dziecko
    fireEvent.click(screen.getAllByTestId("discussion-expand")[0]); // zwiń rodzica
    fireEvent.click(screen.getAllByTestId("discussion-expand")[0]); // rozwiń rodzica

    const after = screen.getAllByTestId("discussion-expand");
    expect(after[0]).toHaveAttribute("data-state", "open");
    expect(after[1]).toHaveAttribute("data-state", "closed");
    expect(onChild.mock.calls).toEqual([["c1", false]]);
  });
});

describe("DiscussionExpand", () => {
  it("pokazuje etykietę z propsa i tylko raz w drzewie dostępności", () => {
    render(
      <Discussion siblingIds={["a"]} collapsed={new Set()} onToggle={() => {}}>
        <DiscussionItem value="a">
          <DiscussionExpand label="ukryj 3 odpowiedzi" />
          <DiscussionReplies>
            <p>treść</p>
          </DiscussionReplies>
        </DiscussionItem>
      </Discussion>,
    );
    expect(screen.getAllByText("ukryj 3 odpowiedzi")).toHaveLength(1);
    expect(screen.getByTestId("discussion-expand")).toHaveTextContent("ukryj 3 odpowiedzi");
    // Żadnego drugiego napisu schowanego klasą (`sr-only`, `hidden`).
    expect(screen.queryByText(/pokaż/i)).toBeNull();
  });

  it("jest punktem zaczepienia testów powierzchni: data-testid + rola przycisku", () => {
    render(<Harness ids={["a"]} />);
    const trigger = screen.getByTestId("discussion-expand");
    expect(trigger.tagName).toBe("BUTTON");
    expect(screen.getByRole("button", { name: /odpowiedzi a/ })).toBe(trigger);
  });

  it("aria-expanded i treść idą za stanem gałęzi", () => {
    render(<Harness ids={["a"]} />);
    const trigger = screen.getByTestId("discussion-expand");
    const content = contentOf(trigger);
    expect(content).toHaveAttribute("data-state", "open");
    expect(content).toHaveTextContent("gałąź a");

    fireEvent.click(trigger);

    const after = screen.getByTestId("discussion-expand");
    expect(after).toHaveAttribute("aria-expanded", "false");
    expect(after).toHaveAttribute("data-state", "closed");
    // Treść zwiniętej gałęzi znika z drzewa - nie jest tylko schowana klasą.
    expect(screen.queryByText("gałąź a")).toBeNull();
  });
});

describe("discussionSpineClass", () => {
  it("daje wcięcie i gradientową linię gałęzi", () => {
    const klasy = discussionSpineClass();
    expect(klasy).toContain("pl-");
    expect(klasy).toContain("before:");
    expect(klasy).toContain("before:bg-gradient-to-b");
    expect(klasy).toContain("relative");
  });

  it("jest czysta - dwa wywołania dają ten sam napis", () => {
    expect(discussionSpineClass()).toBe(discussionSpineClass());
  });

  it("trafia na kontener treści odpowiedzi", () => {
    render(<Harness ids={["a"]} />);
    const content = contentOf(screen.getByTestId("discussion-expand"));
    const spine = content.querySelector("div");
    expect(spine?.className).toContain("before:bg-gradient-to-b");
  });
});

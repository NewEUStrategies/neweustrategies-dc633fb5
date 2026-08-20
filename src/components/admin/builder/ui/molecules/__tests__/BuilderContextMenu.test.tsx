// Menu kontekstowe kanwy buildera (prawy przycisk myszy). Renderuje się
// portalem, pozycjonuje przy kursorze i pokazuje TYLKO te akcje, które
// przekazał rodzic - brak akcji to brak pozycji w menu, nie pozycja wyszarzona.
//
// Test przypina trzy rzeczy, które w praktyce psują to menu:
//  1. KOLEJNOŚĆ ZAMYKANIA. Każda akcja najpierw zamyka menu, potem wykonuje
//     operację. Odwrotna kolejność zostawiała menu nad zmienioną kanwą,
//     a przy usuwaniu - menu przypięte do już nieistniejącego węzła.
//  2. ODWRACANIE PRZY KRAWĘDZI. Menu otwarte przy prawym/dolnym brzegu okna
//     musi się przesunąć, a nie wystawać poza ekran (i nie da się go wtedy
//     kliknąć). Do pierwszego pomiaru menu jest ukryte, żeby nie migało.
//  3. ZAKRES AKCJI. Sekcja, sekcja wewnętrzna, kolumna, widget i puste tło
//     mają różne zestawy - pomyłka daje „Dodaj kolumnę” na widgecie.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuilderContextMenu, type CtxTarget } from "../BuilderContextMenu";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

const K = (key: string) => `builder.contextMenu.${key}`;

const target = (kind: CtxTarget["kind"] = "section", x = 100, y = 100): CtxTarget => ({
  kind,
  id: "n1",
  x,
  y,
});

type Actions = Parameters<typeof BuilderContextMenu>[0]["actions"];

function renderMenu(actions: Actions = {}, t: CtxTarget | null = target()) {
  const onClose = vi.fn();
  const view = render(<BuilderContextMenu target={t} actions={actions} onClose={onClose} />);
  return { ...view, onClose };
}

/** Wymusza deterministyczny rozmiar menu - happy-dom mierzy wszystko na zero. */
function stubMenuSize(width: number, height: number): void {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => height,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BuilderContextMenu - widoczność", () => {
  it("bez celu nie renderuje niczego", () => {
    const { container } = renderMenu({}, null);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renderuje się portalem do body", () => {
    const { container } = renderMenu();
    // Menu MUSI wyjść z drzewa kanwy - inaczej przycięłoby je `overflow`
    // kontenera podglądu.
    expect(container.firstChild).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  });

  it.each([
    ["section", "kindSection"],
    ["inner-section", "kindInnerSection"],
    ["column", "kindColumn"],
    ["widget", "kindWidget"],
    ["empty", "kindArea"],
  ] as const)("nagłówek dla rodzaju %s", (kind, key) => {
    renderMenu({}, target(kind));
    expect(screen.getByText(K(key))).toBeInTheDocument();
  });

  it("bez żadnych akcji menu ma tylko nagłówek i zamknięcie", () => {
    renderMenu();
    // Menu bez akcji jest ślepe - lepiej pokazać puste niż wyszarzoną listę
    // czynności, których rodzic nie obsługuje.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByLabelText(K("close"))).toBeInTheDocument();
  });
});

describe("BuilderContextMenu - zamykanie", () => {
  it("krzyżyk zamyka menu", () => {
    const { onClose } = renderMenu();
    fireEvent.click(screen.getByLabelText(K("close")));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("klik poza menu zamyka", () => {
    const { onClose } = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("klik w menu nie zamyka", () => {
    const { onClose } = renderMenu();
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("prawy przycisk poza menu zamyka", () => {
    const { onClose } = renderMenu();
    fireEvent.contextMenu(document.body);
    // Drugie prawe kliknięcie ma OTWORZYĆ nowe menu, nie doklejać drugiego.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("prawy przycisk w menu jest blokowany", () => {
    const { onClose } = renderMenu();
    const cancelled = !fireEvent.contextMenu(screen.getByRole("menu"));
    expect(cancelled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape zamyka", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pozostałe klawisze nie zamykają", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("przewinięcie strony zamyka", () => {
    const { onClose } = renderMenu();
    fireEvent.scroll(window);
    // Menu jest przypięte do współrzędnych kursora, więc po przewinięciu
    // wskazywałoby inny element niż ten, na którym je otwarto.
    expect(onClose).toHaveBeenCalled();
  });

  it("zdjęcie celu odpina nasłuchy", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <BuilderContextMenu target={target()} actions={{}} onClose={onClose} />,
    );
    rerender(<BuilderContextMenu target={null} actions={{}} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("BuilderContextMenu - pozycjonowanie", () => {
  it("staje w punkcie kursora, gdy się mieści", () => {
    stubMenuSize(200, 300);
    renderMenu({}, target("section", 100, 120));
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("120px");
    expect(menu.style.visibility).toBe("visible");
  });

  it("odwraca się od prawej i dolnej krawędzi", () => {
    stubMenuSize(300, 400);
    renderMenu({}, target("section", window.innerWidth - 10, window.innerHeight - 10));
    const menu = screen.getByRole("menu");
    expect(Number.parseInt(menu.style.left, 10)).toBe(window.innerWidth - 300 - 8);
    expect(Number.parseInt(menu.style.top, 10)).toBe(window.innerHeight - 400 - 8);
  });

  it("menu większe niż okno przykleja się do marginesu", () => {
    stubMenuSize(window.innerWidth + 500, window.innerHeight + 500);
    renderMenu({}, target("section", 50, 50));
    const menu = screen.getByRole("menu");
    // Klamp na `pad` - inaczej menu wyjechałoby w ujemne współrzędne i jego
    // górna część byłaby nieklikalna.
    expect(menu.style.left).toBe("8px");
    expect(menu.style.top).toBe("8px");
  });
});

describe("BuilderContextMenu - akcje", () => {
  it("każda akcja najpierw zamyka menu, potem się wykonuje", () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push("zamknięcie"));
    render(
      <BuilderContextMenu
        target={target()}
        actions={{ remove: () => order.push("usunięcie") }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(K("remove")) }));
    // Kolejność jest kontraktem: menu przypięte do usuniętego węzła zostawało
    // na ekranie i kolejny klik leciał w pustkę.
    expect(order).toEqual(["zamknięcie", "usunięcie"]);
  });

  it("właściwości otwierają panel", () => {
    const openProperties = vi.fn();
    renderMenu({ openProperties });
    fireEvent.click(screen.getByRole("button", { name: K("properties") }));
    expect(openProperties).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["duplikat", "duplicate"],
    ["kopiowanie", "copy"],
    ["wycięcie", "cut"],
    ["dodanie sekcji", "addSection"],
    ["dodanie kolumny", "addColumn"],
    ["dodanie sekcji wewnętrznej", "addInnerSection"],
    ["szablon", "saveAsTemplate"],
    ["widget globalny", "saveAsGlobal"],
    ["odłączenie globalnego", "unlinkGlobal"],
    ["test A/B", "startAbTest"],
  ] as const)("wywołuje akcję: %s", (_label, key) => {
    const fn = vi.fn();
    renderMenu({ [key]: fn });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(K(key)) }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("wklejanie jest wyłączone bez schowka", () => {
    const paste = vi.fn();
    const { rerender } = render(
      <BuilderContextMenu
        target={target()}
        actions={{ paste, hasClipboard: false }}
        onClose={vi.fn()}
      />,
    );
    const item = () => screen.getByRole("button", { name: new RegExp(K("paste")) });
    expect(item()).toBeDisabled();
    fireEvent.click(item());
    expect(paste).not.toHaveBeenCalled();
    rerender(
      <BuilderContextMenu
        target={target()}
        actions={{ paste, hasClipboard: true }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(item());
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it("przesuwanie pokazuje się razem, ale każdy kierunek ma własny warunek", () => {
    const moveUp = vi.fn();
    const moveDown = vi.fn();
    renderMenu({ moveUp, moveDown, canMoveUp: false, canMoveDown: true });
    const up = screen.getByRole("button", { name: new RegExp(K("moveUp")) });
    const down = screen.getByRole("button", { name: new RegExp(K("moveDown")) });
    // Pierwszy element listy nie ma „w górę”, ale ma „w dół” - jedna flaga na
    // oba kierunki blokowałaby przesuwanie w ogóle.
    expect(up).toBeDisabled();
    expect(down).toBeEnabled();
    fireEvent.click(down);
    expect(moveDown).toHaveBeenCalledTimes(1);
    expect(moveUp).not.toHaveBeenCalled();
  });

  it("brak flag przesuwania ukrywa oba przyciski", () => {
    renderMenu({ moveUp: vi.fn(), moveDown: vi.fn() });
    expect(screen.queryByRole("button", { name: new RegExp(K("moveUp")) })).toBeNull();
  });

  it("sama flaga „w dół” wystarcza, by pokazać przesuwanie", () => {
    renderMenu({ canMoveDown: true, moveDown: vi.fn() });
    expect(screen.getByRole("button", { name: new RegExp(K("moveDown")) })).toBeInTheDocument();
  });

  it.each([
    ["ukryty", true, "showOnDevice"],
    ["widoczny", false, "hideOnDevice"],
  ])("przełącznik widoczności dla elementu %s", (_label, hiddenOnDevice, key) => {
    const toggleHidden = vi.fn();
    renderMenu({ toggleHidden, hiddenOnDevice });
    fireEvent.click(screen.getByRole("button", { name: K(key) }));
    expect(toggleHidden).toHaveBeenCalledTimes(1);
  });

  it("test A/B: nagłówek wariantu i trzy zakończenia", () => {
    const endAbTestKeepA = vi.fn();
    const endAbTestKeepB = vi.fn();
    const endAbTestKeepBoth = vi.fn();
    renderMenu({ abVariant: "b", endAbTestKeepA, endAbTestKeepB, endAbTestKeepBoth });
    expect(screen.getByText(K("abVariantHeader") + "(variant=B)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: K("endAbKeepA") }));
    fireEvent.click(screen.getByRole("button", { name: K("endAbKeepB") }));
    fireEvent.click(screen.getByRole("button", { name: K("endAbKeepBoth") }));
    expect(endAbTestKeepA).toHaveBeenCalledTimes(1);
    expect(endAbTestKeepB).toHaveBeenCalledTimes(1);
    expect(endAbTestKeepBoth).toHaveBeenCalledTimes(1);
  });

  it("pozycja bez akcji jest wyłączona", () => {
    renderMenu({ abVariant: "a" });
    // Zakończenia testu bez przekazanych funkcji - pozycja widoczna, ale
    // nieklikalna (rodzic wie, że nie umie ich obsłużyć).
    expect(screen.getByRole("button", { name: K("endAbKeepA") })).toBeDisabled();
  });

  it("usuwanie jest oznaczone jako groźne i ma skrót", () => {
    renderMenu({ remove: vi.fn() });
    const item = screen.getByRole("button", { name: new RegExp(K("remove")) });
    expect(item.className).toContain("text-destructive");
    expect(item.textContent).toContain("Del");
  });

  it("skróty klawiszowe stoją przy operacjach schowka", () => {
    renderMenu({ duplicate: vi.fn(), copy: vi.fn(), cut: vi.fn(), paste: vi.fn() });
    expect(screen.getByRole("button", { name: new RegExp(K("duplicate")) }).textContent).toContain(
      "⌘D",
    );
    expect(screen.getByRole("button", { name: new RegExp(K("copy")) }).textContent).toContain("⌘C");
    expect(screen.getByRole("button", { name: new RegExp(K("cut")) }).textContent).toContain("⌘X");
    expect(screen.getByRole("button", { name: new RegExp(K("paste")) }).textContent).toContain(
      "⌘V",
    );
  });

  it("zestaw akcji widgetu nie zawiera akcji kolumny", () => {
    renderMenu(
      { openProperties: vi.fn(), duplicate: vi.fn(), saveAsGlobal: vi.fn(), remove: vi.fn() },
      target("widget"),
    );
    expect(screen.queryByRole("button", { name: new RegExp(K("addColumn")) })).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(K("saveAsGlobal")) })).toBeInTheDocument();
  });
});

// Chrome buildera: pasek narzędzi, pasek akcji kanwy, ramka podglądu
// (nagłówek/stopka), stan pustego dokumentu i strefa wstawiania sekcji.
//
// To są małe komponenty, ale każdy z nich trzyma jedną decyzję, której nie
// widać w wyglądzie:
//  - pasek narzędzi i pasek akcji WYŁĄCZAJĄ przyciski, kiedy operacja jest
//    niemożliwa (brak historii, brak zaznaczenia) - włączony przycisk cofania
//    bez historii to cichy błąd, nie kosmetyka;
//  - pasek akcji nazywa RODZAJ zaznaczenia w etykiecie usuwania, żeby
//    redaktor wiedział, co właściwie zniknie;
//  - ramka podglądu ODCINA kliknięcia od treści (nagłówek strony w kanwie nie
//    ma nawigować) i prowadzi do właściwego edytora;
//  - strefa wstawiania nie wstawia od razu - najpierw pyta o układ kolumn.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Selection } from "../types";
import { Toolbar } from "../Toolbar";
import { CanvasActionBar } from "../CanvasActionBar";
import { ChromeFrame } from "../ChromeFrame";
import { EmptyState } from "../EmptyState";
import { SectionDropZone } from "../SectionDropZone";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub };
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function toolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const props = {
    lang: "pl" as const,
    onLangChange: vi.fn(),
    device: "desktop" as const,
    setDevice: vi.fn(),
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    mode: "light" as const,
    setMode: vi.fn(),
    ...overrides,
  };
  const view = render(<Toolbar {...props} />);
  return { ...props, unmount: view.unmount };
}

describe("Toolbar", () => {
  it.each([
    ["pulpit", "desktop"],
    ["tablet", "tablet"],
    ["telefon", "mobile"],
  ] as const)("wybór urządzenia %s zgłasza zmianę", (_label, device) => {
    const props = toolbar();
    fireEvent.click(screen.getByTitle(device));
    expect(props.setDevice).toHaveBeenCalledWith(device);
  });

  it("aktywne urządzenie jest oznaczone, pozostałe nie", () => {
    toolbar({ device: "tablet" });
    expect(screen.getByTitle("tablet").getAttribute("data-active")).toBe("true");
    expect(screen.getByTitle("desktop").getAttribute("data-active")).toBe("false");
  });

  it.each([
    ["jasny", "builder.chrome.lightMode", "light"],
    ["ciemny", "builder.chrome.darkMode", "dark"],
  ] as const)("tryb %s zgłasza zmianę", (_label, title, mode) => {
    const props = toolbar({ mode: mode === "light" ? "dark" : "light" });
    fireEvent.click(screen.getByTitle(title));
    expect(props.setMode).toHaveBeenCalledWith(mode);
  });

  it("aktywny tryb jest oznaczony", () => {
    toolbar({ mode: "dark" });
    expect(screen.getByTitle("builder.chrome.darkMode").getAttribute("data-active")).toBe("true");
    expect(screen.getByTitle("builder.chrome.lightMode").getAttribute("data-active")).toBe("false");
  });

  it.each([
    ["cofnij", "builder.chrome.undo", "canUndo", "onUndo"],
    ["ponów", "builder.chrome.redo", "canRedo", "onRedo"],
  ] as const)("%s jest wyłączony bez historii i działa z historią", (_l, title, flag, handler) => {
    const off = toolbar({ [flag]: false });
    const button = screen.getByTitle(title);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(off[handler]).not.toHaveBeenCalled();
    off.unmount();
    const on = toolbar({ [flag]: true });
    fireEvent.click(screen.getByTitle(title));
    expect(on[handler]).toHaveBeenCalledTimes(1);
  });

  it("przełącznik języka zgłasza nowy język edytowanej treści", () => {
    const props = toolbar({ lang: "pl" });
    fireEvent.click(screen.getByLabelText("common.lang.en"));
    expect(props.onLangChange).toHaveBeenCalledWith("en");
  });
});

describe("CanvasActionBar", () => {
  function bar(overrides: Partial<Parameters<typeof CanvasActionBar>[0]> = {}) {
    const props = {
      canUndo: true,
      canRedo: true,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      selection: { kind: null, id: null } as Selection,
      onDelete: vi.fn(),
      ...overrides,
    };
    const view = render(<CanvasActionBar {...props} />);
    return { ...props, unmount: view.unmount };
  }

  it.each([
    ["sekcja", "section", "builder.chrome.kindSection"],
    ["kolumna", "column", "builder.chrome.kindColumn"],
    ["widget", "widget", "builder.chrome.kindWidget"],
  ] as const)("usuwanie nazywa rodzaj zaznaczenia: %s", (_label, kind, kindKey) => {
    const props = bar({ selection: { kind, id: "x1" } });
    const button = screen.getByTitle("builder.chrome.deleteSelTitle");
    // Etykieta niesie rodzaj, bo „Usuń" bez rzeczownika nie mówi, co zniknie.
    expect(button.textContent).toContain(`builder.chrome.deleteKind(kind=${kindKey})`);
    fireEvent.click(button);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["brak zaznaczenia", { kind: null, id: null }],
    ["zaznaczenie bez identyfikatora", { kind: "widget", id: null }],
    ["sekcja wewnętrzna", { kind: "inner-section", id: "s9" }],
  ] as const)("usuwanie jest wyłączone: %s", (_label, selection) => {
    const props = bar({ selection });
    const button = screen.getByTitle("builder.chrome.deleteSelTitle");
    expect(button).toBeDisabled();
    expect(button.textContent).toContain("builder.chrome.nothingSelected");
    fireEvent.click(button);
    // Sekcja wewnętrzna kontenera nie ma własnej operacji usuwania - kliknięcie
    // musi być bez skutku, a nie usuwać rodzica.
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it.each([
    ["cofnij", "builder.chrome.undoTitle", "canUndo", "onUndo"],
    ["ponów", "builder.chrome.redoTitle", "canRedo", "onRedo"],
  ] as const)("%s zależy od historii", (_l, title, flag, handler) => {
    const off = bar({ [flag]: false });
    expect(screen.getByTitle(title)).toBeDisabled();
    fireEvent.click(screen.getByTitle(title));
    expect(off[handler]).not.toHaveBeenCalled();
    off.unmount();
    const on = bar({ [flag]: true });
    fireEvent.click(screen.getByTitle(title));
    expect(on[handler]).toHaveBeenCalledTimes(1);
  });
});

describe("ChromeFrame", () => {
  it("pokazuje etykietę, treść i odsyłacz do właściwego edytora", () => {
    render(
      <ChromeFrame label="Nagłówek" editTo="/admin/chrome/header">
        <span>treść podglądu</span>
      </ChromeFrame>,
    );
    expect(screen.getByText("Nagłówek")).toBeTruthy();
    expect(screen.getByText("treść podglądu")).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/chrome/header");
    // Etykieta w przycisku jest zapisana małymi literami w zdaniu.
    expect(link.textContent).toContain("Edytuj nagłówek");
  });

  it("kliknięcie w ramkę nie przechodzi do kanwy pod nią", () => {
    const onCanvasClick = vi.fn();
    render(
      <div onClick={onCanvasClick}>
        <ChromeFrame label="Stopka" editTo="/admin/chrome/footer">
          <span>stopka</span>
        </ChromeFrame>
      </div>,
    );
    fireEvent.click(screen.getByText("Stopka"));
    // Nagłówek i stopka nie są częścią dokumentu - klik w nie nie może
    // zmieniać zaznaczenia w kanwie.
    expect(onCanvasClick).not.toHaveBeenCalled();
  });

  it("treść podglądu jest odcięta od wskaźnika i od czytnika ekranu", () => {
    const { container } = render(
      <ChromeFrame label="Nagłówek" editTo="/x">
        <span>treść</span>
      </ChromeFrame>,
    );
    const shield = container.querySelector('[aria-hidden="true"]');
    expect(shield?.className).toContain("pointer-events-none");
  });
});

describe("EmptyState", () => {
  it("domyślnie zaprasza do wybrania pierwszej struktury", () => {
    const onAdd = vi.fn();
    render(<EmptyState onAdd={onAdd} />);
    expect(screen.getByText("builder.chrome.startBuilding")).toBeTruthy();
    expect(screen.getByText("builder.chrome.pickFirstStructure")).toBeTruthy();
    fireEvent.click(
      screen.getByTitle("builder.chrome.insertSection(label=builder.chrome.oneColumn)"),
    );
    expect(onAdd).toHaveBeenCalledWith([12]);
  });

  it("własny tytuł i podpowiedź zastępują domyślne", () => {
    render(<EmptyState onAdd={vi.fn()} title="Pusta zakładka" hint="Dodaj pierwszą sekcję" />);
    expect(screen.getByText("Pusta zakładka")).toBeTruthy();
    expect(screen.getByText("Dodaj pierwszą sekcję")).toBeTruthy();
    expect(screen.queryByText("builder.chrome.startBuilding")).toBeNull();
  });

  it("skrót do układu strony głównej pojawia się tylko z obsługą", () => {
    const { unmount } = render(<EmptyState onAdd={vi.fn()} />);
    expect(screen.queryByText("builder.chrome.loadHomeLayout")).toBeNull();
    unmount();
    const onLoadHomepage = vi.fn();
    render(<EmptyState onAdd={vi.fn()} onLoadHomepage={onLoadHomepage} />);
    fireEvent.click(screen.getByText("builder.chrome.loadHomeLayout"));
    expect(onLoadHomepage).toHaveBeenCalledTimes(1);
  });
});

describe("SectionDropZone", () => {
  function zone(overrides: Partial<Parameters<typeof SectionDropZone>[0]> = {}) {
    const props = { onInsert: vi.fn(), index: 2, ...overrides };
    const view = render(<SectionDropZone {...props} />);
    return { ...view, props };
  }

  it("zwinięta strefa niesie numer miejsca w tytule", () => {
    zone();
    // Numer jest liczony od jedynki - dla redaktora, nie dla tablicy.
    expect(screen.getByTitle("builder.chrome.insertSectionAt(index=3)")).toBeTruthy();
  });

  it("etykieta zastępuje ogólny tytuł", () => {
    zone({ label: "Wstaw na końcu" });
    expect(screen.getByTitle("Wstaw na końcu")).toBeTruthy();
    expect(screen.getByText("Wstaw na końcu")).toBeTruthy();
  });

  it("klik otwiera wybór układu, a wybór wstawia i zamyka", () => {
    const { props } = zone();
    fireEvent.click(screen.getByTitle("builder.chrome.insertSectionAt(index=3)"));
    expect(screen.getByText("builder.chrome.pickStructure")).toBeTruthy();
    expect(props.onInsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("builder.chrome.insertSection(label=1/2 · 1/2)"));
    expect(props.onInsert).toHaveBeenCalledWith([6, 6]);
    // Po wstawieniu strefa wraca do stanu zwiniętego - inaczej lista układów
    // zostawałaby otwarta pod każdą wstawioną sekcją.
    expect(screen.queryByText("builder.chrome.pickStructure")).toBeNull();
  });

  it("krzyżyk zamyka wybór bez wstawiania", () => {
    const { props } = zone();
    fireEvent.click(screen.getByTitle("builder.chrome.insertSectionAt(index=3)"));
    fireEvent.click(screen.getByText("×"));
    expect(screen.queryByText("builder.chrome.pickStructure")).toBeNull();
    expect(props.onInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["nad", "onRemoveAbove", "builder.chrome.deleteSectionAbove"],
    ["pod", "onRemoveBelow", "builder.chrome.deleteSectionBelow"],
  ] as const)("usuwanie sekcji %s pojawia się tylko z obsługą", (_label, prop, title) => {
    const bez = zone();
    fireEvent.click(screen.getByTitle("builder.chrome.insertSectionAt(index=3)"));
    expect(screen.queryByTitle(title)).toBeNull();
    bez.unmount();
    const handler = vi.fn();
    zone({ [prop]: handler });
    fireEvent.click(screen.getByTitle("builder.chrome.insertSectionAt(index=3)"));
    fireEvent.click(screen.getByTitle(title));
    expect(handler).toHaveBeenCalledTimes(1);
    // Usunięcie sąsiada też zamyka listę - dokument pod strefą się zmienił.
    expect(screen.queryByText("builder.chrome.pickStructure")).toBeNull();
  });

  it("kliknięcia w strefę nie docierają do kanwy", () => {
    const onCanvasClick = vi.fn();
    render(
      <div onClick={onCanvasClick}>
        <SectionDropZone onInsert={vi.fn()} index={0} label="pierwsza" />
      </div>,
    );
    fireEvent.click(screen.getByTitle("pierwsza"));
    // Klik w chrome buildera nie może kasować zaznaczenia w kanwie.
    expect(onCanvasClick).not.toHaveBeenCalled();
  });
});

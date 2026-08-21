// Dwie kontrolki wyboru sterowane KLAWIATURĄ: przełącznik układu katalogu
// (`ClubHubLayoutSwitch` + hook `useClubHubLayout`) i belka zakładek przestrzeni
// roboczej wątku (`ClubWorkspaceTabs`).
//
// CO TEN PLIK DOWODZI.
//  1. MAPA WARTOŚCI NIE JEST PRZESTAWIONA. Oba organizmy budują listę przycisków
//     z tablicy słownikowej (`CLUB_LAYOUTS`, `panels`) i emitują wybór przez
//     domknięcie w JSX-ie. Przestawiona para „przycisk -> emitowana wartość” nie
//     wychodzi ani na typach (wszystkie warianty mają ten sam typ), ani na
//     ekranie (ikona pasuje, bo pochodzi z tej samej mapy). Dlatego każdy
//     wariant jest tu klikany OSOBNO, a asercja porównuje emisję z etykietą
//     przycisku, w który kliknięto.
//  2. KONTRAKT WAI-ARIA JEST SPEŁNIONY, A NIE ZADEKLAROWANY. `radiogroup`
//     i `tablist` obiecują czytnikowi ekranu dokładnie jeden element w kolejności
//     tabulacji i przełączanie strzałkami. Test sprawdza roving tabindex, komplet
//     strzałek (w tym ZAWIJANIE na obu końcach), Home/End oraz to, że klawisz
//     spoza kontraktu NIE blokuje zdarzenia (`preventDefault`) - zablokowany
//     Enter albo Tab byłby regresją niewidoczną wzrokowo.
//  3. FOKUS IDZIE ZA ZAZNACZENIEM w belce zakładek. Bez tego druga strzałka
//     liczy się względem elementu, którego użytkownik już nie widzi jako
//     aktywnego - a to jest cała różnica między belką sterowaną klawiaturą
//     i dziewięcioma niezależnymi przyciskami.
//  4. TRZY STANY DANYCH belki: pełna lista paneli, lista JEDNOELEMENTOWA
//     (strzałka musi zostać na miejscu, a nie wyjść za tablicę) i lista PUSTA
//     (nie wolno rzucić ani wyrenderować zakładki-widma). Do tego stan
//     „aktywny panel spoza listy”, w którym strzałki muszą milczeć.
//  5. HOOK `useClubHubLayout` DEGRADUJE, A NIE WYWRACA: wartość domyślna,
//     wartość zapisana, wartość USZKODZONA w localStorage, zapis po zmianie,
//     sprzątnięcie starego klucza oraz OBIE awarie magazynu (odczyt i zapis),
//     bo w trybie prywatnym Safari `setItem` rzuca wyjątkiem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - `panelBadge` i `visiblePanels` - czyste funkcje z `threadWorkspaceTypes`
//    mają tabelę przypadków w `src/lib/clubs/__tests__/workspaceTypes.test.ts`.
//    Tutaj dowodzimy WYŁĄCZNIE tego, że licznik z podsumowania dojeżdża na
//    właściwą zakładkę (i że zero nie robi odznaki - to widać przez nazwę
//    dostępną).
//  - Wnętrza atomu `ClubWorkspaceTab` (klasy, kształt odznaki) - ma własny
//    dowód w `clubWorkspaceAtoms.test.tsx`.
//  - `toClubLayout` i słownika `CLUB_LAYOUTS` - `src/lib/clubs/__tests__/clubTypes.test.ts`.
//  - Istnienia kluczy i18n - pilnują bramki słownikowe (`clubI18nKeys.gate.test.ts`).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import {
  ClubHubLayoutSwitch,
  useClubHubLayout,
} from "@/components/clubs/molecules/ClubHubLayoutSwitch";
import { ClubWorkspaceTabs, panelId, tabId } from "@/components/clubs/molecules/ClubWorkspaceTabs";
import { CLUB_LAYOUTS, type ClubLayout } from "@/lib/clubs/types";
import {
  CLUB_WORKSPACE_PANELS,
  EMPTY_WORKSPACE_SUMMARY,
  type ClubWorkspacePanel,
  type ClubWorkspaceSummary,
} from "@/lib/clubs/workspaceTypes";

const STORAGE_KEY = "nes.club.hub.layout.v2";
const LEGACY_STORAGE_KEY = "nes.club.hub.layout";

/** Etykieta przycisku układu - dokładnie ta, którą renderuje produkcja. */
function layoutLabel(layout: ClubLayout): string {
  return `adminClubs.layout.${layout}`;
}

function renderSwitch(value: ClubLayout) {
  const onChange = vi.fn<(layout: ClubLayout) => void>();
  render(<ClubHubLayoutSwitch value={value} onChange={onChange} />);
  return { onChange, group: screen.getByRole("radiogroup") };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("ClubHubLayoutSwitch - kontrakt radiogroup", () => {
  it("renderuje po jednym przycisku na układ, z kluczem i18n w nazwie dostępnej", () => {
    renderSwitch("editorial");

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(CLUB_LAYOUTS.length);
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual(
      CLUB_LAYOUTS.map(layoutLabel),
    );
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-label", "club.hub.layoutLabel");
  });

  it("zaznacza DOKŁADNIE jeden układ i tylko on jest w kolejności tabulacji", () => {
    renderSwitch("magazine");

    const radios = screen.getAllByRole("radio");
    const checked = radios.filter((radio) => radio.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAttribute("aria-label", layoutLabel("magazine"));
    expect(checked[0]).toHaveAttribute("tabindex", "0");
    expect(radios.filter((radio) => radio.getAttribute("tabindex") === "-1")).toHaveLength(
      CLUB_LAYOUTS.length - 1,
    );
  });

  it.each(CLUB_LAYOUTS)("kliknięcie w układ „%s” emituje DOKŁADNIE ten układ", (layout) => {
    const { onChange } = renderSwitch("editorial");

    fireEvent.click(screen.getByLabelText(layoutLabel(layout)));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(layout);
  });

  it("kliknięcie w AKTYWNY układ emituje go ponownie - wybór jest idempotentny, nie przełącznikiem", () => {
    const { onChange } = renderSwitch("cards");

    fireEvent.click(screen.getByLabelText(layoutLabel("cards")));

    expect(onChange).toHaveBeenCalledWith("cards");
  });
});

describe("ClubHubLayoutSwitch - klawiatura", () => {
  const CASES: ReadonlyArray<{ key: string; from: ClubLayout; expected: ClubLayout }> = [
    { key: "ArrowRight", from: "list", expected: "cards" },
    { key: "ArrowDown", from: "list", expected: "cards" },
    // Zawijanie na końcu: z ostatniego układu strzałka w prawo wraca na pierwszy.
    { key: "ArrowRight", from: "editorial", expected: "list" },
    { key: "ArrowLeft", from: "cards", expected: "list" },
    { key: "ArrowUp", from: "cards", expected: "list" },
    // Zawijanie na początku: z pierwszego układu strzałka w lewo idzie na ostatni.
    { key: "ArrowLeft", from: "list", expected: "editorial" },
    { key: "Home", from: "magazine", expected: "list" },
    { key: "End", from: "magazine", expected: "editorial" },
  ];

  it.each(CASES)("$key z „$from” przestawia na „$expected” i blokuje zdarzenie", (testCase) => {
    const { onChange, group } = renderSwitch(testCase.from);

    const notPrevented = fireEvent.keyDown(group, { key: testCase.key });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(testCase.expected);
    // `fireEvent` zwraca false, gdy handler zawołał `preventDefault` - strzałka
    // nie może JEDNOCZEŚNIE przestawiać opcji i przewijać strony.
    expect(notPrevented).toBe(false);
  });

  it.each(["Enter", " ", "Tab", "a"])(
    "klawisz „%s” nie zmienia układu i NIE blokuje zdarzenia",
    (key) => {
      const { onChange, group } = renderSwitch("list");

      const notPrevented = fireEvent.keyDown(group, { key });

      expect(onChange).not.toHaveBeenCalled();
      expect(notPrevented).toBe(true);
    },
  );
});

describe("useClubHubLayout", () => {
  it("bez zapisu w magazynie zwraca układ edytorialny", async () => {
    const { result } = renderHook(() => useClubHubLayout());

    await waitFor(() => {
      expect(result.current[0]).toBe("editorial");
    });
  });

  it("odczytuje zapisany układ i sprząta stary klucz sprzed zmiany domyślnej", async () => {
    window.localStorage.setItem(STORAGE_KEY, "cards");
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "list");

    const { result } = renderHook(() => useClubHubLayout());

    await waitFor(() => {
      expect(result.current[0]).toBe("cards");
    });
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("USZKODZONA wartość w magazynie degraduje do domyślnej, a nie do listy ani do wyjątku", async () => {
    window.localStorage.setItem(STORAGE_KEY, "siatka-3d");

    const { result } = renderHook(() => useClubHubLayout());

    await waitFor(() => {
      expect(result.current[0]).toBe("editorial");
    });
  });

  it("zmiana układu wraca z hooka i ląduje w magazynie pod wersjonowanym kluczem", async () => {
    const { result } = renderHook(() => useClubHubLayout());
    await waitFor(() => {
      expect(result.current[0]).toBe("editorial");
    });

    act(() => {
      result.current[1]("list");
    });

    expect(result.current[0]).toBe("list");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("list");
  });

  it("awaria ODCZYTU magazynu nie wywraca hooka - zostaje układ domyślny", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("test: magazyn odcięty");
    });

    const { result } = renderHook(() => useClubHubLayout());

    await waitFor(() => {
      expect(result.current[0]).toBe("editorial");
    });
  });

  it("awaria ZAPISU (tryb prywatny) nie wywraca zmiany układu w pamięci", async () => {
    const { result } = renderHook(() => useClubHubLayout());
    await waitFor(() => {
      expect(result.current[0]).toBe("editorial");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("test: magazyn tylko do czytania");
    });

    act(() => {
      result.current[1]("magazine");
    });

    expect(result.current[0]).toBe("magazine");
  });
});

// --- belka zakładek ---------------------------------------------------------

function summary(overrides: Partial<ClubWorkspaceSummary> = {}): ClubWorkspaceSummary {
  return { ...EMPTY_WORKSPACE_SUMMARY, ...overrides };
}

function renderTabs(options: {
  panels: readonly ClubWorkspacePanel[];
  active: ClubWorkspacePanel;
  summary?: ClubWorkspaceSummary;
}) {
  const onSelect = vi.fn<(panel: ClubWorkspacePanel) => void>();
  render(
    <ClubWorkspaceTabs
      panels={options.panels}
      active={options.active}
      summary={options.summary ?? summary()}
      onSelect={onSelect}
    />,
  );
  return { onSelect, list: screen.getByRole("tablist") };
}

describe("ClubWorkspaceTabs - dane pełne", () => {
  it("wiąże każdą zakładkę z jej panelem i wystawia klucz i18n jako etykietę", () => {
    renderTabs({ panels: CLUB_WORKSPACE_PANELS, active: "discussion" });

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(CLUB_WORKSPACE_PANELS.length);
    CLUB_WORKSPACE_PANELS.forEach((panel, index) => {
      expect(tabs[index]).toHaveAttribute("id", tabId(panel));
      expect(tabs[index]).toHaveAttribute("aria-controls", panelId(panel));
      expect(tabs[index]).toHaveTextContent(`club.workspace.panel.${panel}`);
    });
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-label", "club.workspace.tabsLabel");
  });

  it("zaznacza DOKŁADNIE aktywny panel i tylko jego zostawia w kolejności tabulacji", () => {
    renderTabs({ panels: CLUB_WORKSPACE_PANELS, active: "documents" });

    const selected = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("id", tabId("documents"));
    expect(selected[0]).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "club.workspace.panel.discussion" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it.each(CLUB_WORKSPACE_PANELS)(
    "kliknięcie zakładki „%s” emituje DOKŁADNIE ten panel",
    (panel) => {
      const { onSelect } = renderTabs({ panels: CLUB_WORKSPACE_PANELS, active: "discussion" });

      fireEvent.click(screen.getByRole("tab", { name: `club.workspace.panel.${panel}` }));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(panel);
    },
  );

  it("licznik z podsumowania trafia na WŁAŚCIWĄ zakładkę, a zero nie robi odznaki", () => {
    renderTabs({
      panels: ["discussion", "participants", "documents"],
      active: "discussion",
      summary: summary({ participants: 3, documents: 0 }),
    });

    expect(
      screen.getByRole("tab", { name: "club.workspace.panel.participants (3)" }),
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "club.workspace.panel.documents" })).toBeVisible();
    // Dyskusja nie liczy niczego - pierwszy panel jest zawsze pełny.
    expect(screen.getByRole("tab", { name: "club.workspace.panel.discussion" })).toBeVisible();
  });
});

describe("ClubWorkspaceTabs - klawiatura", () => {
  const PANELS: readonly ClubWorkspacePanel[] = ["discussion", "documents", "search"];
  const CASES: ReadonlyArray<{
    key: string;
    active: ClubWorkspacePanel;
    expected: ClubWorkspacePanel;
  }> = [
    { key: "ArrowRight", active: "discussion", expected: "documents" },
    // Pierścień: z ostatniej zakładki strzałka w prawo wraca na pierwszą.
    { key: "ArrowRight", active: "search", expected: "discussion" },
    { key: "ArrowLeft", active: "discussion", expected: "search" },
    { key: "ArrowLeft", active: "documents", expected: "discussion" },
    { key: "Home", active: "search", expected: "discussion" },
    { key: "End", active: "discussion", expected: "search" },
  ];

  it.each(CASES)("$key z „$active” wybiera „$expected” i blokuje zdarzenie", (testCase) => {
    const { onSelect, list } = renderTabs({ panels: PANELS, active: testCase.active });

    const notPrevented = fireEvent.keyDown(list, { key: testCase.key });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(testCase.expected);
    expect(notPrevented).toBe(false);
  });

  it("fokus idzie ZA zaznaczeniem - kolejna strzałka liczy od nowej zakładki", async () => {
    const { list } = renderTabs({ panels: PANELS, active: "discussion" });

    fireEvent.keyDown(list, { key: "ArrowRight" });

    await waitFor(() => {
      expect(document.activeElement).toBe(document.getElementById(tabId("documents")));
    });
  });

  it("klawisz spoza kontraktu nie wybiera panelu i nie blokuje zdarzenia", () => {
    const { onSelect, list } = renderTabs({ panels: PANELS, active: "discussion" });

    const notPrevented = fireEvent.keyDown(list, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it("aktywny panel SPOZA listy zamyka ruch strzałkami - belka nie zgaduje pozycji", () => {
    const { onSelect, list } = renderTabs({ panels: ["discussion", "search"], active: "polls" });

    fireEvent.keyDown(list, { key: "ArrowRight" });
    fireEvent.keyDown(list, { key: "ArrowLeft" });

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ClubWorkspaceTabs - dane skrajne", () => {
  it("lista JEDNOELEMENTOWA: strzałka zostaje na tej samej zakładce", () => {
    const { onSelect, list } = renderTabs({ panels: ["discussion"], active: "discussion" });

    fireEvent.keyDown(list, { key: "ArrowRight" });

    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(onSelect).toHaveBeenCalledWith("discussion");
  });

  it("lista PUSTA renderuje belkę bez zakładek i bez wyjątku", () => {
    renderTabs({ panels: [], active: "discussion" });

    expect(screen.getByRole("tablist")).toBeVisible();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});

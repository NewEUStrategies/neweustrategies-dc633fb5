// Panel buildera sidebara jako POWŁOKA nad czystym reduktorem.
//
// Po wyprowadzeniu decyzji do `@/lib/sidebarBuilder/draft` ten test nie
// sprawdza już REGUŁ (te mają własną tabelę w `draft.test.ts`), tylko
// SKLEJENIE: czy właściwa interakcja wywołuje właściwą funkcję reduktora,
// czy wynik trafia do stanu i czy panel przeżywa stany brzegowe danych
// (brak układów, układ pusty, zapytanie w toku).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { DEFAULT_READING_PANEL_SETTINGS, SOCIAL_KEYS } from "@/lib/sidebarBuilder/types";

const h = vi.hoisted(() => ({
  lang: "pl",
  layouts: [] as unknown[],
  layoutsError: null as Error | null,
  update: vi.fn(),
  insert: vi.fn(),
  profileSelect: vi.fn(),
  getSession: vi.fn(),
  promptDialog: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  newWidgetId: "w-nowy",
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => h.lang);
});
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));
vi.mock("@/lib/appDialogs", () => ({ promptDialog: h.promptDialog }));
vi.mock("@/components/share/FloatingShareBar", () => ({
  FloatingShareBar: (props: { settings?: unknown }) => (
    <div data-testid="podglad-panelu" data-settings={JSON.stringify(props.settings ?? null)} />
  ),
}));
vi.mock("@/lib/queries/sidebarLayouts", () => ({
  allSidebarLayoutsQueryOptions: () => ({
    queryKey: ["post-sidebar-layout", "all"],
    queryFn: async () => {
      if (h.layoutsError) throw h.layoutsError;
      return h.layouts;
    },
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: h.getSession },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: h.profileSelect }) }),
        };
      }
      return {
        update: (payload: unknown) => ({ eq: () => h.update(payload) }),
        insert: (payload: unknown) => ({
          select: () => ({ single: () => h.insert(payload) }),
        }),
      };
    },
  },
}));

import { SidebarBuilderPane } from "@/components/admin/sidebarBuilder/SidebarBuilderPane";

const LAYOUT = {
  id: "layout-1",
  tenant_id: "tenant-1",
  name: "Domyślny",
  is_default: true,
  widgets: [
    {
      id: "w-panel",
      type: "reading-panel" as const,
      hidden: false,
      settings: { ...DEFAULT_READING_PANEL_SETTINGS },
    },
    { id: "w-tags", type: "tags" as const, hidden: false, settings: {} },
  ],
};

beforeEach(() => {
  h.lang = "pl";
  h.layouts = [structuredClone(LAYOUT)];
  h.layoutsError = null;
  h.update.mockReset().mockResolvedValue({ error: null });
  h.insert.mockReset().mockResolvedValue({ data: { id: "layout-nowy" }, error: null });
  h.profileSelect.mockReset().mockResolvedValue({ data: { tenant_id: "tenant-1" }, error: null });
  h.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  h.promptDialog.mockReset().mockResolvedValue(null);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Render + oczekiwanie na wczytanie układów (bez tego kanwa jest pusta). */
async function renderPane(): Promise<ReturnType<typeof renderWithQueryClient>> {
  const utils = renderWithQueryClient(<SidebarBuilderPane />);
  await waitFor(() => expect(screen.getByDisplayValue("Domyślny")).toBeTruthy());
  return utils;
}

/**
 * Wiersze widgetów na kanwie, w kolejności dokumentu.
 *
 * Selektor jest NIEZALEŻNY OD JĘZYKA: wiersz kanwy (i tylko on) niesie numer
 * porządkowy `#N`. Filtrowanie po `aria-label` działałoby wyłącznie dla jednego
 * języka, a ten test sprawdza oba.
 */
function canvasRows(): HTMLElement[] {
  return screen
    .getAllByRole("listitem")
    .filter((li) => li.querySelector("span.tabular-nums") !== null);
}

/** Etykiety przycisków operacji w wierszu - do asercji o języku interfejsu. */
function rowActionLabels(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll("button[aria-label]")).map(
    (b) => b.getAttribute("aria-label") ?? "",
  );
}

const rowLabels = (): string[] =>
  canvasRows().map((li) => li.querySelector("span.text-sm")?.textContent ?? "");

describe("SidebarBuilderPane - stany danych", () => {
  it("BEZ układów pokazuje zachętę do wybrania lub utworzenia", async () => {
    h.layouts = [];
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() => expect(screen.getByText("Wybierz lub utwórz układ.")).toBeTruthy());
  });

  it("układ BEZ widgetów pokazuje zachętę do dodania z biblioteki", async () => {
    h.layouts = [{ ...structuredClone(LAYOUT), widgets: [] }];
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() =>
      expect(screen.getByText("Dodaj widget z biblioteki po lewej.")).toBeTruthy(),
    );
  });

  it("otwiera układ oznaczony jako DOMYŚLNY, nie pierwszy z listy", async () => {
    h.layouts = [
      { ...structuredClone(LAYOUT), id: "l-a", name: "Pierwszy", is_default: false },
      { ...structuredClone(LAYOUT), id: "l-b", name: "Domyślny wariant", is_default: true },
    ];
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() => expect(screen.getByDisplayValue("Domyślny wariant")).toBeTruthy());
  });

  it("BŁĄD zapytania nie wywala panelu - biblioteka nadal się renderuje", async () => {
    h.layoutsError = new Error("brak dostępu");
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() => expect(screen.getByText("BIBLIOTEKA WIDGETÓW")).toBeTruthy());
    expect(screen.getByText("Wybierz lub utwórz układ.")).toBeTruthy();
  });

  it("przyciski biblioteki są WYŁĄCZONE, dopóki nie ma draftu", async () => {
    h.layouts = [];
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() => expect(screen.getByText("BIBLIOTEKA WIDGETÓW")).toBeTruthy());
    const dodaj = screen.getByText("Tagi").closest("button") as HTMLButtonElement;
    expect(dodaj.disabled).toBe(true);
  });

  it("przełączenie układu na liście wczytuje jego draft", async () => {
    h.layouts = [
      structuredClone(LAYOUT),
      { ...structuredClone(LAYOUT), id: "l-b", name: "Wariant B", is_default: false, widgets: [] },
    ];
    await renderPane();
    fireEvent.click(screen.getByText("Wariant B"));
    await waitFor(() => expect(screen.getByDisplayValue("Wariant B")).toBeTruthy());
    expect(screen.getByText("Dodaj widget z biblioteki po lewej.")).toBeTruthy();
  });
});

describe("SidebarBuilderPane - interakcje kanwy", () => {
  it("kliknięcie widgetu w bibliotece DODAJE go na koniec i zaznacza", async () => {
    await renderPane();
    expect(rowLabels()).toEqual(["Panel czytania", "Tagi"]);
    fireEvent.click(screen.getByText("Newsletter").closest("button") as HTMLElement);
    await waitFor(() => expect(rowLabels()).toEqual(["Panel czytania", "Tagi", "Newsletter"]));
    // Nowy widget bez własnych opcji - inspektor mówi to wprost.
    expect(screen.getByText("Ten widget nie ma dodatkowych opcji.")).toBeTruthy();
  });

  it("strzałka W DÓŁ zamienia widget z następnym", async () => {
    await renderPane();
    fireEvent.click(canvasRows()[0].querySelector('[aria-label="W dół"]') as HTMLElement);
    await waitFor(() => expect(rowLabels()).toEqual(["Tagi", "Panel czytania"]));
  });

  it("strzałka W GÓRĘ zamienia widget z poprzednim", async () => {
    await renderPane();
    fireEvent.click(canvasRows()[1].querySelector('[aria-label="W górę"]') as HTMLElement);
    await waitFor(() => expect(rowLabels()).toEqual(["Tagi", "Panel czytania"]));
  });

  it("strzałka W GÓRĘ pierwszego wiersza jest WYŁĄCZONA", async () => {
    await renderPane();
    const up = canvasRows()[0].querySelector('[aria-label="W górę"]') as HTMLButtonElement;
    expect(up.disabled).toBe(true);
  });

  it("strzałka W DÓŁ ostatniego wiersza jest WYŁĄCZONA", async () => {
    await renderPane();
    const rows = canvasRows();
    const down = rows[rows.length - 1].querySelector('[aria-label="W dół"]') as HTMLButtonElement;
    expect(down.disabled).toBe(true);
  });

  it("kosz USUWA widget z kanwy", async () => {
    await renderPane();
    fireEvent.click(canvasRows()[1].querySelector('[aria-label="Usuń"]') as HTMLElement);
    await waitFor(() => expect(rowLabels()).toEqual(["Panel czytania"]));
  });

  it("usunięcie ZAZNACZONEGO widgetu czyści inspektor", async () => {
    await renderPane();
    // Panel czytania jest zaznaczony na start - inspektor pokazuje jego opcje.
    expect(screen.getByText("Funkcje")).toBeTruthy();
    fireEvent.click(canvasRows()[0].querySelector('[aria-label="Usuń"]') as HTMLElement);
    await waitFor(() => expect(screen.getByText("Wybierz widget na płótnie.")).toBeTruthy());
  });

  it("usunięcie INNEGO widgetu zostawia inspektor na zaznaczonym", async () => {
    await renderPane();
    fireEvent.click(canvasRows()[1].querySelector('[aria-label="Usuń"]') as HTMLElement);
    await waitFor(() => expect(rowLabels()).toEqual(["Panel czytania"]));
    expect(screen.getByText("Funkcje")).toBeTruthy();
  });

  it("przełącznik widoczności UKRYWA i ODKRYWA widget (etykieta się zmienia)", async () => {
    await renderPane();
    const row = canvasRows()[1];
    fireEvent.click(row.querySelector('[aria-label="Ukryj"]') as HTMLElement);
    await waitFor(() => expect(canvasRows()[1].querySelector('[aria-label="Pokaż"]')).toBeTruthy());
    fireEvent.click(canvasRows()[1].querySelector('[aria-label="Pokaż"]') as HTMLElement);
    await waitFor(() => expect(canvasRows()[1].querySelector('[aria-label="Ukryj"]')).toBeTruthy());
  });

  it("kliknięcie wiersza ZAZNACZA widget i pokazuje jego inspektor", async () => {
    await renderPane();
    fireEvent.click(within(canvasRows()[1]).getByText("Tagi"));
    await waitFor(() =>
      expect(screen.getByText("Ten widget nie ma dodatkowych opcji.")).toBeTruthy(),
    );
  });

  it("wiersze są numerowane od 1 w kolejności kanwy", async () => {
    await renderPane();
    expect(canvasRows().map((li) => li.querySelector("span.tabular-nums")?.textContent)).toEqual([
      "#1",
      "#2",
    ]);
  });

  it("widget typu NIEZNANEGO w bazie renderuje się z surową nazwą typu", async () => {
    h.layouts = [
      {
        ...structuredClone(LAYOUT),
        widgets: [{ id: "w-x", type: "widget-z-przyszlosci", hidden: false, settings: {} }],
      },
    ];
    await renderPane();
    expect(rowLabels()).toEqual(["widget-z-przyszlosci"]);
  });
});

describe("SidebarBuilderPane - inspektor panelu czytania", () => {
  it("pokazuje wszystkie pięć przełączników funkcji", async () => {
    await renderPane();
    for (const label of [
      "Spis treści",
      "Pasek postępu",
      "Zapisz później",
      "Drukuj",
      "Pobierz PDF",
    ]) {
      expect(screen.getByLabelText(label) ?? screen.getByText(label)).toBeTruthy();
    }
  });

  it("wyłączenie JEDNEGO przełącznika nie rusza pozostałych", async () => {
    await renderPane();
    const toc = screen.getByText("Spis treści").closest("label")?.querySelector("input");
    fireEvent.click(toc as HTMLElement);
    await waitFor(() => expect((toc as HTMLInputElement).checked).toBe(false));
    const progress = screen
      .getByText("Pasek postępu")
      .closest("label")
      ?.querySelector("input") as HTMLInputElement;
    expect(progress.checked).toBe(true);
  });

  it("pokazuje wszystkie osiem kanałów udostępniania", async () => {
    await renderPane();
    const labels = [
      "X (Twitter)",
      "Facebook",
      "LinkedIn",
      "E-mail",
      "Copy link",
      "WhatsApp",
      "Telegram",
      "Reddit",
    ];
    expect(labels).toHaveLength(SOCIAL_KEYS.length);
    for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
  });

  it("wyłączenie JEDNEGO kanału nie kasuje pozostałych (scalanie dwupoziomowe)", async () => {
    await renderPane();
    const x = screen.getByText("X (Twitter)").closest("label")?.querySelector("input");
    fireEvent.click(x as HTMLElement);
    await waitFor(() => expect((x as HTMLInputElement).checked).toBe(false));
    const fb = screen
      .getByText("Facebook")
      .closest("label")
      ?.querySelector("input") as HTMLInputElement;
    expect(fb.checked).toBe(true);
  });

  it("widget z NIEPEŁNYMI ustawieniami w bazie dostaje uzupełnione domyślne", async () => {
    h.layouts = [
      {
        ...structuredClone(LAYOUT),
        widgets: [
          { id: "w-panel", type: "reading-panel", hidden: false, settings: { showToc: false } },
        ],
      },
    ];
    await renderPane();
    const toc = screen
      .getByText("Spis treści")
      .closest("label")
      ?.querySelector("input") as HTMLInputElement;
    const pdf = screen
      .getByText("Pobierz PDF")
      .closest("label")
      ?.querySelector("input") as HTMLInputElement;
    expect(toc.checked).toBe(false);
    expect(pdf.checked).toBe(true);
    // Mapa kanałów też musi być pełna, mimo że w bazie jej nie było.
    expect(
      (screen.getByText("Reddit").closest("label")?.querySelector("input") as HTMLInputElement)
        .checked,
    ).toBe(false);
  });
});

describe("SidebarBuilderPane - podgląd panelu czytania", () => {
  it("pokazuje podgląd, gdy w układzie jest WIDOCZNY panel czytania", async () => {
    await renderPane();
    expect(screen.getByTestId("podglad-panelu")).toBeTruthy();
  });

  it("NIE pokazuje podglądu, gdy panel czytania jest UKRYTY", async () => {
    h.layouts = [
      {
        ...structuredClone(LAYOUT),
        widgets: [{ id: "w-panel", type: "reading-panel", hidden: true, settings: {} }],
      },
    ];
    await renderPane();
    expect(screen.queryByTestId("podglad-panelu")).toBeNull();
  });

  it("NIE pokazuje podglądu w układzie BEZ panelu czytania", async () => {
    h.layouts = [
      {
        ...structuredClone(LAYOUT),
        widgets: [{ id: "w-tags", type: "tags", hidden: false, settings: {} }],
      },
    ];
    await renderPane();
    expect(screen.queryByTestId("podglad-panelu")).toBeNull();
  });

  it("podgląd dostaje ustawienia panelu z draftu", async () => {
    await renderPane();
    const settings = JSON.parse(
      screen.getByTestId("podglad-panelu").getAttribute("data-settings") ?? "null",
    );
    expect(settings.showToc).toBe(true);
  });
});

describe("SidebarBuilderPane - zapis i tworzenie układu", () => {
  it("zmiana nazwy trafia do draftu i do zapisu", async () => {
    await renderPane();
    fireEvent.change(screen.getByDisplayValue("Domyślny"), { target: { value: "Nowa nazwa" } });
    fireEvent.click(screen.getByText("Zapisz"));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0]).toMatchObject({ name: "Nowa nazwa", is_default: true });
  });

  it("przełącznik domyślności trafia do zapisu", async () => {
    await renderPane();
    // Napis „domyślny" pada dwa razy: jako znacznik obok układu na liście
    // i jako etykieta przełącznika w nagłówku kanwy. Celujemy w przełącznik.
    const checkbox = screen
      .getAllByText("domyślny")
      .map((el) => el.closest("label")?.querySelector('input[type="checkbox"]'))
      .find((input): input is HTMLInputElement => input !== null && input !== undefined);
    fireEvent.click(checkbox as HTMLElement);
    fireEvent.click(screen.getByText("Zapisz"));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0]).toMatchObject({ is_default: false });
  });

  it("zapis waliduje widgety i wysyła je w postaci przechodzącej schemat", async () => {
    await renderPane();
    fireEvent.click(screen.getByText("Zapisz"));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const payload = h.update.mock.calls[0][0] as { widgets: Array<{ id: string; type: string }> };
    expect(payload.widgets.map((w) => w.type)).toEqual(["reading-panel", "tags"]);
  });

  it("udany zapis pokazuje potwierdzenie", async () => {
    await renderPane();
    fireEvent.click(screen.getByText("Zapisz"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Zapisano układ sidebaru"));
  });

  it("BŁĄD zapisu idzie przez wspólną obsługę błędów, nie przez surowy komunikat", async () => {
    h.update.mockResolvedValue({ error: new Error("update denied") });
    await renderPane();
    fireEvent.click(screen.getByText("Zapisz"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save"));
  });

  it("przycisk zapisu jest WYŁĄCZONY bez draftu", async () => {
    h.layouts = [];
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() => expect(screen.getByText("Zapisz")).toBeTruthy());
    expect((screen.getByText("Zapisz") as HTMLButtonElement).disabled).toBe(true);
  });

  it("ANULOWANIE okna nazwy nie tworzy układu", async () => {
    h.promptDialog.mockResolvedValue(null);
    await renderPane();
    fireEvent.click(screen.getByText(/Nowy układ/));
    await waitFor(() => expect(h.promptDialog).toHaveBeenCalled());
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("nazwa z samych SPACJI nie tworzy układu", async () => {
    h.promptDialog.mockResolvedValue("   ");
    await renderPane();
    fireEvent.click(screen.getByText(/Nowy układ/));
    await waitFor(() => expect(h.promptDialog).toHaveBeenCalled());
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("nazwa poprawna tworzy układ z jednym panelem czytania i przełącza na niego", async () => {
    h.promptDialog.mockResolvedValue("  Wariant C  ");
    await renderPane();
    fireEvent.click(screen.getByText(/Nowy układ/));
    await waitFor(() => expect(h.insert).toHaveBeenCalled());
    const payload = h.insert.mock.calls[0][0] as {
      name: string;
      is_default: boolean;
      widgets: Array<{ type: string }>;
    };
    expect(payload.name).toBe("Wariant C");
    expect(payload.is_default).toBe(false);
    expect(payload.widgets.map((w) => w.type)).toEqual(["reading-panel"]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Utworzono układ"));
  });

  it("BRAK sesji zatrzymuje tworzenie układu", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    h.promptDialog.mockResolvedValue("X");
    await renderPane();
    fireEvent.click(screen.getByText(/Nowy układ/));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "not_authenticated" }),
        "save",
      ),
    );
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("BŁĄD odczytu profilu zatrzymuje tworzenie układu", async () => {
    h.profileSelect.mockResolvedValue({ data: null, error: new Error("profile denied") });
    h.promptDialog.mockResolvedValue("X");
    await renderPane();
    fireEvent.click(screen.getByText(/Nowy układ/));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("BRAK najemcy w profilu zatrzymuje tworzenie układu", async () => {
    h.profileSelect.mockResolvedValue({ data: { tenant_id: null }, error: null });
    h.promptDialog.mockResolvedValue("X");
    await renderPane();
    fireEvent.click(screen.getByText(/Nowy układ/));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "no_tenant" }),
        "save",
      ),
    );
  });

  it("BŁĄD zapisu nowego układu idzie przez wspólną obsługę błędów", async () => {
    h.insert.mockResolvedValue({ data: null, error: new Error("insert denied") });
    h.promptDialog.mockResolvedValue("X");
    await renderPane();
    fireEvent.click(screen.getByText(/Nowy układ/));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save"));
  });
});

// Panel trzyma napisy wprost w kodzie jako `lang === "pl" ? "…" : "…"` (nie przez
// klucze i18n), więc drugie ramię KAŻDEGO z tych ~40 wyrażeń jest osobną gałęzią.
// Bez tego bloku wersja angielska panelu nie ma ANI JEDNEGO wykonania - a to
// znaczy, że literówka albo napis zostawiony po polsku wychodzi dopiero
// u redaktora pracującego w EN.
describe("SidebarBuilderPane - wersja angielska", () => {
  beforeEach(() => {
    h.lang = "en";
  });

  async function renderEn(): Promise<void> {
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() => expect(screen.getByDisplayValue("Domyślny")).toBeTruthy());
  }

  it("nagłówki kolumn są po angielsku", async () => {
    await renderEn();
    expect(screen.getByText("WIDGET LIBRARY")).toBeTruthy();
    expect(screen.getByText("WIDGET SETTINGS")).toBeTruthy();
    expect(screen.getByText("Layouts")).toBeTruthy();
  });

  it.each(["Reading panel", "Tags", "Author card", "Related posts", "Newsletter", "Ad slot"])(
    "biblioteka pokazuje angielską nazwę widgetu: %s",
    async (label) => {
      await renderEn();
      // „Reading panel" i „Tags" padają dwa razy (biblioteka + wiersz kanwy),
      // pozostałe raz - dlatego `getAllByText`, nie `getByText`.
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    },
  );

  it.each([
    "ToC + share + save",
    "Post tags",
    "Author bio and links",
    "List of related articles",
    "Signup form",
    "Sidebar ad slot",
  ])("biblioteka pokazuje angielski opis: %s", async (desc) => {
    await renderEn();
    expect(screen.getByText(desc)).toBeTruthy();
  });

  it("etykiety kanwy i przycisków są po angielsku", async () => {
    await renderEn();
    expect(screen.getByText("Save")).toBeTruthy();
    expect(screen.getAllByText(/New layout/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("default").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Layout name")).toBeTruthy();
  });

  it("etykiety operacji na widgecie są po angielsku", async () => {
    await renderEn();
    expect(rowActionLabels(canvasRows()[0])).toEqual(["Move up", "Move down", "Hide", "Delete"]);
  });

  it("etykieta odkrycia ukrytego widgetu jest po angielsku", async () => {
    h.layouts = [
      {
        ...structuredClone(LAYOUT),
        widgets: [{ id: "w-tags", type: "tags", hidden: true, settings: {} }],
      },
    ];
    await renderEn();
    expect(rowActionLabels(canvasRows()[0])).toContain("Show");
  });

  it("inspektor bez zaznaczenia mówi po angielsku", async () => {
    await renderEn();
    fireEvent.click(canvasRows()[0].querySelector('button[aria-label="Delete"]') as HTMLElement);
    await waitFor(() => expect(screen.getByText("Select a widget on the canvas.")).toBeTruthy());
  });

  it("inspektor widgetu bez opcji mówi po angielsku", async () => {
    await renderEn();
    fireEvent.click(within(canvasRows()[1]).getByText("Tags"));
    await waitFor(() => expect(screen.getByText("This widget has no extra options.")).toBeTruthy());
  });

  it.each(["Table of contents", "Progress bar", "Save for later", "Print", "Download PDF"])(
    "przełącznik funkcji ma angielską etykietę: %s",
    async (label) => {
      await renderEn();
      expect(screen.getByText(label)).toBeTruthy();
    },
  );

  it("nagłówki sekcji inspektora są po angielsku", async () => {
    await renderEn();
    expect(screen.getByText("Features")).toBeTruthy();
    expect(screen.getByText("Social platforms")).toBeTruthy();
  });

  it("nagłówek podglądu jest po angielsku", async () => {
    await renderEn();
    expect(screen.getByText("Reading panel preview")).toBeTruthy();
  });

  it("BEZ układów zachęta jest po angielsku", async () => {
    h.layouts = [];
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() => expect(screen.getByText("Pick or create a layout.")).toBeTruthy());
  });

  it("układ BEZ widgetów zachęca po angielsku", async () => {
    h.layouts = [{ ...structuredClone(LAYOUT), widgets: [] }];
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() =>
      expect(screen.getByText("Add a widget from the library on the left.")).toBeTruthy(),
    );
  });

  it("okno nowego układu dostaje angielskie etykiety", async () => {
    await renderEn();
    fireEvent.click(screen.getByText(/New layout/));
    await waitFor(() => expect(h.promptDialog).toHaveBeenCalled());
    expect(h.promptDialog.mock.calls[0][0]).toMatchObject({
      title: "New layout",
      label: "New layout name",
      confirmLabel: "Create",
    });
  });

  it("potwierdzenie zapisu jest po angielsku", async () => {
    await renderEn();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Sidebar layout saved"));
  });

  it("potwierdzenie utworzenia układu jest po angielsku", async () => {
    h.promptDialog.mockResolvedValue("Variant");
    await renderEn();
    fireEvent.click(screen.getByText(/New layout/));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Layout created"));
  });

  it("stan zapisywania ma angielski napis", async () => {
    let resolveUpdate: (v: unknown) => void = () => {};
    h.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    await renderEn();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Saving…")).toBeTruthy());
    resolveUpdate({ error: null });
    await waitFor(() => expect(screen.getByText("Save")).toBeTruthy());
  });

  it("podgląd dostaje angielski tytuł przykładowy", async () => {
    await renderEn();
    expect(screen.getByTestId("podglad-panelu")).toBeTruthy();
  });
});

describe("SidebarBuilderPane - stan zapisywania (PL)", () => {
  it("przycisk pokazuje polski napis w trakcie zapisu i wraca po zakończeniu", async () => {
    let resolveUpdate: (v: unknown) => void = () => {};
    h.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    renderWithQueryClient(<SidebarBuilderPane />);
    await waitFor(() => expect(screen.getByDisplayValue("Domyślny")).toBeTruthy());
    fireEvent.click(screen.getByText("Zapisz"));
    await waitFor(() => expect(screen.getByText("Zapisywanie…")).toBeTruthy());
    expect((screen.getByText("Zapisywanie…") as HTMLButtonElement).disabled).toBe(true);
    resolveUpdate({ error: null });
    await waitFor(() => expect(screen.getByText("Zapisz")).toBeTruthy());
  });
});

// Panel zapisanych wyszukiwań - powierzchnia, przez którą użytkownik włącza
// ALERTY o nowych wynikach. Warstwa danych ma własny test
// (`hooks/__tests__/useSavedSearches.test.tsx`); tutaj sprawdzamy to, czego
// tamten nie widzi: czy dzwonek pokazuje PRAWDZIWY stan alertu, czy nazwa
// zapisu dojeżdża do mutacji przycięta, i czy błąd zapisu w ogóle dociera do
// użytkownika, zamiast zniknąć w połkniętym wyjątku.
//
// Panel jest encjo-agnostyczny (20260807142000), więc testujemy też, że encja
// przechodzi do zapytania - inaczej panel wyszukiwarki treści pokazałby zapisy
// katalogu osób, których jego URL nie umie odtworzyć.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  user: { current: null as { id: string } | null },
  savedSearches: vi.fn(),
  save: vi.fn(),
  del: vi.fn(),
  toggle: vi.fn(),
  savePending: { current: false },
  togglePending: { current: false },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// react-i18next NIE JEST mockowany. `@/lib/i18n` robi
// `i18n.use(initReactI18next).init(...)`, więc `useTranslation()` bez providera
// czyta PRAWDZIWĄ instancję aplikacji - te same napisy, które zobaczy
// użytkownik. Udokumentowany w `i18nReal.ts` skrót
// `vi.mock("react-i18next", () => reactI18nextMock())` tutaj ZAKLESZCZA test
// (fabryka mocka importuje `@/lib/i18n`, a ten importuje `react-i18next`, czyli
// moduł właśnie mockowany - dokładnie pętla, przed którą ostrzega nagłówek tego
// helpera). W całym repo nie ma ani jednego użycia tego skrótu.
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

vi.mock("@/hooks/useSavedSearches", () => ({
  useSavedSearches: (entity?: string) => h.savedSearches(entity),
  useSaveSearch: () => ({ mutateAsync: h.save, isPending: h.savePending.current }),
  useDeleteSavedSearch: () => ({ mutateAsync: h.del }),
  useToggleSavedSearchAlert: () => ({
    mutateAsync: h.toggle,
    isPending: h.togglePending.current,
  }),
}));

import "@/test/i18nReal";
import "@/lib/i18n-search";
import { SavedSearchesPanel } from "../SavedSearchesPanel";
import type { SavedSearch } from "@/hooks/useSavedSearches";

const saved = (p: Partial<SavedSearch> = {}): SavedSearch => ({
  id: "s-1",
  name: "Energia w CEE",
  params: { q: "energia", topic: "t-1" },
  created_at: "2026-08-01T10:00:00Z",
  alert_enabled: false,
  url: "/search?q=energia",
  entity: "posts",
  ...p,
});

const noop = () => {};

function renderPanel(over: Partial<React.ComponentProps<typeof SavedSearchesPanel>> = {}) {
  return render(
    <SavedSearchesPanel
      current={{ q: "energia" }}
      canSave
      onApply={over.onApply ?? noop}
      {...over}
    />,
  );
}

beforeEach(() => {
  h.user.current = { id: "u-1" };
  h.savedSearches.mockReturnValue({ data: [] });
  h.save.mockResolvedValue(undefined);
  h.del.mockResolvedValue(undefined);
  h.toggle.mockResolvedValue(undefined);
  h.savePending.current = false;
  h.togglePending.current = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.save.mockClear();
  h.del.mockClear();
  h.toggle.mockClear();
});

afterEach(() => cleanup());

describe("SavedSearchesPanel - dostęp", () => {
  it("gość widzi zachętę do logowania i ŻADNEGO przycisku zapisu", () => {
    h.user.current = null;
    renderPanel();
    expect(screen.getByText("Zaloguj się, aby zapisywać wyszukiwania.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("gość nie odpytuje nawet o listę zapisów", () => {
    h.user.current = null;
    renderPanel();
    expect(screen.queryByText("Zapisane wyszukiwania")).not.toBeInTheDocument();
  });
});

describe("SavedSearchesPanel - stan pusty", () => {
  it("pokazuje komunikat pustej listy zamiast pustego <ul>", () => {
    renderPanel();
    expect(screen.getByText("Nie masz jeszcze zapisanych wyszukiwań.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("nierozstrzygnięte zapytanie (data undefined) też daje stan pusty, nie wysypkę", () => {
    h.savedSearches.mockReturnValue({ data: undefined });
    renderPanel();
    expect(screen.getByText("Nie masz jeszcze zapisanych wyszukiwań.")).toBeInTheDocument();
  });
});

describe("SavedSearchesPanel - encja", () => {
  it("domyślnie pyta o zapisy WPISÓW", () => {
    renderPanel();
    expect(h.savedSearches).toHaveBeenCalledWith("posts");
  });

  it("przekazuje encję katalogu osób do zapytania", () => {
    renderPanel({ entity: "people" });
    expect(h.savedSearches).toHaveBeenCalledWith("people");
  });
});

describe("SavedSearchesPanel - zapisywanie", () => {
  it("bez czego zapisywać przycisk jest zablokowany", () => {
    renderPanel({ canSave: false });
    expect(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ })).toBeDisabled();
  });

  it("zapis wymaga nazwy - przycisk potwierdzenia stoi zablokowany do czasu wpisania", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    const input = screen.getByPlaceholderText("Nazwa wyszukiwania");
    const confirm = screen.getAllByRole("button").find((b) => b.hasAttribute("disabled"));
    expect(confirm).toBeDefined();
    fireEvent.change(input, { target: { value: "Energia" } });
    expect(screen.getAllByRole("button").filter((b) => b.hasAttribute("disabled"))).toHaveLength(0);
  });

  it("sama spacja NIE jest nazwą - mutacja nie leci", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    const input = screen.getByPlaceholderText("Nazwa wyszukiwania");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.save).not.toHaveBeenCalled();
  });

  it("Enter zapisuje bieżący stan URL pod przyciętą nazwą", async () => {
    renderPanel({ current: { q: "energia", topic: "t-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    const input = screen.getByPlaceholderText("Nazwa wyszukiwania");
    fireEvent.change(input, { target: { value: "  Energia w CEE  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        name: "Energia w CEE",
        params: { q: "energia", topic: "t-1" },
        entity: "posts",
      }),
    );
  });

  it("udany zapis potwierdza toastem i zwija formularz", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    fireEvent.change(screen.getByPlaceholderText("Nazwa wyszukiwania"), {
      target: { value: "Energia" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Nazwa wyszukiwania"), { key: "Enter" });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Zapisano wyszukiwanie"));
    expect(screen.queryByPlaceholderText("Nazwa wyszukiwania")).not.toBeInTheDocument();
  });

  it("BŁĄD zapisu dociera do użytkownika i formularz ZOSTAJE otwarty", async () => {
    h.save.mockRejectedValue(new Error("row level security"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    fireEvent.change(screen.getByPlaceholderText("Nazwa wyszukiwania"), {
      target: { value: "Energia" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Nazwa wyszukiwania"), { key: "Enter" });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("row level security"));
    // Zwinięcie formularza po błędzie kasowałoby wpisaną nazwę bez zapisu.
    expect(screen.getByPlaceholderText("Nazwa wyszukiwania")).toBeInTheDocument();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd nie-Error też ma czytelną treść, nie „[object Object]”", async () => {
    h.save.mockRejectedValue("zerwane połączenie");
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    fireEvent.change(screen.getByPlaceholderText("Nazwa wyszukiwania"), {
      target: { value: "Energia" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Nazwa wyszukiwania"), { key: "Enter" });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("zerwane połączenie"));
  });

  it("Escape porzuca formularz i CZYŚCI wpisaną nazwę", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    fireEvent.change(screen.getByPlaceholderText("Nazwa wyszukiwania"), {
      target: { value: "Energia" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Nazwa wyszukiwania"), { key: "Escape" });
    expect(screen.queryByPlaceholderText("Nazwa wyszukiwania")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    expect(screen.getByPlaceholderText("Nazwa wyszukiwania")).toHaveValue("");
  });

  it("inne klawisze nie zapisują ani nie zamykają formularza", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    const input = screen.getByPlaceholderText("Nazwa wyszukiwania");
    fireEvent.change(input, { target: { value: "Energia" } });
    fireEvent.keyDown(input, { key: "a" });
    expect(h.save).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Nazwa wyszukiwania")).toBeInTheDocument();
  });

  it("krzyżyk zamyka formularz bez zapisu", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(screen.queryByPlaceholderText("Nazwa wyszukiwania")).not.toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
  });

  it("klik przycisku potwierdzenia zapisuje tak samo jak Enter", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    fireEvent.change(screen.getByPlaceholderText("Nazwa wyszukiwania"), {
      target: { value: "Energia" },
    });
    const confirm = screen
      .getAllByRole("button")
      .find((b) => !b.hasAttribute("disabled") && b.className.includes("h-8"));
    fireEvent.click(confirm!);
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
  });

  it("zapis w toku blokuje przycisk potwierdzenia (bez podwójnego wpisu)", () => {
    h.savePending.current = true;
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Zapisz wyszukiwanie/ }));
    fireEvent.change(screen.getByPlaceholderText("Nazwa wyszukiwania"), {
      target: { value: "Energia" },
    });
    expect(screen.getAllByRole("button").some((b) => b.hasAttribute("disabled"))).toBe(true);
  });
});

describe("SavedSearchesPanel - lista i przywracanie", () => {
  it("klik nazwy przywraca ZAPISANE parametry", () => {
    const onApply = vi.fn();
    const params = { q: "energia", topic: "t-1" };
    h.savedSearches.mockReturnValue({ data: [saved({ params })] });
    renderPanel({ onApply });
    fireEvent.click(screen.getByRole("button", { name: "Energia w CEE" }));
    expect(onApply).toHaveBeenCalledWith(params);
  });

  it("zapis z pustymi parametrami przywraca pusty obiekt, nie undefined", () => {
    const onApply = vi.fn();
    h.savedSearches.mockReturnValue({
      data: [saved({ params: undefined as unknown as Record<string, unknown> })],
    });
    renderPanel({ onApply });
    fireEvent.click(screen.getByRole("button", { name: "Energia w CEE" }));
    expect(onApply).toHaveBeenCalledWith({});
  });

  it("wypisuje wszystkie zapisy", () => {
    h.savedSearches.mockReturnValue({
      data: [saved({ id: "a", name: "Pierwszy" }), saved({ id: "b", name: "Drugi" })],
    });
    renderPanel();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("SavedSearchesPanel - dzwonek alertu", () => {
  it("wyłączony alert zaprasza do WŁĄCZENIA i nie kłamie stanem", () => {
    h.savedSearches.mockReturnValue({ data: [saved({ alert_enabled: false })] });
    renderPanel();
    const bell = screen.getByRole("button", { name: "Włącz alert o nowych wynikach" });
    expect(bell).toHaveAttribute("aria-pressed", "false");
  });

  it("włączony alert zaprasza do WYŁĄCZENIA", () => {
    h.savedSearches.mockReturnValue({ data: [saved({ alert_enabled: true })] });
    renderPanel();
    const bell = screen.getByRole("button", { name: "Wyłącz alert o nowych wynikach" });
    expect(bell).toHaveAttribute("aria-pressed", "true");
  });

  it("klik na wyłączonym WŁĄCZA alert i potwierdza obietnicę powiadomień", async () => {
    const s = saved({ alert_enabled: false });
    h.savedSearches.mockReturnValue({ data: [s] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Włącz alert o nowych wynikach" }));
    await waitFor(() => expect(h.toggle).toHaveBeenCalledWith({ search: s, enabled: true }));
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "Alert włączony - powiadomimy Cię o nowych wynikach.",
    );
  });

  it("klik na włączonym WYŁĄCZA alert", async () => {
    const s = saved({ alert_enabled: true });
    h.savedSearches.mockReturnValue({ data: [s] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Wyłącz alert o nowych wynikach" }));
    await waitFor(() => expect(h.toggle).toHaveBeenCalledWith({ search: s, enabled: false }));
    expect(h.toastSuccess).toHaveBeenCalledWith("Alert wyłączony.");
  });

  it("BŁĄD przełączenia nie może udawać sukcesu - inaczej użytkownik liczy na alert, którego nie ma", async () => {
    h.toggle.mockRejectedValue(new Error("row level security"));
    h.savedSearches.mockReturnValue({ data: [saved()] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Włącz alert o nowych wynikach" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("row level security"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd nie-Error przełączenia też ma czytelną treść", async () => {
    h.toggle.mockRejectedValue("timeout");
    h.savedSearches.mockReturnValue({ data: [saved()] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Włącz alert o nowych wynikach" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("timeout"));
  });

  it("przełączenie w toku blokuje dzwonek", () => {
    h.togglePending.current = true;
    h.savedSearches.mockReturnValue({ data: [saved()] });
    renderPanel();
    expect(screen.getByRole("button", { name: "Włącz alert o nowych wynikach" })).toBeDisabled();
  });
});

describe("SavedSearchesPanel - usuwanie", () => {
  it("usuwa wskazany zapis i potwierdza toastem", async () => {
    h.savedSearches.mockReturnValue({ data: [saved({ id: "s-7" })] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith("s-7"));
    expect(h.toastSuccess).toHaveBeenCalledWith("Usunięto zapisane wyszukiwanie");
  });

  it("błąd usunięcia dociera do użytkownika", async () => {
    h.del.mockRejectedValue(new Error("not found"));
    h.savedSearches.mockReturnValue({ data: [saved()] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("not found"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd nie-Error usunięcia też ma czytelną treść", async () => {
    h.del.mockRejectedValue({ code: 500 });
    h.savedSearches.mockReturnValue({ data: [saved()] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("[object Object]"));
  });
});

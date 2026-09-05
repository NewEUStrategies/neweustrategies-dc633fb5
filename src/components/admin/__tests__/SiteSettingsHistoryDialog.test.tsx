// Historia zmian ustawień serwisu z przywracaniem - `SiteSettingsHistoryDialog`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. To okno jest jedyną drogą powrotu po
// nieudanej zmianie motywu: pokazuje rewizje z `site_settings_revisions`
// i pozwala wgrać wybraną z powrotem. Cała jego wartość leży w tym, KTÓRA
// wartość zostanie przywrócona i KIEDY okno wolno zamknąć. Przypinam:
//   1. PRZYWRACANA JEST WARTOŚĆ ZAZNACZONEJ REWIZJI, nie pierwsza z listy
//      ani nie stan bieżący - `onRestore` dostaje dokładnie `value` klikniętego
//      wiersza, a przywrócenie cudzej rewizji to podmiana wyglądu serwisu.
//   2. PRZYCISK PRZYWRACANIA JEST MARTWY BEZ ZAZNACZENIA i w trakcie
//      przywracania (podwójne kliknięcie = dwa zapisy pod rząd).
//   3. OKNO ZAMYKA SIĘ DOPIERO PO ZAKOŃCZENIU `onRestore` - wcześniejsze
//      zamknięcie pokazałoby redakcji stary stan jako "przywrócony".
//   4. PODGLĄD PORÓWNAWCZY: lewa kolumna to ZAWSZE stan bieżący, prawa -
//      zaznaczona rewizja; obie jako sformatowany JSON, bo redakcja porównuje
//      je wzrokiem. Bez zaznaczenia prawa kolumna jest pusta, a nagłówek
//      prosi o wybór.
//   5. PREFIKS KLUCZY `admin` (osobliwość tego pliku, opisana w komentarzu
//      produkcyjnym): teksty żyją pod `admin.themeOptions.history.*`, a
//      `loading`/`cancel` pod `admin.loading`/`admin.cancel`. Atrapa i18n
//      DOKLEJA prefiks, więc asercja mierzy właśnie to, co produkcja policzy
//      - bez tego test przechodziłby także dla wersji bez prefiksu, czyli dla
//      wersji pokazującej ten sam tekst w PL i EN.
//   6. AUTOR REWIZJI: brak nazwy spada na etykietę "nieznany", brak awatara
//      na zastępczą ikonę - wiersz bez żadnego opisu byłby nie do odróżnienia.
//   7. DATA IDZIE PRZEZ `Intl` Z JĘZYKIEM PANELU, a niepoprawny znacznik
//      języka NIE wywraca okna (blok `catch` oddaje surowy ISO).
//
// GAŁĄŹ NIEOSIĄGALNA Z INTERFEJSU: osłona `if (!selected) return` w
// `handleRestore` - jedyne wejście do tej funkcji to przycisk, który BEZ
// zaznaczenia jest `disabled`, więc kliknięcie do handlera nie dochodzi.
//
// ZAREJESTROWANY DEFEKT (`it.fails` na końcu pliku): `handleRestore` ma
// `try/finally` BEZ `catch`, a wynik wywołania nie jest nigdzie odbierany
// (`onClick={handleRestore}`), więc odrzucone `onRestore` kończy się
// NIEOBSŁUŻONYM odrzuceniem obietnicy. Jedyny konsument tego okna
// (`ThemeOptionsPane`) woła `save.mutateAsync(...)`, które przy błędzie
// zapisu (RLS, brak sieci) ODRZUCA - a globalny nasłuch
// `unhandledrejection` w `lib/observability` beaconuje takie odrzucenie do
// telemetrii błędów klienta. Skutek: nieudane przywrócenie, o którym
// użytkownik już wie z toasta mutacji, dorzuca do dashboardu błędów
// fałszywy wpis "nieobsłużony błąd JS". Do tego kontrola dodatnia niżej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: odczytu rewizji - `useSiteSettingsRevisions`
// (dociąganie profili autorów, limit, sortowanie) jest tu ATRAPĄ, bo
// przedmiotem dowodu jest okno, nie zapytanie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SiteSettingsRevision } from "@/lib/admin/useSiteSettingsRevisions";

interface StanZapytania {
  data: SiteSettingsRevision[] | undefined;
  isLoading: boolean;
}

const h = vi.hoisted(() => ({
  language: "pl",
  revisions: { data: [], isLoading: false } as StanZapytania,
  useRevisions: vi.fn<(key: string, limit?: number) => StanZapytania>(),
}));

// Atrapa i18n DOKLEJAJĄCA prefiks kluczy - inaczej asercje nie odróżniłyby
// wywołania z `keyPrefix: "admin"` od wywołania bez niego.
vi.mock("react-i18next", () => ({
  useTranslation: (_ns?: unknown, opcje?: { keyPrefix?: string }) => ({
    t: (key: string) => (opcje?.keyPrefix ? `${opcje.keyPrefix}.${key}` : key),
    i18n: {
      get language() {
        return h.language;
      },
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Radix Dialog nie montuje zawartości pod happy-dom bez pełnego pointer API.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-testid="okno">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/lib/admin/useSiteSettingsRevisions", () => ({
  useSiteSettingsRevisions: (key: string, limit?: number) => h.useRevisions(key, limit),
}));

const { SiteSettingsHistoryDialog } = await import("@/components/admin/SiteSettingsHistoryDialog");

function rewizja(over: Partial<SiteSettingsRevision> = {}): SiteSettingsRevision {
  return {
    id: "rev-1",
    key: "theme_options",
    value: { accent: "#123456" },
    changed_by: "user-1",
    changed_at: "2026-06-15T10:20:00.000Z",
    operation: "UPDATE",
    note: null,
    author_name: "Anna Kowalska",
    author_avatar: null,
    ...over,
  };
}

function renderuj(
  opcje: {
    revisions?: StanZapytania;
    open?: boolean;
    currentValue?: unknown;
    onRestore?: (value: unknown) => Promise<void> | void;
    title?: string;
  } = {},
) {
  h.revisions = opcje.revisions ?? { data: [rewizja()], isLoading: false };
  h.useRevisions.mockImplementation(() => h.revisions);
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const onRestore = vi.fn(opcje.onRestore ?? (() => undefined));
  const utils = render(
    <SiteSettingsHistoryDialog
      open={opcje.open ?? true}
      onOpenChange={onOpenChange}
      settingsKey="theme_options"
      currentValue={opcje.currentValue ?? { accent: "#000000" }}
      onRestore={onRestore}
      title={opcje.title}
    />,
  );
  return { ...utils, onOpenChange, onRestore };
}

/** Lewa kolumna to stan bieżący, prawa - zaznaczona rewizja. */
function kolumny(): HTMLTextAreaElement[] {
  return screen.getAllByRole("textbox") as HTMLTextAreaElement[];
}

function przyciskPrzywroc(): HTMLElement {
  return screen.getByRole("button", { name: /themeOptions\.history\.restor/ });
}

beforeEach(() => {
  h.language = "pl";
  h.useRevisions.mockReset();
});

describe("SiteSettingsHistoryDialog - rama okna", () => {
  it("zamknięte okno nie renderuje niczego", () => {
    renderuj({ open: false });

    expect(screen.queryByTestId("okno")).not.toBeInTheDocument();
  });

  it("pyta o rewizje DOKŁADNIE tego klucza ustawień", () => {
    renderuj({});

    expect(h.useRevisions).toHaveBeenCalledWith("theme_options", undefined);
  });

  it("tytuł i opis biorą się ze słownika pod prefiksem `admin`", () => {
    renderuj({});

    expect(screen.getByRole("heading")).toHaveTextContent("admin.themeOptions.history.title");
    expect(screen.getByText("admin.themeOptions.history.description")).toBeInTheDocument();
  });

  it("własny tytuł nadpisuje ten ze słownika", () => {
    renderuj({ title: "Historia motywu" });

    expect(screen.getByRole("heading")).toHaveTextContent("Historia motywu");
  });

  it("przycisk anulowania zamyka okno bez przywracania", () => {
    const { onOpenChange, onRestore } = renderuj({});

    fireEvent.click(screen.getByRole("button", { name: "admin.cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRestore).not.toHaveBeenCalled();
  });
});

describe("SiteSettingsHistoryDialog - lista rewizji", () => {
  it("w trakcie ładowania pokazuje stan, a nie pustą listę", () => {
    renderuj({ revisions: { data: undefined, isLoading: true } });

    expect(screen.getByText("admin.loading")).toBeInTheDocument();
    expect(screen.queryByText("admin.themeOptions.history.empty")).not.toBeInTheDocument();
  });

  it.each([
    ["pusta lista", [] as SiteSettingsRevision[]],
    ["brak danych po nieudanym odczycie", undefined],
  ])("%s mówi wprost, że historii nie ma", (_opis, dane) => {
    renderuj({ revisions: { data: dane, isLoading: false } });

    expect(screen.getByText("admin.themeOptions.history.empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Anna/ })).not.toBeInTheDocument();
  });

  it("wiersz pokazuje autora, rodzaj operacji i sformatowaną datę", () => {
    renderuj({ revisions: { data: [rewizja({ operation: "INSERT" })], isLoading: false } });

    const wiersz = screen.getByRole("button", { name: /Anna Kowalska/ });
    expect(within(wiersz).getByText("INSERT")).toBeInTheDocument();
    // Data przechodzi przez `Intl` - nie zostaje surowym ISO.
    expect(wiersz).not.toHaveTextContent("2026-06-15T10:20:00.000Z");
    expect(wiersz.textContent).toContain("2026");
  });

  it("brak nazwy autora spada na etykietę 'nieznany', a brak awatara na ikonę", () => {
    renderuj({
      revisions: {
        data: [rewizja({ author_name: null, author_avatar: null })],
        isLoading: false,
      },
    });

    expect(screen.getByText("admin.themeOptions.history.unknownAuthor")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("awatar autora renderuje się jako obrazek dekoracyjny", () => {
    renderuj({
      revisions: {
        data: [rewizja({ author_avatar: "https://cdn.example.com/a.png" })],
        isLoading: false,
      },
    });

    const awatar = document.querySelector("img");
    expect(awatar).toHaveAttribute("src", "https://cdn.example.com/a.png");
    expect(awatar).toHaveAttribute("alt", "");
  });

  it("niepoprawny znacznik języka NIE wywraca okna - data wraca surowa", () => {
    h.language = "to nie jest locale";
    renderuj({});

    expect(screen.getByRole("button", { name: /Anna Kowalska/ })).toHaveTextContent(
      "2026-06-15T10:20:00.000Z",
    );
  });
});

describe("SiteSettingsHistoryDialog - podgląd porównawczy", () => {
  it("lewa kolumna pokazuje stan bieżący jako sformatowany JSON", () => {
    renderuj({ currentValue: { accent: "#000000", dark: true } });

    expect(kolumny()[0]).toHaveValue(JSON.stringify({ accent: "#000000", dark: true }, null, 2));
    expect(kolumny()[0]).toHaveAttribute("readonly");
  });

  it("bez zaznaczenia prawa kolumna jest pusta, a nagłówek prosi o wybór", () => {
    renderuj({});

    expect(kolumny()[1]).toHaveValue("");
    expect(screen.getAllByText("admin.themeOptions.history.selectRevision").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByText("admin.themeOptions.history.previewSelected"),
    ).not.toBeInTheDocument();
  });

  it("zaznaczenie rewizji wypełnia prawą kolumnę jej wartością", () => {
    renderuj({
      revisions: {
        data: [rewizja({ id: "rev-9", value: { accent: "#abcdef", layout: "wide" } })],
        isLoading: false,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Anna Kowalska/ }));

    expect(kolumny()[1]).toHaveValue(
      JSON.stringify({ accent: "#abcdef", layout: "wide" }, null, 2),
    );
    expect(screen.getByText("admin.themeOptions.history.previewSelected")).toBeInTheDocument();
  });

  it("zaznaczona rewizja, która ZNIKNĘŁA z listy, czyści podgląd i blokuje przywracanie", () => {
    const { rerender, onOpenChange, onRestore } = renderuj({
      revisions: { data: [rewizja({ id: "rev-1" })], isLoading: false },
    });
    fireEvent.click(screen.getByRole("button", { name: /Anna Kowalska/ }));
    expect(kolumny()[1]).toHaveValue(JSON.stringify({ accent: "#123456" }, null, 2));

    // Odświeżenie historii oddaje inny zestaw rewizji (np. po przycięciu
    // limitem) - zaznaczenie wskazuje wtedy na nieistniejący wiersz.
    h.revisions = { data: [rewizja({ id: "rev-7", author_name: "Piotr" })], isLoading: false };
    rerender(
      <SiteSettingsHistoryDialog
        open
        onOpenChange={onOpenChange}
        settingsKey="theme_options"
        currentValue={{ accent: "#000000" }}
        onRestore={onRestore}
      />,
    );

    expect(kolumny()[1]).toHaveValue("");
    expect(przyciskPrzywroc()).toBeDisabled();
  });

  it("kliknięcie DRUGIEJ rewizji podmienia podgląd, nie dokłada go", () => {
    renderuj({
      revisions: {
        data: [
          rewizja({ id: "rev-1", author_name: "Anna Kowalska", value: { v: 1 } }),
          rewizja({ id: "rev-2", author_name: "Piotr Zieliński", value: { v: 2 } }),
        ],
        isLoading: false,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Anna Kowalska/ }));
    fireEvent.click(screen.getByRole("button", { name: /Piotr Zieliński/ }));

    expect(kolumny()[1]).toHaveValue(JSON.stringify({ v: 2 }, null, 2));
  });
});

describe("SiteSettingsHistoryDialog - przywracanie", () => {
  it("bez zaznaczenia przycisk przywracania jest zablokowany", () => {
    renderuj({});

    expect(przyciskPrzywroc()).toBeDisabled();
  });

  it("przywraca wartość ZAZNACZONEJ rewizji, a nie pierwszej z listy", async () => {
    const { onRestore } = renderuj({
      revisions: {
        data: [
          rewizja({ id: "rev-1", author_name: "Anna Kowalska", value: { v: 1 } }),
          rewizja({ id: "rev-2", author_name: "Piotr Zieliński", value: { v: 2 } }),
        ],
        isLoading: false,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Piotr Zieliński/ }));
    fireEvent.click(przyciskPrzywroc());

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(onRestore).toHaveBeenCalledWith({ v: 2 });
  });

  it("okno zamyka się DOPIERO po zakończeniu przywracania", async () => {
    let zakoncz: () => void = () => {};
    const { onOpenChange } = renderuj({
      onRestore: () =>
        new Promise<void>((resolve) => {
          zakoncz = resolve;
        }),
    });

    fireEvent.click(screen.getByRole("button", { name: /Anna Kowalska/ }));
    fireEvent.click(przyciskPrzywroc());

    // Zapis trwa: przycisk zablokowany, etykieta zmieniona, okno OTWARTE.
    await waitFor(() =>
      expect(screen.getByText("admin.themeOptions.history.restoring")).toBeInTheDocument(),
    );
    expect(przyciskPrzywroc()).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();

    zakoncz();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("przywracanie synchroniczne też zamyka okno", async () => {
    const { onOpenChange, onRestore } = renderuj({ onRestore: () => undefined });

    fireEvent.click(screen.getByRole("button", { name: /Anna Kowalska/ }));
    fireEvent.click(przyciskPrzywroc());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onRestore).toHaveBeenCalledWith({ accent: "#123456" });
  });
});

/**
 * Uruchamia `akcja` z PODMIENIONYM nasłuchem `unhandledRejection` i oddaje
 * przechwycone powody odrzuceń.
 *
 * Dlaczego tak, a nie prościej: wynik `handleRestore` nie jest nigdzie
 * odbierany (React ignoruje obietnicę zwróconą z `onClick`), więc odrzucenia
 * NIE DA SIĘ złapać ani przez `await` na kliknięciu, ani przez `catch` na
 * atrapie - jedynym miejscem, w którym się objawia, jest zdarzenie procesu.
 * Własny nasłuch (na czas jednego przypadku, z przywróceniem w `finally`)
 * jest tu konieczny także dlatego, że nasłuch Vitesta raportuje takie
 * odrzucenie jako "Unhandled Error" i wywraca CAŁY plik - a wtedy defektu nie
 * da się zarejestrować przez `it.fails`.
 */
async function zlapNieobsluzoneOdrzucenia(akcja: () => Promise<void>): Promise<unknown[]> {
  const zapamietane = process.listeners("unhandledRejection");
  const zlapane: unknown[] = [];
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", (powod: unknown) => {
    zlapane.push(powod);
  });
  try {
    await akcja();
    // Node zgłasza nieobsłużone odrzucenie po opróżnieniu mikrozadań, więc
    // oddajemy jeszcze jedno makrozadanie, zanim czytamy wynik.
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.removeAllListeners("unhandledRejection");
    for (const nasluch of zapamietane) {
      process.on("unhandledRejection", nasluch as NodeJS.UnhandledRejectionListener);
    }
  }
  return zlapane;
}

describe("SiteSettingsHistoryDialog - nieudane przywracanie", () => {
  it.fails(
    "DEFEKT: odrzucone `onRestore` kończy się NIEOBSŁUŻONYM odrzuceniem (brak `catch`)",
    async () => {
      const { onOpenChange } = renderuj({
        onRestore: () => Promise.reject(new Error("RLS: brak uprawnien do site_settings")),
      });

      const zlapane = await zlapNieobsluzoneOdrzucenia(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Anna Kowalska/ }));
        fireEvent.click(przyciskPrzywroc());
        // To działa dobrze: `finally` odblokowuje przycisk, a okno ZOSTAJE
        // otwarte, bo `onOpenChange(false)` jest za `await`.
        await waitFor(() => expect(przyciskPrzywroc()).toBeEnabled());
      });

      expect(onOpenChange).not.toHaveBeenCalled();
      // Ta asercja jest treścią defektu: dziś odrzucenie wycieka do procesu
      // (w przeglądarce - do `window.onunhandledrejection`, a stamtąd do
      // beaconu telemetrii). Dodanie `catch` w `handleRestore` zamknie
      // znalezisko i wywróci to `it.fails`.
      expect(zlapane).toEqual([]);
    },
  );

  it("kontrola dodatnia: udane przywracanie nie generuje ŻADNEGO odrzucenia", async () => {
    // Dowód, że harness wyżej mierzy odrzucenie z `handleRestore`, a nie szum
    // tła: ta sama droga z obietnicą spełnioną oddaje pustą listę.
    const { onOpenChange } = renderuj({ onRestore: () => Promise.resolve() });

    const zlapane = await zlapNieobsluzoneOdrzucenia(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Anna Kowalska/ }));
      fireEvent.click(przyciskPrzywroc());
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    expect(zlapane).toEqual([]);
  });
});

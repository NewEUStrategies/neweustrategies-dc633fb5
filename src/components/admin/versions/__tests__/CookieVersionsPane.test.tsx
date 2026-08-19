// Wersje konfiguracji bannera zgód (`CookieVersionsPane`, 0%) oraz organizm
// nadrzędny sekcji (`VersionsPane`, 0%).
//
// Banner zgód jest powierzchnią RODO: to on zbiera i zapisuje zgody
// odwiedzającego. Trzy rzeczy są tu warte testu:
//
//   1. `asConfig` MUSI SCALAĆ z domyślnymi. Migawka zapisana przed dodaniem
//      kategorii ciasteczek nie ma jej klucza — bez scalenia podgląd
//      renderowałby `undefined` zamiast nazwy kategorii, a przywrócenie takiej
//      wersji zapisałoby do ustawień konfigurację z dziurą.
//   2. PODGLĄD POKAZUJE WERSJĘ WYBRANĄ, nie zawsze aktywną — inaczej redaktor
//      przywracałby wersję, której nigdy nie zobaczył.
//   3. PRZYWRÓCENIE ODŚWIEŻA I USTAWIENIA, I HISTORIĘ. Sam zapis bez
//      inwalidacji zostawiłby panel pokazujący stare wartości jako „aktywne".
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  revisions: [] as unknown[],
  current: null as unknown,
  toast: null as unknown,
  upsertArgs: [] as unknown[],
  upsertError: null as unknown,
}));

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async (...args: unknown[]) => {
        h.upsertArgs.push(args);
        return { error: h.upsertError };
      },
    }),
  },
}));

vi.mock("@/lib/admin/useSiteSettingsRevisions", () => ({
  useSiteSettingsRevisions: () => ({ data: h.revisions }),
}));

vi.mock("@/lib/cookieBanner/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cookieBanner/config")>();
  return { ...actual, useCookieBannerConfig: () => h.current ?? actual.COOKIE_BANNER_DEFAULTS };
});

import { CookieVersionsPane } from "@/components/admin/versions/organisms/CookieVersionsPane";
import { COOKIE_BANNER_DEFAULTS, COOKIE_BANNER_SETTINGS_KEY } from "@/lib/cookieBanner/config";

type Mock = ReturnType<typeof vi.fn>;
const toast = () => h.toast as Record<string, Mock>;

function revision(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rev-1",
    author_name: "Anna Kowalska",
    changed_at: "2026-08-18T10:00:00.000Z",
    value: COOKIE_BANNER_DEFAULTS,
    ...over,
  };
}

beforeEach(() => {
  h.revisions = [];
  h.current = null;
  h.upsertArgs = [];
  h.upsertError = null;
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(cleanup);

describe("CookieVersionsPane - lista wersji", () => {
  it("wersja aktywna jest zawsze pierwsza i domyslnie wybrana", () => {
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    expect(screen.getByText("Wersja aktywna")).toBeInTheDocument();
    // Bez wybranej migawki nie ma czego przywracać.
    expect(screen.queryByText("Przywróć tę wersję")).toBeNull();
  });

  it("wiersz migawki nosi nazwisko autora zmiany", () => {
    // Historia konfiguracji zgód musi być rozliczalna - kto zmienił i kiedy.
    h.revisions = [revision({ author_name: "Anna Kowalska" })];
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
  });

  it("migawka bez autora ma etykietę zastępczą, nie pustą", () => {
    h.revisions = [revision({ author_name: null })];
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    expect(screen.getByText("Zmiana")).toBeInTheDocument();
  });

  it("zła data nie wysypuje listy - wraca surowy ISO", () => {
    h.revisions = [revision({ changed_at: "nie-data" })];
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    expect(screen.getByText("nie-data")).toBeInTheDocument();
  });
});

describe("CookieVersionsPane - podgląd", () => {
  it("domyślnie pokazuje konfigurację AKTYWNĄ", () => {
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    expect(screen.getByText(COOKIE_BANNER_DEFAULTS.copy.pl.title)).toBeInTheDocument();
  });

  it("wybór migawki podmienia podgląd na JEJ treść", () => {
    // Bez tego redaktor przywracałby wersję, której nigdy nie zobaczył.
    h.revisions = [
      revision({
        value: {
          ...COOKIE_BANNER_DEFAULTS,
          copy: {
            ...COOKIE_BANNER_DEFAULTS.copy,
            pl: { ...COOKIE_BANNER_DEFAULTS.copy.pl, title: "Stary tytuł bannera" },
          },
        },
      }),
    ];
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Anna Kowalska"));

    expect(screen.getByText("Stary tytuł bannera")).toBeInTheDocument();
  });

  it("MIGAWKA NIEPEŁNA jest scalana z domyślnymi, nie renderuje dziur", () => {
    // Migawka zapisana przed dodaniem kategorii nie ma jej klucza. Bez scalenia
    // podgląd pokazałby puste pole, a przywrócenie zapisałoby konfigurację
    // z dziurą do ustawień serwisu - czyli do bannera zgód RODO.
    h.revisions = [revision({ value: { enabled: true } })];
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Anna Kowalska"));

    expect(screen.getByText(COOKIE_BANNER_DEFAULTS.copy.pl.title)).toBeInTheDocument();
    expect(screen.getByText(COOKIE_BANNER_DEFAULTS.copy.pl.categoryNecessary)).toBeInTheDocument();
  });

  it("migawka NIE BĘDĄCA obiektem wraca do wartości domyślnych", () => {
    h.revisions = [revision({ value: "śmieci" })];
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Anna Kowalska"));

    expect(screen.getByText(COOKIE_BANNER_DEFAULTS.copy.pl.title)).toBeInTheDocument();
  });

  it("wszystkie cztery kategorie ciasteczek są w podglądzie", () => {
    // Brak którejkolwiek kategorii w podglądzie ukrywałby przed redaktorem, że
    // odwiedzający nie ma nad nią kontroli.
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    const c = COOKIE_BANNER_DEFAULTS.copy.pl;
    for (const label of [
      c.categoryNecessary,
      c.categoryFunctional,
      c.categoryAnalytics,
      c.categoryMarketing,
    ]) {
      expect(screen.getByText(label), label).toBeInTheDocument();
    }
  });

  it("stan włączenia bannera jest napisany wprost", () => {
    h.current = { ...COOKIE_BANNER_DEFAULTS, enabled: false };
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    expect(screen.getByText("Banner wyłączony")).toBeInTheDocument();
    cleanup();

    h.current = { ...COOKIE_BANNER_DEFAULTS, enabled: true };
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    expect(screen.getByText("Banner włączony")).toBeInTheDocument();
  });

  it("język podglądu przełącza się niezależnie od języka panelu", () => {
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    expect(screen.getByRole("button", { name: "PL" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(COOKIE_BANNER_DEFAULTS.copy.en.title)).toBeInTheDocument();
  });
});

describe("CookieVersionsPane - przywracanie", () => {
  it("zapisuje SCALONĄ konfigurację pod kluczem ustawień bannera", async () => {
    h.revisions = [revision({ value: { enabled: false } })];
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Anna Kowalska"));

    fireEvent.click(screen.getByText("Przywróć tę wersję"));

    await waitFor(() => expect(h.upsertArgs.length).toBeGreaterThan(0));
    const [payload, options] = h.upsertArgs[0] as [Record<string, unknown>, unknown];
    // Klucz bierzemy ze STALEJ, nie z literalu - inaczej test przeszedlby
    // obok zmiany nazwy klucza ustawien, ktora rozjechalaby panel z baza.
    expect(payload.key).toBe(COOKIE_BANNER_SETTINGS_KEY);
    // Scalenie z domyślnymi: brakujące klucze migawki są uzupełnione.
    expect(payload.value).toMatchObject({ enabled: false, copy: expect.anything() });
    // `onConflict` na parze tenant+klucz - bez tego upsert stworzyłby drugi
    // wiersz ustawień zamiast nadpisać istniejący.
    expect(options).toMatchObject({ onConflict: "tenant_id,key" });
  });

  it("po przywróceniu odświeża USTAWIENIA i HISTORIĘ", async () => {
    // Sam zapis bez inwalidacji zostawiłby panel pokazujący stare wartości
    // jako „wersję aktywną".
    h.revisions = [revision()];
    const { queryClient } = renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByText("Anna Kowalska"));

    fireEvent.click(screen.getByText("Przywróć tę wersję"));

    await waitFor(() => expect(toast().success).toHaveBeenCalledWith("Przywrócono wersję bannera"));
    const keys = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keys).toContain(JSON.stringify(["site-setting", COOKIE_BANNER_SETTINGS_KEY]));
    expect(keys).toContain(JSON.stringify(["site_settings_revisions"]));
  });

  it("nieudane przywrócenie pokazuje BŁĄD i nie melduje sukcesu", async () => {
    h.revisions = [revision()];
    h.upsertError = new Error("rls denied");
    renderWithQueryClient(<CookieVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Anna Kowalska"));

    fireEvent.click(screen.getByText("Przywróć tę wersję"));

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("Nie udało się przywrócić"));
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("interfejs jest dwujęzyczny", () => {
    renderWithQueryClient(<CookieVersionsPane lang="en" />);
    expect(screen.getByText("Live version")).toBeInTheDocument();
    expect(screen.getByText("What a visitor will see")).toBeInTheDocument();
  });
});

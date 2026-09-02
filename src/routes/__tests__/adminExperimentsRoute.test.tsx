// Trasa `/admin/experiments` - wynik testów A/B. 0/26 linii, 0/8 funkcji.
//
// PO CO. Z tego ekranu redakcja czyta ODPOWIEDŹ na pytanie „który wariant
// wygrał", czyli podejmuje decyzję o treści strony. Ekran nie liczy sam -
// werdykt liczy `zScore` z `lib/builder/experiments` - ale to on decyduje, CZY
// I JAK werdykt jest pokazany. Reguły, których złamania nie widać:
//
//   1. TRZY STANY PUSTKI TO TRZY RÓŻNE KOMUNIKATY. „Ładowanie listy",
//      „nie ma żadnego testu" i „test jest, ale statystyki jeszcze nie
//      dojechały" muszą się różnić. Zlepienie ich w jeden pusty prostokąt
//      każe redakcji zgadywać, czy test nie zbiera danych, czy nie istnieje.
//   2. ZERO EKSPOZYCJI TO NIE „BRAK ISTOTNOŚCI". Przy zerowym ruchu `zScore`
//      zwraca 0, więc naiwny render pokazałby „różnica nieistotna (z = 0,00)"
//      - zdanie fałszywe: nie ma czego porównywać. Kod ma osobną gałąź
//      `noData` i ta gałąź musi być pierwsza.
//   3. ZWYCIĘZCĄ JEST WARIANT O WYŻSZEJ KONWERSJI, nie ten o wyższej liczbie
//      konwersji. Wariant B z 10/1000 przegrywa z A o 5/100 - pomyłka tutaj
//      przestawia treść strony na gorszą i nikt tego nie zauważy, bo liczba
//      bezwzględna „wygląda lepiej".
//   4. PRZYCISKI ZALEŻĄ OD STATUSU. Test uruchomiony da się zapauzować,
//      zapauzowany - wznowić, zakończony - żadne z tych dwóch. Przycisk
//      wznawiający zakończony test cofa wynik do zbierania danych.
//   5. USUNIĘCIE PYTA I DA SIĘ ODWOŁAĆ. Odmowa w dialogu NIE MOŻE nic usunąć.
//
// GRANICE. Atrapowane są dwa hooki danych (`useExperimentsAdmin`,
// `useExperimentStats`), dialog potwierdzenia, toasty i i18n. PRAWDZIWE biegną
// `zScore` i `conversionRate` - to one dają werdykt, więc atrapa w tym miejscu
// zamieniłaby test w sprawdzanie własnych liczb.
//
// CZEGO TEN TEST NIE DOWODZI: uprawnień (zestaw middleware pilnuje
// `check:authz-snapshot`) ani izolacji najemcy po stronie zapytania - klucz
// `["builder-experiments", tenantId]` i filtr `.eq("tenant_id", …)` żyją
// w `lib/builder/experiments`, poza tą trasą. Ingest zdarzeń A/B ma własny,
// pełny test odmowy międzynajemczej: `api/public/-experiment-event.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  items: [] as Array<{
    id: string;
    name: string;
    status: "running" | "paused" | "completed";
    created_at: string;
    updated_at: string;
  }>,
  loading: false,
  stats: new Map<
    string,
    { exposures: { a: number; b: number }; conversions: { a: number; b: number } } | undefined
  >(),
  setStatus: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  toastSuccess: vi.fn(),
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => h.toastSuccess(...a) } }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: (...a: unknown[]) => h.confirm(...a) }));

// PRAWDZIWE `zScore` i `conversionRate`, atrapowane tylko hooki danych.
vi.mock("@/lib/builder/experiments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/experiments")>();
  return {
    ...actual,
    useExperimentsAdmin: () => ({
      items: h.items,
      loading: h.loading,
      setStatus: h.setStatus,
      remove: h.remove,
    }),
    useExperimentStats: (id: string | null) => ({ data: id ? h.stats.get(id) : undefined }),
  };
});

import { renderRoute } from "@/test/routeHarness";
import { Route as ExperimentsRoute } from "@/routes/admin.experiments";

const PATH = "/admin/experiments";

function experiment(patch: Partial<(typeof h.items)[number]> = {}) {
  return {
    id: "exp-1",
    name: "Nagłówek cennika",
    status: "running" as const,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    ...patch,
  };
}

const mount = () => renderRoute({ route: ExperimentsRoute, path: PATH, initialEntry: PATH });

/** Karta testu o danej nazwie - asercje idą w jej obrębie, nie po całej stronie. */
function card(name: string): HTMLElement {
  const heading = screen.getByText(name);
  const box = heading.closest("div.border");
  if (!box) throw new Error(`test: karta „${name}” nie ma kontenera`);
  return box as HTMLElement;
}

beforeEach(() => {
  cleanup();
  h.items = [];
  h.loading = false;
  h.stats = new Map();
  h.setStatus.mockReset();
  h.remove.mockReset().mockResolvedValue(undefined);
  h.confirm.mockReset().mockResolvedValue(true);
  h.toastSuccess.mockReset();
  h.lang = "pl";
});

// ---------------------------------------------------------------------------
describe("trzy stany pustki są rozróżnialne", () => {
  it("ŁADOWANIE listy mówi „ładowanie”, a nie „brak testów”", async () => {
    h.loading = true;

    await mount();

    expect(screen.getByText("admin.experiments.loading")).toBeTruthy();
    expect(screen.queryByText("admin.experiments.empty")).toBeNull();
  });

  it("BRAK testów mówi „brak”, a nie pokazuje pustej listy kart", async () => {
    await mount();

    expect(screen.getByText("admin.experiments.empty")).toBeTruthy();
    expect(screen.queryByText("admin.experiments.loading")).toBeNull();
  });

  it("TEST BEZ STATYSTYK mówi, że statystyki się ładują - i nie pokazuje zer", async () => {
    // Zera w kaflach byłyby pomiarem, którego nie ma.
    h.items = [experiment()];

    await mount();

    expect(screen.getByText("admin.experiments.loadingStats")).toBeTruthy();
    expect(screen.queryByText(/admin\.experiments\.exposures/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("werdykt statystyczny", () => {
  it("ZERO EKSPOZYCJI daje „brak danych”, nie „różnica nieistotna”", async () => {
    // `zScore` zwraca 0 przy zerowym ruchu, więc bez osobnej gałęzi ekran
    // ogłaszałby brak istotności na próbce, której nie ma.
    h.items = [experiment()];
    h.stats.set("exp-1", { exposures: { a: 0, b: 0 }, conversions: { a: 0, b: 0 } });

    await mount();

    expect(within(card("Nagłówek cennika")).getByText("admin.experiments.noData")).toBeTruthy();
  });

  it("RÓŻNICA NIEISTOTNA pokazuje wartość |z| z dwiema cyframi", async () => {
    h.items = [experiment()];
    h.stats.set("exp-1", { exposures: { a: 100, b: 100 }, conversions: { a: 10, b: 12 } });

    await mount();

    const text = within(card("Nagłówek cennika")).getByText(
      /admin\.experiments\.notSignificant/,
    ).textContent;
    expect(text).toMatch(/z=\d\.\d\d/);
  });

  it("RÓŻNICA ISTOTNA wskazuje zwycięzcę - wariant o wyższej KONWERSJI, nie o wyższej liczbie", async () => {
    // A: 5/100 = 5%. B: 10/1000 = 1%. Bezwzględnie B ma więcej konwersji,
    // ale przegrywa - pomyłka tutaj przestawia stronę na gorszy wariant.
    h.items = [experiment()];
    h.stats.set("exp-1", { exposures: { a: 100, b: 1000 }, conversions: { a: 5, b: 10 } });

    await mount();

    const text = within(card("Nagłówek cennika")).getByText(
      /admin\.experiments\.significant/,
    ).textContent;
    expect(text).toContain("winner=A");
  });

  it("wariant B z wyraźnie lepszą konwersją JEST ogłoszony zwycięzcą", async () => {
    h.items = [experiment()];
    h.stats.set("exp-1", { exposures: { a: 1000, b: 1000 }, conversions: { a: 50, b: 120 } });

    await mount();

    expect(
      within(card("Nagłówek cennika")).getByText(/admin\.experiments\.significant/).textContent,
    ).toContain("winner=B");
  });

  it("współczynnik konwersji jest liczony per wariant i podany z jednym miejscem po przecinku", async () => {
    h.items = [experiment()];
    h.stats.set("exp-1", { exposures: { a: 200, b: 200 }, conversions: { a: 25, b: 50 } });

    await mount();

    const text = card("Nagłówek cennika").textContent ?? "";
    expect(text).toContain("12.5%");
    expect(text).toContain("25.0%");
  });

  it("ZERO EKSPOZYCJI w jednym wariancie nie daje NaN w jego współczynniku", async () => {
    h.items = [experiment()];
    h.stats.set("exp-1", { exposures: { a: 0, b: 50 }, conversions: { a: 0, b: 5 } });

    await mount();

    const text = card("Nagłówek cennika").textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).toContain("0.0%");
  });
});

// ---------------------------------------------------------------------------
describe("akcje zależą od statusu", () => {
  it("test URUCHOMIONY da się zapauzować, ale nie wznowić", async () => {
    h.items = [experiment({ status: "running" })];

    await mount();

    const box = within(card("Nagłówek cennika"));
    expect(box.getByTitle("admin.experiments.pause")).toBeTruthy();
    expect(box.queryByTitle("admin.experiments.resume")).toBeNull();
  });

  it("test ZAPAUZOWANY da się wznowić, ale nie zapauzować", async () => {
    h.items = [experiment({ status: "paused" })];

    await mount();

    const box = within(card("Nagłówek cennika"));
    expect(box.getByTitle("admin.experiments.resume")).toBeTruthy();
    expect(box.queryByTitle("admin.experiments.pause")).toBeNull();
  });

  it("test ZAKOŃCZONY nie ma ANI pauzy, ANI wznowienia - wynik nie wraca do zbierania", async () => {
    h.items = [experiment({ status: "completed" })];

    await mount();

    const box = within(card("Nagłówek cennika"));
    expect(box.queryByTitle("admin.experiments.pause")).toBeNull();
    expect(box.queryByTitle("admin.experiments.resume")).toBeNull();
    // Usunięcie zostaje dostępne w każdym statusie.
    expect(box.getByTitle("admin.experiments.delete")).toBeTruthy();
  });

  it("trzy statusy mają TRZY różne etykiety", async () => {
    h.items = [
      experiment({ id: "a", name: "Bieżący", status: "running" }),
      experiment({ id: "b", name: "Wstrzymany", status: "paused" }),
      experiment({ id: "c", name: "Zamknięty", status: "completed" }),
    ];

    await mount();

    expect(within(card("Bieżący")).getByText("admin.experiments.statusRunning")).toBeTruthy();
    expect(within(card("Wstrzymany")).getByText("admin.experiments.statusPaused")).toBeTruthy();
    expect(within(card("Zamknięty")).getByText("admin.experiments.statusCompleted")).toBeTruthy();
  });

  it("PAUZA i WZNOWIENIE wołają zmianę statusu z identyfikatorem TEJ karty", async () => {
    // Dwie karty naraz: akcja przypięta do złej karty zmieniłaby cudzy test.
    h.items = [
      experiment({ id: "pierwszy", name: "Pierwszy", status: "running" }),
      experiment({ id: "drugi", name: "Drugi", status: "paused" }),
    ];

    await mount();
    fireEvent.click(within(card("Pierwszy")).getByTitle("admin.experiments.pause"));
    fireEvent.click(within(card("Drugi")).getByTitle("admin.experiments.resume"));

    expect(h.setStatus).toHaveBeenNthCalledWith(1, "pierwszy", "paused");
    expect(h.setStatus).toHaveBeenNthCalledWith(2, "drugi", "running");
  });
});

// ---------------------------------------------------------------------------
describe("usunięcie testu", () => {
  it("PYTA przed usunięciem, a pytanie niesie nazwę testu i jest destrukcyjne", async () => {
    h.items = [experiment()];

    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTitle("admin.experiments.delete"));
    });

    const arg = h.confirm.mock.calls[0]?.[0] as { title: string; destructive: boolean };
    expect(arg.destructive).toBe(true);
    expect(arg.title).toContain("Nagłówek cennika");
  });

  it("ODMOWA w dialogu NIE usuwa i nie pokazuje komunikatu sukcesu", async () => {
    h.confirm.mockResolvedValue(false);
    h.items = [experiment()];

    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTitle("admin.experiments.delete"));
    });

    expect(h.remove).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("POTWIERDZENIE usuwa TEN test i potwierdza to komunikatem", async () => {
    h.items = [
      experiment({ id: "zostaje", name: "Zostaje" }),
      experiment({ id: "do-usuniecia", name: "Do usunięcia" }),
    ];

    await mount();
    await act(async () => {
      fireEvent.click(within(card("Do usunięcia")).getByTitle("admin.experiments.delete"));
    });

    expect(h.remove).toHaveBeenCalledExactlyOnceWith("do-usuniecia");
    expect(h.toastSuccess).toHaveBeenCalledWith("admin.experiments.deleted");
  });
});

// ---------------------------------------------------------------------------
describe("nagłówek i dostępność", () => {
  it("tytuł i podtytuł idą ze SŁOWNIKA", async () => {
    await mount();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "admin.experiments.title",
    );
    expect(screen.getByText("admin.experiments.subtitle")).toBeTruthy();
  });

  it("nazwa testu jest nagłówkiem drugiego poziomu - lista jest przeglądalna nawigacją nagłówków", async () => {
    h.items = [experiment({ id: "a", name: "Pierwszy" }), experiment({ id: "b", name: "Drugi" })];

    await mount();

    const names = screen.getAllByRole("heading", { level: 2 }).map((n) => n.textContent);
    expect(names).toEqual(["Pierwszy", "Drugi"]);
  });

  it("każdy przycisk akcji ma dostępną nazwę - ikona bez tytułu jest dla czytnika pusta", async () => {
    h.items = [experiment({ status: "running" })];

    await mount();

    for (const button of within(card("Nagłówek cennika")).getAllByRole("button")) {
      const name = button.getAttribute("title") ?? button.textContent ?? "";
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });
});

// Organizm zakładki „Statystyki": SKĄD biorą się liczby, które admin czyta.
//
// CO TEN PLIK DOWODZI.
//   1. LICZNIKI SĄ PRZYPISANE DO WŁAŚCIWEGO SLOTU I WŁAŚCIWEGO RODZAJU
//      ZDARZENIA. Panel robi po DWA zapytania liczące na każdy slot
//      (`select("*", { count: "exact", head: true })` + `eq("slot_id", id)`
//      + `eq("kind", ...)`), więc pomylenie filtrów dałoby tabelę, która wygląda
//      poprawnie i kłamie: kliknięcia jednego slotu w wierszu drugiego. Test
//      odpowiada RÓŻNĄ liczbą na każdy z czterech filtrów i sprawdza, że każda
//      liczba wylądowała w swojej komórce.
//   2. ZAPYTANIE LICZĄCE NIE ŚCIĄGA WIERSZY (`head: true`) - inaczej panel
//      pobierałby całą tabelę zdarzeń do przeglądarki, żeby policzyć jej długość.
//   3. `count: null` (odmowa policzenia) JEST TRAKTOWANY JAK ZERO, więc tabela
//      pokazuje 0 i kreskę w CTR, a nie „null" ani „NaN".
//   4. TRZY STANY TABELI SĄ ROZDZIELONE: „wczytywanie", „brak danych"
//      i wiersze. Stan wczytywania jest obserwowalny TYLKO przy łańcuchu, który
//      nigdy się nie rozwiązuje (atrapa odpowiada natychmiast) - stąd atrapa
//      `neverSettling`, nie wyścig z mikrozadaniami.
//   5. LICZBA ZAPYTAŃ ROŚNIE LINIOWO Z LICZBĄ SLOTÓW (N+1: 1 + 2N). To nie
//      defekt do naprawy w tej pracy, ale koszt, który ma być POLICZONY - żeby
//      trzysta slotów nie zrobiło z tej zakładki sześciuset zapytań w ciszy.
//   6. AWARIA ODCZYTU UDAJE BRAK DANYCH (defekt) - para `it.fails` + `it`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Formatu CTR - `adsAtoms.test.tsx`.
// (2) Zapisu zdarzeń reklamowych - `src/routes/api/public/__tests__` i testy
// `lib/ads`. (3) Autorytetu odczytu `ad_events` (RLS dla redakcji) - pgTAP.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Tabele, których odczyt NIGDY się nie rozwiązuje (stan „wczytywanie"). */
  pendingTables: new Set<string>(),
  /** Tabele, których odczyt rozwiązuje test - RĘCZNIE, po odmontowaniu. */
  deferredTables: new Set<string>(),
  /** Zwolnienie ostatniego odroczonego odczytu. */
  release: null as ((value: unknown) => void) | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  /**
   * Łańcuch, który nigdy się nie rozwiązuje - jedyny deterministyczny sposób
   * na utrzymanie stanu „wczytywanie" (wzorzec z `adminIntegrationsRoute.test.tsx`).
   */
  const neverSettling = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) builder[method] = () => builder;
    builder.then = () => new Promise(() => undefined);
    return builder;
  };
  /**
   * Łańcuch rozwiązywany RĘCZNIE przez test - jedyny sposób, żeby odmontować
   * panel W TRAKCIE odczytu i sprawdzić, co robi flaga `cancelled`.
   */
  const deferred = (): Record<string, unknown> => {
    const promise = new Promise((resolve) => {
      h.release = resolve;
    });
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) builder[method] = () => builder;
    builder.then = (onFulfilled?: (value: unknown) => unknown, onRejected?: unknown) =>
      promise.then(onFulfilled, onRejected as never);
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (h.pendingTables.has(table)) return neverSettling();
        if (h.deferredTables.has(table)) return deferred();
        return db.from(table);
      },
    },
  };
});

import { AdStatsPanel } from "@/components/admin/ads/organisms/AdStatsPanel";
import { fail, ok, okCount } from "@/test/supabase";
import type { AdSlot } from "@/lib/ads/types";

const slot = (id: string, name: string) => ({ id, name }) as AdSlot;

/** Wartości filtrów `eq` w kolejności wywołania - `argsOf` daje tylko pierwszy. */
function eqArgs(chain: RecordedChain): [string, unknown][] {
  return chain.calls.filter((c) => c.method === "eq").map((c) => [c.args[0] as string, c.args[1]]);
}

/** Odpowiada RÓŻNĄ liczbą na każdą parę (slot, rodzaj zdarzenia). */
function planEvents(counts: Record<string, number | null>) {
  h.db!.setResponse("ad_events", (chain: RecordedChain) => {
    const filters = Object.fromEntries(eqArgs(chain));
    const key = `${String(filters.slot_id)}:${String(filters.kind)}`;
    const value = counts[key];
    if (value === undefined) return fail(`test: nieplanowany licznik dla "${key}"`);
    return value === null ? { data: null, error: null, count: null } : okCount(value);
  });
}

const eventChains = () => h.db!.chainsFor("ad_events");
const cellsOfRow = (name: string) => {
  const row = screen.getByText(name).closest("tr");
  return Array.from(row?.querySelectorAll("td") ?? []).map((td) => td.textContent);
};

beforeEach(() => {
  h.db?.reset();
  h.pendingTables.clear();
  h.deferredTables.clear();
  h.release = null;
});

describe("zakładka statystyk: przypisanie liczników", () => {
  it("każdy licznik trafia do SWOJEGO slotu i SWOJEGO rodzaju zdarzenia", async () => {
    h.db!.setResponse("ad_slots", () => ok([slot("s1", "Baner góra"), slot("s2", "Sidebar")]));
    planEvents({
      "s1:impression": 1000,
      "s1:click": 25,
      "s2:impression": 8,
      "s2:click": 3,
    });

    render(<AdStatsPanel />);
    await screen.findByText("Baner góra");

    expect(cellsOfRow("Baner góra")).toEqual(["Baner góra", "1000", "25", "2.5%"]);
    expect(cellsOfRow("Sidebar")).toEqual(["Sidebar", "8", "3", "37.5%"]);
  });

  it("filtry zapytań liczących to (slot_id, kind) - po dwa na slot", async () => {
    h.db!.setResponse("ad_slots", () => ok([slot("s1", "Baner góra")]));
    planEvents({ "s1:impression": 4, "s1:click": 1 });

    render(<AdStatsPanel />);
    await screen.findByText("Baner góra");

    expect(eventChains().map(eqArgs)).toEqual([
      [
        ["slot_id", "s1"],
        ["kind", "impression"],
      ],
      [
        ["slot_id", "s1"],
        ["kind", "click"],
      ],
    ]);
  });

  it("zapytanie liczące NIE ściąga wierszy (head: true, count: exact)", async () => {
    h.db!.setResponse("ad_slots", () => ok([slot("s1", "Baner góra")]));
    planEvents({ "s1:impression": 4, "s1:click": 1 });

    render(<AdStatsPanel />);
    await screen.findByText("Baner góra");

    for (const chain of eventChains()) {
      expect(chain.argsOf("select")).toEqual(["*", { count: "exact", head: true }]);
    }
  });

  it("koszt rośnie liniowo: 1 zapytanie o sloty + 2 na każdy slot", async () => {
    h.db!.setResponse("ad_slots", () => ok([slot("s1", "A"), slot("s2", "B"), slot("s3", "C")]));
    planEvents({
      "s1:impression": 0,
      "s1:click": 0,
      "s2:impression": 0,
      "s2:click": 0,
      "s3:impression": 0,
      "s3:click": 0,
    });

    render(<AdStatsPanel />);
    await screen.findByText("A");

    expect(h.db!.chainsFor("ad_slots").length).toBe(1);
    expect(eventChains().length).toBe(6);
  });

  it("sloty są czytane po nazwie - kolejność wierszy jest przewidywalna", async () => {
    h.db!.setResponse("ad_slots", () => ok([slot("s1", "A")]));
    planEvents({ "s1:impression": 0, "s1:click": 0 });

    render(<AdStatsPanel />);
    await screen.findByText("A");

    expect(h.db!.chainsFor("ad_slots")[0].argsOf("order")).toEqual(["name"]);
  });
});

describe("zakładka statystyk: liczby brzegowe", () => {
  it("odmowa policzenia (count: null) czyta się jak ZERO, nie jak 'null'", async () => {
    h.db!.setResponse("ad_slots", () => ok([slot("s1", "Baner góra")]));
    planEvents({ "s1:impression": null, "s1:click": null });

    render(<AdStatsPanel />);
    await screen.findByText("Baner góra");

    expect(cellsOfRow("Baner góra")).toEqual(["Baner góra", "0", "0", "—"]);
  });

  it("wyświetlenia bez ani jednego klika dają 0 i CTR 0.0%, a nie kreskę", async () => {
    h.db!.setResponse("ad_slots", () => ok([slot("s1", "Baner góra")]));
    planEvents({ "s1:impression": 500, "s1:click": 0 });

    render(<AdStatsPanel />);
    await screen.findByText("Baner góra");

    expect(cellsOfRow("Baner góra")).toEqual(["Baner góra", "500", "0", "0.0%"]);
  });
});

describe("zakładka statystyk: trzy stany tabeli", () => {
  it("dopóki odczyt trwa, tabela mówi 'wczytywanie' - a NIE 'brak danych'", async () => {
    h.pendingTables.add("ad_slots");
    render(<AdStatsPanel />);

    expect(await screen.findByText("adsAdmin.stats.loading")).toBeTruthy();
    expect(screen.queryByText("adsAdmin.stats.empty")).toBeNull();
  });

  it("brak slotów mówi 'brak danych' i NIE pyta o ani jedno zdarzenie", async () => {
    h.db!.setResponse("ad_slots", () => ok([]));
    render(<AdStatsPanel />);

    expect(await screen.findByText("adsAdmin.stats.empty")).toBeTruthy();
    expect(eventChains()).toEqual([]);
    expect(screen.queryByText("adsAdmin.stats.loading")).toBeNull();
  });

  it("nagłówki kolumn liczbowych jadą z kluczy słownika", async () => {
    h.db!.setResponse("ad_slots", () => ok([]));
    render(<AdStatsPanel />);
    await screen.findByText("adsAdmin.stats.empty");

    expect(screen.getByText("adsAdmin.stats.impressions")).toBeTruthy();
    expect(screen.getByText("adsAdmin.stats.clicks")).toBeTruthy();
  });
});

describe("zakładka statystyk: odmontowanie w trakcie odczytu", () => {
  it("odpowiedź, która przyszła PO opuszczeniu zakładki, nie ustawia stanu i nie krzyczy", async () => {
    // Administrator przełącza zakładki szybciej, niż baza liczy - i wtedy
    // odpowiedź wraca do panelu, którego już nie ma. Flaga `cancelled` jest
    // jedynym, co stoi między tym a ostrzeżeniem Reacta w konsoli produkcyjnej.
    h.deferredTables.add("ad_slots");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = render(<AdStatsPanel />);
    await screen.findByText("adsAdmin.stats.loading");

    unmount();
    h.release?.({ data: [], error: null });
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

// DEFEKT: awaria odczytu statystyk udaje brak danych.
//
// `it.fails` opisuje zachowanie OCZEKIWANE, sąsiedni `it` - stan FAKTYCZNY.
// Po naprawie (odczyt pola `error` i osobny stan błędu, jak w panelu integracji)
// USUWA SIĘ OBA RAZEM.
describe("zakładka statystyk: awaria odczytu (defekt)", () => {
  it.fails("odmowa RLS POWINNA być odróżnialna od zera zdarzeń", async () => {
    h.db!.setResponse("ad_slots", () => fail("permission denied for table ad_slots", "42501"));
    render(<AdStatsPanel />);

    // Najpierw poczekaj, aż odczyt się ZAKOŃCZY (stan wczytywania znika),
    // a dopiero potem sprawdź, co panel mówi o awarii.
    await waitFor(() => expect(screen.queryByText("adsAdmin.stats.loading")).toBeNull());
    expect(screen.queryByText("adsAdmin.stats.empty")).toBeNull();
  });

  it("STAN FAKTYCZNY: odmowa RLS pokazuje 'brak danych' - to samo, co slot bez zdarzeń", async () => {
    h.db!.setResponse("ad_slots", () => fail("permission denied for table ad_slots", "42501"));
    render(<AdStatsPanel />);

    expect(await screen.findByText("adsAdmin.stats.empty")).toBeTruthy();
  });
});

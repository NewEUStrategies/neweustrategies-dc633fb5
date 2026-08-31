// Zakladka STATYSTYKI panelu reklam: odslony, klikniecia i CTR per slot.
//
// PO CO TEN PLIK ISTNIEJE. Ta tabela jest jedynym miejscem, z ktorego redakcja
// rozlicza sie z reklamodawca. Trzy rzeczy moga tu wprowadzic w blad:
//   1. DZIELENIE PRZEZ ZERO. Slot swiezo zalozony ma zero odslon. Bez straznika
//      `imp > 0` wyrazenie `clicks / 0 * 100` daje `NaN` (albo `Infinity` przy
//      niezerowych klikach) i w kolumnie CTR staje „NaN%" - liczba, ktora
//      wyglada jak wynik pomiaru, a nie jak brak danych.
//   2. POMYLONE LICZNIKI. Odslony i klikniecia to DWA osobne zapytania
//      roznione wylacznie wartoscia `kind`. Zamiana tych filtrow miejscami
//      odwraca CTR i nikt tego nie zauwazy, bo obie liczby sa wiarygodne.
//   3. PUSTA TABELA W TRAKCIE LADOWANIA. Bez odrebnego stanu „wczytuje"
//      redaktor widzi przez chwile „brak danych" i wnioskuje, ze kampania nie
//      wystartowala.
//
// GRANICA: wylacznie klient Supabase i i18n. Tabela `ad_events` nie jest w
// wygenerowanych typach bazy, wiec panel czyta ja przez `count` z `head: true` -
// atrapa lancucha PostgREST umie oddac sam licznik (`okCount`), i tak wlasnie
// jest tu odwzorowana.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { fail, ok, okCount, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";
import type { AdSlot } from "@/lib/ads/types";

const h = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

import { StatsPanel } from "../StatsPanel";

const db = () => h.from as SupabaseFromStub;

function slot(id: string, name: string): AdSlot {
  return {
    id,
    tenant_id: "tttttttt-1111-4111-8111-tttttttttttt",
    name,
    kind: "html",
    status: "active",
    html: null,
    script: null,
    image_url: null,
    image_link: null,
    image_alt: null,
    width: null,
    height: null,
    requires_consent: true,
    targeting: {},
    notes: null,
    created_at: "2026-02-01T10:00:00.000Z",
    updated_at: "2026-02-01T10:00:00.000Z",
  };
}

const SLOT_A = slot("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "Baner glowny");
const SLOT_B = slot("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "Pasek boczny");

/** Wartosc drugiego ogniwa `eq` - to ono rozroznia odslone od klikniecia. */
function kindOf(chain: RecordedChain): string {
  const eqs = chain.calls.filter((c) => c.method === "eq");
  const kind = eqs.find((c) => c.args[0] === "kind");
  return String(kind?.args[1] ?? "");
}

function slotIdOf(chain: RecordedChain): string {
  const eq = chain.calls.find((c) => c.method === "eq" && c.args[0] === "slot_id");
  return String(eq?.args[1] ?? "");
}

/** Liczniki `ad_events`: klucz `"<slot_id>:<kind>"`. */
function withCounts(counts: Record<string, number>): void {
  db().setResponse("ad_events", (chain) =>
    okCount(counts[`${slotIdOf(chain)}:${kindOf(chain)}`] ?? 0),
  );
}

function wiersz(nazwa: string): HTMLElement {
  return screen.getByText(nazwa).closest("tr") as HTMLElement;
}

beforeEach(() => {
  db().reset();
});

describe("StatsPanel - stany tabeli", () => {
  it("ZANIM dane dojada, tabela mowi `wczytuje`, a nie `brak danych`", () => {
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({});
    render(<StatsPanel />);
    expect(screen.getByText("adsAdmin.stats.loading")).toBeInTheDocument();
    expect(screen.queryByText("adsAdmin.stats.empty")).toBeNull();
  });

  it("BRAK slotow konczy sie komunikatem o pustej tabeli", async () => {
    db().setResponse("ad_slots", ok([]));
    withCounts({});
    render(<StatsPanel />);
    expect(await screen.findByText("adsAdmin.stats.empty")).toBeInTheDocument();
  });

  it("odczyt slotow sortuje po nazwie - kolejnosc raportu ma byc stabilna", async () => {
    // Raport dla reklamodawcy porownuje sie miedzy tygodniami. Sort po
    // `created_at` przestawialby wiersze po kazdym nowym slocie.
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({});
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    expect(db().lastChain("ad_slots")?.argsOf("order")).toEqual(["name"]);
  });

  it("ODMOWA odczytu slotow konczy sie pusta tabela, a nie wieczna ladowarka", async () => {
    // Panel czyta `data` bez zagladania do `error`. To ustalone zachowanie:
    // gorzej byloby, gdyby tabela stala na „wczytuje" i wygladala na zawieszona.
    db().setResponse("ad_slots", fail("permission denied", "42501"));
    withCounts({});
    render(<StatsPanel />);
    expect(await screen.findByText("adsAdmin.stats.empty")).toBeInTheDocument();
  });
});

describe("StatsPanel - liczniki i CTR", () => {
  it("odslony i klikniecia licza sie OSOBNO, po `kind`, w zakresie JEDNEGO slotu", async () => {
    // Bez `eq("slot_id", ...)` kazdy wiersz pokazalby sume calego najemcy.
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({ [`${SLOT_A.id}:impression`]: 200, [`${SLOT_A.id}:click`]: 5 });
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    const chains = db().chainsFor("ad_events");
    expect(chains).toHaveLength(2);
    expect(chains.map(kindOf).sort()).toEqual(["click", "impression"]);
    for (const chain of chains) {
      expect(slotIdOf(chain)).toBe(SLOT_A.id);
      // `head: true` - zapytanie liczace, bez sciagania wierszy zdarzen.
      expect(chain.argsOf("select")).toEqual(["*", { count: "exact", head: true }]);
    }
  });

  it("CTR liczy sie poprawnie i ma JEDNO miejsce po przecinku", async () => {
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({ [`${SLOT_A.id}:impression`]: 200, [`${SLOT_A.id}:click`]: 5 });
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    const cells = within(wiersz("Baner glowny"));
    expect(cells.getByText("200")).toBeInTheDocument();
    expect(cells.getByText("5")).toBeInTheDocument();
    expect(cells.getByText("2.5%")).toBeInTheDocument();
  });

  it("ZERO ODSLON nie daje `NaN%` - kolumna CTR pokazuje znak braku danych", async () => {
    // Rdzen tego pliku: slot bez ani jednej odslony (swiezo zalozony albo
    // wstrzymany) NIE MOZE pokazac wyniku dzielenia przez zero.
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({ [`${SLOT_A.id}:impression`]: 0, [`${SLOT_A.id}:click`]: 0 });
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    const cells = within(wiersz("Baner glowny"));
    expect(cells.queryByText(/NaN/)).toBeNull();
    expect(cells.queryByText(/Infinity/)).toBeNull();
  });

  it("ZERO ODSLON przy niezerowych klikach TEZ nie daje `Infinity%`", async () => {
    // Stan realny: zdarzenie klikniecia dojechalo, odslona zgubila sie na
    // blokerze reklam. Bez straznika `imp > 0` w kolumnie stanelaby
    // nieskonczonosc - i raport dla reklamodawcy przestalby byc czytelny.
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({ [`${SLOT_A.id}:impression`]: 0, [`${SLOT_A.id}:click`]: 3 });
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    const cells = within(wiersz("Baner glowny"));
    expect(cells.getByText("3")).toBeInTheDocument();
    expect(cells.queryByText(/Infinity/)).toBeNull();
    expect(cells.queryByText(/%/)).toBeNull();
  });

  it("brakujacy licznik (null z bazy) czyta sie jako ZERO, nie jako pustka", async () => {
    // `count` bywa `null`, gdy PostgREST nie policzy zakresu. Pusta komorka
    // w raporcie wyglada jak awaria; zero jest prawdziwa informacja.
    db().setResponse("ad_slots", ok([SLOT_A]));
    db().setResponse("ad_events", () => ({ data: null, error: null, count: null }));
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    const cells = within(wiersz("Baner glowny"));
    expect(cells.getAllByText("0")).toHaveLength(2);
  });

  it("KAZDY slot dostaje wlasna pare licznikow", async () => {
    // Dwa sloty to cztery zapytania. Wspoldzielenie licznika miedzy wierszami
    // dawaloby ten sam CTR dla wszystkich kreacji.
    db().setResponse("ad_slots", ok([SLOT_A, SLOT_B]));
    withCounts({
      [`${SLOT_A.id}:impression`]: 1000,
      [`${SLOT_A.id}:click`]: 10,
      [`${SLOT_B.id}:impression`]: 50,
      [`${SLOT_B.id}:click`]: 1,
    });
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    expect(db().chainsFor("ad_events")).toHaveLength(4);
    expect(within(wiersz("Baner glowny")).getByText("1.0%")).toBeInTheDocument();
    expect(within(wiersz("Pasek boczny")).getByText("2.0%")).toBeInTheDocument();
  });

  it("ODMONTOWANIE przed nadejsciem danych nie aktualizuje juz stanu", async () => {
    // Redaktor przelacza zakladke szybciej, niz wracaja liczniki. Bez flagi
    // `cancelled` React zglosilby aktualizacje odmontowanego komponentu.
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({ [`${SLOT_A.id}:impression`]: 1, [`${SLOT_A.id}:click`]: 1 });
    const { unmount } = render(<StatsPanel />);
    unmount();
    await waitFor(() => expect(db().chainsFor("ad_events").length).toBe(2));
    expect(screen.queryByText("Baner glowny")).toBeNull();
  });
});

describe("StatsPanel - dostepnosc", () => {
  it("tabela raportu nie ma strukturalnych naruszen dostepnosci", async () => {
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({ [`${SLOT_A.id}:impression`]: 10, [`${SLOT_A.id}:click`]: 1 });
    const { container } = render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY NAPRAWIONE (dawne `it.fails`).
// ---------------------------------------------------------------------------
describe("StatsPanel - dawne defekty", () => {
  it("znak braku CTR jest DYWIZEM ASCII, nie pauza", async () => {
    // CO BYLO ZLE. Przy zerowych odslonach kolumna CTR dostawala literal „—"
    // (U+2014, pauza). Konwencja tego repozytorium mowi wprost: dywiz ASCII.
    //
    // JAKIE TO BYLO RYZYKO. Pauza wklejona w kod jest niewidoczna w przegladzie
    // zmian i rozjezdzala sie z reszta panelu, ktora uzywa dywizu (podsumowanie
    // targetingu, kolumna slotu w pozycjach). Twardszy skutek byl przy
    // eksporcie: raport CTR kopiowany do arkusza dla reklamodawcy niosl znak,
    // ktorego czesc narzedzi nie odczyta w kodowaniu jednobajtowym, i komorka
    // konczyla jako „â€”". A poniewaz byl to literal, a nie klucz slownika, nie
    // dalo sie go tez podmienic na „brak danych" w wersji angielskiej.
    //
    // JAK NAPRAWIONE. Kolumna wola `t("adsAdmin.stats.noData")`; klucz stoi
    // w `i18n-ads-admin` w PL i EN z wartoscia „-" (dywiz ASCII).
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({ [`${SLOT_A.id}:impression`]: 0, [`${SLOT_A.id}:click`]: 0 });
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    expect(within(wiersz("Baner glowny")).queryByText("—")).toBeNull();
  });

  it("naglowek kolumny `Slot` pochodzi ze slownika", async () => {
    // BYLO: dwa z czterech naglowkow tej tabeli („Slot" i „CTR") wpisane
    // wprost, przy dwoch pozostalych idacych przez `t()` - jedna tabela na dwa
    // mechanizmy. JEST: `adsAdmin.stats.columnSlot` i `adsAdmin.stats.columnCtr`
    // w PL i EN.
    db().setResponse("ad_slots", ok([SLOT_A]));
    withCounts({});
    render(<StatsPanel />);
    await screen.findByText("Baner glowny");
    expect(screen.queryByRole("columnheader", { name: "Slot" })).toBeNull();
  });
});

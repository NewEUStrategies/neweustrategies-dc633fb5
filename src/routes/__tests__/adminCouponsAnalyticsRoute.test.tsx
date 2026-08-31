// Trasa `/admin/coupons/analytics` - zakładka ANALITYKA kuponów B2B.
// Do dziś: 0 z 9 funkcji, 0 instrukcji. Podobnie jak zakładka Realizacje NIE
// jest cienkim opakowaniem - niesie własny panel, więc testuje się ją jak
// panel, ale przez `renderRoute`, czyli razem ze sklejeniem adresu.
//
// PO CO TEN EKRAN MUSI BYĆ DOWIEDZIONY. To z tych czterech kafli i z tej
// tabeli powstaje odpowiedź na pytanie „czy kupony B2B nam się opłacają" -
// czyli decyzja o kolejnych kampaniach. Reguły, których złamania nie widać:
//
//   1. KONTRAKT Z FUNKCJĄ BAZY. `b2b_coupons_analytics` zwraca
//      `revenue_cents` jako przychód NETTO i `discount_cents_total` jako
//      udzielony RABAT. Wcześniej zwracała te wyrażenia ODWROTNIE i panel
//      pokazywał sumę rabatów w kaflu „Przychód". Panel musi czytać te pola
//      zgodnie z ich znaczeniem - inaczej inwersja wraca bez śladu w SQL.
//   2. OKNO CZASOWE JEDZIE DO BAZY. Agregaty liczy funkcja bazodanowa
//      z parametrami `_from`/`_to`. Zakres, który nie dojeżdża do wywołania,
//      daje liczby z innego okresu, niż pokazuje formularz.
//   3. WYKRES POKAZUJE TOP 10, NIE WSZYSTKO. Przy kilkuset kuponach oś
//      kategorii bez ucięcia jest nieczytelna, a wykres przestaje o czymkolwiek
//      informować. Ucięcie ma być na dziesięciu pozycjach i w kolejności
//      z bazy.
//   4. PUSTY WYNIK TO NIE BŁĄD. Zakres bez realizacji ma powiedzieć „brak
//      danych", a nie pokazać pusty wykres.
//
// GRANICE vs SĄSIEDZI. Atrapowane są WYŁĄCZNIE granice: klient Supabase (samo
// `rpc`), i18n oraz `EChart` - silnik wykresów doładowuje się leniwie i rysuje
// po canvasie, którego happy-dom nie ma. Atrapa wykresu jest przy okazji
// jedynym sposobem, żeby zobaczyć, JAKIE DANE panel do wykresu podaje.
// PRAWDZIWE biegną: atom `Stat` i `DatePickerField` (sąsiedzi z
// `@/components/admin/coupons/*`).
//
// ZERO SIECI, ZERO danych osobowych - agregaty nie niosą tożsamości.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => h.rpc(name, args) },
}));

// GRANICA WYKRESU. `EChart` renderuje szkielet, a po zamontowaniu dociąga
// `EChartClient` (≈1 MB silnika rysującego po canvasie). W teście liczy się
// nie obraz, tylko DANE, które panel na wykres wysyła - atrapa wystawia je
// w atrybucie, żeby nie mieszały się z tekstem strony.
vi.mock("@/components/admin/analytics/EChart", () => ({
  EChart: ({ option, height }: { option: unknown; height?: number | string }) => (
    <div data-testid="wykres" data-wysokosc={String(height)} data-opcja={JSON.stringify(option)} />
  ),
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as AnalyticsRoute } from "@/routes/admin.coupons.analytics";

const PATH = "/admin/coupons/analytics";
const RPC = "b2b_coupons_analytics";

/** Wiersz agregatu w kształcie kontraktu funkcji `b2b_coupons_analytics`. */
interface WierszAnalityki {
  coupon_id: string;
  code: string;
  name: string | null;
  redemptions: number;
  /** Przychód NETTO (original - applied). */
  revenue_cents: number;
  /** Udzielony RABAT (applied). */
  discount_cents_total: number;
}

function wiersz(over: Partial<WierszAnalityki> = {}): WierszAnalityki {
  return {
    coupon_id: "11111111-1111-4111-8111-111111111111",
    code: "NES-AAA111",
    name: "Partner A",
    redemptions: 3,
    revenue_cents: 24_000,
    discount_cents_total: 6_000,
    ...over,
  };
}

function zBazy(rows: WierszAnalityki[]): void {
  h.rpc.mockResolvedValue({ data: rows, error: null });
}

async function zamontuj() {
  return renderRoute({ route: AnalyticsRoute, path: PATH, initialEntry: PATH });
}

/**
 * Kafel liczby (`Stat`) po widocznej etykiecie. Zawężenie do `div` jest
 * KONIECZNE: „Realizacje", „Przychód netto" i „Rabat łącznie" są jednocześnie
 * etykietami kafli i nagłówkami kolumn tabeli szczegółów (`th`) - bez tego
 * wskazanie raz trafiałoby w kafel, a raz w nagłówek kolumny.
 */
function kafel(etykieta: string): HTMLElement {
  const label = screen.getByText(etykieta, { selector: "div" });
  const karta = label.parentElement;
  if (!karta) throw new Error(`test: kafel "${etykieta}" nie ma zawartości`);
  return karta;
}

/** Przycisk pola daty (`DatePickerField`) po widocznej etykiecie pola. */
function poleDaty(etykieta: string): HTMLElement {
  const label = screen.getByText(etykieta);
  const przycisk = label.parentElement?.querySelector("button");
  if (!przycisk) throw new Error(`test: pole daty "${etykieta}" nie ma przycisku`);
  return przycisk;
}

/**
 * Klika w dzień kalendarza i czeka, aż panel POŚLE nowe pytanie do bazy.
 *
 * Klikamy w pętli, bo warstwa Radiksa PRZEMONTOWUJE kalendarz przy kolejnych
 * renderach panelu: uchwyt złapany raz bywa już odpięty od dokumentu w chwili
 * kliknięcia, a klik w odpięty węzeł jest bezgłośny. Dowodem jest więc dopiero
 * kolejne wywołanie funkcji agregującej, a nie samo zdarzenie myszy.
 */
async function klikDzien(dzien: string, poprzednieWywolania: number): Promise<void> {
  await screen.findByRole("gridcell", { name: dzien });
  await waitFor(() => {
    const komorka = screen.getByRole("gridcell", { name: dzien });
    fireEvent.click(komorka.querySelector("button") ?? komorka);
    expect(h.rpc.mock.calls.length).toBeGreaterThan(poprzednieWywolania);
  });
}

/** Wiersz tabeli szczegółów po kodzie kuponu - liczby powtarzają się w kaflach. */
function wierszTabeli(kod: string): HTMLElement {
  const komorka = screen.getByText(kod).closest("tr");
  if (!komorka) throw new Error(`test: kod "${kod}" nie stoi w wierszu tabeli`);
  return komorka;
}

/** Argumenty ostatniego wywołania funkcji agregującej. */
function argumentyRpc(): { _from: string; _to: string } {
  const call = h.rpc.mock.calls.at(-1);
  if (!call) throw new Error("test: panel nie wywołał funkcji agregującej");
  const [nazwa, args] = call;
  expect(nazwa).toBe(RPC);
  if (typeof args !== "object" || args === null) throw new Error("test: brak parametrów zakresu");
  const from = "_from" in args ? args._from : undefined;
  const to = "_to" in args ? args._to : undefined;
  if (typeof from !== "string" || typeof to !== "string") {
    throw new Error("test: zakres nie jedzie do bazy jako `_from`/`_to`");
  }
  return { _from: from, _to: to };
}

/** Dane, które panel podał wykresowi: kategorie osi i wartości serii. */
function daneWykresu(): { kody: string[]; wartosci: number[] } {
  const surowe = screen.getByTestId("wykres").getAttribute("data-opcja");
  if (!surowe) throw new Error("test: wykres nie dostał opcji");
  const opcja: unknown = JSON.parse(surowe);
  if (typeof opcja !== "object" || opcja === null || !("xAxis" in opcja) || !("series" in opcja)) {
    throw new Error("test: opcja wykresu nie ma osi i serii");
  }
  const os = opcja.xAxis;
  const serie = opcja.series;
  if (typeof os !== "object" || os === null || !("data" in os) || !Array.isArray(os.data)) {
    throw new Error("test: oś kategorii nie niesie danych");
  }
  if (!Array.isArray(serie) || serie.length === 0) throw new Error("test: brak serii wykresu");
  const pierwsza: unknown = serie[0];
  if (
    typeof pierwsza !== "object" ||
    pierwsza === null ||
    !("data" in pierwsza) ||
    !Array.isArray(pierwsza.data)
  ) {
    throw new Error("test: seria nie niesie wartości");
  }
  return {
    kody: os.data.map((value: unknown) => String(value)),
    wartosci: pierwsza.data.map((value: unknown) => Number(value)),
  };
}

beforeEach(() => {
  h.lang = "pl";
  h.rpc.mockReset();
  zBazy([]);
});

describe("trasa /admin/coupons/analytics - sklejenie i zakres", () => {
  it("montuje się POD SWOIM ADRESEM i pyta funkcję agregującą bazy", async () => {
    const view = await zamontuj();
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByText("TOP 10 kuponów")).toBeInTheDocument();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    expect(h.rpc.mock.calls[0][0]).toBe(RPC);
    cleanup();
  });

  it("domyślne okno to OSTATNIE 90 DNI i jedzie do bazy jako `_from`/`_to`", async () => {
    // Analityka patrzy szerzej niż rejestr realizacji (tam 30 dni): kampanie
    // kuponowe rozliczają się kwartałami. Okno liczone po stronie panelu, ale
    // filtrowane po stronie BAZY - stąd dowód dotyczy parametrów wywołania.
    await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    const { _from, _to } = argumentyRpc();
    const dni = (Date.parse(_to) - Date.parse(_from)) / (24 * 3600 * 1000);
    expect(Math.round(dni)).toBe(90);
    cleanup();
  });

  it("zmiana daty OD wysyła NOWE wywołanie z nowym początkiem zakresu", async () => {
    await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    fireEvent.click(poleDaty("Od"));
    await klikDzien("15", 1);
    expect(new Date(argumentyRpc()._from).getDate()).toBe(15);
    cleanup();
  });

  it("WYCZYSZCZENIE daty OD pyta bazę od POCZĄTKU historii, a nie bez parametru", async () => {
    // Funkcja agregująca wymaga OBU parametrów, więc panel podstawia za pusty
    // początek zakresu epokę (1970). To celowa różnica wobec zakładki
    // Realizacje, która po prostu zdejmuje ograniczenie - i właśnie dlatego
    // warto ją mieć zapisaną: „brak daty" znaczy tu co innego niż tam.
    // Wybór i ponowne kliknięcie TEGO SAMEGO dnia to jedyna droga do pustego
    // pola (kalendarz otwiera się na bieżącym miesiącu, więc dzień musi być
    // z niego - inaczej test zależałby od dzisiejszej daty).
    await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    fireEvent.click(poleDaty("Od"));
    await klikDzien("15", 1);
    await klikDzien("15", h.rpc.mock.calls.length);
    expect(Date.parse(argumentyRpc()._from)).toBe(0);
    cleanup();
  });

  it("WYCZYSZCZENIE daty DO pyta bazę DO TERAZ, a nie bez parametru", async () => {
    // Druga strona tej samej reguły: funkcja agregująca wymaga obu granic,
    // więc puste pole „Do" znaczy „do chwili obecnej". Gdyby panel wysłał tu
    // pustą wartość, wywołanie odbiłoby się błędem typu zamiast pokazać dane.
    await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    fireEvent.click(poleDaty("Do"));
    await klikDzien("15", 1);
    await klikDzien("15", h.rpc.mock.calls.length);
    const doChwili = Date.parse(argumentyRpc()._to);
    expect(Number.isNaN(doChwili)).toBe(false);
    expect(Math.abs(Date.now() - doChwili)).toBeLessThan(60_000);
    cleanup();
  });
});

describe("trasa /admin/coupons/analytics - liczby i kontrakt kolumn", () => {
  it("NULL zamiast tablicy z funkcji agregującej nie wywraca panelu", async () => {
    // Funkcja bez wierszy potrafi oddać `data: null`. Bez zabezpieczenia
    // `rows.reduce` na `null` daje biały ekran całej zakładki zamiast napisu
    // o braku danych.
    h.rpc.mockResolvedValue({ data: null, error: null });
    await zamontuj();
    await waitFor(() => expect(screen.getAllByText("Brak danych.")).toHaveLength(2));
    expect(within(kafel("Kupony")).getByText("0")).toBeInTheDocument();
    cleanup();
  });

  it("PUSTY wynik mówi wprost, że nie ma danych - i nie rysuje wykresu", async () => {
    zBazy([]);
    const view = await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    // Dwa razy: pod wykresem i pod tabelą szczegółów. Czekamy na OBA napisy,
    // bo w trakcie wczytywania miejsce wykresu zajmuje jeszcze spinner.
    await waitFor(() => expect(screen.getAllByText("Brak danych.")).toHaveLength(2));
    expect(within(view.container).queryByTestId("wykres")).toBeNull();
    cleanup();
  });

  it("W TRAKCIE liczenia agregatów pokazuje wczytywanie, a nie pusty wykres", async () => {
    // Funkcja agregująca liczy po całej historii realizacji, więc bywa
    // wolniejsza od zwykłego odczytu. Bez tej gałęzi ekran w trakcie liczenia
    // byłby nieodróżnialny od odpowiedzi „nic nie znaleziono".
    h.rpc.mockReturnValue(new Promise<never>(() => {}));
    await zamontuj();
    expect(screen.getByText("Wczytywanie…")).toBeInTheDocument();
    cleanup();
  });

  it("kafle czytają przychód NETTO, a nie sumę rabatów", async () => {
    // Kontrakt migracji 20260725090200: `revenue_cents` = przychód netto,
    // `discount_cents_total` = rabat. Odwrócenie ich w panelu (albo w SQL)
    // pokazuje kupon o największym rabacie jako najbardziej dochodowy.
    zBazy([
      wiersz(),
      wiersz({
        coupon_id: "22222222-2222-4222-8222-222222222222",
        code: "NES-BBB222",
        name: null,
        redemptions: 2,
        revenue_cents: 16_000,
        discount_cents_total: 4_000,
      }),
    ]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    expect(within(kafel("Kupony")).getByText("2")).toBeInTheDocument();
    expect(within(kafel("Realizacje")).getByText("5")).toBeInTheDocument();
    // 240,00 + 160,00 = 400,00 przychodu netto (a NIE 60,00 + 40,00 rabatu).
    expect(within(kafel("Przychód netto")).getByText("400.00")).toBeInTheDocument();
    cleanup();
  });

  it("tabela szczegółów pokazuje rabat ze znakiem minus i sumę rabatów pod spodem", async () => {
    zBazy([wiersz()]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    const wierszKuponu = wierszTabeli("NES-AAA111");
    expect(within(wierszKuponu).getByText("Partner A")).toBeInTheDocument();
    expect(within(wierszKuponu).getByText("3")).toBeInTheDocument();
    expect(within(wierszKuponu).getByText("240.00")).toBeInTheDocument();
    expect(within(wierszKuponu).getByText("-60.00")).toBeInTheDocument();
    // Łączny rabat stoi osobno pod tabelą - to on jest kosztem kampanii.
    expect(screen.getByText("Łączny rabat udzielony", { exact: false })).toBeInTheDocument();
    cleanup();
  });

  it("konwersja liczy UDZIAŁ kuponów, które ktokolwiek zrealizował", async () => {
    // Kupon wystawiony i nietknięty to koszt kampanii bez zwrotu. Ten kafel
    // jest jedynym miejscem, w którym widać, jaka część puli w ogóle ruszyła.
    zBazy([
      wiersz(),
      wiersz({
        coupon_id: "33333333-3333-4333-8333-333333333333",
        code: "NES-CCC333",
        redemptions: 0,
        revenue_cents: 0,
        discount_cents_total: 0,
      }),
    ]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    expect(within(kafel("Konwersja")).getByText("50.0%")).toBeInTheDocument();
    cleanup();
  });
});

describe("trasa /admin/coupons/analytics - wykres", () => {
  it("na wykres idą KODY i liczby realizacji, w kolejności z bazy", async () => {
    zBazy([
      wiersz({ code: "NES-AAA111", redemptions: 7 }),
      wiersz({
        coupon_id: "22222222-2222-4222-8222-222222222222",
        code: "NES-BBB222",
        redemptions: 2,
      }),
    ]);
    await zamontuj();
    await screen.findByTestId("wykres");
    expect(daneWykresu()).toEqual({
      kody: ["NES-AAA111", "NES-BBB222"],
      wartosci: [7, 2],
    });
    cleanup();
  });

  it("wykres URYWA SIĘ na dziesięciu pozycjach, choćby kuponów było więcej", async () => {
    // Bez ucięcia oś kategorii przy kilkuset kuponach jest nieczytelna,
    // a tabela szczegółów pod spodem i tak pokazuje komplet.
    zBazy(
      Array.from({ length: 14 }, (_, i) =>
        wiersz({
          coupon_id: `coupon-${i}`,
          code: `NES-${String(i).padStart(3, "0")}`,
          redemptions: i,
        }),
      ),
    );
    await zamontuj();
    await screen.findByTestId("wykres");
    const { kody } = daneWykresu();
    expect(kody).toHaveLength(10);
    expect(kody[0]).toBe("NES-000");
    expect(kody[9]).toBe("NES-009");
    // Tabela szczegółów nie jest ucinana - komplet zostaje widoczny.
    expect(screen.getByText("NES-013")).toBeInTheDocument();
    cleanup();
  });
});

describe("trasa /admin/coupons/analytics - język i dostępność", () => {
  it("wersja angielska opisuje kafle i nagłówki po angielsku", async () => {
    h.lang = "en";
    zBazy([wiersz()]);
    await zamontuj();
    expect(await screen.findByText("TOP 10 coupons")).toBeInTheDocument();
    expect(kafel("Net revenue")).toBeInTheDocument();
    expect(kafel("Conversion")).toBeInTheDocument();
    expect(screen.getByText("Per-coupon detail")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total discount" })).toBeInTheDocument();
    cleanup();
  });

  it("panel z danymi nie ma naruszeń dostępności", async () => {
    zBazy([wiersz()]);
    const view = await zamontuj();
    await screen.findByText("NES-AAA111");
    const naruszenia = await axeViolations(view.container);
    expect(summarize(naruszenia)).toBe("");
    cleanup();
  });
});

describe("trasa /admin/coupons/analytics - DEFEKTY (zarejestrowane, nienaprawiane)", () => {
  it.fails("BŁĄD FUNKCJI AGREGUJĄCEJ wygląda jak zakres bez sprzedaży", async () => {
    // CO JEST ZŁE. `queryFn` rzuca błędem PostgREST, ale render nie ma ani
    // jednej gałęzi dla `q.isError`: `rows = q.data ?? []`, więc odmowa
    // uprawnień do `b2b_coupons_analytics`, błąd SQL w funkcji i zerwana sieć
    // dają dokładnie ten sam ekran co poprawny odczyt pustego okna - „Brak
    // danych." i cztery kafle zer (w tym „Przychód netto: 0.00").
    //
    // DLACZEGO TO RYZYKO. Ten ekran odpowiada na pytanie „czy kupony B2B nam
    // się opłacają". Zera odczytane z awarii to wniosek, że kampania nie
    // przyniosła przychodu - czyli decyzja o wygaszeniu programu podjęta na
    // podstawie błędu odczytu, a nie danych. Kierunek odwrotny jest równie
    // realny: nikt nie zgłosi awarii funkcji bazodanowej, bo panel wygląda
    // na sprawny.
    //
    // DLACZEGO NIE NAPRAWIAM. Zadanie zabrania zmian w kodzie produkcyjnym,
    // a poprawka jest decyzją modułu, nie literówką: trzeba wybrać kształt
    // komunikatu (zamiast kafli czy obok nich), ujednolicić go z zakładką
    // Realizacje (ma ten sam brak - patrz jej plik testowy) i rozstrzygnąć,
    // czy kafle mają wtedy pokazywać kreski zamiast zer. Rejestruję defekt
    // z dowodem zamiast go po cichu obejść.
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "test: brak uprawnień do funkcji agregującej" },
    });
    await zamontuj();
    // Stan faktyczny: awaria nie do odróżnienia od zakresu bez realizacji.
    await waitFor(() => expect(screen.getAllByText("Brak danych.")).toHaveLength(2));
    expect(within(kafel("Przychód netto")).getByText("0.00")).toBeInTheDocument();
    // ASERCJA DOCELOWA: panel MUSI zameldować, że agregatów nie udało się
    // policzyć - inaczej zera są kłamstwem o pieniądzach.
    expect(screen.queryByRole("alert")).not.toBeNull();
  });
});

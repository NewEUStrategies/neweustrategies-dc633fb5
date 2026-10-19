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
// `rpc`), i18n, najemca (`@/lib/tenant` - prawdziwy hook ciągnąłby sesję
// `useAuth`, której harness tras nie ma) oraz silnik wykresów
// (`@/components/charts/Chart`) - atrapa wystawia konfigurację, bo to ona,
// a nie obraz, jest tu przedmiotem dowodu (patrz komentarz przy atrapie).
// PRAWDZIWE biegną: atom `Stat` i `DatePickerField` (sąsiedzi z
// `@/components/admin/coupons/*`).
//
// ZERO SIECI, ZERO danych osobowych - agregaty nie niosą tożsamości.
//
// ZMIANA ŚWIADOMA (S1, P10, D-S1-08). Kafle liczyły się z funkcji
// `b2b_coupons_analytics`, która NIE zna waluty ani płatności: przychód
// sumował grosze PLN z centami EUR, a „konwersja" liczyła kupony z jakimkolwiek
// wykorzystaniem - także rezerwacją bez płatności. Teraz:
//   * kafle idą z podsumowania `couponAnalyticsSummaryQueryOptions` (atrapa
//     na granicy modułu danych - jego zapytania mają własne testy w
//     `couponQueries.test.ts`): wydane, konwersja opłacona z definicją,
//     wykorzystania opłacone, rezerwacje, przychód i rabat PER WALUTA;
//   * funkcja agregująca zostaje źródłem RANKINGU (wykres, tabela liczby
//     wykorzystań) - bez kwot, które mieszały waluty;
//   * kwoty czyta wyłącznie administrator (RLS zamówień), stąd atrapa ról;
//   * napisy idą ze słownika (`t`), więc asercje mierzą KLUCZE (echo atrapy
//     i18n), a nie polskie literały dawnego bliźniaka `L(pl, en)`;
//   * granice zakresu to pełne doby LOKALNE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  lang: "pl",
  tenantId: null as string | null,
  roles: ["admin"] as string[],
  /** Podsumowanie P10 (`fetchCouponAnalyticsSummary`) - atrapa granicy danych. */
  summary: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ roles: h.roles }) }));
vi.mock("@/lib/admin/couponQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/couponQueries")>();
  const { queryOptions } = await import("@tanstack/react-query");
  const { analyticsCouponsPrefixKey } = await import("@/lib/analytics/queryKeys");
  return {
    ...actual,
    couponAnalyticsSummaryQueryOptions: (
      tenantId: string | null,
      fromIso: string | null,
      toIso: string | null,
    ) =>
      queryOptions({
        queryKey: [...analyticsCouponsPrefixKey(tenantId ?? ""), "summary", fromIso, toIso],
        enabled: Boolean(tenantId),
        retry: false,
        queryFn: () => h.summary(tenantId, fromIso, toIso),
      }),
  };
});

// Najemca jako ATRAPA (wzór: `vitalsBiDashboard.test.tsx`): klucz zapytania
// niesie najemcę, a odczyt rusza dopiero przy ustalonym najemcy.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => h.rpc(name, args) },
}));

// GRANICA WYKRESU. Trasa rysuje naszym silnikiem, ale przedmiotem TEGO testu
// jest nie obraz, tylko DANE, które panel na wykres wysyła - silnik ma własne,
// pełne testy renderu. Atrapa wystawia konfigurację w atrybucie, żeby jej
// treść nie mieszała się z tekstem strony.
vi.mock("@/components/charts/Chart", () => ({
  Chart: ({ config }: { config: { height: number } }) => (
    <div
      data-testid="wykres"
      data-wysokosc={String(config.height)}
      data-opcja={JSON.stringify(config)}
    />
  ),
}));

import { renderRoute } from "@/test/routeHarness";
import { analyticsCouponsKey } from "@/lib/analytics/queryKeys";
import { Route as AnalyticsRoute } from "@/routes/admin.coupons.analytics";

const PATH = "/admin/coupons/analytics";
const RPC = "b2b_coupons_analytics";
const TENANT = "tenant-kupony";

/**
 * Dzień kalendarza używany w testach zakresu dat - ZAWSZE inny niż dzisiejszy.
 * Kalendarz otwiera się na bieżącym miesiącu, a domyślny zakres panelu sięga
 * DZIŚ: klik w dzisiejszy dzień KASUJE wybór, więc test przypięty na sztywno
 * do „15" przewracał się dokładnie 15. dnia miesiąca.
 */
const DZIEN: string = new Date().getDate() === 15 ? "14" : "15";

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

interface Podsumowanie {
  issued: number;
  issuedConverted: number;
  conversion: number | null;
  paidRedemptions: number;
  reservedRedemptions: number;
  revenueNet: { currency: string; amountMinor: number }[];
  discount: { currency: string; amountMinor: number }[];
  truncated: boolean;
}

function podsumowanie(over: Partial<Podsumowanie> = {}): Podsumowanie {
  return {
    issued: 4,
    issuedConverted: 1,
    conversion: 0.25,
    paidRedemptions: 3,
    reservedRedemptions: 2,
    revenueNet: [{ currency: "PLN", amountMinor: 40_000 }],
    discount: [{ currency: "PLN", amountMinor: 10_000 }],
    truncated: false,
    ...over,
  };
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

/** Dane, które panel podał wykresowi: kategorie i wartości pierwszej serii. */
function daneWykresu(): { kody: string[]; wartosci: number[] } {
  const surowe = screen.getByTestId("wykres").getAttribute("data-opcja");
  if (!surowe) throw new Error("test: wykres nie dostał konfiguracji");
  const konfiguracja: unknown = JSON.parse(surowe);
  if (
    typeof konfiguracja !== "object" ||
    konfiguracja === null ||
    !("categories" in konfiguracja) ||
    !("series" in konfiguracja)
  ) {
    throw new Error("test: konfiguracja nie ma kategorii i serii");
  }
  const kategorie = konfiguracja.categories;
  const serie = konfiguracja.series;
  if (!Array.isArray(kategorie)) throw new Error("test: kategorie nie są tablicą");
  if (!Array.isArray(serie) || serie.length === 0) throw new Error("test: brak serii wykresu");
  const pierwsza: unknown = serie[0];
  if (
    typeof pierwsza !== "object" ||
    pierwsza === null ||
    !("values" in pierwsza) ||
    !Array.isArray(pierwsza.values)
  ) {
    throw new Error("test: seria nie niesie wartości");
  }
  return {
    kody: kategorie.map((value: unknown) => String(value)),
    wartosci: pierwsza.values.map((value: unknown) => Number(value)),
  };
}

beforeEach(() => {
  h.lang = "pl";
  h.tenantId = TENANT;
  h.roles = ["admin"];
  h.rpc.mockReset();
  h.summary.mockReset();
  h.summary.mockResolvedValue(podsumowanie());
  zBazy([]);
});

describe("trasa /admin/coupons/analytics - sklejenie i zakres", () => {
  it("montuje się POD SWOIM ADRESEM i pyta funkcję agregującą bazy", async () => {
    const view = await zamontuj();
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByText("adminCoupons.analytics.rankingTitle")).toBeInTheDocument();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    expect(h.rpc.mock.calls[0][0]).toBe(RPC);
    cleanup();
  });

  it("domyślne okno to OSTATNIE 90 DNI PEŁNYMI DOBAMI i jedzie do bazy jako `_from`/`_to`", async () => {
    // Analityka patrzy szerzej niż rejestr realizacji (tam 30 dni): kampanie
    // kuponowe rozliczają się kwartałami. Okno liczone po stronie panelu, ale
    // filtrowane po stronie BAZY - stąd dowód dotyczy parametrów wywołania.
    // Granice to pełne doby lokalne (S1): od północy 90 dni temu do końca dziś.
    await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    const { _from, _to } = argumentyRpc();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 90);
    const koniec = new Date();
    koniec.setHours(23, 59, 59, 999);
    expect(Date.parse(_from)).toBe(start.getTime());
    expect(Date.parse(_to)).toBe(koniec.getTime());
    // To samo okno dostaje podsumowanie kafli - jeden zakres na ekranie.
    await waitFor(() =>
      expect(h.summary).toHaveBeenCalledWith(TENANT, start.toISOString(), koniec.toISOString()),
    );
    cleanup();
  });

  it("zmiana daty OD wysyła NOWE wywołanie z nowym początkiem zakresu", async () => {
    await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    fireEvent.click(poleDaty("adminCoupons.analytics.from"));
    await klikDzien(DZIEN, 1);
    expect(new Date(argumentyRpc()._from).getDate()).toBe(Number(DZIEN));
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
    fireEvent.click(poleDaty("adminCoupons.analytics.from"));
    await klikDzien(DZIEN, 1);
    await klikDzien(DZIEN, h.rpc.mock.calls.length);
    expect(Date.parse(argumentyRpc()._from)).toBe(0);
    cleanup();
  });

  it("WYCZYSZCZENIE daty DO pyta bazę DO TERAZ, a nie bez parametru", async () => {
    // Druga strona tej samej reguły: funkcja agregująca wymaga obu granic,
    // więc puste pole „Do" znaczy „do chwili obecnej". Gdyby panel wysłał tu
    // pustą wartość, wywołanie odbiłoby się błędem typu zamiast pokazać dane.
    await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    fireEvent.click(poleDaty("adminCoupons.analytics.to"));
    await klikDzien(DZIEN, 1);
    await klikDzien(DZIEN, h.rpc.mock.calls.length);
    const doChwili = Date.parse(argumentyRpc()._to);
    expect(Number.isNaN(doChwili)).toBe(false);
    expect(Math.abs(Date.now() - doChwili)).toBeLessThan(60_000);
    cleanup();
  });
});

describe("trasa /admin/coupons/analytics - najemca w kluczu", () => {
  it("agregaty leżą w cache'u pod kluczem z najemcą i zakresem", async () => {
    zBazy([wiersz()]);
    const view = await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    const { _from, _to } = argumentyRpc();

    await waitFor(() =>
      expect(view.queryClient.getQueryState(analyticsCouponsKey(TENANT, _from, _to))?.status).toBe(
        "success",
      ),
    );
    cleanup();
  });

  it("bez ustalonego najemcy nie pyta bazy i nie twierdzi „Brak danych” pod wykresem", async () => {
    // Wyłączone zapytanie ma `isLoading: false`: bez `!tenantId` karta
    // rankingu mówiłaby „Brak danych." - zakres bez sprzedaży - zanim
    // ktokolwiek zapytał bazę.
    h.tenantId = null;
    const view = await zamontuj();
    await act(async () => {});

    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.summary).not.toHaveBeenCalled();
    expect(screen.getByText("adminCoupons.loading")).toBeInTheDocument();
    expect(within(view.container).queryByTestId("wykres")).toBeNull();
    cleanup();
  });
});

describe("trasa /admin/coupons/analytics - ranking i tabela szczegółów", () => {
  it("NULL zamiast tablicy z funkcji agregującej nie wywraca panelu", async () => {
    // Funkcja bez wierszy potrafi oddać `data: null`. Bez zabezpieczenia
    // `rows.slice` na `null` daje biały ekran całej zakładki zamiast napisu
    // o braku danych.
    h.rpc.mockResolvedValue({ data: null, error: null });
    await zamontuj();
    await waitFor(() =>
      expect(screen.getAllByText("adminCoupons.analytics.noData")).toHaveLength(2),
    );
    cleanup();
  });

  it("PUSTY wynik mówi wprost, że nie ma danych - i nie rysuje wykresu", async () => {
    zBazy([]);
    const view = await zamontuj();
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    // Dwa razy: pod wykresem i pod tabelą szczegółów. Czekamy na OBA napisy,
    // bo w trakcie wczytywania miejsce wykresu zajmuje jeszcze spinner.
    await waitFor(() =>
      expect(screen.getAllByText("adminCoupons.analytics.noData")).toHaveLength(2),
    );
    expect(within(view.container).queryByTestId("wykres")).toBeNull();
    cleanup();
  });

  it("W TRAKCIE liczenia agregatów pokazuje wczytywanie, a nie pusty wykres", async () => {
    // Funkcja agregująca liczy po całej historii realizacji, więc bywa
    // wolniejsza od zwykłego odczytu. Bez tej gałęzi ekran w trakcie liczenia
    // byłby nieodróżnialny od odpowiedzi „nic nie znaleziono".
    h.rpc.mockReturnValue(new Promise<never>(() => {}));
    await zamontuj();
    expect(screen.getByText("adminCoupons.loading")).toBeInTheDocument();
    cleanup();
  });

  it("tabela szczegółów pokazuje WYŁĄCZNIE liczbę wykorzystań - bez kwot mieszających waluty", async () => {
    // Kwoty funkcji agregującej nie znają waluty i obejmują rezerwacje bez
    // płatności. W wierszu kuponu zostaje kod, nazwa i liczba wykorzystań;
    // dawna suma „Łączny rabat udzielony" (PLN + EUR w jednej liczbie) znika.
    zBazy([wiersz()]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    const wierszKuponu = wierszTabeli("NES-AAA111");
    expect(within(wierszKuponu).getByText("Partner A")).toBeInTheDocument();
    expect(within(wierszKuponu).getByText("3")).toBeInTheDocument();
    expect(within(wierszKuponu).queryByText("240.00")).toBeNull();
    expect(within(wierszKuponu).queryByText("-60.00")).toBeNull();
    expect(screen.queryByText("Łączny rabat udzielony", { exact: false })).toBeNull();
    expect(screen.getByText("adminCoupons.analytics.detailNote")).toBeInTheDocument();
    cleanup();
  });
});

describe("trasa /admin/coupons/analytics - P10: kafle per waluta i konwersja opłacona", () => {
  it("DWIE WALUTY = DWA kafle przychodu i DWA kafle rabatu - nigdy jedna suma", async () => {
    h.summary.mockResolvedValue(
      podsumowanie({
        revenueNet: [
          { currency: "PLN", amountMinor: 40_000 },
          { currency: "EUR", amountMinor: 5_000 },
        ],
        discount: [
          { currency: "PLN", amountMinor: 10_000 },
          { currency: "EUR", amountMinor: 1_000 },
        ],
      }),
    );
    const view = await zamontuj();
    await screen.findByText("adminCoupons.analytics.revenueNet(currency=PLN)");

    const kafle = within(screen.getByTestId("kafle-walut"));
    expect(kafle.getByText("adminCoupons.analytics.revenueNet(currency=EUR)")).toBeInTheDocument();
    expect(kafle.getByText("adminCoupons.analytics.discount(currency=PLN)")).toBeInTheDocument();
    expect(kafle.getByText("adminCoupons.analytics.discount(currency=EUR)")).toBeInTheDocument();
    // Każda kwota niesie SWOJĄ walutę; 400 zł i 50 € nie skleja się w 450.
    const pln = kafel("adminCoupons.analytics.revenueNet(currency=PLN)").textContent ?? "";
    const eur = kafel("adminCoupons.analytics.revenueNet(currency=EUR)").textContent ?? "";
    expect(pln).toMatch(/400/);
    expect(pln).not.toMatch(/€|EUR/);
    expect(eur).toMatch(/50/);
    expect(eur).toMatch(/€|EUR/);
    expect(view.container.textContent ?? "").not.toMatch(/450[,.]00/);
    cleanup();
  });

  it("konwersja = kohorta wydanych z OPŁACONYM wykorzystaniem, z definicją przy kaflu", async () => {
    // 1 z 4 wydanych ma opłacone wykorzystanie = 25%, choć funkcja agregująca
    // (rezerwacje też) widzi wykorzystanie przy WSZYSTKICH czterech.
    zBazy([wiersz(), wiersz({ coupon_id: "c-2", code: "NES-BBB222", redemptions: 1 })]);
    h.summary.mockResolvedValue(podsumowanie({ issued: 4, issuedConverted: 1, conversion: 0.25 }));
    await zamontuj();
    await waitFor(() =>
      expect(within(kafel("adminCoupons.analytics.conversion")).getByText("25.0%")).toBeTruthy(),
    );
    // Definicja jest w drzewie dostępności (tekst `sr-only`) i za przyciskiem
    // z nazwą - nie tylko w dymku po najechaniu.
    expect(screen.getByText("adminCoupons.analytics.conversionDefinition")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "adminCoupons.analytics.conversionHelp" }),
    ).toBeInTheDocument();
    cleanup();
  });

  it("brak wydanych kuponów to KRESKA konwersji, a nie 0%", async () => {
    h.summary.mockResolvedValue(podsumowanie({ issued: 0, issuedConverted: 0, conversion: null }));
    await zamontuj();
    await waitFor(() =>
      expect(within(kafel("adminCoupons.analytics.issued")).getByText("0")).toBeTruthy(),
    );
    expect(within(kafel("adminCoupons.analytics.conversion")).getByText("-")).toBeTruthy();
    cleanup();
  });

  it("rezerwacje bez płatności stoją OSOBNO od wykorzystań opłaconych", async () => {
    h.summary.mockResolvedValue(podsumowanie({ paidRedemptions: 3, reservedRedemptions: 2 }));
    await zamontuj();
    await waitFor(() =>
      expect(within(kafel("adminCoupons.analytics.paid")).getByText("3")).toBeTruthy(),
    );
    expect(within(kafel("adminCoupons.analytics.reserved")).getByText("2")).toBeTruthy();
    cleanup();
  });

  it("okres bez opłaconych wykorzystań pokazuje zero przychodu - bez waluty", async () => {
    h.summary.mockResolvedValue(podsumowanie({ revenueNet: [], discount: [] }));
    await zamontuj();
    await waitFor(() =>
      expect(within(kafel("adminCoupons.analytics.revenueNone")).getByText("0")).toBeTruthy(),
    );
    expect(within(kafel("adminCoupons.analytics.discountNone")).getByText("0")).toBeTruthy();
    cleanup();
  });

  it("obcięta próbka (`truncated`) jest PODPISANA - kafle nie udają pełnych sum", async () => {
    h.summary.mockResolvedValue(podsumowanie({ truncated: true }));
    await zamontuj();
    expect(
      await screen.findByText("adminCoupons.analytics.truncated(limit=5000)"),
    ).toBeInTheDocument();
    cleanup();
  });

  it("REDAKTOR nie pyta o kwoty - widzi adnotację i kreski, nie zera", async () => {
    // RLS zamówień wpuszcza wyłącznie administratora: redaktor dostałby zera
    // albo WŁASNE zamówienia udające wynik organizacji.
    h.roles = ["editor"];
    zBazy([wiersz()]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    expect(h.summary).not.toHaveBeenCalled();
    expect(screen.getByText("adminCoupons.analytics.adminOnly")).toBeInTheDocument();
    expect(within(kafel("adminCoupons.analytics.revenueNone")).getByText("-")).toBeTruthy();
    expect(within(kafel("adminCoupons.analytics.conversion")).getByText("-")).toBeTruthy();
    cleanup();
  });

  it("AWARIA podsumowania melduje się alertem i kreskami - ranking dalej działa", async () => {
    h.summary.mockRejectedValue(new Error("permission denied"));
    zBazy([wiersz()]);
    await zamontuj();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(within(kafel("adminCoupons.analytics.issued")).getByText("-")).toBeTruthy();
    expect(screen.getByText("NES-AAA111")).toBeInTheDocument();
    cleanup();
  });

  it("ma SEKCYJNY tytuł karty i jest wyłączona z indeksu (D14)", async () => {
    const view = await zamontuj();
    expect(view.meta()).toContainEqual({ title: "Analityka kuponów | New European Strategies" });
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
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
  it("napisy idą ze słownika `adminCoupons.analytics.*`, a nie z bliźniaka `L(pl, en)`", async () => {
    // Parytet PL/EN pilnuje bramka słowników - tu dowód, że panel w ogóle po
    // nie sięga (atrapa i18n oddaje klucze).
    zBazy([wiersz()]);
    await zamontuj();
    expect(await screen.findByText("adminCoupons.analytics.rankingTitle")).toBeInTheDocument();
    expect(kafel("adminCoupons.analytics.conversion")).toBeInTheDocument();
    expect(screen.getByText("adminCoupons.analytics.detailTitle")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "adminCoupons.analytics.detailRedemptions" }),
    ).toBeInTheDocument();
    cleanup();
  });

  it("panel z danymi nie ma naruszeń dostępności", async () => {
    zBazy([wiersz()]);
    const view = await zamontuj();
    await screen.findByText("NES-AAA111");
    await screen.findByText("adminCoupons.analytics.revenueNet(currency=PLN)");
    const naruszenia = await axeViolations(view.container);
    expect(summarize(naruszenia)).toBe("");
    cleanup();
  });
});

describe("trasa /admin/coupons/analytics - DEFEKTY (naprawione)", () => {
  it("BŁĄD FUNKCJI AGREGUJĄCEJ nie wygląda już jak zakres bez sprzedaży", async () => {
    // CO BYŁO ZŁE. `queryFn` rzucał błędem PostgREST, ale render nie miał ani
    // jednej gałęzi dla `q.isError`: `rows = q.data ?? []`, więc odmowa
    // uprawnień do `b2b_coupons_analytics`, błąd SQL w funkcji i zerwana sieć
    // dawały dokładnie ten sam ekran co poprawny odczyt pustego okna - „Brak
    // danych." i cztery kafle zer (w tym „Przychód netto: 0.00").
    //
    // DLACZEGO TO BYŁO RYZYKO. Ten ekran odpowiada na pytanie „czy kupony B2B
    // nam się opłacają". Zera odczytane z awarii to wniosek, że kampania nie
    // przyniosła przychodu - czyli decyzja o wygaszeniu programu podjęta na
    // podstawie błędu odczytu, a nie danych. Kierunek odwrotny był równie
    // realny: nikt nie zgłaszał awarii funkcji bazodanowej, bo panel wyglądał
    // na sprawny.
    //
    // JAK NAPRAWIONE. Trasa czyta `q.isError` i pokazuje komunikat
    // `role="alert"` o TYM SAMYM kształcie i z tych samych kluczy
    // (`adminCoupons.loadError.*`) co zakładka Realizacje, kafle stawiają
    // KRESKI zamiast zer (zero jest twierdzeniem o pieniądzach, kreska mówi
    // „nie wiadomo"), a obie karty zamiast „Brak danych." mówią o niedostępnym
    // odczycie.
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "test: brak uprawnień do funkcji agregującej" },
    });
    await zamontuj();
    // Awaria melduje się sama i nie udaje zakresu bez realizacji.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.analytics.noData")).toBeNull();
    expect(screen.getAllByText("adminCoupons.loadError.placeholder")).toHaveLength(2);
    // Kafle: kreski, nie zera - także te z podsumowania (jeden ekran, jeden stan).
    expect(within(kafel("adminCoupons.analytics.issued")).getByText("-")).toBeInTheDocument();
    cleanup();
  });
});

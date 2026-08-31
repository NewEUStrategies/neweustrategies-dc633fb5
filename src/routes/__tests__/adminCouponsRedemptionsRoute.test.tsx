// Trasa `/admin/coupons/redemptions` - zakładka REALIZACJE kuponów B2B.
// Do dziś: 0 z 8 funkcji, 0 instrukcji. W odróżnieniu od sąsiednich tras tego
// modułu ta NIE jest cienkim opakowaniem - niesie własny panel, więc testuje
// się ją jak panel: przez `renderRoute`, czyli razem ze sklejeniem adresu.
//
// PO CO TEN EKRAN MUSI BYĆ DOWIEDZIONY. To jedyne miejsce, w którym widać, co
// kupony B2B zrobiły z pieniędzmi: ile faktur obniżyły i ile z nich zostało.
// Cztery reguły, których złamania nie widać z zewnątrz:
//
//   1. RABAT TO NIE PRZYCHÓD. `applied_cents` jest RABATEM, mimo że nazwa
//      kolumny sugeruje „kwotę po zastosowaniu kuponu". Ta inwersja już raz
//      się zdarzyła (patrz `@/lib/billing/couponMoney`) i pokazywała kupon
//      o największym rabacie jako najbardziej dochodowy. Kolumna „Zapłacono"
//      i kafel „Przychód netto" muszą liczyć `original - applied`.
//   2. ZAKRES DAT JEST CZĘŚCIĄ ODPOWIEDZI. Okno czasowe jedzie do bazy jako
//      `gte`/`lte`. Filtr, który nie dojeżdża do zapytania, daje raport
//      z innego okresu, niż pokazuje formularz - i nikt tego nie zauważy,
//      bo liczby wyglądają wiarygodnie.
//   3. KUPON NADAJĄCY PLAN MA DWA STANY. `effects_applied_at` = NULL przy
//      kuponie z `grants_tier_key` oznacza zamówienie NIEOPŁACONE. Zlanie obu
//      stanów w jeden znaczek to abonament uznany za nadany, którego klient
//      nie ma (albo odwrotnie - dopłata ścigana od kogoś, kto już zapłacił).
//   4. EKSPORT CSV IDZIE DO KSIĘGOWOŚCI. Nagłówek i kolejność kolumn są
//      kontraktem pliku; `discount` to rabat, `paid` to kwota zapłacona.
//
// GRANICE vs SĄSIEDZI. Atrapowane są WYŁĄCZNIE granice: klient Supabase, i18n
// i API obiektów URL przeglądarki (happy-dom go nie implementuje, a to jedyne
// miejsce, z którego da się odczytać wygenerowany plik). PRAWDZIWE biegną:
// atom `Stat`, `DatePickerField` (sąsiad z `@/components/admin/coupons/*`)
// oraz `@/lib/billing/couponMoney` - to na jego niezmienniku stoi cały dowód
// o pieniądzach.
//
// ZERO SIECI. RODO: żadnych prawdziwych danych osobowych - identyfikatory
// użytkowników są syntetycznymi UUID-ami.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  from: null as unknown,
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

import { renderRoute } from "@/test/routeHarness";
import { Route as RedemptionsRoute } from "@/routes/admin.coupons.redemptions";

const PATH = "/admin/coupons/redemptions";
const TABELA = "b2b_coupon_redemptions";

const db = () => h.from as SupabaseFromStub;

/** Blob-y oddane przeglądarce - z nich czytamy treść wyeksportowanego pliku. */
const pobraneBloby: Blob[] = [];
const zwolnioneUrl: string[] = [];

/** Wiersz realizacji w kształcie, w jakim czyta go panel (join z `b2b_coupons`). */
interface WierszRealizacji {
  id: string;
  coupon_id: string;
  user_id: string | null;
  order_id: string | null;
  applied_cents: number;
  original_cents: number;
  currency: string;
  created_at: string;
  effects_applied_at: string | null;
  b2b_coupons: { code: string; name: string | null; grants_tier_key: string | null } | null;
}

function realizacja(over: Partial<WierszRealizacji> = {}): WierszRealizacji {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    coupon_id: "22222222-2222-4222-8222-222222222222",
    user_id: "33333333-3333-4333-8333-333333333333",
    order_id: "44444444-4444-4444-8444-444444444444",
    // 100,00 PLN przed rabatem, 20,00 PLN rabatu => 80,00 PLN zapłacone.
    original_cents: 10_000,
    applied_cents: 2_000,
    currency: "PLN",
    created_at: "2026-08-20T10:00:00.000Z",
    effects_applied_at: null,
    b2b_coupons: { code: "NES-AAA111", name: "Partner A", grants_tier_key: null },
    ...over,
  };
}

function zBazy(rows: WierszRealizacji[]): void {
  db().setResponse(TABELA, ok(rows));
}

async function zamontuj() {
  return renderRoute({ route: RedemptionsRoute, path: PATH, initialEntry: PATH });
}

/** Kafel liczby (`Stat`) po widocznej etykiecie - zwraca całą zawartość karty. */
function kafel(etykieta: string): HTMLElement {
  const label = screen.getByText(etykieta);
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
 * Klika w dzień kalendarza i czeka, aż panel POŚLE nowe zapytanie do bazy.
 *
 * Klikamy w pętli, bo warstwa Radiksa PRZEMONTOWUJE kalendarz przy kolejnych
 * renderach panelu: uchwyt złapany raz bywa już odpięty od dokumentu w chwili
 * kliknięcia, a klik w odpięty węzeł jest bezgłośny. Dowodem jest więc dopiero
 * NOWE zapytanie, a nie samo zdarzenie myszy.
 */
async function klikDzien(dzien: string, poprzednieZapytania: number): Promise<void> {
  await screen.findByRole("gridcell", { name: dzien });
  await waitFor(() => {
    const komorka = screen.getByRole("gridcell", { name: dzien });
    fireEvent.click(komorka.querySelector("button") ?? komorka);
    expect(db().chainsFor(TABELA).length).toBeGreaterThan(poprzednieZapytania);
  });
}

/** Ostatnie zapytanie o realizacje - to w nim mieszka kontrakt zakresu dat. */
function ostatnieZapytanie() {
  const chain = db().lastChain(TABELA);
  if (!chain) throw new Error(`test: panel nie odpytał tabeli "${TABELA}"`);
  return chain;
}

function argDaty(method: "gte" | "lte"): Date {
  const args = ostatnieZapytanie().argsOf(method);
  if (!args || args[0] !== "created_at" || typeof args[1] !== "string") {
    throw new Error(`test: zapytanie nie zawęża \`created_at\` ogniwem \`${method}\``);
  }
  return new Date(args[1]);
}

beforeEach(() => {
  db().reset();
  h.lang = "pl";
  pobraneBloby.length = 0;
  zwolnioneUrl.length = 0;
  // happy-dom nie implementuje API obiektów URL. To granica przeglądarki,
  // a zarazem jedyne miejsce, z którego da się odczytać wygenerowany plik.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      pobraneBloby.push(blob);
      return "blob:test/realizacje.csv";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string) => {
      zwolnioneUrl.push(url);
    },
  });
});

describe("trasa /admin/coupons/redemptions - sklejenie i stany listy", () => {
  it("montuje się POD SWOIM ADRESEM i odpytuje rejestr realizacji", async () => {
    zBazy([]);
    const view = await zamontuj();
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByText("Historia realizacji")).toBeInTheDocument();
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBe(1));
    cleanup();
  });

  it("PUSTY zakres mówi wprost, że nie ma realizacji", async () => {
    zBazy([]);
    await zamontuj();
    expect(await screen.findByText("Brak realizacji w zakresie.")).toBeInTheDocument();
    cleanup();
  });

  it("WIERSZ pokazuje kod, nazwę kuponu i skrócony identyfikator użytkownika", async () => {
    // Pełny identyfikator w tabeli byłby nieczytelny; skrót do ośmiu znaków
    // wystarcza do zestawienia wiersza z zamówieniem.
    zBazy([realizacja()]);
    await zamontuj();
    expect(await screen.findByText("NES-AAA111")).toBeInTheDocument();
    expect(screen.getByText("Partner A")).toBeInTheDocument();
    expect(screen.getByText("33333333")).toBeInTheDocument();
    cleanup();
  });

  it("BRAK dołączonego kuponu nie wywraca wiersza - pokazuje kreskę", async () => {
    // Realizacja osierocona (kupon skasowany) nadal jest zdarzeniem
    // finansowym i musi być widoczna w rejestrze.
    zBazy([realizacja({ b2b_coupons: null, user_id: null })]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByText("-").length).toBeGreaterThan(0));
    expect(screen.queryByText("Brak realizacji w zakresie.")).toBeNull();
    cleanup();
  });
});

describe("trasa /admin/coupons/redemptions - pieniądze", () => {
  it("kolumny liczą PRZED rabatem, RABAT i ZAPŁACONO - a nie rabat jako przychód", async () => {
    // 100,00 - 20,00 = 80,00. Gdyby `applied_cents` przeczytać jako „kwotę
    // zapłaconą" (tak sugeruje nazwa kolumny), tabela pokazałaby 20,00 jako
    // przychód i 80,00 jako rabat - dokładnie ta inwersja żyła w bazie.
    zBazy([realizacja()]);
    await zamontuj();
    expect(await screen.findByText("100.00 PLN")).toBeInTheDocument();
    expect(screen.getByText("-20.00 PLN")).toBeInTheDocument();
    expect(screen.getByText("80.00 PLN")).toBeInTheDocument();
    cleanup();
  });

  it("kafle sumują CAŁY zakres: liczbę realizacji, przychód netto i rabat", async () => {
    zBazy([
      realizacja(),
      realizacja({
        id: "55555555-5555-4555-8555-555555555555",
        original_cents: 30_000,
        applied_cents: 5_000,
        b2b_coupons: { code: "NES-BBB222", name: null, grants_tier_key: null },
      }),
    ]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    expect(within(kafel("Realizacje")).getByText("2")).toBeInTheDocument();
    // Przychód netto = (100 - 20) + (300 - 50) = 330,00.
    expect(within(kafel("Przychód netto")).getByText("330.00")).toBeInTheDocument();
    // Rabat udzielony = 20 + 50 = 70,00.
    expect(within(kafel("Rabat udzielony")).getByText("70.00")).toBeInTheDocument();
    cleanup();
  });

  it("rabat WIĘKSZY niż kwota zamówienia nie daje ujemnego przychodu", async () => {
    // Dane niespójne (kupon 100% na zamówieniu przeliczonym po rabacie)
    // nie mogą cicho zaniżać sumy przychodu w raporcie.
    zBazy([realizacja({ original_cents: 5_000, applied_cents: 9_000 })]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    expect(within(kafel("Przychód netto")).getByText("0.00")).toBeInTheDocument();
    cleanup();
  });
});

describe("trasa /admin/coupons/redemptions - kupon nadający plan", () => {
  it("PO opłaceniu wiersz melduje nadanie planu", async () => {
    zBazy([
      realizacja({
        b2b_coupons: { code: "NES-VIP", name: null, grants_tier_key: "premium" },
        effects_applied_at: "2026-08-20T10:05:00.000Z",
      }),
    ]);
    await zamontuj();
    expect(await screen.findByText("premium")).toBeInTheDocument();
    expect(screen.getByText("nadano")).toBeInTheDocument();
    expect(screen.queryByText("czeka na płatność")).toBeNull();
    cleanup();
  });

  it("BEZ opłacenia ten sam kupon czeka na płatność - to nie jest ten sam stan", async () => {
    zBazy([
      realizacja({
        b2b_coupons: { code: "NES-VIP", name: null, grants_tier_key: "premium" },
        effects_applied_at: null,
      }),
    ]);
    await zamontuj();
    expect(await screen.findByText("czeka na płatność")).toBeInTheDocument();
    expect(screen.queryByText("nadano")).toBeNull();
    cleanup();
  });
});

describe("trasa /admin/coupons/redemptions - zakres dat", () => {
  it("domyślne okno to OSTATNIE 30 DNI i jedzie do bazy jako `gte`/`lte`", async () => {
    zBazy([]);
    await zamontuj();
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBe(1));
    const od = argDaty("gte");
    const doDaty = argDaty("lte");
    const dni = (doDaty.getTime() - od.getTime()) / (24 * 3600 * 1000);
    expect(Math.round(dni)).toBe(30);
    cleanup();
  });

  it("rejestr czyta się od NAJNOWSZYCH i z sufitem 500 wierszy", async () => {
    // Sufit chroni panel przed wciągnięciem całej historii do przeglądarki;
    // kolejność malejąca sprawia, że po wejściu widać ostatnie zdarzenia.
    zBazy([]);
    await zamontuj();
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBe(1));
    expect(ostatnieZapytanie().argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(ostatnieZapytanie().argsOf("limit")).toEqual([500]);
    cleanup();
  });

  it("zmiana daty OD wysyła NOWE zapytanie z nowym początkiem zakresu", async () => {
    // To jest cały sens filtra: bez ponownego odczytu z nowym `gte` panel
    // pokazywałby liczby z poprzedniego okna pod nowym opisem zakresu.
    zBazy([]);
    await zamontuj();
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBe(1));
    fireEvent.click(poleDaty("Od"));
    await screen.findByRole("gridcell", { name: "15" });
    // Kalendarz w warstwie Radiksa PRZEMONTOWUJE się przy kolejnych renderach
    // panelu, więc uchwyt do komórki złapany raz bywa już odpięty od dokumentu
    // w chwili kliknięcia (klik w odpięty węzeł jest bezgłośny). Dlatego
    // komórkę wyszukujemy i klikamy WEWNĄTRZ pętli oczekiwania - dowodem jest
    // dopiero NOWE zapytanie do bazy.
    await waitFor(() => {
      const komorka = screen.getByRole("gridcell", { name: "15" });
      fireEvent.click(komorka.querySelector("button") ?? komorka);
      expect(db().chainsFor(TABELA).length).toBeGreaterThan(1);
    });
    expect(argDaty("gte").getDate()).toBe(15);
    cleanup();
  });
});

describe("trasa /admin/coupons/redemptions - zakres otwarty i puste dane", () => {
  it("WYCZYSZCZENIE daty OD zdejmuje dolne ograniczenie z zapytania", async () => {
    // Ponowne kliknięcie zaznaczonego dnia kasuje wybór - i to jest jedyna
    // droga do zapytania o CAŁĄ historię realizacji. Panel musi wtedy wysłać
    // zapytanie BEZ `gte`, a nie z ograniczeniem sprzed czyszczenia.
    // Wybieramy dzień z BIEŻĄCEGO miesiąca (kalendarz otwiera się właśnie na
    // nim), żeby test nie zależał od dzisiejszej daty.
    zBazy([]);
    await zamontuj();
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBe(1));
    fireEvent.click(poleDaty("Od"));
    await klikDzien("15", 1);
    await klikDzien("15", db().chainsFor(TABELA).length);
    expect(ostatnieZapytanie().has("gte")).toBe(false);
    // Górna granica zostaje - czyszczenie jednego pola nie może po cichu
    // rozszerzyć zakresu w drugą stronę.
    expect(ostatnieZapytanie().has("lte")).toBe(true);
    cleanup();
  });

  it("WYCZYSZCZENIE daty DO otwiera zakres w górę", async () => {
    // Symetria do poprzedniego przypadku i osobna gałąź w kodzie: puste pole
    // „Do" ma zdjąć ograniczenie GÓRNE, zostawiając dolne nietknięte. Wersja,
    // która przy okazji gubi `gte`, pokazałaby całą historię pod opisem
    // wybranego okna.
    zBazy([]);
    await zamontuj();
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBe(1));
    fireEvent.click(poleDaty("Do"));
    await klikDzien("15", 1);
    await klikDzien("15", db().chainsFor(TABELA).length);
    expect(ostatnieZapytanie().has("lte")).toBe(false);
    expect(ostatnieZapytanie().has("gte")).toBe(true);
    cleanup();
  });

  it("NULL zamiast tablicy z bazy nie wywraca panelu", async () => {
    // PostgREST oddaje `data: null` przy odczycie bez wierszy w części
    // ścieżek. Brak zabezpieczenia daje tu `rows.map` na `null`, czyli biały
    // ekran całej zakładki zamiast napisu o pustym zakresie.
    db().setResponse(TABELA, ok(null));
    await zamontuj();
    expect(await screen.findByText("Brak realizacji w zakresie.")).toBeInTheDocument();
    cleanup();
  });
});

describe("trasa /admin/coupons/redemptions - eksport księgowy", () => {
  async function eksportuj(): Promise<string> {
    zBazy([realizacja()]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    fireEvent.click(screen.getByRole("button", { name: /Eksport CSV/ }));
    await waitFor(() => expect(pobraneBloby).toHaveLength(1));
    return pobraneBloby[0].text();
  }

  it("plik ma nagłówek nazywający kolumny PO ZNACZENIU", async () => {
    // „applied" w nagłówku sugerowało kwotę zapłaconą i utrwalało inwersję
    // rabatu w każdym wyeksportowanym arkuszu księgowym.
    const csv = await eksportuj();
    expect(csv.split("\n")[0]).toBe("date;code;user_id;order_id;original;discount;paid;currency");
    cleanup();
  });

  it("wiersz pliku niesie kwotę przed rabatem, rabat I kwotę zapłaconą", async () => {
    const csv = await eksportuj();
    const wiersz = csv.split("\n")[1];
    expect(wiersz).toContain("NES-AAA111");
    expect(wiersz.endsWith("100;20;80;PLN")).toBe(true);
    cleanup();
  });

  it("wiersz BEZ kuponu, użytkownika i zamówienia zostawia kolumny PUSTE", async () => {
    // Puste pole ma zostać puste, a nie zniknąć - inaczej wszystkie kolumny
    // po nim przesuwają się o jedną i arkusz księgowy czyta walutę jako plan.
    zBazy([realizacja({ b2b_coupons: null, user_id: null, order_id: null })]);
    await zamontuj();
    // Eksport składa plik z tego, co panel MA w ręku - czekamy na wiersz,
    // nie na samo zapytanie.
    await screen.findByText("100.00 PLN");
    fireEvent.click(screen.getByRole("button", { name: /Eksport CSV/ }));
    await waitFor(() => expect(pobraneBloby).toHaveLength(1));
    const wiersz = (await pobraneBloby[0].text()).split("\n")[1];
    expect(wiersz.split(";")).toHaveLength(8);
    expect(wiersz).toContain(";;;");
    cleanup();
  });

  it("zwalnia adres obiektu po pobraniu - inaczej blob zostaje w pamięci karty", async () => {
    await eksportuj();
    expect(zwolnioneUrl).toEqual(["blob:test/realizacje.csv"]);
    cleanup();
  });
});

describe("trasa /admin/coupons/redemptions - język i dostępność", () => {
  it("wersja angielska opisuje kafle i pustą listę po angielsku", async () => {
    h.lang = "en";
    zBazy([]);
    await zamontuj();
    expect(await screen.findByText("No redemptions in range.")).toBeInTheDocument();
    expect(screen.getByText("Net revenue")).toBeInTheDocument();
    expect(screen.getByText("Discount granted")).toBeInTheDocument();
    cleanup();
  });

  it("panel z wierszami nie ma naruszeń dostępności", async () => {
    zBazy([realizacja()]);
    const view = await zamontuj();
    await screen.findByText("NES-AAA111");
    const naruszenia = await axeViolations(view.container);
    expect(summarize(naruszenia)).toBe("");
    cleanup();
  });
});

describe("trasa /admin/coupons/redemptions - DEFEKTY (zarejestrowane, nienaprawiane)", () => {
  it.fails("BŁĄD ODCZYTU wygląda dokładnie jak pusty zakres", async () => {
    // CO JEST ZŁE. `useQuery` w tej trasie nie ma ŻADNEJ gałęzi błędu:
    // `rows = q.data ?? []`, a render pyta tylko o `q.isLoading` i o długość
    // listy. Odmowa RLS, padnięty PostgREST i zerwana sieć dają więc ten sam
    // ekran co poprawny odczyt pustego okna: napis „Brak realizacji
    // w zakresie." i kafle 0 / 0.00 / 0.00.
    //
    // DLACZEGO TO RYZYKO. To ekran rozliczeniowy. Administrator, który
    // zobaczy „brak realizacji", wyciągnie wniosek O PIENIĄDZACH: że w danym
    // okresie nikt nie użył kuponów - i tak zaraportuje. Cichy błąd odczytu
    // zamienia awarię uprawnień w fałszywy fakt księgowy, a eksport CSV
    // zrobiony z tego samego stanu utrwala go w arkuszu. Ta sama gałąź
    // odpowiada za sytuację odwrotną: nikt nie dowie się, że raport jest
    // niepełny, bo panel nie ma jak tego powiedzieć.
    //
    // DLACZEGO NIE NAPRAWIAM. Zadanie zabrania zmian w kodzie produkcyjnym,
    // a poprawka nie jest jednolinijkowa: trzeba zdecydować, czy błąd ma
    // wywracać całą zakładkę, czy stawać obok listy, ujednolicić to
    // z zakładką Analityki (ma dokładnie ten sam brak) i zablokować eksport
    // CSV ze stanu błędu - inaczej powstałby przycisk pobierający pusty
    // „komplet". To decyzja właściciela modułu kuponów, nie efekt uboczny
    // pracy testowej.
    db().setResponse(TABELA, fail("test: odmowa RLS na rejestrze realizacji"));
    await zamontuj();
    // Stan faktyczny: pusty zakres nie do odróżnienia od awarii.
    expect(await screen.findByText("Brak realizacji w zakresie.")).toBeInTheDocument();
    // ASERCJA DOCELOWA: panel MUSI zameldować, że odczyt się nie powiódł.
    expect(screen.queryByRole("alert")).not.toBeNull();
  });

  it.fails("kafle sumują RÓŻNE WALUTY w jedną liczbę i nie podają żadnej", async () => {
    // CO JEST ZŁE. `sumCouponTotals` dodaje `original_cents`/`applied_cents`
    // wiersz po wierszu, ignorując kolumnę `currency`, a kafel renderuje samą
    // liczbę: `${(totals.revenueCents / 100).toFixed(2)}` - bez jednostki.
    // Przy realizacji w PLN i realizacji w EUR kafel „Przychód netto" pokazuje
    // sumę liczb z dwóch walut jako jedną wartość.
    //
    // DLACZEGO TO RYZYKO. Tabela tuż pod kaflem pokazuje walutę PRZY KAŻDYM
    // wierszu, więc kafel czyta się jako podsumowanie tych samych kwot -
    // i tak trafia do notatki albo do slajdu. Kupony B2B są wystawiane
    // partnerom rozliczanym w euro (`currency` jest kolumną wiersza, nie
    // stałą), więc to nie jest przypadek hipotetyczny.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka to decyzja produktowa, nie literówka:
    // albo kafle rozbijają się per waluta, albo zakładka wymusza wybór waluty
    // w filtrze, albo panel przelicza po kursie z dnia realizacji (i wtedy
    // potrzebuje źródła kursu). Każdy z tych wariantów zmienia też kontrakt
    // eksportu CSV i zakładkę Analityki. Poza zakresem pracy testowej.
    zBazy([
      realizacja(),
      realizacja({
        id: "66666666-6666-4666-8666-666666666666",
        original_cents: 5_000,
        applied_cents: 1_000,
        currency: "EUR",
        b2b_coupons: { code: "NES-EUR333", name: null, grants_tier_key: null },
      }),
    ]);
    await zamontuj();
    await screen.findByText("NES-AAA111");
    // Stan faktyczny: 80,00 PLN + 40,00 EUR = „120.00" bez jednostki.
    expect(within(kafel("Przychód netto")).getByText("120.00")).toBeInTheDocument();
    // ASERCJA DOCELOWA: kwota w kaflu musi nieść walutę, tak jak w tabeli.
    expect(kafel("Przychód netto").textContent ?? "").toMatch(/PLN|EUR/);
  });
});

// Caly panel administracyjny darowizn: konfiguracja zbiorki, synchronizacja
// ze Stripe i sklejenie dwoch paneli prezentacyjnych.
//
// PO CO TEN PLIK ISTNIEJE. To jedyny ekran, z ktorego ustawia sie PRZYJMOWANIE
// PIENIEDZY od darczyncow - i jedyny, z ktorego uzgadnia sie rejestr wplat
// z operatorem platnosci. Ryzyka, ktore te testy pilnuja:
//   1. USTAWIENIE, KTORE NIE DOJEZDZA DO ZAPISU. Kazde pole tego formularza
//      zmienia to, co widzi darczynca na `/donate`: kwoty sugerowane, walute,
//      minimum, cel zbiorki, tryb (wlasny checkout kontra zewnetrzny link).
//      Pole, ktore wyglada na zmienione, a nie trafia do ladunku zapisu, to
//      zbiorka dzialajaca inaczej, niz mysli administrator - i nikt tego nie
//      zauwazy, bo panel po zapisie pokazuje wlasny stan, a nie stan bazy.
//   2. KWOTY SUGEROWANE SA W GROSZACH, A WPISUJE SIE ZLOTOWKI. Pominiete albo
//      podwojone mnozenie przez 100 daje przyciski „25 gr" albo „25 000 zl".
//   3. SYNCHRONIZACJA W ZLYM SRODOWISKU. Ten sam przycisk uruchamia uzgodnienie
//      na piaskownicy albo na produkcji. Wyslanie srodowiska innego niz
//      wybrane oznacza „uzgodnilem produkcje", gdy naprawde przejrzano konta
//      testowe - czyli falszywe poczucie, ze rejestr sie zgadza.
//   4. WYNIK SYNCHRONIZACJI MUSI BYC ROZROZNIALNY OD JEJ BRAKU. Sukces bez
//      raportu i blad bez komunikatu wygladaja identycznie: nic sie nie stalo.
//   5. ODSWIEZENIE PO SYNCHRONIZACJI. Uzgodnienie zmienia rejestr I sumy.
//      Panel, ktory po synchronizacji pokazuje stare liczby, kaze administratorowi
//      uruchomic ja jeszcze raz - a to operacja na koncie operatora platnosci.
//
//   6. JEZYK PANELU. Panel jest dwujezyczny, a od 08.2026 bierze WSZYSTKIE
//      napisy ze slownika. Rozroznienie „Środowisko testowe" kontra
//      „Środowisko produkcyjne" jest jedynym, co dzieli uzgodnienie na
//      piaskownicy od uzgodnienia na koncie produkcyjnym - wiec napis
//      nieprzetlumaczony jest tu ryzykiem operacyjnym, nie kosmetyka.
//
// GRANICE vs SASIEDZI. Atrapowane sa WYLACZNIE granice: funkcje serwerowe
// (statystyki, rejestr, synchronizacja), silnik ustawien `useSettings`
// (ma wlasny, wyczerpujacy test - `src/lib/admin/__tests__/useSettings.test.tsx`),
// odczyt srodowiska operatora i toasty. PRAWDZIWE biegna: `useDraft`
// z tego samego modulu (czysty stan Reacta), `donationsConfig`
// (`DONATIONS_DEFAULTS`, `formatDonationAmount`, schemat konfiguracji), pola
// formularza panelu, OBA panele skladowe i PRAWDZIWY slownik i18n - dzieki
// temu widac takze, ze dane z zapytan naprawde do nich dojezdzaja, a napisy
// pochodza ze slownika, a nie z kodu.
//
// ZERO SIECI, ZERO SEKRETOW: klucz operatora nie jest tu w ogole czytany
// (`getStripeEnvironmentSafe` to atrapa), a zadna funkcja serwerowa nie biegnie.
//
// RODO: adresy darczyncow wylacznie z domen zarezerwowanych do przykladow
// (`example.com` / `example.org`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import {
  DONATIONS_DEFAULTS,
  DonationsConfigSchema,
  formatDonationAmount,
  type DonationsConfig,
} from "@/lib/billing/donationsConfig";
import type { DonationsPublicStats } from "@/lib/billing/donations.functions";
import type { AdminDonationRow, DonationsSyncReport } from "@/lib/billing/donationsAdmin.server";

const h = vi.hoisted(() => ({
  ensureI18n: vi.fn(),
  /** Srodowisko operatora odczytane z konfiguracji klienta. */
  stripeEnv: vi.fn(() => "sandbox"),
  getStats: vi.fn(),
  listRecords: vi.fn(),
  sync: vi.fn(),
  /** Ustawienia widziane przez panel; `null` = zapytanie jeszcze nie wrocilo. */
  stored: null as Record<string, unknown> | null,
  /** Ladunki wyslane do zapisu - to jest przedmiot dowodu dla pol formularza. */
  saves: [] as Record<string, unknown>[],
  saving: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// `react-i18next` NIE JEST atrapowany: panel jest dwujezyczny, a przedmiotem
// dowodu jest to, ze napisy przychodza ZE SLOWNIKA, wiec test musi czytac ten
// sam slownik, co uzytkownik (patrz `src/test/i18nReal.ts`). Jezyk przestawia
// sie tu `i18n.changeLanguage`, nie polem atrapy. Skrotu
// `vi.mock("react-i18next", () => reactI18nextMock())` uzyc NIE MOZNA - fabryka
// mocka siegnelaby po `@/lib/i18n`, ktory importuje wlasnie mockowany modul,
// i plik testowy zawiesilby sie bez komunikatu.
//
// Nakladka slownika darowizn jest rozwinieta PRAWDZIWA (`importActual`), zeby
// `donate.admin.*` bylo w store; podmieniony zostaje wylacznie `ensureI18n`,
// bo jego wywolanie jest osobnym przedmiotem dowodu.
vi.mock("@/lib/i18n-donate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/i18n-donate")>("@/lib/i18n-donate");
  return { ...actual, ensureI18n: h.ensureI18n };
});
vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: h.stripeEnv }));
vi.mock("@/lib/billing/donations.functions", () => ({ getDonationsPublicStats: h.getStats }));
vi.mock("@/lib/billing/donationsAdmin.functions", () => ({
  listDonationRecords: h.listRecords,
  syncDonationsWithStripe: h.sync,
}));

/**
 * Atrapa SILNIKA ustawien - ale nie `useDraft`. Podmieniamy wylacznie odczyt
 * i zapis `site_settings` (granica: Supabase), a `useDraft` zostaje PRAWDZIWY,
 * bo to zwykly stan Reacta i to on odpowiada za przejscie „wczytuje" ->
 * „formularz". Gleboki merge przy odczycie ma osobny, wyczerpujacy test
 * (`src/lib/admin/__tests__/useSettings.test.tsx`) - tutaj przedmiotem dowodu
 * jest to, CO panel do zapisu wysyla, a nie jak zapis dziala.
 */
vi.mock("@/lib/admin/useSettings", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin/useSettings")>("@/lib/admin/useSettings");
  return {
    ...actual,
    useSettings: (_key: string, defaults: Record<string, unknown>) => ({
      query: {
        data: h.stored === null ? undefined : { ...defaults, ...h.stored },
        isPending: h.stored === null,
      },
      save: {
        mutate: (next: Record<string, unknown>) => {
          h.saves.push(next);
        },
        isPending: h.saving,
      },
    }),
  };
});

import { AdminDonations } from "../AdminDonations";

// --- atomy testowe ----------------------------------------------------------

/**
 * Kwota w postaci, w jakiej widzi ja `getByText`. `Intl.NumberFormat` wstawia
 * TWARDA spacje (U+00A0) miedzy liczba a symbolem waluty, a RTL normalizuje ja
 * w drzewie do zwyklej. Formatowanie liczy PRAWDZIWY `formatDonationAmount`;
 * tu wyrownujemy wylacznie bialy znak.
 */
function kwota(cents: number, currency: string, lang: "pl" | "en"): string {
  return formatDonationAmount(cents, currency, lang).replace(/\u00a0/g, " ");
}

function konfiguracja(over: Partial<DonationsConfig> = {}): DonationsConfig {
  return { ...DONATIONS_DEFAULTS, ...over };
}

function statystyki(over: Partial<DonationsPublicStats> = {}): DonationsPublicStats {
  return {
    totalCents: 1_250_00,
    monthCents: 320_00,
    count: 42,
    monthCount: 9,
    currency: "PLN",
    recent: [],
    truncated: false,
    ...over,
  };
}

function wplata(over: Partial<AdminDonationRow> = {}): AdminDonationRow {
  return {
    id: "dddddddd-1111-4111-8111-dddddddddddd",
    amountCents: 15000,
    currency: "PLN",
    status: "paid",
    recurring: false,
    donorEmail: "darczynca@example.com",
    message: null,
    provider: "stripe",
    providerSessionId: "cs_test_000",
    providerIntentId: null,
    createdAt: "2026-03-15T12:30:00.000Z",
    paidAt: "2026-03-15T12:31:00.000Z",
    ...over,
  };
}

function raport(over: Partial<DonationsSyncReport> = {}): DonationsSyncReport {
  return {
    environment: "sandbox",
    sinceIso: "2026-03-08T00:00:00.000Z",
    scannedSessions: 12,
    settled: 3,
    imported: 2,
    refunded: 1,
    expired: 4,
    warnings: [],
    ...over,
  };
}

/** Promise, ktory NIGDY nie wraca - stan „zapytanie w toku". */
function wieczneOczekiwanie(): Promise<never> {
  return new Promise<never>(() => {});
}

// --- lokalizowanie kontrolek ------------------------------------------------
//
// Kontrolki znajdujemy PO ETYKIECIE (`getByLabelText`), czyli tak, jak znajduje
// je i administrator wzrokiem, i czytnik ekranu. Do 08.2026 nie bylo to
// mozliwe: `Field` renderowal `<label>` jako siostre kontrolki, bez `htmlFor`,
// wiec test musial siegac po `parentElement.querySelector("input")` - obejscie,
// ktore przechodzilo takze wtedy, gdy zadna kontrolka nie miala nazwy
// dostepnej. Teraz kazde uzycie tych helperow jest przy okazji dowodem, ze
// powiazanie etykiety z kontrolka istnieje.

/** Etykiety pol formularza - jedno zrodlo dla testow i dla asercji dostepnosci. */
const ETYKIETY_POL = [
  "Kwoty sugerowane",
  "Kwota minimalna (grosze)",
  "Kwota maksymalna (grosze)",
  "Cel zbiórki (grosze)",
  "Nagłówek (PL)",
  "Nagłówek (EN)",
  "Opis (PL)",
  "Opis (EN)",
] as const;

function poleTekstowe(etykieta: string): HTMLInputElement {
  const control = screen.getByLabelText(etykieta);
  if (!(control instanceof HTMLInputElement)) {
    throw new Error(`test: etykieta "${etykieta}" nie opisuje pola tekstowego`);
  }
  return control;
}

function poleWyboru(etykieta: string): HTMLSelectElement {
  const control = screen.getByLabelText(etykieta);
  if (!(control instanceof HTMLSelectElement)) {
    throw new Error(`test: etykieta "${etykieta}" nie opisuje listy rozwijanej`);
  }
  return control;
}

/** Pole wyboru srodowiska stoi poza `Field` - rozpoznajemy je po opcjach. */
function poleSrodowiska(): HTMLSelectElement {
  const found = screen
    .getAllByRole("combobox")
    .find(
      (el): el is HTMLSelectElement =>
        el instanceof HTMLSelectElement &&
        Array.from(el.options).some((option) => option.value === "sandbox"),
    );
  if (!found) throw new Error("test: brak pola wyboru srodowiska synchronizacji");
  return found;
}

function przelacznik(etykieta: string): HTMLElement {
  const box = screen.getByText(etykieta).closest("label")?.querySelector('[role="checkbox"]');
  if (!(box instanceof HTMLElement)) throw new Error(`test: brak przelacznika "${etykieta}"`);
  return box;
}

function przyciskZapisu(): HTMLElement {
  return screen.getByRole("button", { name: /Zapis/ });
}

function przyciskSynchronizacji(): HTMLElement {
  return screen.getByRole("button", { name: /Synchronizuj/ });
}

/** Ostatni ladunek wyslany do zapisu. */
function zapisany(): Record<string, unknown> {
  fireEvent.click(przyciskZapisu());
  const last = h.saves.at(-1);
  if (!last) throw new Error("test: pasek zapisu nie wyslal zadnego ladunku");
  return last;
}

/** Napis stanu „wczytuje" - ze slownika, nie z klucza. */
function wczytuje(lang: "pl" | "en" = "pl"): string {
  return realT(lang)("admin.loading");
}

/**
 * Renderuje panel i czeka, az OBA zapytania osiadna (znika „wczytuje").
 * Czekamy na OBA jezyki: test dwujezyczny przestawia instancje i18next, a napis
 * szukany tylko po polsku znikalby w wersji angielskiej natychmiast - czyli
 * zanim zapytania wroca.
 */
async function panel() {
  const utils = renderWithQueryClient(<AdminDonations />);
  await waitFor(() => {
    expect(screen.queryByText(wczytuje("pl"))).toBeNull();
    expect(screen.queryByText(wczytuje("en"))).toBeNull();
  });
  return utils;
}

beforeEach(async () => {
  // Jezyk jest stanem WSPOLDZIELONEJ instancji i18next - kazdy test zaczyna
  // od polskiego, inaczej przestawienie w jednym tescie wyciekaloby na kolejne.
  await i18n.changeLanguage("pl");
  h.stored = konfiguracja();
  h.saves = [];
  h.saving = false;
  h.ensureI18n.mockClear();
  h.stripeEnv.mockReset();
  h.stripeEnv.mockReturnValue("sandbox");
  h.getStats.mockReset();
  h.getStats.mockResolvedValue(statystyki());
  h.listRecords.mockReset();
  h.listRecords.mockResolvedValue([wplata()]);
  h.sync.mockReset();
  h.sync.mockResolvedValue(raport());
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("AdminDonations - wejscie na panel", () => {
  it("ZANIM ustawienia dojada, panel mowi `wczytuje` i NIE pokazuje formularza", () => {
    // Wyrenderowanie formularza z pustym draftem konczyloby sie zapisem
    // ustawien zlozonych z `undefined` - czyli skasowaniem konfiguracji
    // zbiorki jednym klikiem w „Zapisz".
    h.stored = null;
    renderWithQueryClient(<AdminDonations />);
    expect(screen.getByText(wczytuje())).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Darowizny" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Zapis/ })).toBeNull();
  });

  it("REJESTRUJE slownik darowizn przy wejsciu", async () => {
    // Slownik jedzie w chunku KOMPONENTU, nie w entry - bez tego wywolania
    // panel po odswiezeniu strony pokazywalby surowe klucze i18n.
    await panel();
    expect(h.ensureI18n).toHaveBeenCalled();
  });

  it("po wczytaniu ustawien widac formularz i OBA panele skladowe", async () => {
    await panel();
    expect(screen.getByRole("heading", { name: "Darowizny" })).toBeInTheDocument();
    expect(screen.getByText("Suma wpłat")).toBeInTheDocument();
    expect(screen.getByText("Ostatnie wpłaty")).toBeInTheDocument();
    expect(przyciskZapisu()).toBeInTheDocument();
  });
});

describe("AdminDonations - sklejenie z panelami skladowymi", () => {
  it("statystyki z zapytania dojezdzaja do panelu podsumowania", async () => {
    // Panel podsumowania jest prezentacyjny: jesli zapytanie zostalo tu, a jego
    // wynik nie jest przekazany, kafelki na zawsze pokazuja zera - i wyglada to
    // jak zbiorka bez ani jednej wplaty.
    await panel();
    expect(screen.getByText(kwota(125000, "PLN", "pl"))).toBeInTheDocument();
    expect(screen.getByText(kwota(32000, "PLN", "pl"))).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("waluta Z KONFIGURACJI jedzie do kafelkow, dopoki statystyk nie ma", async () => {
    // Zanim statystyki wroca, jedynym zrodlem waluty jest formularz. Sztywne
    // „PLN" pokazywaloby zlote zbiorce prowadzonej w euro.
    h.stored = konfiguracja({ currency: "EUR" });
    h.getStats.mockReturnValue(wieczneOczekiwanie());
    renderWithQueryClient(<AdminDonations />);
    await screen.findByRole("heading", { name: "Darowizny" });
    expect(screen.getAllByText(kwota(0, "EUR", "pl"))).toHaveLength(2);
  });

  it("rejestr wplat dojezdza do panelu listy", async () => {
    h.listRecords.mockResolvedValue([
      wplata(),
      wplata({ id: "druga", donorEmail: "druga@example.org", amountCents: 7700 }),
    ]);
    await panel();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("darczynca@example.com")).toBeInTheDocument();
  });

  it("rejestr jest zadany z TWARDYM limitem, a nie w calosci", async () => {
    // Bez limitu panel sciagnalby do przegladarki caly rejestr wplat razem
    // z adresami darczyncow - i koszt pamieciowy, i niepotrzebna ekspozycja PII.
    await panel();
    expect(h.listRecords).toHaveBeenCalledWith({ data: { limit: 50 } });
  });

  it("dopoki rejestr sie wczytuje, LISTA mowi `wczytuje`, a formularz juz stoi", async () => {
    // Dwa niezalezne stany: ustawienia sa, rejestru jeszcze nie ma. Panel nie
    // moze przez to blokowac calego formularza konfiguracji.
    h.listRecords.mockReturnValue(wieczneOczekiwanie());
    renderWithQueryClient(<AdminDonations />);
    await screen.findByRole("heading", { name: "Darowizny" });
    expect(screen.getByText(wczytuje())).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(przyciskZapisu()).toBeInTheDocument();
  });

  it("jezyk EN zmienia konwencje zapisu kwot w OBU panelach", async () => {
    // Jezyk czyta sie z i18n i podaje obu panelom. Panel podsumowania i wiersz
    // rejestru musza mowic tym samym formatem - inaczej ta sama kwota wyglada
    // na dwie rozne.
    await i18n.changeLanguage("en");
    await panel();
    expect(screen.getByText(kwota(125000, "PLN", "en"))).toBeInTheDocument();
    expect(screen.getByText(kwota(15000, "PLN", "en"))).toBeInTheDocument();
  });
});

describe("AdminDonations - synchronizacja ze Stripe", () => {
  it("SRODOWISKO STARTOWE pochodzi z konfiguracji operatora, a nie ze sztywnej wartosci", async () => {
    // Instalacja produkcyjna ma klucz `pk_live_` - domyslna piaskownica
    // kazalaby administratorowi pamietac o przestawieniu przy kazdym wejsciu,
    // a zapomniane przestawienie to „uzgodnilem" bez uzgodnienia.
    h.stripeEnv.mockReturnValue("live");
    await panel();
    expect(poleSrodowiska().value).toBe("live");
  });

  it("wybrane srodowisko PRODUKCYJNE jedzie do synchronizacji", async () => {
    await panel();
    fireEvent.change(poleSrodowiska(), { target: { value: "live" } });
    fireEvent.click(przyciskSynchronizacji());
    await waitFor(() => expect(h.sync).toHaveBeenCalled());
    expect(h.sync).toHaveBeenCalledWith({ data: { environment: "live", sinceHours: 168 } });
  });

  it("powrot na srodowisko TESTOWE tez jedzie do synchronizacji", async () => {
    // Druga strona tej samej galezi: przelacznik musi dzialac w obie strony,
    // inaczej po jednym omylkowym wyborze panel zostaje na produkcji.
    h.stripeEnv.mockReturnValue("live");
    await panel();
    fireEvent.change(poleSrodowiska(), { target: { value: "sandbox" } });
    fireEvent.click(przyciskSynchronizacji());
    await waitFor(() => expect(h.sync).toHaveBeenCalled());
    expect(h.sync).toHaveBeenCalledWith({ data: { environment: "sandbox", sinceHours: 168 } });
  });

  it("W TRAKCIE synchronizacji przycisk jest ZABLOKOWANY", async () => {
    // Uzgodnienie chodzi po sesjach operatora platnosci. Drugie klikniecie
    // w trakcie pierwszego to druga taka operacja - kosztowna i mylaca
    // w raportach.
    h.sync.mockReturnValue(wieczneOczekiwanie());
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    await waitFor(() => expect(przyciskSynchronizacji()).toBeDisabled());
    expect(screen.getByRole("button", { name: "Synchronizuję..." })).toBeInTheDocument();
  });

  it("SUKCES pokazuje raport z wszystkimi licznikami", async () => {
    // Raport jest jedynym dowodem, ze uzgodnienie cos zrobilo. Sukces bez
    // raportu wyglada identycznie jak nieklikniety przycisk.
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    const tekst = (await screen.findByText(/Zaksięgowane/)).textContent ?? "";
    expect(tekst).toContain("Zaksięgowane: 3");
    expect(tekst).toContain("zaimportowane: 2");
    expect(tekst).toContain("zwroty: 1");
    expect(tekst).toContain("wygasłe: 4");
    expect(tekst).toContain("przejrzane sesje: 12");
  });

  it("raport BEZ ostrzezen nie dokleja pustego licznika ostrzezen", async () => {
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    await screen.findByText(/Zaksięgowane/);
    expect(screen.queryByText(/ostrzeżenia/)).toBeNull();
  });

  it("raport Z ostrzezeniami pokazuje ICH LICZBE", async () => {
    // Ostrzezenia to sesje, ktorych uzgodnienie nie umialo dopasowac - czyli
    // dokladnie te, ktore trzeba obejrzec recznie. Bez licznika przechodza
    // niezauwazone.
    h.sync.mockResolvedValue(
      raport({ warnings: ["brak wiersza dla cs_test_1", "podwojny zwrot"] }),
    );
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    const tekst = (await screen.findByText(/Zaksięgowane/)).textContent ?? "";
    expect(tekst).toContain("ostrzeżenia: 2");
  });

  it("SUKCES odswieza rejestr wplat I statystyki", async () => {
    // Sedno podzialu na organizmy: oba zapytania zostaly w tym komponencie
    // WLASNIE po to, zeby `onSuccess` mial co odswiezyc. Gdyby ktore z nich
    // przewedrowalo do panelu prezentacyjnego, panel po uzgodnieniu
    // pokazywalby stan sprzed uzgodnienia.
    await panel();
    expect(h.getStats).toHaveBeenCalledTimes(1);
    expect(h.listRecords).toHaveBeenCalledTimes(1);
    fireEvent.click(przyciskSynchronizacji());
    await waitFor(() => expect(h.listRecords).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.getStats).toHaveBeenCalledTimes(2));
  });

  it("BLAD synchronizacji pokazuje komunikat operatora i NIE pokazuje raportu", async () => {
    h.sync.mockRejectedValue(new Error("Stripe: brak klucza dla srodowiska live"));
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    expect(await screen.findByText("Stripe: brak klucza dla srodowiska live")).toBeInTheDocument();
    expect(screen.queryByText(/Zaksięgowane/)).toBeNull();
  });

  it("odrzucenie BEZ obiektu bledu konczy sie komunikatem zastepczym", async () => {
    // Warstwa transportowa potrafi odrzucic napisem albo obiektem odpowiedzi.
    // Bez galezi zastepczej administrator zobaczylby pusty akapit i uznal,
    // ze uzgodnienie przeszlo.
    h.sync.mockRejectedValue("connection reset");
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    expect(await screen.findByText("Synchronizacja nie powiodła się.")).toBeInTheDocument();
  });

  it("NIEUDANA synchronizacja nie odswieza zapytan", async () => {
    // Odswiezenie po bledzie sugerowaloby, ze cos sie zmienilo - a rejestr
    // jest dokladnie taki sam jak przed proba.
    h.sync.mockRejectedValue(new Error("odmowa"));
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    await screen.findByText("odmowa");
    expect(h.getStats).toHaveBeenCalledTimes(1);
    expect(h.listRecords).toHaveBeenCalledTimes(1);
  });
});

describe("AdminDonations - zapis ustawien", () => {
  it("pasek zapisu wysyla CALY draft, a nie same zmienione pola", async () => {
    // `useSettings` scala ladunek na wierszu z bazy. Wyslanie fragmentu
    // wygladaloby poprawnie, dopoki ktos nie zmieni domyslnych wartosci -
    // wtedy pola pominiete w ladunku zostalyby ciche na starych wartosciach.
    h.stored = konfiguracja({ headlinePl: "Wesprzyj analize" });
    await panel();
    expect(zapisany()).toEqual(konfiguracja({ headlinePl: "Wesprzyj analize" }));
  });

  it("W TRAKCIE zapisu pasek jest ZABLOKOWANY", async () => {
    // Podwojny zapis tego samego draftu jest nieszkodliwy, ale brak informacji
    // zwrotnej („czy kliknalem?") konczy sie seria klikniec i wrazeniem, ze
    // panel nie dziala.
    h.saving = true;
    await panel();
    expect(przyciskZapisu()).toBeDisabled();
  });
});

describe("AdminDonations - silnik wplat", () => {
  it("WYLACZNIK modulu trafia do zapisu", async () => {
    // To jedyny hamulec calej zbiorki - musi dzialac, gdy trzeba szybko
    // schowac formularz (np. na czas awarii operatora platnosci).
    await panel();
    fireEvent.click(przelacznik("Zbieraj darowizny"));
    expect(zapisany().enabled).toBe(false);
  });

  it("tryb ZEWNETRZNY odslania pole adresu zbiorki", async () => {
    // Bez adresu tryb zewnetrzny prowadzi darczynce donikad. Pole musi
    // pojawic sie razem z trybem, nie po zapisie i odswiezeniu.
    await panel();
    expect(screen.queryByText("Adres zbiórki")).toBeNull();
    fireEvent.change(poleWyboru("Tryb"), { target: { value: "external" } });
    expect(screen.getByText("Adres zbiórki")).toBeInTheDocument();
    expect(zapisany().provider).toBe("external");
  });

  it("powrot na WLASNY checkout chowa pole adresu zbiorki", async () => {
    h.stored = konfiguracja({ provider: "external" });
    await panel();
    expect(screen.getByText("Adres zbiórki")).toBeInTheDocument();
    fireEvent.change(poleWyboru("Tryb"), { target: { value: "stripe" } });
    expect(screen.queryByText("Adres zbiórki")).toBeNull();
    expect(zapisany().provider).toBe("stripe");
  });

  it("adres zewnetrznej zbiorki trafia do zapisu", async () => {
    h.stored = konfiguracja({ provider: "external" });
    await panel();
    fireEvent.change(poleTekstowe("Adres zbiórki"), {
      target: { value: "https://example.org/zbiorka" },
    });
    expect(zapisany().externalUrl).toBe("https://example.org/zbiorka");
  });

  it("zmiana WALUTY trafia do zapisu i od razu przestawia kafelki", async () => {
    // Waluta jest jednoczesnie ustawieniem zbiorki i jednostka podsumowania.
    // Zmiana widoczna dopiero po zapisie i odswiezeniu kazalaby zgadywac,
    // czy klikniecie zadzialalo.
    h.getStats.mockReturnValue(wieczneOczekiwanie());
    renderWithQueryClient(<AdminDonations />);
    await screen.findByRole("heading", { name: "Darowizny" });
    fireEvent.change(poleWyboru("Waluta"), { target: { value: "EUR" } });
    expect(screen.getAllByText(kwota(0, "EUR", "pl"))).toHaveLength(2);
    expect(zapisany().currency).toBe("EUR");
  });

  it("nieznana wartosc waluty spada na PLN, a nie leci do bazy", async () => {
    // Pole wyboru z dwiema opcjami nie powinno oddac nic innego, ale straznik
    // jest tanszy niz waluta „undefined" w konfiguracji publicznego formularza.
    await panel();
    const select = poleWyboru("Waluta");
    fireEvent.change(select, { target: { value: "EUR" } });
    fireEvent.change(select, { target: { value: "PLN" } });
    expect(zapisany().currency).toBe("PLN");
  });
});

describe("AdminDonations - kwoty", () => {
  it("kwoty sugerowane pokazuja sie w ZLOTOWKACH, a zapisuja w GROSZACH", async () => {
    // Najkosztowniejsza pomylka tego formularza: administrator wpisuje „25",
    // mysli „25 zl", a baza trzyma grosze. Pominiete mnozenie daje przycisk
    // „0,25 zl" na publicznym formularzu.
    await panel();
    const pole = poleTekstowe("Kwoty sugerowane");
    expect(pole.value).toBe("25, 50, 100, 250");
    fireEvent.change(pole, { target: { value: "25, 50, 100" } });
    expect(zapisany().presetsCents).toEqual([2500, 5000, 10000]);
  });

  it("kwota z groszami da sie wpisac KROPKA dziesietna", async () => {
    // Zbiorki z progiem „12,50" istnieja (np. rownowartosc kawy). Jedyny
    // dzialajacy zapis to kropka - wersja z przecinkiem jest zarejestrowana
    // nizej jako defekt.
    await panel();
    fireEvent.change(poleTekstowe("Kwoty sugerowane"), { target: { value: "12.50, 25" } });
    expect(zapisany().presetsCents).toEqual([1250, 2500]);
  });

  it("kwoty sugerowane ODSIEWAJA smieci, zera i wartosci ujemne", async () => {
    // Przycisk z kwota 0 albo NaN otwiera kase na kwote, ktorej operator
    // platnosci nie przyjmie - darczynca dostaje blad zamiast platnosci.
    await panel();
    fireEvent.change(poleTekstowe("Kwoty sugerowane"), {
      target: { value: "25, abc, 0, -5, 100" },
    });
    expect(zapisany().presetsCents).toEqual([2500, 10000]);
  });

  it("kwoty sugerowane maja TWARDY sufit osmiu pozycji", async () => {
    // Schemat konfiguracji dopuszcza najwyzej osiem; dziewiata pozycja
    // uniewaznilaby CALY zapis przy odczycie publicznym.
    await panel();
    fireEvent.change(poleTekstowe("Kwoty sugerowane"), {
      target: { value: "10,20,30,40,50,60,70,80,90,100" },
    });
    expect(zapisany().presetsCents).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
  });

  it("kwota minimalna, maksymalna i cel zbiorki trafiaja do zapisu jako LICZBY", async () => {
    // Zapisane jako napisy przeszlyby przez formularz, ale wywrocilyby schemat
    // konfiguracji przy odczycie publicznym - i cala zbiorka wrocilaby do
    // wartosci domyslnych.
    await panel();
    fireEvent.change(poleTekstowe("Kwota minimalna (grosze)"), { target: { value: "1000" } });
    fireEvent.change(poleTekstowe("Kwota maksymalna (grosze)"), { target: { value: "2000000" } });
    fireEvent.change(poleTekstowe("Cel zbiórki (grosze)"), { target: { value: "5000000" } });
    const zapis = zapisany();
    expect(zapis.minCents).toBe(1000);
    expect(zapis.maxCents).toBe(2000000);
    expect(zapis.goalCents).toBe(5000000);
  });

  it("WYCZYSZCZONE pole kwoty maksymalnej daje ZERO, a nie `NaN`", async () => {
    // `Number("")` to zero, ale `Number("abc")` to `NaN` - i to `NaN` jest tu
    // ryzykiem, bo po serializacji do JSON staje sie `null` i cala konfiguracja
    // zbiorki przestaje przechodzic walidacje przy odczycie publicznym.
    // Straznik `|| 0` zamienia oba przypadki na liczbe. Zero PRZECHODZI tu przez
    // walidacje zapisu, bo `maxCents` ma w schemacie tylko sufit - inaczej niz
    // `minCents` z podloga 500, ktore od 08.2026 zapis blokuje (test nizej).
    await panel();
    fireEvent.change(poleTekstowe("Kwota maksymalna (grosze)"), { target: { value: "" } });
    const zapis = zapisany();
    expect(zapis.maxCents).toBe(0);
    expect(Number.isNaN(zapis.maxCents)).toBe(false);
  });

  it("CEL rowny zeru jest wartoscia, a nie brakiem wartosci", async () => {
    // Zero WYLACZA pasek postepu i jest normalnym ustawieniem. Zamiana zera na
    // wartosc domyslna (`value || default`) to klasyczny blad paneli
    // konfiguracji - administrator wylacza pasek, zapisuje i nic sie nie dzieje.
    h.stored = konfiguracja({ goalCents: 100000 });
    await panel();
    fireEvent.change(poleTekstowe("Cel zbiórki (grosze)"), { target: { value: "0" } });
    expect(zapisany().goalCents).toBe(0);
  });
});

describe("AdminDonations - przelaczniki formularza", () => {
  it.each([
    ["Pozwól wpisać własną kwotę", "allowCustom"],
    ["Pozwól na wsparcie miesięczne", "allowRecurring"],
    ["Pole wiadomości od darczyńcy", "allowMessage"],
    ["Pokazuj ostatnie wpłaty", "showRecent"],
  ])("przelacznik `%s` trafia do zapisu jako `%s`", async (etykieta, klucz) => {
    // Kazdy z tych czterech przelacznikow zmienia PUBLICZNY formularz wplaty:
    // wlasna kwota, wsparcie cykliczne, pole wiadomosci i lista ostatnich
    // wplat. Przelacznik, ktory nie dojezdza do ladunku, to ustawienie
    // wygladajace na zmienione i nigdy niezapisane.
    await panel();
    fireEvent.click(przelacznik(etykieta));
    expect(zapisany()[klucz]).toBe(false);
  });

  it("przelacznik wraca do wlaczonego po ponownym klikniecu", async () => {
    // Druga strona galezi `onCheckedChange` - bez niej ustawienie da sie
    // wylaczyc, ale nie da sie wlaczyc z powrotem.
    h.stored = konfiguracja({ allowRecurring: false });
    await panel();
    fireEvent.click(przelacznik("Pozwól na wsparcie miesięczne"));
    expect(zapisany().allowRecurring).toBe(true);
  });
});

describe("AdminDonations - tresci formularza wplaty", () => {
  it.each([
    ["Nagłówek (PL)", "headlinePl"],
    ["Nagłówek (EN)", "headlineEn"],
    ["Opis (PL)", "descriptionPl"],
    ["Opis (EN)", "descriptionEn"],
  ])("pole `%s` trafia do zapisu jako `%s`", async (etykieta, klucz) => {
    // Te cztery pola to CALY tekst widziany przez darczynce na `/donate`
    // w obu jezykach. Pole nietrafiajace do ladunku oznacza strone zbiorki
    // z nieaktualnym apelem.
    await panel();
    fireEvent.change(poleTekstowe(etykieta), { target: { value: "Nowa treść" } });
    expect(zapisany()[klucz]).toBe("Nowa treść");
  });
});

describe("AdminDonations - dostepnosc", () => {
  it("panel nie ma naruszen dostepnosci - takze po synchronizacji", async () => {
    // Zakres celowo obejmuje stan PO synchronizacji: raport i komunikat bledu
    // to tresc pojawiajaca sie dynamicznie, czyli ta, ktora najlatwiej dodac
    // bez semantyki.
    //
    // Do 08.2026 dwie reguly (`label` i `select-name`) byly tu WYLACZONE, bo
    // padaly na kazdym polu formularza - `Field` nie wiazal etykiety
    // z kontrolka. Po naprawie nie ma czego wylaczac i test pilnuje calego
    // zestawu razem z kolejnoscia naglowkow, semantyka tabeli rejestru,
    // nazwami przyciskow i poprawnoscia ARIA.
    const { container } = await panel();
    fireEvent.click(przyciskSynchronizacji());
    await screen.findByText(/Zaksięgowane/);
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY ZAREJESTROWANE I NAPRAWIONE (08.2026).
// ---------------------------------------------------------------------------
describe("AdminDonations - dawne defekty", () => {
  it("caly panel jest przetlumaczalny, a nie wpisany po polsku", async () => {
    // CO BYLO ZLE. Panel WOLAL `useTranslation()` i wyliczal z niego `lang`,
    // ale uzywal go WYLACZNIE do formatowania kwot i dat. Cala reszta byla
    // wpisana w kod po polsku: naglowek „Darowizny", opis modulu, naglowki
    // sekcji („Silnik wpłat", „Kwoty", „Formularz", „Treści", „Synchronizacja
    // ze Stripe"), etykiety wszystkich pol, obie opcje trybu, obie opcje
    // srodowiska, oba stany przycisku synchronizacji, tresc raportu i
    // komunikat zastepczy bledu.
    //
    // DLACZEGO TO BYLO RYZYKO. Efekt byl gorszy niz „brak tlumaczenia": panel
    // przelaczony na angielski pokazywal kwoty i daty po angielsku POD polskimi
    // etykietami, wiec wygladal na uszkodzony, a nie na nieprzetlumaczony.
    // Twardsza konsekwencja byla przy synchronizacji - „Środowisko testowe"
    // kontra „Środowisko produkcyjne" to JEDYNE rozroznienie miedzy operacja
    // na piaskownicy a operacja na koncie produkcyjnym operatora platnosci.
    // Administrator, ktory tego nie czytal, wybieral na slepo.
    //
    // JAK NAPRAWIONE. Wszystkie napisy panelu i obu paneli skladowych ida przez
    // klucze `donate.admin.*` w nakladce `i18n-donate` (PL i EN) - tej samej,
    // ktora panel juz rejestrowal `ensureI18n()`. Napisy przycisku zapisu niesie
    // wspoldzielony `SaveBar` z `@/components/admin/settings/fields` i to jest
    // OSOBNY, szerszy dlug (dotyczy wszystkich paneli ustawien), wiec ten test
    // go nie obejmuje.
    await i18n.changeLanguage("en");
    await panel();
    const t = realT("en");
    expect(screen.queryByRole("heading", { name: "Darowizny" })).toBeNull();
    expect(screen.getByRole("heading", { name: t("donate.admin.title") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("donate.admin.sync.title") })).toBeInTheDocument();
    // Najostrzejsze miejsce calego panelu: opisy obu srodowisk operatora.
    expect(Array.from(poleSrodowiska().options).map((o) => o.textContent)).toEqual([
      t("donate.admin.sync.sandbox"),
      t("donate.admin.sync.live"),
    ]);
    // Kwoty i etykiety mowia teraz jednym jezykiem.
    expect(await screen.findByText(kwota(125000, "PLN", "en"))).toBeInTheDocument();
    expect(screen.getByText(t("donate.admin.summary.total"))).toBeInTheDocument();
  });

  it("etykiety pol formularza sa POWIAZANE ze swoimi kontrolkami", async () => {
    // CO BYLO ZLE. `Field` (z `@/components/admin/settings/fields`) renderowal
    // `<label>` jako SIOSTRE kontrolki, bez `htmlFor` i bez otoczenia jej soba.
    // Zaden `<input>` ani `<select>` tego panelu nie mial wiec nazwy dostepnej -
    // axe zglaszal to jako naruszenie na kazdym polu (`label` x8,
    // `select-name` x3).
    //
    // DLACZEGO TO BYLO RYZYKO. Uzytkownik czytnika ekranu przechodzil przez ten
    // formularz i slyszal „pole edycji", „pole edycji", „lista rozwijana" - bez
    // ani jednej nazwy. To formularz, w ktorym ustawia sie KWOTE MINIMALNA,
    // MAKSYMALNA i CEL ZBIORKI: pomylenie dwoch sasiadujacych pol liczbowych
    // ustawia minimum wyzej niz maksimum i wylacza cala zbiorke. Klikniecie
    // w etykiete nie ustawialo tez fokusu w polu.
    //
    // JAK NAPRAWIONE. `Field` przyjmuje `htmlFor` i renderuje `<label for>`,
    // a panel podaje kazdej kontrolce jawne `id` (stala `ID` w `AdminDonations`).
    // Identyfikator jest JAWNY, a nie generowany przez `useId()` i podawany
    // dzieciom kontekstem, bo `Field` bywa uzyty z kilkoma kontrolkami naraz
    // (osiem pol `Text` w panelu banera cookies, trzy `NumberInput`
    // w google-source) - automat dawalby wtedy duplikaty identyfikatorow.
    // Wyglad sie nie zmienil: `htmlFor` nie ma reprezentacji wizualnej.
    // Pole wyboru srodowiska stoi poza `Field` i dostalo `aria-label`.
    const { container } = await panel();
    for (const etykieta of ETYKIETY_POL) {
      expect(screen.getByLabelText(etykieta)).toBeInstanceOf(HTMLInputElement);
    }
    expect(poleWyboru("Tryb").id).not.toBe("");
    expect(poleWyboru("Waluta").id).not.toBe("");
    expect(poleSrodowiska()).toHaveAccessibleName();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("kwoty sugerowane przyjmuja POLSKI przecinek dziesietny", async () => {
    // CO BYLO ZLE. Pole rozbijalo wpisany tekst po PRZECINKU, a dopiero potem
    // probowalo w kazdym kawalku zamienic przecinek na kropke
    // (`part.replace(",", ".")`). Po rozbiciu w kawalku nie ma juz przecinka,
    // wiec ta zamiana byla KODEM MARTWYM - nie dalo sie jej wykonac zadnym
    // wejsciem. Wpisane „12,50" nie dawalo jednej kwoty 12,50 zl, tylko DWIE
    // kwoty: 12 zl i 50 zl.
    //
    // DLACZEGO TO BYLO RYZYKO. Przecinek jest polskim separatorem dziesietnym,
    // a podpowiedz pod polem sama pokazywala przecinek („25, 50, 100, 250") -
    // czyli w roli separatora listy. Administrator wpisujacy „12,50" dostawal
    // wiec dwa dodatkowe przyciski na publicznym formularzu wplaty zamiast
    // jednego, bez zadnego komunikatu. Obecnosc martwego `replace(",", ".")`
    // dowodzila, ze zapis dziesietny byl zamierzony - nie zostal tylko nigdy
    // osiagniety.
    //
    // JAK ROZSTRZYGNIETO SEPARATORY. Kawalek, ktory jako CALOSC wyglada na
    // liczbe z przecinkiem dziesietnym („12,50"), jest jedna kwota; poza tym
    // przecinek nadal rozdziela kwoty, a lista rozdziela sie takze spacja
    // i srednikiem. Dzieki temu „12,50" znaczy 12,50 zl, a „25, 50, 100"
    // i „10,20,30" nadal znacza to, na co wygladaja (osobne, zielone testy
    // wyzej). Podpowiedz pod polem opisuje te regule wprost.
    await panel();
    const pole = poleTekstowe("Kwoty sugerowane");
    fireEvent.change(pole, { target: { value: "12,50" } });
    expect(zapisany().presetsCents).toEqual([1250]);
    // Pole pokazuje to, co administrator NAPRAWDE wpisal - kanoniczna postac
    // nadpisywala wpis przy kazdym znaku i przecinka nie dalo sie wpisac.
    expect(pole.value).toBe("12,50");
  });

  it("raport synchronizacji mowi, KTOREGO srodowiska dotyczy", async () => {
    // CO BYLO ZLE. Raport niesie pole `environment` (i `sinceIso`), ale panel
    // wypisywal z niego wylacznie liczniki. Po zmianie srodowiska w polu wyboru
    // stary raport zostawal na ekranie bez zmian.
    //
    // DLACZEGO TO BYLO RYZYKO. Administrator uruchamial uzgodnienie na
    // piaskownicy, widzial „Zaksięgowane: 3", przestawial pole na srodowisko
    // produkcyjne i mial pod nim ten sam raport. Wniosek „produkcja uzgodniona"
    // byl wtedy falszywy, a to wlasnie ten ekran sluzy do stwierdzenia, czy
    // rejestr wplat zgadza sie z operatorem platnosci.
    //
    // JAK NAPRAWIONE. Raport otwiera nazwa srodowiska WZIETA Z RAPORTU (a nie
    // z biezacego stanu pola wyboru - opisuje przebieg, ktory sie odbyl),
    // a zmiana pola wyboru raport czysci.
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    const tekst = (await screen.findByText(/Zaksięgowane/)).textContent ?? "";
    expect(tekst).toMatch(/sandbox|testow/i);

    fireEvent.change(poleSrodowiska(), { target: { value: "live" } });
    expect(screen.queryByText(/Zaksięgowane/)).toBeNull();
  });

  it("NIEUDANA synchronizacja kasuje nieaktualny raport sukcesu", async () => {
    // CO BYLO ZLE. `syncReport` ustawial sie w `onSuccess` i nigdy nie byl
    // czyszczony. Po udanym uzgodnieniu i nastepnym nieudanym na ekranie staly
    // JEDNOCZESNIE czerwony komunikat bledu i zielony raport z poprzedniego
    // przebiegu.
    //
    // DLACZEGO TO BYLO RYZYKO. Raport opisuje stan sprzed nieudanej proby, ale
    // nic tego nie mowilo. Odczyt „cos poszlo nie tak, ale widze zaksiegowane 3"
    // prowadzil do wniosku, ze uzgodnienie czesciowo przeszlo - podczas gdy
    // nie zrobilo nic. Przy rejestrze wplat roznica miedzy „czesciowo" a
    // „wcale" decyduje o tym, czy ktos szuka brakujacych wplat recznie.
    //
    // JAK NAPRAWIONE. `onMutate` zeruje raport na starcie KAZDEGO przebiegu -
    // wczesniej niz `onError`, wiec w trakcie uzgodnienia tez nie stoi na
    // ekranie wynik poprzedniego.
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    await screen.findByText(/Zaksięgowane/);
    h.sync.mockRejectedValue(new Error("odmowa uzgodnienia"));
    fireEvent.click(przyciskSynchronizacji());
    await screen.findByText("odmowa uzgodnienia");
    expect(screen.queryByText(/Zaksięgowane/)).toBeNull();
  });

  it("panel nie pozwala zapisac konfiguracji, ktorej publiczna strona odrzuci", async () => {
    // CO BYLO ZLE. Pola liczbowe czytaja `Number(e.target.value) || 0`, wiec
    // wyczyszczenie „Kwota minimalna (grosze)" zapisywalo `minCents: 0`. Schemat
    // `DonationsConfigSchema` wymaga tam minimum 500 (50 gr - minimum operatora
    // platnosci), a atrybut `min` na polu nie blokuje ani wpisania, ani zapisu.
    //
    // DLACZEGO TO BYLO RYZYKO. Nie konczylo sie na jednym zlym polu. Publiczna
    // strona czyta konfiguracje przez `parseDonationsConfig`, ktory przy
    // nieudanym `safeParse` zwraca CALE `DONATIONS_DEFAULTS`. Jedno wyczyszczone
    // pole liczbowe cofalo wiec do wartosci domyslnych rowniez tryb zbiorki,
    // walute, kwoty sugerowane, cel i oba naglowki - a panel administratora
    // dalej pokazywal zapisane (wlasne) wartosci, bo trzyma je we wlasnym stanie.
    // Rozjazd byl cichy i widoczny wylacznie na publicznym formularzu.
    //
    // JAK NAPRAWIONE. Zapis idzie przez `DonationsConfigSchema.safeParse`:
    // konfiguracja, ktorej publiczna strona i tak by nie przyjela, NIE JEDZIE
    // do bazy, a panel mowi WPROST, ktore pole ja blokuje (nazwa pola ta sama,
    // co nad kontrolka). Poprawka stoi po stronie panelu, a nie
    // `parseDonationsConfig`: tamten jest ostatnia linia obrony przed
    // USZKODZONYM wierszem w bazie i ma sie zachowywac tak samo dla kazdego
    // zrodla uszkodzenia, a nie zgadywac, ktore pola da sie uratowac.
    await panel();
    fireEvent.change(poleTekstowe("Kwota minimalna (grosze)"), { target: { value: "" } });
    fireEvent.click(przyciskZapisu());
    expect(h.saves).toHaveLength(0);
    // Komunikat nazywa pole tym samym napisem, co etykieta nad kontrolka -
    // administrator ma wiedziec, KTORE pole poprawic, a nie tylko ze „cos jest
    // nie tak".
    expect(
      screen.getByText(
        realT("pl")("donate.admin.save.invalid", { fields: "Kwota minimalna (grosze)" }),
      ),
    ).toBeInTheDocument();

    // Po poprawieniu wartosci zapis przechodzi - i to, co jedzie do bazy,
    // przechodzi ten sam schemat, ktory czyta publiczna strona.
    fireEvent.change(poleTekstowe("Kwota minimalna (grosze)"), { target: { value: "1000" } });
    const zapis = zapisany();
    expect(zapis.minCents).toBe(1000);
    expect(DonationsConfigSchema.safeParse(zapis).success).toBe(true);
  });
});

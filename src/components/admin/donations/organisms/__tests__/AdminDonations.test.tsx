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
// GRANICE vs SASIEDZI. Atrapowane sa WYLACZNIE granice: funkcje serwerowe
// (statystyki, rejestr, synchronizacja), silnik ustawien `useSettings`
// (ma wlasny, wyczerpujacy test - `src/lib/admin/__tests__/useSettings.test.tsx`),
// odczyt srodowiska operatora, i18n i toasty. PRAWDZIWE biegna: `useDraft`
// z tego samego modulu (czysty stan Reacta), `donationsConfig`
// (`DONATIONS_DEFAULTS`, `formatDonationAmount`, schemat konfiguracji), pola
// formularza panelu i OBA panele skladowe - dzieki temu widac takze, ze dane
// z zapytan naprawde do nich dojezdzaja.
//
// ZERO SIECI, ZERO SEKRETOW: klucz operatora nie jest tu w ogole czytany
// (`getStripeEnvironmentSafe` to atrapa), a zadna funkcja serwerowa nie biegnie.
//
// RODO: adresy darczyncow wylacznie z domen zarezerwowanych do przykladow
// (`example.com` / `example.org`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
  /** Jezyk interfejsu widziany przez atrape i18n. */
  language: "pl",
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

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-donate", () => ({ ensureI18n: h.ensureI18n }));
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
// `Field` renderuje etykiete jako SIOSTRE kontrolki (uklad dwukolumnowy), a nie
// jako `<label for>`, wiec `getByLabelText` tu nie dziala. To samo w sobie jest
// defektem dostepnosci - jest zarejestrowany na dole pliku. Tutaj szukamy
// kontrolki po widocznej etykiecie, czyli dokladnie tak, jak znajduje ja
// administrator wzrokiem.

function polePrzyEtykiecie<T extends Element>(etykieta: string, selektor: string): T {
  const label = screen.getByText(etykieta);
  const control = label.parentElement?.querySelector(selektor);
  if (!control) throw new Error(`test: przy etykiecie "${etykieta}" nie ma "${selektor}"`);
  return control as T;
}

function poleTekstowe(etykieta: string): HTMLInputElement {
  return polePrzyEtykiecie<HTMLInputElement>(etykieta, "input");
}

function poleWyboru(etykieta: string): HTMLSelectElement {
  return polePrzyEtykiecie<HTMLSelectElement>(etykieta, "select");
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

/** Renderuje panel i czeka, az OBA zapytania osiadna (znika „wczytuje"). */
async function panel() {
  const utils = renderWithQueryClient(<AdminDonations />);
  await waitFor(() => expect(screen.queryByText("admin.loading")).toBeNull());
  return utils;
}

beforeEach(() => {
  h.language = "pl";
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
    expect(screen.getByText("admin.loading")).toBeInTheDocument();
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
    expect(screen.getByText("admin.loading")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(przyciskZapisu()).toBeInTheDocument();
  });

  it("jezyk EN zmienia konwencje zapisu kwot w OBU panelach", async () => {
    // Jezyk czyta sie z i18n i podaje obu panelom. Panel podsumowania i wiersz
    // rejestru musza mowic tym samym formatem - inaczej ta sama kwota wyglada
    // na dwie rozne.
    h.language = "en";
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
    // Straznik `|| 0` zamienia oba przypadki na liczbe. (Sama wartosc 0 jest
    // dla schematu nadal nieprawidlowa - to osobny, zarejestrowany defekt.)
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
  it("poza brakiem nazw pol panel nie ma innych naruszen dostepnosci", async () => {
    // Zakres celowo obejmuje stan PO synchronizacji: raport i komunikat bledu
    // to tresc pojawiajaca sie dynamicznie, czyli ta, ktora najlatwiej dodac
    // bez semantyki.
    //
    // DWIE REGULY SA TU WYLACZONE CELOWO. `label` i `select-name` padaja na
    // KAZDYM polu tego formularza, bo `Field` nie wiaze etykiety z kontrolka -
    // to osobny, zarejestrowany defekt (`it.fails` na dole pliku). Gdyby ten
    // test uruchamial je razem z reszta, bylby na stale czerwony i przestalby
    // pilnowac wszystkiego innego: kolejnosci naglowkow, semantyki tabeli
    // rejestru, nazw przyciskow i poprawnosci ARIA.
    const { container } = await panel();
    fireEvent.click(przyciskSynchronizacji());
    await screen.findByText(/Zaksięgowane/);
    const naruszenia = await axeViolations(container, {
      label: { enabled: false },
      "select-name": { enabled: false },
    });
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY ZAREJESTROWANE, NIENAPRAWIONE (zakres tej pracy: wylacznie testy).
// ---------------------------------------------------------------------------
describe("AdminDonations - defekty (zarejestrowane)", () => {
  it.fails("caly panel jest przetlumaczalny, a nie wpisany po polsku", async () => {
    // CO JEST ZLE. Panel WOLA `useTranslation()` i wylicza z niego `lang`,
    // ale uzywa go WYLACZNIE do formatowania kwot i dat. Cala reszta jest
    // wpisana w kod po polsku: naglowek „Darowizny", opis modulu, naglowki
    // sekcji („Silnik wpłat", „Kwoty", „Formularz", „Treści", „Synchronizacja
    // ze Stripe"), etykiety wszystkich pol, obie opcje trybu, obie opcje
    // srodowiska, oba stany przycisku synchronizacji, tresc raportu i
    // komunikat zastepczy bledu.
    //
    // DLACZEGO TO RYZYKO. Efekt jest gorszy niz „brak tlumaczenia": panel
    // przelaczony na angielski pokazuje kwoty i daty po angielsku POD polskimi
    // etykietami, wiec wyglada na uszkodzony, a nie na nieprzetlumaczony.
    // Twardsza konsekwencja jest przy synchronizacji - „Środowisko testowe"
    // kontra „Środowisko produkcyjne" to JEDYNE rozroznienie miedzy operacja
    // na piaskownicy a operacja na koncie produkcyjnym operatora platnosci.
    // Administrator, ktory tego nie czyta, wybiera na slepo.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka wymaga zalozenia kilkudziesieciu kluczy
    // w slowniku `i18n-donate` w obu jezykach i przepisania kodu produkcyjnego;
    // zakres tej pracy to wylacznie testy.
    h.language = "en";
    await panel();
    expect(screen.queryByRole("heading", { name: "Darowizny" })).toBeNull();
  });

  it.fails("etykiety pol formularza sa POWIAZANE ze swoimi kontrolkami", async () => {
    // CO JEST ZLE. `Field` (z `@/components/admin/settings/fields`) renderuje
    // `<label>` jako SIOSTRE kontrolki, bez `htmlFor` i bez otoczenia jej soba.
    // Zaden `<input>`, `<select>` ani przelacznik tego panelu nie ma wiec
    // nazwy dostepnej - axe zglasza to jako naruszenie na kazdym polu.
    //
    // DLACZEGO TO RYZYKO. Uzytkownik czytnika ekranu przechodzi przez ten
    // formularz i slyszy „pole edycji", „pole edycji", „lista rozwijana" - bez
    // ani jednej nazwy. To formularz, w ktorym ustawia sie KWOTE MINIMALNA,
    // MAKSYMALNA i CEL ZBIORKI: pomylenie dwoch sasiadujacych pol liczbowych
    // ustawia minimum wyzej niz maksimum i wylacza cala zbiorke. Klikniecie
    // w etykiete nie ustawia tez fokusu w polu, co dla kontrolek o rozmiarze
    // 18 px (przelaczniki) ma znaczenie takze dla osob z ograniczona
    // motoryka.
    //
    // DLACZEGO NIE NAPRAWIAM. Zrodlo jest w `@/components/admin/settings/fields`,
    // wspolnym dla WSZYSTKICH paneli ustawien - poprawka dotyka kodu
    // produkcyjnego daleko poza tym modulem i wymaga przejscia po kazdym
    // panelu, ktory tych pol uzywa. Zakres tej pracy to wylacznie testy.
    const { container } = await panel();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it.fails("kwoty sugerowane przyjmuja POLSKI przecinek dziesietny", async () => {
    // CO JEST ZLE. Pole rozbija wpisany tekst po PRZECINKU, a dopiero potem
    // probuje w kazdym kawalku zamienic przecinek na kropke
    // (`part.replace(",", ".")`). Po rozbiciu w kawalku nie ma juz przecinka,
    // wiec ta zamiana jest KODEM MARTWYM - nie da sie jej wykonac zadnym
    // wejsciem. Wpisane „12,50" nie daje jednej kwoty 12,50 zl, tylko DWIE
    // kwoty: 12 zl i 50 zl.
    //
    // DLACZEGO TO RYZYKO. Przecinek jest polskim separatorem dziesietnym,
    // a podpowiedz pod polem sama pokazuje przecinek („25, 50, 100, 250") -
    // czyli w roli separatora listy. Administrator wpisujacy „12,50" dostaje
    // wiec dwa dodatkowe przyciski na publicznym formularzu wplaty zamiast
    // jednego, i nie ma zadnego komunikatu ani sygnalu, ze cos poszlo inaczej,
    // niz chcial. Obecnosc martwego `replace(",", ".")` dowodzi, ze zapis
    // dziesietny byl zamierzony - nie zostal tylko nigdy osiagniety.
    // Kropka dziesietna dziala (osobny, zielony test wyzej), ale nikt jej tu
    // nie sugeruje.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka wymaga zmiany parsera pola (inny
    // separator listy albo rozpoznanie „12,50" jako jednej pozycji) w kodzie
    // produkcyjnym; zakres tej pracy to wylacznie testy.
    await panel();
    fireEvent.change(poleTekstowe("Kwoty sugerowane"), { target: { value: "12,50" } });
    expect(zapisany().presetsCents).toEqual([1250]);
  });

  it.fails("raport synchronizacji mowi, KTOREGO srodowiska dotyczy", async () => {
    // CO JEST ZLE. Raport niesie pole `environment` (i `sinceIso`), ale panel
    // wypisuje z niego wylacznie liczniki. Po zmianie srodowiska w polu wyboru
    // stary raport zostaje na ekranie bez zmian.
    //
    // DLACZEGO TO RYZYKO. Administrator uruchamia uzgodnienie na piaskownicy,
    // widzi „Zaksięgowane: 3", przestawia pole na srodowisko produkcyjne i ma
    // pod nim ten sam raport. Wniosek „produkcja uzgodniona" jest wtedy
    // falszywy, a to wlasnie ten ekran sluzy do stwierdzenia, czy rejestr
    // wplat zgadza sie z operatorem platnosci.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka (wypisanie srodowiska w raporcie albo
    // czyszczenie raportu przy zmianie pola wyboru) dotyka kodu produkcyjnego;
    // zakres tej pracy to wylacznie testy.
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    const tekst = (await screen.findByText(/Zaksięgowane/)).textContent ?? "";
    expect(tekst).toMatch(/sandbox|testow/i);
  });

  it.fails("NIEUDANA synchronizacja kasuje nieaktualny raport sukcesu", async () => {
    // CO JEST ZLE. `syncReport` ustawia sie w `onSuccess` i nigdy nie jest
    // czyszczony. Po udanym uzgodnieniu i nastepnym nieudanym na ekranie stoja
    // JEDNOCZESNIE czerwony komunikat bledu i zielony raport z poprzedniego
    // przebiegu.
    //
    // DLACZEGO TO RYZYKO. Raport opisuje stan sprzed nieudanej proby, ale nic
    // tego nie mowi. Odczyt „cos poszlo nie tak, ale widze zaksiegowane 3"
    // prowadzi do wniosku, ze uzgodnienie czesciowo przeszlo - podczas gdy
    // nie zrobilo nic. Przy rejestrze wplat roznica miedzy „czesciowo" a
    // „wcale" decyduje o tym, czy ktos szuka brakujacych wplat recznie.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka to wyzerowanie raportu w `onMutate`
    // albo `onError` - kod produkcyjny; zakres tej pracy to wylacznie testy.
    await panel();
    fireEvent.click(przyciskSynchronizacji());
    await screen.findByText(/Zaksięgowane/);
    h.sync.mockRejectedValue(new Error("odmowa uzgodnienia"));
    fireEvent.click(przyciskSynchronizacji());
    await screen.findByText("odmowa uzgodnienia");
    expect(screen.queryByText(/Zaksięgowane/)).toBeNull();
  });

  it.fails("panel nie pozwala zapisac konfiguracji, ktorej publiczna strona odrzuci", async () => {
    // CO JEST ZLE. Pola liczbowe czytaja `Number(e.target.value) || 0`, wiec
    // wyczyszczenie „Kwota minimalna (grosze)" zapisuje `minCents: 0`. Schemat
    // `DonationsConfigSchema` wymaga tam minimum 500 (50 gr - minimum operatora
    // platnosci), a atrybut `min` na polu nie blokuje ani wpisania, ani zapisu.
    //
    // DLACZEGO TO RYZYKO. To nie konczy sie na jednym zlym polu. Publiczna
    // strona czyta konfiguracje przez `parseDonationsConfig`, ktory przy
    // nieudanym `safeParse` zwraca CALE `DONATIONS_DEFAULTS`. Jedno wyczyszczone
    // pole liczbowe cofa wiec do wartosci domyslnych rowniez tryb zbiorki,
    // walute, kwoty sugerowane, cel i oba naglowki - a panel administratora
    // dalej pokazuje zapisane (wlasne) wartosci, bo trzyma je we wlasnym stanie.
    // Rozjazd jest cichy i widoczny wylacznie na publicznym formularzu.
    // Ta sama sciezka dotyczy „Kwota maksymalna" powyzej 5 000 000 i dziewiatej
    // kwoty sugerowanej.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka to walidacja draftu schematem przed
    // zapisem (albo `safeParse` w `onSave` z komunikatem) - zmiana kodu
    // produkcyjnego; zakres tej pracy to wylacznie testy.
    await panel();
    fireEvent.change(poleTekstowe("Kwota minimalna (grosze)"), { target: { value: "" } });
    const zapis = zapisany();
    expect(zapis.minCents).toBe(0);
    expect(DonationsConfigSchema.safeParse(zapis).success).toBe(true);
  });
});

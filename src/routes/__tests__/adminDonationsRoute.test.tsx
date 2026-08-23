// TRASA `/admin/donations` (329 linii, 0% pokrycia) - jedyny panel w repo,
// który mówi redakcji, ILE PIENIĘDZY WPŁYNĘŁO. RYZYKIEM nie jest tu render,
// tylko to, że panel składa JEDEN widok z DWÓCH niezależnych źródeł prawdy
// o tych samych pieniądzach i nie ma ani jednej gałęzi na to, że jedno z nich
// milczy.
//
// CO TEN PLIK DOWODZI.
//   1. DWA SPRZECZNE OBRAZY W JEDNYM RENDERZE. Kafelki sum czyta
//      `getDonationsPublicStats` - server fn na SERVICE ROLE, która omija RLS.
//      Rejestr wpłat czyta `listDonationRecords` - server fn, która przed
//      odczytem woła `assertAdmin`. Polityka RLS na `donations` dopuszcza samo
//      `admin`, a layout `/admin` przepuszcza też `editor` i `author`. Skutek
//      dla redaktora jest widoczny dopiero w DOM: kafelek „12 500 zł" stoi nad
//      komunikatem „adminDonations.records.empty", a obok czeka aktywny
//      przycisk synchronizacji, który serwer odrzuci. Ani tsc, ani recenzja
//      nie widzą sprzeczności - to są dwa poprawne wywołania dwóch poprawnych
//      funkcji.
//   2. AWARIA ODCZYTU JEST NIEODRÓŻNIALNA OD ZERA. `stats.data?.totalCents ?? 0`
//      nie ma gałęzi na `isError`, a `(records.data?.length ?? 0) === 0`
//      renderuje „brak wpłat" także wtedy, gdy odczyt rejestru PADŁ. To ta sama
//      klasa defektu, którą na widgecie publicznym złapał
//      `src/components/donations/__tests__/DonationsWidgetView.test.tsx` (punkt
//      1 jego nagłówka) - tu dotyczy PANELU, nie widgetu, i drugiego zapytania.
//   3. `if (!draft) return ...admin.loading` - dopóki `site_settings` się nie
//      wczyta, panel nie renderuje ANI JEDNEGO pola. Odczyt, który padł, zostaje
//      w tym stanie na zawsze i wygląda identycznie jak wczytywanie.
//   4. WALUTA KAFELKÓW MA DWA ŹRÓDŁA: `stats.data?.currency ?? currency`.
//      Awaria statystyk przełącza jednostkę kwot ze statystyk na DRAFT ustawień
//      - kafelek dalej pokazuje liczbę, tylko w innej walucie.
//   5. SYNCHRONIZACJA: blokada przycisku na czas biegu, rozgałęzienie
//      `error instanceof Error` (treść błędu vs komunikat ogólny), interpolacja
//      pięciu liczb raportu, doklejanie ostrzeżeń dopiero przy niepustej liście
//      i PONOWNY przejazd obu zapytań po sukcesie.
//   6. REJESTR: trzy stany (oczekiwanie / pusto / tabela) oraz to, co tabela
//      robi z danymi - etykieta cykliczności, myślnik dla anonima, data przez
//      `toLocaleString` zależny od języka i kwota w walucie WIERSZA (nie zbiórki).
//   7. NAGŁÓWEK DOKUMENTU: trasa deklaruje `head()` LOKALNIE (inaczej niż
//      `/admin/ads`, która pożycza go od rodzica) - i robi to z literałem, nie
//      przez `t()`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * Warstwa decyzji (`parsePresetsCents`, `parseAmountField`, `coerce*`) ma
//     44 testy w `src/lib/billing/__tests__/donationsAdminModel.test.ts`. Trasa
//     te funkcje tylko WOŁA - ich tabelki przypadków tu nie wracają.
//   * Schemat zapisu ustawień: `src/lib/billing/donationsConfig.ts` ma własne
//     testy; silnik `useSettings` - `src/lib/admin/__tests__/useSettings.test.tsx`.
//   * DOWÓD ŹRÓDŁOWY o braku kontroli roli w tej trasie postawiła już bramka
//     `src/routes/__tests__/adminRouteAuthority.gate.test.ts` (it.fails „DEFEKT:
//     /admin/donations pokazuje redaktorowi PUSTY rejestr wpłat..."). Ona czyta
//     PLIK i szuka `isAdmin`. Ten plik nie powtarza tamtej asercji - pokazuje
//     SKUTEK W DOM, którego skan źródła zobaczyć nie może.
//   * Martwe wywołanie `ensureDonateI18n()` (trasa nie renderuje ani jednego
//     klucza `donate.*`) udowadnia `src/__tests__/monetizationI18nLoading.gate.test.ts`.
//     Tutaj sprawdzamy wyłącznie MOMENT rejestracji obu słowników.
//
// CZEGO TEN PLIK NIE DOWODZI (i nie udaje, że dowodzi). AUTORYTETU DOSTĘPU.
// Harness montuje trasę pod zastępczym korzeniem, więc ani bramka `isStaff`
// w layoucie `/admin`, ani RLS na `donations`, ani `assertAdmin` w server fn nie
// biorą w tym udziału - autorytet zostaje przy pgTAP i bramce
// `check:authz-snapshot`. Tu sterujemy odpowiedziami server fn ręcznie i pytamy
// wyłącznie o to, JAKI WIDOK panel z nich składa.
//
// PODMIENIONE ATRAPY (i dlaczego inaczej się nie da):
//   * `@/lib/billing/donations.functions` i `@/lib/billing/donationsAdmin.functions`
//     - prawdziwa server fn nie ma pod happy-dom runtime'u TanStack Start
//     (patrz `src/test/serverFn.ts`), a poza tym to WŁAŚNIE ich odpowiedzi są
//     przedmiotem dowodu: sukces / odrzucenie / wieczne oczekiwanie.
//   * `@/integrations/supabase/client` - atrapa łańcucha PostgREST. `useSettings`
//     zostaje PRAWDZIWY, bo draft i jego trwałość przy przełączaniu trybu są
//     tym, co mamy udowodnić; zamockowany hook dowodziłby atrapy.
//   * `@/lib/stripe` - `getStripeEnvironmentSafe()` czyta `import.meta.env`,
//     czyli konfigurację maszyny, a nie zachowanie panelu.
//   * `react-i18next` - `t` echuje klucz (`@/test/i18nStub`), więc asercja widzi
//     KLUCZ i parametry interpolacji, a nie polskie zdanie.
//   * `sonner` + `@/lib/builder/siteSettingsLiveSync` - `useSettings` woła je po
//     zapisie; poza zakresem tego pliku.
// Atrapy Radiksa NIE MA i nie jest potrzebna: wszystkie trzy listy rozwijane tej
// trasy to natywne `<select>`, a `AdminShell` ta trasa w ogóle nie renderuje
// (sprawdzone w źródle, nie założone z nazwy).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SupabaseFromStub } from "@/test/supabase";
import type { DonationsPublicStats } from "@/lib/billing/donations.functions";
import type { AdminDonationRow, DonationsSyncReport } from "@/lib/billing/donationsAdmin.server";

const h = vi.hoisted(() => {
  const stan = {
    db: null as SupabaseFromStub | null,
    /** Język zwracany przez atrapę i18next - steruje formatem daty i kwoty. */
    jezyk: "pl",
    /** Wynik `getStripeEnvironmentSafe()` - wartość startowa listy środowisk. */
    srodowiskoStripe: "sandbox" as "sandbox" | "live",
    /** Czy odczyt `site_settings` ma NIGDY nie odpowiedzieć (prawdziwe oczekiwanie). */
    ustawieniaWisza: false,
    odpowiedzStats: null as (() => Promise<DonationsPublicStats>) | null,
    odpowiedzRecords: null as (() => Promise<AdminDonationRow[]>) | null,
    odpowiedzSync: null as (() => Promise<DonationsSyncReport>) | null,
    wywolaniaStats: 0,
    wywolaniaRecords: 0,
    wywolaniaSync: 0,
    argumentySync: [] as unknown[],
    rejestracjeDonate: 0,
    rejestracjeAdmin: 0,
    /** Suma rejestracji słowników w chwili PIERWSZEGO zapytania o dane. */
    rejestracjeWPierwszymZapytaniu: -1,
  };
  return Object.assign(stan, {
    zanotujPierwszeZapytanie() {
      if (stan.rejestracjeWPierwszymZapytaniu === -1) {
        stan.rejestracjeWPierwszymZapytaniu = stan.rejestracjeDonate + stan.rejestracjeAdmin;
      }
    },
  });
});

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.jezyk),
);
vi.mock("@/lib/i18n-donate", () => ({
  ensureI18n: () => {
    h.rejestracjeDonate += 1;
  },
}));
vi.mock("@/lib/i18n-donations-admin", () => ({
  ensureDonationsAdminI18n: () => {
    h.rejestracjeAdmin += 1;
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: () => h.srodowiskoStripe }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/builder/siteSettingsLiveSync", () => ({
  emitSiteSettingsInvalidate: () => undefined,
}));
vi.mock("@/lib/billing/donations.functions", () => ({
  getDonationsPublicStats: () => {
    h.zanotujPierwszeZapytanie();
    h.wywolaniaStats += 1;
    if (!h.odpowiedzStats) throw new Error("test: brak zaplanowanej odpowiedzi statystyk");
    return h.odpowiedzStats();
  },
}));
vi.mock("@/lib/billing/donationsAdmin.functions", () => ({
  listDonationRecords: () => {
    h.zanotujPierwszeZapytanie();
    h.wywolaniaRecords += 1;
    if (!h.odpowiedzRecords) throw new Error("test: brak zaplanowanej odpowiedzi rejestru");
    return h.odpowiedzRecords();
  },
  syncDonationsWithStripe: (arg: unknown) => {
    h.wywolaniaSync += 1;
    h.argumentySync.push(arg);
    if (!h.odpowiedzSync) throw new Error("test: brak zaplanowanej odpowiedzi synchronizacji");
    return h.odpowiedzSync();
  },
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  /**
   * Łańcuch, który NIGDY nie odpowiada. `supabaseFromStub` rozwiązuje się
   * synchronicznie, więc prawdziwego stanu `!draft` (jeszcze nie ma ustawień)
   * nie dałoby się nim złapać - `draft` byłby ustawiony, zanim padnie pierwsza
   * asercja. To jedyne miejsce w tym pliku, które omija wspólną atrapę, i tylko
   * po to, żeby zatrzymać czas na gałęzi wczytywania.
   */
  const wiszacyLancuch = () => {
    const builder: Record<string, unknown> = {};
    for (const ogniwo of ["select", "eq", "order", "limit", "upsert"]) {
      builder[ogniwo] = () => builder;
    }
    builder["maybeSingle"] = () => new Promise(() => {});
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => {
        h.zanotujPierwszeZapytanie();
        return h.ustawieniaWisza ? wiszacyLancuch() : db.from(table);
      },
    },
  };
});

import { Route } from "@/routes/admin.donations";
import { Route as AdminRoute } from "@/routes/admin";
import { renderRoute, routeHead, routeMeta } from "@/test/routeHarness";
import { fail, ok } from "@/test/supabase";
import { DONATIONS_SETTINGS_KEY } from "@/lib/billing/donationsConfig";

// --- dane testowe -----------------------------------------------------------

/**
 * RODO: rejestr wpłat to dane osobowe darczyńców. Adresy WYŁĄCZNIE w domenach
 * zarezerwowanych (RFC 2606), bez nazwisk - także w atrapie.
 */
const WPLATY: AdminDonationRow[] = [
  {
    id: "wplata-1",
    amountCents: 25000,
    currency: "PLN",
    status: "paid",
    recurring: false,
    donorEmail: "darczynca@example.com",
    message: null,
    provider: "stripe",
    providerSessionId: "cs_test_jednorazowa",
    providerIntentId: "pi_test_jednorazowa",
    createdAt: "2026-08-20T10:30:00.000Z",
    paidAt: "2026-08-20T10:30:05.000Z",
  },
  {
    id: "wplata-2",
    amountCents: 5000,
    currency: "EUR",
    status: "refunded",
    recurring: true,
    // Darczyńca anonimowy - w tabeli ma się pojawić myślnik, nie puste pole.
    donorEmail: null,
    message: null,
    provider: "stripe",
    providerSessionId: "cs_test_cykliczna",
    providerIntentId: null,
    createdAt: "2026-08-19T08:00:00.000Z",
    paidAt: null,
  },
];

const RAPORT: DonationsSyncReport = {
  environment: "sandbox",
  sinceIso: "2026-08-16T00:00:00.000Z",
  scannedSessions: 5,
  settled: 1,
  imported: 2,
  refunded: 3,
  expired: 4,
  warnings: [],
};

function statystyki(nadpisania: Partial<DonationsPublicStats> = {}): DonationsPublicStats {
  return {
    totalCents: 1_250_000,
    monthCents: 300_000,
    count: 42,
    monthCount: 7,
    currency: "PLN",
    recent: [],
    truncated: false,
    ...nadpisania,
  };
}

/** Wiersz `site_settings` w kształcie, jaki czyta `useSettings` (deep merge na domyślnych). */
function ustawienia(wartosc: Record<string, unknown>) {
  h.db?.setResponse("site_settings", () => ok({ value: wartosc }));
}

// --- pomocnicze wyszukiwarki DOM --------------------------------------------

/**
 * Dopasowanie po CAŁEJ treści węzła, odporne na spację nierozdzielającą, którą
 * `Intl.NumberFormat` wstawia między liczbę a symbol waluty („12 500 zł").
 */
function tresc(oczekiwana: string) {
  return (zawartosc: string) => zawartosc.replace(/\s+/g, " ").trim() === oczekiwana;
}

/** `<select>`, który zawiera opcję o podanej etykiecie - trasa ma trzy listy. */
function listaZOpcja(etykietaOpcji: string): HTMLSelectElement {
  const opcja = screen.getByText(etykietaOpcji);
  const lista = opcja.closest("select");
  if (!lista) throw new Error(`test: opcja "${etykietaOpcji}" nie leży w żadnym <select>`);
  return lista;
}

function mount() {
  return renderRoute({
    route: Route,
    path: "/admin/donations",
    initialEntry: "/admin/donations",
  });
}

beforeEach(() => {
  h.db?.reset();
  h.jezyk = "pl";
  h.srodowiskoStripe = "sandbox";
  h.ustawieniaWisza = false;
  h.wywolaniaStats = 0;
  h.wywolaniaRecords = 0;
  h.wywolaniaSync = 0;
  h.argumentySync = [];
  h.rejestracjeDonate = 0;
  h.rejestracjeAdmin = 0;
  h.rejestracjeWPierwszymZapytaniu = -1;
  ustawienia({ provider: "stripe", currency: "PLN" });
  h.odpowiedzStats = () => Promise.resolve(statystyki());
  h.odpowiedzRecords = () => Promise.resolve([]);
  h.odpowiedzSync = () => Promise.resolve(RAPORT);
});

describe("trasa /admin/donations: dwa źródła prawdy o tych samych pieniądzach", () => {
  it("kafelki liczą z SERVICE ROLE, a rejestr przez assertAdmin - w jednym renderze stoi '12 500 zł' NAD 'brak wpłat'", async () => {
    // Dokładnie sytuacja redaktora: publiczne statystyki omijają RLS, więc
    // sumy się liczą; `listDonationRecords` woła `assertAdmin` i odrzuca.
    h.odpowiedzStats = () => Promise.resolve(statystyki());
    h.odpowiedzRecords = () => Promise.reject(new Error("forbidden: donations są admin-only"));

    await mount();
    await waitFor(() => expect(screen.getByText(tresc("12 500 zł"))).toBeTruthy());

    // FAKT 1 - kafelki przypinają konkretne liczby.
    expect(screen.getByText(tresc("12 500 zł"))).toBeTruthy();
    expect(screen.getByText(tresc("3000 zł"))).toBeTruthy();
    expect(screen.getByText(tresc("42"))).toBeTruthy();
    // FAKT 2 - tabela pod nimi mówi, że wpłat nie ma.
    expect(screen.getByText("adminDonations.records.empty")).toBeTruthy();
    // FAKT 3 - i nic nie blokuje przycisku, który serwer odrzuci tak samo.
    const przycisk = screen.getByRole("button", { name: "adminDonations.sync.run" });
    expect(przycisk.hasAttribute("disabled")).toBe(false);
  });

  it.fails(
    "OCZEKIWANE: panel nie pokazuje sum, których nie umie rozwinąć w rejestr - " +
      "nieudany odczyt rejestru powinien wyłączyć kafelki albo nazwać rejestr niedostępnym",
    async () => {
      // Skutek dla użytkownika: redaktor raportuje zarządowi „zebraliśmy
      // 12 500 zł", a jedyne, co widzi pod spodem, to „brak zarejestrowanych
      // wpłat". Jedna z dwóch liczb jest nieprawdziwa i panel nie mówi która.
      //
      // NAPRAWA (poza zakresem): albo kafelki milkną, gdy rejestr jest
      // niedostępny, albo sekcja rejestru dostaje własny komunikat o braku
      // uprawnień/awarii - dziś nie ma ani jednego, ani drugiego.
      //
      // KONTROLA DODATNIA: test wyżej („kafelki liczą z SERVICE ROLE...")
      // przechodzi na TYM SAMYM ustawieniu atrap, więc ten `it.fails` nie
      // może zzielenieć z powodu zepsutej scenografii.
      h.odpowiedzStats = () => Promise.resolve(statystyki());
      h.odpowiedzRecords = () => Promise.reject(new Error("forbidden: donations są admin-only"));

      await mount();
      await waitFor(() => expect(screen.getByText("adminDonations.records.empty")).toBeTruthy());

      expect(screen.queryByText(tresc("12 500 zł"))).toBeNull();
    },
  );
});

describe("trasa /admin/donations: awaria odczytu statystyk", () => {
  it("odrzucona obietnica statystyk renderuje '0 zł' i zero wpłat - nie ma gałęzi na isError", async () => {
    // Ta sama klasa defektu, co punkt 1 w `DonationsWidgetView.test.tsx`
    // (`statsQ.data ?? FALLBACK`), tyle że tutaj mieszka w PANELU: trzy kafelki
    // czytają `stats.data?.X ?? 0` i nic nie odróżnia awarii od pustej zbiórki.
    h.odpowiedzStats = () => Promise.reject(new Error("donations: odczyt statystyk padł"));

    const { queryClient } = await mount();
    await waitFor(() =>
      expect(queryClient.getQueryState(["donations", "stats", "admin"])?.status).toBe("error"),
    );

    expect(screen.getAllByText(tresc("0 zł")).length).toBe(2);
    expect(screen.getByText(tresc("0"))).toBeTruthy();
  });

  it("gdy statystyki DZIAŁAJĄ, waluta kafelków jedzie ze STATYSTYK, nie z ustawień", async () => {
    ustawienia({ provider: "stripe", currency: "PLN" });
    h.odpowiedzStats = () => Promise.resolve(statystyki({ currency: "EUR" }));

    await mount();
    await waitFor(() => expect(screen.getByText(tresc("12 500 €"))).toBeTruthy());

    expect(screen.queryByText(tresc("12 500 zł"))).toBeNull();
  });

  it("gdy statystyki PADNĄ, waluta kafelków jedzie z DRAFTU ustawień", async () => {
    // `stats.data?.currency ?? currency` - drugi człon to `draft.currency`.
    // Kafelek nie znika i nie zmienia liczby, zmienia JEDNOSTKĘ.
    ustawienia({ provider: "stripe", currency: "EUR" });
    h.odpowiedzStats = () => Promise.reject(new Error("donations: odczyt statystyk padł"));

    const { queryClient } = await mount();
    await waitFor(() =>
      expect(queryClient.getQueryState(["donations", "stats", "admin"])?.status).toBe("error"),
    );

    expect(screen.getAllByText(tresc("0 €")).length).toBe(2);
    expect(screen.queryByText(tresc("0 zł"))).toBeNull();
  });
});

describe("trasa /admin/donations: brak draftu ustawień", () => {
  it("dopóki ustawienia się nie wczytają, nie ma ANI JEDNEGO pola formularza", async () => {
    // `if (!draft) return ...admin.loading` stoi PRZED całym JSX. Gdyby
    // kiedykolwiek zniknął, panel wystartowałby na wartościach domyślnych
    // i pierwszy zapis nadpisałby konfigurację produkcyjną szkicem z powietrza.
    h.ustawieniaWisza = true;

    await mount();

    expect(screen.getByText("admin.loading")).toBeTruthy();
    expect(screen.queryByText("adminDonations.title")).toBeNull();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryAllByRole("spinbutton")).toEqual([]);
    expect(screen.queryAllByRole("combobox")).toEqual([]);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("BŁĄD odczytu ustawień zostawia panel w tym samym stanie, co wczytywanie", async () => {
    h.db?.setResponse("site_settings", () => fail("site_settings: brak uprawnień", "42501"));

    const { queryClient } = await mount();
    await waitFor(() =>
      expect(queryClient.getQueryState(["site_settings", DONATIONS_SETTINGS_KEY])?.status).toBe(
        "error",
      ),
    );

    expect(screen.getByText("admin.loading")).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
  });

  it.fails(
    "OCZEKIWANE: nieudany odczyt ustawień mówi o błędzie zamiast wiecznie 'wczytywać'",
    async () => {
      // Skutek dla użytkownika: administrator patrzy na napis „Wczytywanie…",
      // który nigdy nie zniknie, i nie ma z czego wywnioskować, że to awaria
      // odczytu, a nie wolna sieć. `useSettings` wystawia `query.isError` -
      // trasa go nie czyta.
      //
      // KONTROLA DODATNIA: test wyżej („BŁĄD odczytu ustawień zostawia panel
      // w tym samym stanie, co wczytywanie") przechodzi na tej samej atrapie.
      h.db?.setResponse("site_settings", () => fail("site_settings: brak uprawnień", "42501"));

      const { queryClient } = await mount();
      await waitFor(() =>
        expect(queryClient.getQueryState(["site_settings", DONATIONS_SETTINGS_KEY])?.status).toBe(
          "error",
        ),
      );

      expect(screen.queryByText("admin.loading")).toBeNull();
    },
  );
});

describe("trasa /admin/donations: silnik wpłat", () => {
  it("tryb 'external' pokazuje adres zbiórki, a 'stripe' go nie pokazuje", async () => {
    ustawienia({ provider: "external", externalUrl: "https://zbiorka.example.org/a" });

    await mount();
    await waitFor(() => expect(screen.getByText("adminDonations.title")).toBeTruthy());

    expect(screen.getByText("adminDonations.engine.externalUrl")).toBeTruthy();
    expect(screen.getByDisplayValue("https://zbiorka.example.org/a")).toBeTruthy();
  });

  it("przełączenie na 'stripe' CHOWA pole adresu, ale NIE kasuje go z draftu - powrót przywraca wpisaną wartość", async () => {
    // Stan faktyczny, sprawdzony empirycznie: `setDraft({ ...draft, provider })`
    // nie dotyka `externalUrl`, więc pole tylko znika z widoku. Konsekwencja
    // jest obosieczna: administrator nie traci wpisanego adresu, ale zapis
    // w trybie `stripe` i tak utrwali w `site_settings` adres, którego nikt
    // już nie widzi na ekranie.
    ustawienia({ provider: "external", externalUrl: "https://zbiorka.example.org/a" });

    await mount();
    await waitFor(() => expect(screen.getByText("adminDonations.title")).toBeTruthy());

    const pole = screen.getByDisplayValue("https://zbiorka.example.org/a");
    fireEvent.change(pole, { target: { value: "https://zbiorka.example.org/b" } });
    expect(screen.getByDisplayValue("https://zbiorka.example.org/b")).toBeTruthy();

    const tryb = listaZOpcja("adminDonations.engine.modeStripe");
    fireEvent.change(tryb, { target: { value: "stripe" } });
    expect(screen.queryByText("adminDonations.engine.externalUrl")).toBeNull();
    expect(screen.queryByDisplayValue("https://zbiorka.example.org/b")).toBeNull();

    fireEvent.change(tryb, { target: { value: "external" } });
    expect(screen.getByDisplayValue("https://zbiorka.example.org/b")).toBeTruthy();
  });
});

describe("trasa /admin/donations: synchronizacja ze Stripe", () => {
  async function zamontujIKliknij() {
    const wynik = await mount();
    await waitFor(() => expect(screen.getByText("adminDonations.title")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "adminDonations.sync.run" }));
    return wynik;
  }

  it("na czas biegu przycisk jest ZABLOKOWANY i zmienia napis na 'sync.running'", async () => {
    h.odpowiedzSync = () => new Promise<DonationsSyncReport>(() => {});

    await zamontujIKliknij();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "adminDonations.sync.running" })).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: "adminDonations.sync.running" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "adminDonations.sync.run" })).toBeNull();
  });

  it("błąd będący Error pokazuje JEGO TREŚĆ, a nie komunikat ogólny", async () => {
    h.odpowiedzSync = () =>
      Promise.reject(new Error("stripe: brak klucza bramki dla środowiska sandbox"));

    await zamontujIKliknij();

    await waitFor(() =>
      expect(screen.getByText("stripe: brak klucza bramki dla środowiska sandbox")).toBeTruthy(),
    );
    expect(screen.queryByText("adminDonations.sync.failed")).toBeNull();
  });

  it("błąd NIE będący Error spada na komunikat ogólny 'sync.failed'", async () => {
    // Druga gałąź `sync.error instanceof Error`. Server fn potrafi odrzucić
    // zwykłym obiektem odpowiedzi (redirect / `{ status, body }`), a wtedy
    // `error.message` byłoby `undefined` i akapit błędu byłby pusty.
    const niebedacyError: unknown = { status: 403, body: "forbidden" };
    h.odpowiedzSync = () =>
      new Promise<DonationsSyncReport>((_resolve, reject) => {
        reject(niebedacyError);
      });

    await zamontujIKliknij();

    await waitFor(() => expect(screen.getByText("adminDonations.sync.failed")).toBeTruthy());
  });

  it("raport sukcesu interpoluje PIĘĆ liczb, a ostrzeżeń nie dokleja przy pustej liście", async () => {
    h.odpowiedzSync = () => Promise.resolve({ ...RAPORT, warnings: [] });

    await zamontujIKliknij();

    await waitFor(() =>
      expect(
        screen.getByText(
          tresc("adminDonations.sync.report(expired=4,imported=2,refunded=3,scanned=5,settled=1)"),
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/reportWarnings/)).toBeNull();
  });

  it("ostrzeżenia doklejają się do raportu dopiero, gdy lista nie jest pusta", async () => {
    h.odpowiedzSync = () =>
      Promise.resolve({ ...RAPORT, warnings: ["tenant_unresolved", "stripe_rate_limited"] });

    await zamontujIKliknij();

    await waitFor(() =>
      expect(
        screen.getByText(
          tresc(
            "adminDonations.sync.report(expired=4,imported=2,refunded=3,scanned=5,settled=1)" +
              "adminDonations.sync.reportWarnings(count=2)",
          ),
        ),
      ).toBeTruthy(),
    );
  });

  it("po sukcesie rejestr I statystyki idą po dane PO RAZ DRUGI", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("adminDonations.title")).toBeTruthy());
    expect(h.wywolaniaRecords).toBe(1);
    expect(h.wywolaniaStats).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "adminDonations.sync.run" }));

    await waitFor(() => expect(h.wywolaniaRecords).toBe(2));
    await waitFor(() => expect(h.wywolaniaStats).toBe(2));
    expect(h.wywolaniaSync).toBe(1);
  });

  it("synchronizacja jedzie ze środowiskiem z listy i oknem 168 godzin", async () => {
    h.srodowiskoStripe = "live";

    await mount();
    await waitFor(() => expect(screen.getByText("adminDonations.title")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "adminDonations.sync.run" }));

    await waitFor(() => expect(h.wywolaniaSync).toBe(1));
    expect(h.argumentySync[0]).toEqual({ data: { environment: "live", sinceHours: 168 } });
  });
});

describe("trasa /admin/donations: rejestr wpłat", () => {
  it("stan oczekiwania rejestru renderuje 'admin.loading' WEWNĄTRZ panelu, nie zamiast niego", async () => {
    h.odpowiedzRecords = () => new Promise<AdminDonationRow[]>(() => {});

    await mount();
    await waitFor(() => expect(screen.getByText("adminDonations.title")).toBeTruthy());

    expect(screen.getByText("admin.loading")).toBeTruthy();
    expect(screen.queryByText("adminDonations.records.empty")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("pusta odpowiedź rejestru renderuje komunikat, a nie pustą tabelę", async () => {
    h.odpowiedzRecords = () => Promise.resolve([]);

    await mount();
    await waitFor(() => expect(screen.getByText("adminDonations.records.empty")).toBeTruthy());

    expect(screen.queryByRole("table")).toBeNull();
  });

  it("tabela odróżnia wpłatę cykliczną od jednorazowej, anonimowi darczyńcy dostają myślnik", async () => {
    h.odpowiedzRecords = () => Promise.resolve(WPLATY);

    await mount();
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

    expect(screen.getByText("adminDonations.records.oneTime")).toBeTruthy();
    expect(screen.getByText("adminDonations.records.recurring")).toBeTruthy();
    expect(screen.getByText("darczynca@example.com")).toBeTruthy();
    expect(screen.getByText(tresc("-"))).toBeTruthy();
    expect(screen.getByText("paid")).toBeTruthy();
    expect(screen.getByText("refunded")).toBeTruthy();
  });

  it("kwota wiersza jest w walucie WIERSZA, a nie w walucie zbiórki z kafelków", async () => {
    // Rejestr bywa dwuwalutowy (PLN historycznie, EUR po zmianie ustawień),
    // a kafelki sumują wyłącznie walutę zbiórki - te dwie liczby nie są tym
    // samym pomiarem i tabela to pokazuje.
    ustawienia({ provider: "stripe", currency: "PLN" });
    h.odpowiedzRecords = () => Promise.resolve(WPLATY);

    await mount();
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

    expect(screen.getByText(tresc("250 zł"))).toBeTruthy();
    expect(screen.getByText(tresc("50 €"))).toBeTruthy();
  });

  it("data wiersza idzie przez toLocaleString zależny od języka: pl-PL vs en-GB", async () => {
    const iso = WPLATY[0]!.createdAt;
    const poPolsku = new Date(iso).toLocaleString("pl-PL");
    const poAngielsku = new Date(iso).toLocaleString("en-GB");
    // Bez tego asercje niżej byłyby prawdziwe także wtedy, gdyby trasa w ogóle
    // nie rozróżniała języków.
    expect(poPolsku).not.toBe(poAngielsku);

    h.odpowiedzRecords = () => Promise.resolve(WPLATY);
    h.jezyk = "pl";
    const { unmount } = await mount();
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.getByText(tresc(poPolsku))).toBeTruthy();
    expect(screen.queryByText(tresc(poAngielsku))).toBeNull();
    unmount();

    h.jezyk = "en";
    await mount();
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.getByText(tresc(poAngielsku))).toBeTruthy();
    expect(screen.queryByText(tresc(poPolsku))).toBeNull();
  });

  it("odrzucony odczyt rejestru renderuje DOKŁADNIE ten sam DOM, co rejestr pusty", async () => {
    h.odpowiedzRecords = () => Promise.reject(new Error("donations: odczyt rejestru padł"));

    const { queryClient } = await mount();
    await waitFor(() =>
      expect(queryClient.getQueryState(["donations", "records", "admin"])?.status).toBe("error"),
    );

    expect(screen.getByText("adminDonations.records.empty")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.fails(
    "OCZEKIWANE: awaria odczytu rejestru NIE jest pokazywana jako 'brak zarejestrowanych wpłat'",
    async () => {
      // Skutek dla użytkownika: przy chwilowej awarii sieci albo braku
      // uprawnień panel twierdzi, że zbiórka nie ma ANI JEDNEJ wpłaty. To jest
      // komunikat o pieniądzach, na którym redakcja podejmuje decyzje.
      // `records.isError` istnieje w wyniku `useQuery` i nikt go nie czyta.
      //
      // KONTROLA DODATNIA: test wyżej („odrzucony odczyt rejestru renderuje
      // DOKŁADNIE ten sam DOM, co rejestr pusty") przechodzi na tej samej
      // atrapie, więc porażka niżej pochodzi z ostatniej asercji, nie z setupu.
      h.odpowiedzRecords = () => Promise.reject(new Error("donations: odczyt rejestru padł"));

      const { queryClient } = await mount();
      await waitFor(() =>
        expect(queryClient.getQueryState(["donations", "records", "admin"])?.status).toBe("error"),
      );

      expect(screen.queryByText("adminDonations.records.empty")).toBeNull();
    },
  );
});

describe("trasa /admin/donations: nagłówek dokumentu", () => {
  it("trasa deklaruje WŁASNY head(): tytuł 'Darowizny - Panel' i robots noindex, nofollow", async () => {
    expect(Route.options.head).toBeTypeOf("function");
    expect(await routeMeta(Route)).toEqual([
      { title: "Darowizny - Panel" },
      { name: "robots", content: "noindex, nofollow" },
    ]);
  });

  it("robots stoi TU i w rodzicu /admin - lokalna deklaracja nie jest jedyną ochroną", async () => {
    // W przeciwieństwie do `/admin/ads` (patrz `adminAdsRoute.test.tsx`), ta
    // trasa nie polega na scalaniu head() w dół łańcucha - ale rodzic i tak
    // deklaruje `robots`, więc obie ścieżki prowadzą do tego samego wyniku.
    // Wniosek dla utrzymania: usunięcie lokalnego head() NIE odsłoniłoby panelu
    // wyszukiwarkom, zabrałoby natomiast tytuł zakładki.
    const rodzic = await routeMeta(AdminRoute);
    expect(rodzic).toEqual(
      expect.arrayContaining([{ name: "robots", content: "noindex, nofollow" }]),
    );
    expect(rodzic).toEqual(expect.arrayContaining([{ title: "Admin" }]));
  });

  it("tytuł jest LITERAŁEM dwujęzycznym wyjątkiem head(), nie kluczem i18n", async () => {
    // §6 briefu: `head()` renderuje się POZA providerem i18n, więc literał jest
    // tu świadomą decyzją repo, a nie defektem lokalizacji. Dowód, że tytuł
    // faktycznie NIE zależy od języka: ta sama wartość przy `pl` i przy `en`.
    h.jezyk = "pl";
    const poPolsku = routeHead(Route).meta;
    h.jezyk = "en";
    const poAngielsku = routeHead(Route).meta;

    expect(poPolsku).toEqual(poAngielsku);
    expect(poPolsku?.[0]).toEqual({ title: "Darowizny - Panel" });
  });
});

describe("trasa /admin/donations: rejestracja słowników", () => {
  it("oba słowniki rejestrują się PRZED pierwszym zapytaniem o dane", async () => {
    await mount();
    await waitFor(() => expect(h.rejestracjeWPierwszymZapytaniu).toBeGreaterThan(-1));

    // `ensureDonateI18n()` i `ensureDonationsAdminI18n()` są dwiema pierwszymi
    // instrukcjami komponentu - obie muszą paść, zanim ruszy jakikolwiek odczyt,
    // inaczej panel mignie gołymi kluczami zamiast napisów.
    expect(h.rejestracjeDonate).toBeGreaterThan(0);
    expect(h.rejestracjeAdmin).toBeGreaterThan(0);
    expect(h.rejestracjeWPierwszymZapytaniu).toBeGreaterThanOrEqual(2);
  });
});

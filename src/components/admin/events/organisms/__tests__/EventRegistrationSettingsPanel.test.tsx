// Organizm „USTAWIENIA REJESTRACJI" - ekran, na ktorym zapada CZY i NA JAKICH
// WARUNKACH uczestnik w ogole wejdzie na wydarzenie.
//
// PO CO TEN PLIK ISTNIEJE. Kazde z dziesieciu pol tego ekranu ma DRUGIE miejsce
// zycia w bazie: raz jako CHECK na `events`, raz jako `RAISE EXCEPTION`
// w `admin_event_general_save`. Modul czysty (`registrationSettingsDraft`) ma
// wlasny plik testowy i dowodzi tabel regul - ale zaden test nie dowodzil, ze
// EKRAN tych regul uzywa. Roznica jest namacalna: reguly, ktore istnieja
// w module, a nie sa wpiete w formularz, konczą sie surowym
// `23514 violates check constraint` u redaktora, czyli dokladnie tym, czemu
// modul czysty mial zapobiec.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. LIMIT MIEJSC JEDZIE DO BAZY BEZ SPRAWDZENIA. Kolumna ma CHECK
//      `capacity IS NULL OR capacity > 0`, wiec „0" i „-5" wracaja jako blad
//      SQL bez nazwy pola. Test idzie w PARZE: czerwone zdanie NA EKRANIE
//      i cisza NA WARSTWIE ZAPISU - tylko drugie chroni wydarzenie.
//   2. CENA W GROSZACH. Pole trzyma jednostki glowne („250,55"), baza grosze.
//      Blad zaokraglenia jest niewidoczny na ekranie i widoczny na fakturze.
//   3. LADUNEK NIEKOMPLETNY. Ten ekran i „Informacje ogolne" pisza do JEDNEJ
//      tabeli przez to samo RPC, a kontrakt mowi „klucz nieobecny = pole
//      nietkniete". Klucz, ktory tu wypadnie, zostawia w bazie wartosc sprzed
//      zmiany i redaktor widzi „zapisano" nad danymi, ktorych nie zapisal.
//   4. ADRES ZEWNETRZNY ZNIKA Z EKRANU, ALE NIE Z BAZY. Pole pokazuje sie tylko
//      w trybie `external`; RPC go nie zeruje przy zmianie trybu, wiec musi
//      jechac dalej w ladunku - inaczej powrot do trybu `external` gubi adres.
//   5. OSTRZEZENIA NIE SA BLEDAMI. „Chatham House na stronie publicznej" ma
//      zatrzymac wzrok, a nie zapis - pomylenie tych dwoch klas zamyka
//      redaktorowi ekran, na ktorym nie ma nic niepoprawnego.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Tabel regul szkicu (walidacja, ladunek,
// ostrzezenia, przeliczenie groszy) - `lib/events/__tests__/registrationSettingsDraft.test.ts`;
// tutaj dowodzimy, ze organizm ich UZYWA i ze skutek widac na ekranie.
// (2) Mapowania odmow bazy (`adminEventStudioErrors`). (3) Kalendarza i droplisty
// Radiksa - pod happy-dom nie maja pelnego API wskaznika, wiec stoja tu atrapy
// o tym samym kontrakcie.
//
// ZAWEZENIE NAJEMCA. Zapis idzie przez RPC `admin_event_general_save`, wiec
// asertujemy NAZWE FUNKCJI i LADUNEK; samo zawezenie tenantem siedzi w SQL
// (`assert_editor_tenant`) i pilnuje go bramka `check:sql-tenant-scope`.
//
// RODO: zadnych prawdziwych danych osobowych, adresy wylacznie `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/adminEventStudioErrors", () => ({
  adminEventStudioErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Droplista waluty stoi na Radix Select (przez `FormSelect`), a ten pod
// happy-dom nie otwiera popupu bez pelnego API wskaznika. Atrapa jest natywna
// i ETYKIETOWANA, bo przedmiotem dowodu jest to, KTORA waluta dojedzie do
// ladunku - nie to, jak wyglada lista.
vi.mock("@/components/atoms/FormSelect", () => {
  const FormSelect = ({
    id,
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  return { FormSelect, default: FormSelect };
});

// Kalendarz jest popoverem Radiksa - atrapa zostawia z niego KONTRAKT: napis
// ISO w srodku i pusty napis jako „nie podano".
vi.mock("@/components/ui/datetime-picker", () => ({
  DateTimePicker: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string | null;
    onChange: (iso: string | null) => void;
  }) => (
    <input
      id={id}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    />
  ),
}));

const { EventRegistrationSettingsPanel } =
  await import("@/components/admin/events/organisms/EventRegistrationSettingsPanel");

const R = "adminEvents.studio.registrationSettings.";
const ZAPIS_RPC = "admin_event_general_save";

/**
 * KOLUMNY LICZBOWE, KTORE BAZA ODDAJE JAKO `NULL`.
 *
 * `admin_event_detail` zwraca `e.capacity`, `e.ticket_price_cents`
 * i `e.early_rsvp_rank` wprost z tabeli, a wszystkie trzy sa NULL-owalne -
 * „bez limitu", „bezplatne" i „bez pierwszenstwa" to WARTOSCI, nie braki
 * danych. Generator typow opisuje `RETURNS TABLE` jako kolumny niepuste, wiec
 * w budowniku wiersza nie da sie podac `null` bez rzutowania przez `unknown`,
 * a repozytorium ma na nie ratchet (`check:unknown-casts`). Wartosc
 * nieskonczona wchodzi w DOKLADNIE TE SAMA galaz produkcyjnego `integerText`
 * (`Number.isFinite` -> puste pole), co realny `null` z bazy.
 */
const BEZ_WARTOSCI = Number.NaN;

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Wiersz studia BEZ ustawien rejestracji - punkt wyjscia „nowe wydarzenie".
 *
 * Wspolny budownik ma domyslnie zera w kolumnach liczbowych (bo tak typuje je
 * generator), a zero limitu i zero groszy to dla tego ekranu WARTOSCI BLEDNE.
 * Test, ktory chce limitu albo ceny, dokłada je nadpisaniem.
 */
function wiersz(overrides: Partial<AdminEventDetailRow> = {}): AdminEventDetailRow {
  return adminEventDetailRow({
    capacity: BEZ_WARTOSCI,
    ticket_price_cents: BEZ_WARTOSCI,
    early_rsvp_rank: BEZ_WARTOSCI,
    ...overrides,
  });
}

function panel(overrides: Partial<AdminEventDetailRow> = {}) {
  return render(
    <Provider>
      <EventRegistrationSettingsPanel row={wiersz(overrides)} />
    </Provider>,
  );
}

/**
 * Karta wyboru po roli, nie po etykiecie.
 *
 * `EventStudioChoiceCard` opakowuje kolko etykieta, w ktorej stoi TAKZE zdanie
 * „co sie stanie, gdy uczestnik kliknie Zapisz sie" - dostepna nazwa kolka jest
 * wiec sklejeniem calej karty, a nie samym napisem.
 */
function karta(klucz: string): HTMLInputElement {
  const found = screen.getByRole("radio", { name: new RegExp(klucz.replaceAll(".", "\\.")) });
  return found as HTMLInputElement;
}

function pole(klucz: string): HTMLInputElement {
  return screen.getByLabelText(`${R}${klucz}`) as HTMLInputElement;
}

function wpisz(klucz: string, value: string): void {
  fireEvent.change(pole(klucz), { target: { value } });
}

function przyciskZapisu(): HTMLElement | null {
  return screen.queryByRole("button", { name: "adminEvents.studio.actions.save" });
}

function zapisz(): void {
  const przycisk = przyciskZapisu();
  if (przycisk === null) throw new Error("test: paska zapisu nie ma na ekranie");
  fireEvent.click(przycisk);
}

function odrzuc(): void {
  fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.discard" }));
}

/** Ladunek ostatniego zapisu jako slownik - bez rzutowania na typ RPC. */
function ladunek(): Record<string, unknown> {
  const call = stub().lastCall(ZAPIS_RPC);
  if (call === undefined) throw new Error("test: zapis nie dojechal do bazy");
  const arg = call.arg("p_payload");
  if (arg === null || typeof arg !== "object") {
    throw new Error("test: ladunek zapisu nie jest obiektem");
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(arg)) out[key] = value;
  return out;
}

async function czekajNaZapis(): Promise<void> {
  await waitFor(() => expect(stub().lastCall(ZAPIS_RPC)).toBeDefined());
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setData(ZAPIS_RPC, STUDIO_EVENT_ID);
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

afterEach(cleanup);

describe("EventRegistrationSettingsPanel - trzy stany ekranu", () => {
  it("PUSTY: nowe wydarzenie nie ma limitu, ceny ani adresow - i nie zaprasza do zapisu", () => {
    // Pusty limit znaczy „bez limitu", a nie „zero miejsc". Gdyby ekran wpisywal
    // tu zero z wiersza, redaktor zapisywalby wydarzenie zamkniete, nie otwarte.
    panel({ join_url: "", recording_url: "", external_registration_url: "" });

    expect(pole("capacityLabel").value).toBe("");
    expect(pole("priceLabel").value).toBe("");
    expect(pole("joinUrlLabel").value).toBe("");
    expect(pole("recordingUrlLabel").value).toBe("");
    expect(pole("earlyRankLabel").value).toBe("");
    expect(przyciskZapisu()).toBeNull();
  });

  it("Z DANYMI: kazde pole niesie WARTOSC Z BAZY, a cena wraca w jednostkach glownych", () => {
    // „25000" w kolumnie to „250.00" na fakturze. Ekran, ktory pokazalby grosze,
    // uczylby redaktora dopisywac dwa zera - i pierwszy zapis pomnozylby cene.
    panel({
      capacity: 120,
      ticket_price_cents: 25000,
      ticket_currency: "EUR",
      min_tier_rank: 2,
      early_rsvp_rank: 1,
      rsvp_opens_at: "2026-08-01T08:00:00.000Z",
      chatham_house: true,
      join_url: "https://transmisja.example.org/kongres",
      recording_url: "https://nagrania.example.org/kongres",
      visibility: "members",
      registration_mode: "form",
      registration_flow: "approval",
    });

    expect(pole("capacityLabel").value).toBe("120");
    expect(pole("priceLabel").value).toBe("250.00");
    expect(pole("minTierLabel").value).toBe("2");
    expect(pole("earlyRankLabel").value).toBe("1");
    expect(pole("rsvpOpensLabel").value).toBe("2026-08-01T08:00:00.000Z");
    expect(pole("joinUrlLabel").value).toBe("https://transmisja.example.org/kongres");
    expect(pole("recordingUrlLabel").value).toBe("https://nagrania.example.org/kongres");
    expect(screen.getByLabelText(`${R}currencyLabel`)).toHaveValue("EUR");
    expect(karta("registrationModes.form").checked).toBe(true);
    expect(karta("registrationFlows.approval").checked).toBe(true);
    expect(karta("visibilities.members").checked).toBe(true);
    expect(screen.getByRole("switch", { name: `${R}chathamHouseLabel` })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("BLAD: odmowa bazy jest ZDANIEM, a wpisana praca zostaje na ekranie", async () => {
    // Pasek zapisu musi zostac: szkic NIE zostal zapisany, wiec redaktor ma
    // jeszcze co zapisac i co odrzucic. Zniknięcie paska po odmowie mowilo by,
    // ze limit jest juz w bazie.
    stub().setError(ZAPIS_RPC, "forbidden: not an event admin", "42501");
    panel();

    wpisz("capacityLabel", "150");
    zapisz();

    // Redaktor ma dostac CALE zdanie odmowy, a nie sam fakt, ze cos poszlo nie
    // tak: „nie masz uprawnien" i „adres juz zajety" wymagaja innej reakcji.
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: not an event admin"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(przyciskZapisu()).not.toBeNull();
    expect(pole("capacityLabel").value).toBe("150");
  });
});

describe("EventRegistrationSettingsPanel - limit miejsc", () => {
  it("LIMIT UJEMNY nie dociera do bazy i konczy sie zdaniem przy polu", () => {
    panel();

    wpisz("capacityLabel", "-5");
    zapisz();

    expect(screen.getByText(`${R}errors.capacityInvalid`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("ZERO NIE JEST LIMITEM, jest wydarzeniem zamknietym - CHECK `capacity > 0` je odrzuca", () => {
    // RPC przepuszcza zero (pilnuje tylko `>= 0`), wiec bez tej bramki redaktor
    // dostalby surowy `23514` z nazwa constraintu zamiast zdania po polsku.
    panel();

    wpisz("capacityLabel", "0");
    zapisz();

    expect(screen.getByText(`${R}errors.capacityInvalid`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("LIMIT NIENUMERYCZNY („120 osob”) nie dociera do bazy", () => {
    panel();

    wpisz("capacityLabel", "120 osob");
    zapisz();

    expect(screen.getByText(`${R}errors.capacityInvalid`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("po pierwszej odmowie ekranu przycisk zapisu GASNIE - drugie klikniecie nie ma jak wyslac", () => {
    panel();

    wpisz("capacityLabel", "-5");
    zapisz();
    const przycisk = przyciskZapisu();
    expect(przycisk).toBeDisabled();

    if (przycisk !== null) fireEvent.click(przycisk);
    expect(stub().names()).toEqual([]);
  });

  it("POPRAWNY LIMIT jedzie do bazy napisem, bo `p_payload->>` i tak oddaje tekst", async () => {
    panel();

    wpisz("capacityLabel", "150");
    zapisz();

    await czekajNaZapis();
    expect(ladunek().capacity).toBe("150");
  });

  it("WYCZYSZCZENIE LIMITU jedzie jako pusty napis - „bez limitu”, a nie „zero”", async () => {
    panel({ capacity: 120 });

    wpisz("capacityLabel", "");
    zapisz();

    await czekajNaZapis();
    expect(ladunek().capacity).toBe("");
  });
});

describe("EventRegistrationSettingsPanel - dostep do zapisow", () => {
  it("zmiana widocznosci dojezdza do ladunku - to ona decyduje, KTO zobaczy wydarzenie", async () => {
    panel({ visibility: "public" });

    fireEvent.click(karta("visibilities.members"));
    zapisz();

    await czekajNaZapis();
    expect(ladunek().visibility).toBe("members");
  });

  it("zmiana przebiegu na „wymaga akceptacji” dojezdza do ladunku", async () => {
    // Przebieg decyduje, czy zgloszenie zajmuje miejsce od razu, czy czeka na
    // decyzje - to nie jest ustawienie kosmetyczne.
    panel({ registration_flow: "instant" });

    fireEvent.click(karta("registrationFlows.approval"));
    zapisz();

    await czekajNaZapis();
    expect(ladunek().registration_flow).toBe("approval");
  });

  it("PROG WARSTWY UJEMNY nie dociera do bazy", () => {
    // Warstwa liczy sie od zera w gore; wartosc ujemna to nie „wszyscy", tylko
    // regula dostepu, ktorej `get_event_access` nie umie policzyc.
    panel();

    wpisz("minTierLabel", "-1");
    zapisz();

    expect(screen.getByText(`${R}errors.tierRankInvalid`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("prog warstwy dojezdza do ladunku napisem", async () => {
    panel();

    wpisz("minTierLabel", "3");
    zapisz();

    await czekajNaZapis();
    expect(ladunek().min_tier_rank).toBe("3");
  });
});

describe("EventRegistrationSettingsPanel - transmisja i nagranie", () => {
  it("adres transmisji `http://` nie dociera do bazy - przegladarka zablokuje go po cichu", () => {
    // Strona wydarzenia idzie po HTTPS, wiec mieszana tresc konczy sie
    // ostrzezeniem dokladnie w chwili, w ktorej uczestnik klika „Wejdz na
    // transmisje" - czyli w jedynej chwili, w ktorej ten adres ma znaczenie.
    panel();

    wpisz("joinUrlLabel", "http://transmisja.example.org/kongres");
    zapisz();

    expect(screen.getByText(`${R}errors.joinUrlInvalid`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("adres nagrania `http://` tez nie dociera do bazy", () => {
    panel();

    wpisz("recordingUrlLabel", "http://nagrania.example.org/kongres");
    zapisz();

    expect(screen.getByText(`${R}errors.recordingUrlInvalid`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("oba adresy `https` jada do ladunku - redaktor moze je TU zobaczyc tylko dzieki RPC", async () => {
    // Obie kolumny sa odciete od klienckiego SELECT-a grantem kolumnowym;
    // definerowe `admin_event_detail` jest jedynym miejscem, z ktorego wracaja.
    panel();

    wpisz("joinUrlLabel", "https://transmisja.example.org/kongres");
    wpisz("recordingUrlLabel", "https://nagrania.example.org/kongres");
    zapisz();

    await czekajNaZapis();
    expect(ladunek().join_url).toBe("https://transmisja.example.org/kongres");
    expect(ladunek().recording_url).toBe("https://nagrania.example.org/kongres");
  });
});

describe("EventRegistrationSettingsPanel - tryb zapisow", () => {
  it("wartosc spoza zbioru („internal” z czasow starego dialogu) degraduje do zapisow jednym klikiem", () => {
    // Kolumna jest `text` z CHECK-iem, ale ekran nie ma prawa zalezec od cudzego
    // CHECK-a: wiersz z wartoscia legacy musi zaznaczyc KTORAS karte, inaczej
    // pierwszy zapis wyslalby tryb wybrany przypadkiem.
    panel({ registration_mode: "internal", registration_flow: "direct" });

    expect(karta("registrationModes.rsvp").checked).toBe(true);
    expect(karta("registrationFlows.instant").checked).toBe(true);
  });

  it("karta „bez zapisow” stoi NA KONCU - to wyjscie, nie wybor domyslny", () => {
    panel();

    const identyfikatory = screen
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("id"))
      .filter((id) => id !== null && id.startsWith("event-registration-mode-"));
    expect(identyfikatory).toEqual([
      "event-registration-mode-rsvp",
      "event-registration-mode-form",
      "event-registration-mode-external",
      "event-registration-mode-none",
    ]);
  });

  it("pole adresu zewnetrznego POJAWIA SIE tylko w trybie `external`", () => {
    panel();

    expect(screen.queryByLabelText(`${R}externalUrlLabel`)).toBeNull();
    fireEvent.click(karta("registrationModes.external"));
    expect(screen.getByLabelText(`${R}externalUrlLabel`)).toBeInTheDocument();
  });

  it("tryb `external` BEZ adresu nie dociera do bazy - przycisk prowadzilby donikad", () => {
    panel();

    fireEvent.click(karta("registrationModes.external"));
    zapisz();

    expect(screen.getByText(`${R}errors.externalUrlRequired`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("adres `http://` nie dociera do bazy - mieszana tresc na stronie po HTTPS", () => {
    panel();

    fireEvent.click(karta("registrationModes.external"));
    fireEvent.change(screen.getByLabelText(`${R}externalUrlLabel`), {
      target: { value: "http://zapisy.example.org/kongres" },
    });
    zapisz();

    expect(screen.getByText(`${R}errors.externalUrlInvalid`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("adres `http://` blokuje zapis TAKZE poza trybem `external` - CHECK bazy obowiazuje zawsze", () => {
    // RPC patrzy na ksztalt adresu wylacznie dla trybu `external`, ale CHECK
    // `events_external_registration_url_https` obowiazuje ZAWSZE. Adres wklejony
    // „na probe" i zostawiony przy trybie `rsvp` wywalilby sie na tabeli.
    panel();

    fireEvent.click(karta("registrationModes.external"));
    fireEvent.change(screen.getByLabelText(`${R}externalUrlLabel`), {
      target: { value: "http://zapisy.example.org/kongres" },
    });
    fireEvent.click(karta("registrationModes.rsvp"));
    zapisz();

    expect(stub().names()).toEqual([]);
    expect(przyciskZapisu()).toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: blokada BEZ POWODU NA EKRANIE. Czerwone zdanie o adresie
  // zewnetrznym mieszka PRZY POLU, a pole rysuje sie wylacznie w trybie
  // `external`. Adres w zlym ksztalcie zostawiony przy innym trybie nadal
  // blokuje zapis (test wyzej), ale komunikat nie ma gdzie sie pojawic:
  // redaktor widzi zgaszony przycisk „Zapisz", zaden blad i zadnego pola, ktore
  // moglby poprawic. Wyjscie z tego stanu wymaga zgadniecia, ze trzeba wrocic
  // do karty „cudzy serwis" i wyczyscic adres, ktorego ten tryb nie uzywa.
  // ---------------------------------------------------------------------------
  it("DEFEKT: zly adres zewnetrzny blokuje zapis w trybie `rsvp` BEZ jakiegokolwiek komunikatu na ekranie", () => {
    panel();

    fireEvent.click(karta("registrationModes.external"));
    fireEvent.change(screen.getByLabelText(`${R}externalUrlLabel`), {
      target: { value: "http://zapisy.example.org/kongres" },
    });
    fireEvent.click(karta("registrationModes.rsvp"));
    zapisz();

    expect(screen.getByText(`${R}errors.externalUrlInvalid`)).toBeInTheDocument();
  });

  it("adres zewnetrzny ZNIKA Z EKRANU przy zmianie trybu, ale NIE z ladunku", async () => {
    // Baza go nie zeruje przy zmianie trybu, wiec pominiecie klucza zostawiloby
    // w tabeli adres sprzed zmiany - a powrot do trybu `external` pokazalby
    // wartosc, ktorej ekran nigdy nie potwierdzil.
    panel({ external_registration_url: "https://zapisy.example.org/kongres" });

    fireEvent.click(karta("registrationModes.form"));
    zapisz();

    await czekajNaZapis();
    expect(ladunek().external_registration_url).toBe("https://zapisy.example.org/kongres");
    expect(ladunek().registration_mode).toBe("form");
  });

  it("tryb „bez zapisow” NIE ZERUJE limitu - powrot do zapisow ma odzyskac wczesniejsza pule", async () => {
    panel({ capacity: 120 });

    fireEvent.click(karta("registrationModes.none"));
    zapisz();

    await czekajNaZapis();
    expect(ladunek().registration_mode).toBe("none");
    expect(ladunek().capacity).toBe("120");
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: limit miejsc przy trybie „bez zapisow" nie dostaje ZADNEGO sygnalu.
  // Limit bez zapisow nie ma czego ograniczac - nie ma zgloszen, ktore mozna by
  // odciac - a mimo to pole przyjmuje liczbe, maluje sie tak samo jak w trybie
  // zapisow i jedzie do bazy. Redaktor, ktory wylaczyl zapisy i wpisal „120",
  // wychodzi z ekranu przekonany, ze ograniczyl wejscie. Cena w tej samej
  // sytuacji dostaje ostrzezenie `pricedWithoutRegistration`; limit nie dostaje
  // nic.
  //
  // ASERCJA JEST NA STANIE EKRANU, A NIE NA JEDNEJ POPRAWCE. Defekt zamyka
  // zarowno zgaszenie pola, jak i dopisanie zdania do listy ostrzezen - gdyby
  // wpis rejestru zadal wylacznie `disabled`, poprawka druga zostawilaby go
  // czerwonym i nikt by sie nie dowiedzial, ze dziura jest juz zalatana.
  // ---------------------------------------------------------------------------
  it("DEFEKT: tryb „bez zapisow” zostawia limit miejsc bez sygnalu - ani zgaszonego pola, ani ostrzezenia", () => {
    panel();

    fireEvent.click(karta("registrationModes.none"));
    wpisz("capacityLabel", "120");

    expect({
      poleZgaszone: pole("capacityLabel").disabled,
      ostrzezenia: screen.queryAllByRole("listitem").map((item) => item.textContent),
    }).not.toEqual({ poleZgaszone: false, ostrzezenia: [] });
  });
});

describe("EventRegistrationSettingsPanel - przelacznik zasady Chatham House", () => {
  // To JEDYNY przelacznik tego ekranu i jedyne pole, ktore zmienia UMOWE
  // z uczestnikiem, a nie parametr liczbowy - dlatego jego droga do ladunku ma
  // wlasne przypadki.
  it("wlaczenie jedzie do bazy jako napis „true” - `p_payload->>` czyta tekst, nie boolean", async () => {
    panel({ chatham_house: false });

    fireEvent.click(screen.getByRole("switch", { name: `${R}chathamHouseLabel` }));
    zapisz();

    await czekajNaZapis();
    expect(ladunek().chatham_house).toBe("true");
  });

  it("wylaczenie jedzie jako „false”, a nie jako brak klucza", async () => {
    // Klucz pominiety w ladunku zachowuje dzisiejszy stan po stronie RPC, wiec
    // bez jawnego „false" zasady nie dalo by sie ZDJAC.
    panel({ chatham_house: true });

    fireEvent.click(screen.getByRole("switch", { name: `${R}chathamHouseLabel` }));
    zapisz();

    await czekajNaZapis();
    expect(ladunek().chatham_house).toBe("false");
  });

  it("zasada na stronie PUBLICZNEJ jest ostrzezeniem, a nie blokada zapisu", async () => {
    // Obietnica „nie cytujemy" przy stronie, ktora czyta kazdy, jest sprzeczna -
    // ale to redaktor decyduje, czy zmienia zasade, czy widocznosc.
    panel({ visibility: "public", chatham_house: false });

    fireEvent.click(screen.getByRole("switch", { name: `${R}chathamHouseLabel` }));

    expect(screen.getByText(`${R}warnings.chathamHouseOnPublicPage`)).toBeInTheDocument();
    zapisz();

    await czekajNaZapis();
    expect(ladunek().chatham_house).toBe("true");
  });
});

describe("EventRegistrationSettingsPanel - ostrzezenia", () => {
  it("pierwszenstwo bez daty otwarcia zapisow nie robi NIC - i ekran to mowi", () => {
    panel({ rsvp_opens_at: "" });

    wpisz("earlyRankLabel", "2");

    // Lista ostrzezen w calosci, a nie samo „to zdanie gdzies jest": drugie
    // zdanie doklejone przez pomylke rozmywa to jedno, ktore ma znaczenie.
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      `${R}warnings.earlyRankWithoutOpening`,
    ]);
  });

  it("data otwarcia gasi ostrzezenie - lista ostrzezen znika w calosci", () => {
    panel({ rsvp_opens_at: "" });
    wpisz("earlyRankLabel", "2");

    fireEvent.change(pole("rsvpOpensLabel"), { target: { value: "2026-08-01T08:00:00.000Z" } });

    expect(screen.queryByText(`${R}warnings.earlyRankWithoutOpening`)).toBeNull();
  });

  it("wydarzenie bez powodu do ostrzezenia nie rysuje pustej listy", () => {
    panel({ visibility: "members", rsvp_opens_at: "" });

    expect(screen.queryByText(`${R}warnings.chathamHouseOnPublicPage`)).toBeNull();
    expect(screen.queryByText(`${R}warnings.earlyRankWithoutOpening`)).toBeNull();
    expect(screen.queryByText(`${R}warnings.onlineWithoutJoinUrl`)).toBeNull();
    // Pusta `<ul>` zostawilaby nad paskiem zapisu bursztynowy odstep bez tresci
    // - redaktor szukalby ostrzezenia, ktorego nie ma. Jedyna lista tego ekranu
    // to lista ostrzezen, wiec zero pozycji znaczy „nie narysowano jej wcale".
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("wydarzenie ONLINE z zapisami i bez adresu transmisji ostrzega - potwierdzenie prowadzi donikad", () => {
    // Format przychodzi z INNEGO ekranu, wiec to zdanie jest o PARZE ustawien
    // z dwoch formularzy i nie da sie go wyliczyc na zadnym z nich osobno.
    panel({ format: "online", join_url: "" });

    expect(screen.getByText(`${R}warnings.onlineWithoutJoinUrl`)).toBeInTheDocument();
  });
});

describe("EventRegistrationSettingsPanel - cena wejsciowki", () => {
  it("PRZECINEK Z KLAWIATURY NUMERYCZNEJ liczy sie na napisach, nie przez `Number * 100`", async () => {
    // `250.55 * 100` daje w JS 25055.000000000004; od zaokraglania groszy
    // zaczyna sie klasa bledow, ktorej nie widac przy okraglych kwotach.
    panel();

    wpisz("priceLabel", "250,55");
    zapisz();

    await czekajNaZapis();
    expect(ladunek().ticket_price_cents).toBe("25055");
  });

  it("kwota ponizej 1,00 nie dociera do bazy - CHECK `>= 100` groszy", () => {
    // RPC pilnuje tylko `>= 0`, wiec „0,50" przeszlo by walidacje funkcji
    // i wywalilo sie na tabeli. „Bezplatne" zapisuje sie PUSTYM polem.
    panel();

    wpisz("priceLabel", "0,50");
    zapisz();

    expect(screen.getByText(`${R}errors.priceTooLow`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  it("kwota nieczytelna („dwiescie”) nie dociera do bazy", () => {
    // Wydarzenie MA cene, wiec wpisanie napisu realnie zmienia szkic i pasek
    // zapisu wstaje - patrz defekt ponizej o wydarzeniu bezplatnym.
    panel({ ticket_price_cents: 25000 });

    wpisz("priceLabel", "dwiescie");
    zapisz();

    expect(screen.getByText(`${R}errors.priceInvalid`)).toBeInTheDocument();
    expect(stub().names()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: nieczytelna kwota wpisana w wydarzeniu BEZPLATNYM znika bez sladu.
  // „Czy jest co zapisac" liczy sie PORÓWNANIEM LADUNKOW
  // (`registrationSettingsDirty` zestawia dwa `registrationSettingsPayload`),
  // a ladunek zamienia kwote nieczytelna na PUSTY NAPIS - dokladnie taki sam,
  // jaki niesie pole puste. Szkic „dwiescie" jest wiec dla ekranu identyczny ze
  // szkicem zapisanym: pasek zapisu nie wstaje, `touched` zostaje na `false`,
  // wiec czerwone zdanie tez sie nie pokazuje. Redaktor wpisuje cene, nie widzi
  // ani bledu, ani przycisku, i wychodzi z ekranu przekonany, ze bilet kosztuje.
  // ---------------------------------------------------------------------------
  it("DEFEKT: nieczytelna kwota w wydarzeniu bezplatnym nie budzi ani paska zapisu, ani komunikatu", () => {
    panel();

    wpisz("priceLabel", "dwiescie");

    expect(przyciskZapisu()).not.toBeNull();
  });

  it("puste pole ceny jedzie jako pusty napis - wydarzenie BEZPLATNE, a nie za zero groszy", async () => {
    panel({ ticket_price_cents: 25000 });

    wpisz("priceLabel", "");
    zapisz();

    await czekajNaZapis();
    expect(ladunek().ticket_price_cents).toBe("");
  });

  it("zmiana waluty dojezdza do ladunku wielkimi literami - CHECK porownuje do „PLN”/„EUR”", async () => {
    panel();

    fireEvent.change(screen.getByLabelText(`${R}currencyLabel`), { target: { value: "EUR" } });
    zapisz();

    await czekajNaZapis();
    expect(ladunek().ticket_currency).toBe("EUR");
  });
});

describe("EventRegistrationSettingsPanel - ladunek zapisu", () => {
  it("wysyla KOMPLET POL TEGO EKRANU i ani jednego pola cudzego", async () => {
    // Ten ekran i „Informacje ogolne" pisza do jednej tabeli tym samym RPC.
    // Klucz nieobecny = pole nietkniete, wiec tytul i termin maja tu NIE
    // wystapic, a wszystkie dziesiec pol rejestracji - wystapic.
    panel({ capacity: 120, min_tier_rank: 2, join_url: "https://transmisja.example.org/kongres" });

    wpisz("capacityLabel", "150");
    zapisz();

    await czekajNaZapis();
    expect(Object.keys(ladunek()).sort()).toEqual([
      "capacity",
      "chatham_house",
      "early_rsvp_rank",
      "external_registration_url",
      "id",
      "join_url",
      "min_tier_rank",
      "recording_url",
      "registration_flow",
      "registration_mode",
      "rsvp_opens_at",
      "ticket_currency",
      "ticket_price_cents",
      "visibility",
    ]);
    expect(ladunek().id).toBe(STUDIO_EVENT_ID);
    expect(ladunek().min_tier_rank).toBe("2");
    expect(ladunek().join_url).toBe("https://transmisja.example.org/kongres");
  });

  it("idzie DOKLADNIE JEDNO wywolanie i pod nazwa `admin_event_general_save`", async () => {
    // Zawezenie tenantem siedzi w SQL (`assert_editor_tenant`) - tutaj
    // pilnujemy nazwy funkcji, bo pomylka w niej omija cala te bramke.
    panel();

    wpisz("capacityLabel", "150");
    zapisz();

    await czekajNaZapis();
    expect(stub().names()).toEqual([ZAPIS_RPC]);
  });

  it("udany zapis melduje sie WLASNYM kluczem, nie ogolnym „zapisano”", async () => {
    panel();

    wpisz("capacityLabel", "150");
    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "adminEvents.studio.toasts.registrationSettingsSaved",
    );
  });
});

describe("EventRegistrationSettingsPanel - szkic i pasek zapisu", () => {
  it("bez zmiany nie ma paska zapisu - ekran nie zaprasza do zapisania niczego", () => {
    panel();

    expect(przyciskZapisu()).toBeNull();
  });

  it("„Odrzuc zmiany” przywraca stan z bazy i chowa pasek", () => {
    panel({ capacity: 120 });

    wpisz("capacityLabel", "150");
    odrzuc();

    expect(pole("capacityLabel").value).toBe("120");
    expect(przyciskZapisu()).toBeNull();
  });

  it("„Odrzuc zmiany” gasi TAKZE czerwone zdania - ekran wraca do stanu sprzed proby", () => {
    panel();
    wpisz("capacityLabel", "-5");
    zapisz();
    expect(screen.getByText(`${R}errors.capacityInvalid`)).toBeInTheDocument();

    odrzuc();
    wpisz("capacityLabel", "-5");

    expect(screen.queryByText(`${R}errors.capacityInvalid`)).toBeNull();
  });

  it("nowy wiersz z serwera przestawia pola i chowa pasek - inaczej wisialby nad zapisanymi danymi", () => {
    const { rerender } = panel({ capacity: 120 });
    wpisz("capacityLabel", "150");
    expect(przyciskZapisu()).not.toBeNull();

    rerender(
      <Provider>
        <EventRegistrationSettingsPanel row={wiersz({ capacity: 150 })} />
      </Provider>,
    );

    expect(pole("capacityLabel").value).toBe("150");
    expect(przyciskZapisu()).toBeNull();
  });
});

describe("EventRegistrationSettingsPanel - dostepnosc", () => {
  it("ekran z danymi nie ma naruszen axe", async () => {
    const { container } = panel({
      capacity: 120,
      ticket_price_cents: 25000,
      join_url: "https://transmisja.example.org/kongres",
    });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("ekran z czerwonym zdaniem, ostrzezeniem i paskiem zapisu tez nie ma naruszen axe", async () => {
    const { container } = panel({ visibility: "public", chatham_house: true, rsvp_opens_at: "" });
    wpisz("capacityLabel", "-5");
    wpisz("earlyRankLabel", "2");
    zapisz();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

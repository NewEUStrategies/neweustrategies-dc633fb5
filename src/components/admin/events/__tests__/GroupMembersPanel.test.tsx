// Organizm „CZLONKOSTWA DODATKOWE" - ekran, na ktorym NADAJE SIE i ODBIERA
// uprawnienia jednej osobie.
//
// DLACZEGO TEN EKRAN JEST WRAZLIWY. Grupa dodatkowa nie zastepuje grupy
// z biletu, tylko DOKLADA uprawnienia: dostep do listy uczestnikow, do gieldy
// spotkan, do skanowania leadow. Klikniecie w niewlasciwym wierszu daje
// uprawnienia komus, kto ich nie kupil ani nie dostal od organizatora.
//
// CO TEN PLIK DOWODZI. Kazda regula jako PARA „moze / nie moze":
//   1. BEZ WYBRANEJ GRUPY NIE DA SIE NIC NADAC. Obie akcje sa wygaszone i nie
//      wolaja warstwy danych - inaczej pierwszy przycisk po wejsciu na ekran
//      wysylalby zadanie z pustym `group_id`, ktore baza odrzuca
//      `invalid_request`, a organizator czyta jak awarie ekranu.
//   2. PO WYBRANIU GRUPY OBIE AKCJE SA DOSTEPNE, a nadanie i odjecie ida ta
//      sama funkcja z roznym `is_member` - odjecie NIE MOZE isc bez tego
//      klucza, bo domyslna wartoscia po stronie SQL-a jest `true`.
//   3. AKCJA DOTYCZY TEJ OSOBY. Identyfikator idzie z klikanego wiersza, nie
//      z pierwszego na liscie.
//   4. LUDZI SZUKAMY WSROD ZAPISOW TEGO WYDARZENIA. Wyszukiwarka po calym
//      najemcy zapraszalaby do nadawania uprawnien osobom, ktore nie sa
//      zapisane - a wtedy uprawnienie wisi w wydarzeniu bez zgloszenia.
//   5. FRAZA JEDZIE Z OPOZNIENIEM. Zapytanie na kazdy znak to zapytanie
//      o kartoteke ludzi przy kazdym nacisnieciu klawisza.
//   6. CZTERY STANY LISTY MAJA CZTERY WIDOKI, a awaria NIE MOZE mowic „nikogo
//      nie znaleziono".
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Warstwy danych i kluczy pamieci podrecznej.
// (2) Listy zgloszen (`RegistrationsListPanel`) - tutaj jest atrapa, a
// przedmiotem dowodu jest O CO organizm pyta. (3) Slownika odmow bazy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { radixSelectStub } from "@/test/reactStubs";
import { axeViolations, summarize } from "@/test/axe";
import type { EventGroupRow, GroupMemberInput } from "@/lib/events/termsGroupsApi";
import type { EventRegistrationRow } from "@/lib/events/registrationsApi";

interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: Error) => void;
}

/** Zapytanie o zgloszenia - to, co organizm wysyla do warstwy danych. */
interface ZapytanieZgloszen {
  eventId: string;
  q: string;
  limit: number;
  groupId: string | null;
  status: string;
}

const h = vi.hoisted(() => ({
  language: "pl",
  groups: [] as unknown,
  rows: undefined as unknown,
  isLoading: false,
  listError: null as Error | null,
  zapytania: [] as unknown[],
  memberInputs: [] as unknown[],
  memberFails: null as string | null,
  memberPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));

vi.mock("@/lib/events/adminTermsErrors", () => ({
  adminTermsErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/lib/events/useEventTermsGroups", () => ({
  useEventGroups: () => ({ data: h.groups, isLoading: false, error: null }),
  useSetEventGroupMember: () => ({
    isPending: h.memberPending,
    mutate: (input: GroupMemberInput, res: Wynik<boolean>) => {
      h.memberInputs.push(input);
      if (h.memberFails !== null) res.onError?.(new Error(h.memberFails));
      else res.onSuccess?.(true);
    },
  }),
}));

vi.mock("@/lib/events/useEventRegistrations", () => ({
  useRegistrationsList: (query: ZapytanieZgloszen) => {
    h.zapytania.push(query);
    return {
      data: h.rows === undefined ? undefined : { rows: h.rows, total: 0 },
      isLoading: h.isLoading,
      error: h.listError,
    };
  },
}));

const { GroupMembersPanel } = await import("@/components/admin/events/organisms/GroupMembersPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const M = "adminEventTerms.members.";

function groupRow(overrides: Partial<EventGroupRow> = {}): EventGroupRow {
  return {
    attendee_visibility: "registered",
    can_chat: true,
    can_lead_retrieval: false,
    can_meet: true,
    can_see_attendees: true,
    can_see_recording: true,
    color: "#2563eb",
    created_at: "2026-08-01T09:00:00.000Z",
    description_en: "",
    description_pl: "",
    event_id: EVENT_ID,
    extra_members_count: 0,
    id: "grupa-a",
    is_default: false,
    is_system: false,
    key: "attendees",
    members_count: 0,
    min_tier_rank: 0,
    name_en: "Attendees",
    name_pl: "Uczestnicy",
    primary_members_count: 0,
    sort_order: 10,
    tickets_count: 0,
    updated_at: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

/**
 * Wiersz `admin_event_registrations_list`.
 *
 * Kolumny opcjonalne (`company_name`, `ticket_*`, `group_*`, znaczniki czasu
 * decyzji) przychodza z RPC jako `NULL`, choc sygnatura generowana z bazy
 * opisuje kazda jako niepusta - `RETURNS TABLE` nie niesie nullowalnosci.
 * Rzutowanie calego obiektu jest wiec wierne bazie, a nie obejsciem typu.
 */
function registrationRow(
  overrides: Partial<Record<keyof EventRegistrationRow, string | number | boolean | null>> = {},
): EventRegistrationRow {
  return {
    accepted_terms_count: 0,
    answers: null,
    attended_at: null,
    cancelled_at: null,
    company_id: null,
    company_name: null,
    company_text: "",
    consent_data_processing_at: "2026-08-01T10:00:00.000Z",
    consent_marketing_at: null,
    consent_partner_sharing_at: null,
    consent_withdrawn_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
    decided_at: null,
    decided_by: null,
    decision_note: "",
    decision_source: "",
    email: "anna.kowalska@example.org",
    event_id: EVENT_ID,
    extra_groups_count: 0,
    first_name: "Anna",
    group_color: "",
    group_id: null,
    group_key: null,
    group_name_en: null,
    group_name_pl: null,
    has_qr: false,
    id: "zgloszenie-a",
    job_title: "",
    last_name: "Kowalska",
    person_id: "osoba-a",
    person_user_id: null,
    phone: "",
    promoted_at: null,
    registration_mode: "form",
    required_terms_missing: 0,
    social_profile_url: "",
    source: "self_registration",
    status: "approved",
    ticket_currency: "PLN",
    ticket_key: null,
    ticket_name_en: null,
    ticket_name_pl: null,
    ticket_price_cents: 0,
    ticket_type_id: null,
    total_count: 1,
    waitlist_notified_at: null,
    waitlist_position: null,
    ...overrides,
  } as EventRegistrationRow;
}

function renderuj() {
  return render(<GroupMembersPanel eventId={EVENT_ID} />);
}

function wiersz(nazwisko: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(nazwisko) === true);
  if (li === undefined) throw new Error(`brak wiersza „${nazwisko}” na ekranie`);
  return li;
}

/** Wybiera grupe w dropliscie - bez tego zadna akcja nie jest dostepna. */
function wybierzGrupe(id: string): void {
  fireEvent.change(screen.getByLabelText(`${M}groupLabel`), { target: { value: id } });
}

function ostatnieZapytanie(): ZapytanieZgloszen {
  const last = h.zapytania.at(-1);
  if (last === undefined) throw new Error("organizm nie zapytal o zgloszenia");
  return last as ZapytanieZgloszen;
}

beforeEach(() => {
  h.language = "pl";
  h.groups = [groupRow({ id: "grupa-a", name_pl: "Uczestnicy" })];
  h.rows = [registrationRow()];
  h.isLoading = false;
  h.listError = null;
  h.zapytania = [];
  h.memberInputs = [];
  h.memberFails = null;
  h.memberPending = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("bez wybranej grupy nie da sie nic nadac", () => {
  // GRUPA JEST ADRESATEM UPRAWNIENIA. Zadanie z pustym `group_id` konczy sie
  // odmowa `invalid_request: group_id and person_id are required` - czyli
  // czerwonym zdaniem za cos, czego organizator jeszcze nie zdazyl wybrac.
  it("obie akcje sa WYGASZONE, dopoki grupa nie jest wybrana", () => {
    renderuj();
    const li = wiersz("Anna Kowalska");
    expect(within(li).getByText(`${M}addAction`).closest("button")?.hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      within(li).getByText(`${M}removeAction`).closest("button")?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("klikniecie wygaszonej akcji nie woła warstwy danych", () => {
    renderuj();
    fireEvent.click(
      within(wiersz("Anna Kowalska")).getByText(`${M}addAction`).closest("button") as HTMLElement,
    );
    expect(h.memberInputs).toEqual([]);
  });

  it("po wybraniu grupy obie akcje sa DOSTEPNE", () => {
    renderuj();
    wybierzGrupe("grupa-a");
    const li = wiersz("Anna Kowalska");
    expect(within(li).getByText(`${M}addAction`).closest("button")?.hasAttribute("disabled")).toBe(
      false,
    );
    expect(
      within(li).getByText(`${M}removeAction`).closest("button")?.hasAttribute("disabled"),
    ).toBe(false);
  });

  // TRWAJACE ZADANIE TEZ GASI OBIE AKCJE: dwa klikniecia to dwa zadania
  // o tym samym skutku, a przy „odejmij" drugie z nich odejmuje juz odjete.
  it("trwajace zadanie gasi obie akcje mimo wybranej grupy", () => {
    h.memberPending = true;
    renderuj();
    wybierzGrupe("grupa-a");
    const li = wiersz("Anna Kowalska");
    expect(within(li).getByText(`${M}addAction`).closest("button")?.hasAttribute("disabled")).toBe(
      true,
    );
  });
});

describe("nadanie i odjecie - para na tej samej funkcji", () => {
  it("„Dodaj” wysyla grupe, osobe i `isMember: true`", () => {
    renderuj();
    wybierzGrupe("grupa-a");
    fireEvent.click(within(wiersz("Anna Kowalska")).getByText(`${M}addAction`));
    expect(h.memberInputs).toEqual([{ groupId: "grupa-a", personId: "osoba-a", isMember: true }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventTerms.toasts.memberAdded");
  });

  // ODJECIE MUSI NIESC JAWNE `false`. Domyslna wartoscia po stronie SQL-a jest
  // `true`, wiec zadanie bez tego klucza DODAWALOBY uprawnienie zamiast je
  // zabierac - i to przy przycisku podpisanym „Odejmij".
  it("„Odejmij” wysyla to samo, ale z `isMember: false`", () => {
    renderuj();
    wybierzGrupe("grupa-a");
    fireEvent.click(within(wiersz("Anna Kowalska")).getByText(`${M}removeAction`));
    expect(h.memberInputs).toEqual([{ groupId: "grupa-a", personId: "osoba-a", isMember: false }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventTerms.toasts.memberRemoved");
  });

  // UPRAWNIENIE DOSTAJE TA OSOBA, KTORA KLIKNIETO. Pomylka wiersza to
  // uprawnienie nadane komus, kto go nie mial dostac - i nikt tego nie zauwazy,
  // bo obie osoby sa na tej samej liscie.
  it("akcja niesie identyfikator TEJ osoby, nie pierwszej z listy", () => {
    h.rows = [
      registrationRow({ id: "z-a", person_id: "osoba-a", first_name: "Anna" }),
      registrationRow({
        id: "z-b",
        person_id: "osoba-b",
        first_name: "Bartosz",
        last_name: "Nowak",
        email: "bartosz.nowak@example.org",
      }),
    ];
    renderuj();
    wybierzGrupe("grupa-a");
    fireEvent.click(within(wiersz("Bartosz Nowak")).getByText(`${M}addAction`));
    expect(h.memberInputs).toEqual([{ groupId: "grupa-a", personId: "osoba-b", isMember: true }]);
  });

  // ZMIANA GRUPY W DROPLISCIE ZMIENIA ADRESATA. Bez tego drugie nadanie
  // trafialoby do grupy wybranej na poczatku sesji.
  it("po zmianie grupy nadanie idzie do NOWEJ grupy", () => {
    h.groups = [
      groupRow({ id: "grupa-a", name_pl: "Uczestnicy" }),
      groupRow({ id: "grupa-b", name_pl: "Prelegenci" }),
    ];
    renderuj();
    wybierzGrupe("grupa-a");
    wybierzGrupe("grupa-b");
    fireEvent.click(within(wiersz("Anna Kowalska")).getByText(`${M}addAction`));
    expect(h.memberInputs).toEqual([{ groupId: "grupa-b", personId: "osoba-a", isMember: true }]);
  });

  it("droplista niesie wszystkie grupy wydarzenia", () => {
    h.groups = [
      groupRow({ id: "grupa-a", name_pl: "Uczestnicy" }),
      groupRow({ id: "grupa-b", name_pl: "Prelegenci" }),
    ];
    renderuj();
    const opcje = within(screen.getByLabelText(`${M}groupLabel`))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual(["Uczestnicy", "Prelegenci"]);
  });

  it("po angielsku droplista bierze nazwy angielskie", () => {
    h.language = "en";
    h.groups = [groupRow({ id: "grupa-a", name_pl: "Uczestnicy", name_en: "Attendees" })];
    renderuj();
    expect(
      within(screen.getByLabelText(`${M}groupLabel`))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Attendees"]);
  });

  // ODMOWA DOCHODZI ZDANIEM. Bez tego nieudane nadanie wyglada jak udane -
  // a organizator idzie dalej w przekonaniu, ze osoba ma juz uprawnienia.
  it("odmowa bazy dochodzi zdaniem i nie mowi o sukcesie", () => {
    h.memberFails = "not_found: person does not exist in this tenant";
    renderuj();
    wybierzGrupe("grupa-a");
    fireEvent.click(within(wiersz("Anna Kowalska")).getByText(`${M}addAction`));
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:not_found: person does not exist in this tenant",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("ludzi szukamy wsrod zapisow TEGO wydarzenia", () => {
  // OSOBA BEZ ZAPISU NIE MA PO CO DOSTAWAC UPRAWNIEN WYDARZENIA. Zapytanie
  // musi wiec byc zawezone do zgloszen tego wydarzenia, a nie do kartoteki
  // calego najemcy.
  it("zapytanie o ludzi jest zawezone do tego wydarzenia", () => {
    renderuj();
    expect(ostatnieZapytanie().eventId).toBe(EVENT_ID);
  });

  it("zapytanie bierze krotka strone wynikow, a nie cala liste zapisow", () => {
    renderuj();
    expect(ostatnieZapytanie().limit).toBe(20);
  });

  it("na starcie fraza jest pusta - ekran nie zaweza niczego z gory", () => {
    renderuj();
    expect(ostatnieZapytanie().q).toBe("");
  });

  it("wiersz osoby niesie imie, nazwisko i adres kontaktowy", () => {
    renderuj();
    const li = wiersz("Anna Kowalska");
    expect(within(li).getByText(/anna\.kowalska@example\.org/)).toBeTruthy();
  });

  // LICZNIK GRUP DODATKOWYCH MOWI, ZE OSOBA JUZ COS DOSTALA. Bez niego
  // organizator nadaje to samo uprawnienie drugi raz (operacja jest
  // idempotentna, ale ekran przestaje mowic prawde o stanie).
  it("osoba z grupami dodatkowymi ma licznik, a osoba bez nich go nie ma", () => {
    h.rows = [
      registrationRow({ id: "z-a", first_name: "Anna", extra_groups_count: 2 }),
      registrationRow({
        id: "z-b",
        first_name: "Bartosz",
        last_name: "Nowak",
        email: "bartosz.nowak@example.org",
        extra_groups_count: 0,
      }),
    ];
    renderuj();
    expect(
      within(wiersz("Anna Kowalska")).getByText("adminEventTerms.labels.extraMembers: 2"),
    ).toBeTruthy();
    expect(within(wiersz("Bartosz Nowak")).queryByText(/extraMembers/)).toBeNull();
  });
});

describe("fraza jedzie z opoznieniem", () => {
  // ZAPYTANIE NA KAZDY ZNAK to zapytanie o kartoteke ludzi przy kazdym
  // nacisnieciu klawisza. Opoznienie jest tu regula, nie optymalizacja.
  it("tuz po wpisaniu zapytanie NIE ma jeszcze nowej frazy", () => {
    vi.useFakeTimers();
    try {
      renderuj();
      fireEvent.change(screen.getByLabelText(`${M}search`), { target: { value: "kowalska" } });
      expect(ostatnieZapytanie().q).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("po uspokojeniu sie pisania fraza dojezdza do zapytania", () => {
    vi.useFakeTimers();
    try {
      renderuj();
      fireEvent.change(screen.getByLabelText(`${M}search`), { target: { value: "kowalska" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(ostatnieZapytanie().q).toBe("kowalska");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cztery stany listy ludzi", () => {
  it("wczytywanie pokazuje postep i NIE mowi o pustce", () => {
    h.rows = undefined;
    h.isLoading = true;
    renderuj();
    expect(screen.getByText(`${M}loading`)).toBeTruthy();
    expect(screen.queryByText(`${M}empty`)).toBeNull();
  });

  // „NIKOGO NIE ZNALEZIONO" PO ODMOWIE prowadzi organizatora do wniosku, ze
  // osoba nie jest zapisana - a wtedy zaklada jej drugie zgloszenie.
  it("awaria mowi trescia odmowy i NIE mowi o pustce", () => {
    h.rows = undefined;
    h.listError = new Error("forbidden: editor role required");
    renderuj();
    expect(screen.getByText("odmowa:forbidden: editor role required")).toBeTruthy();
    expect(screen.queryByText(`${M}empty`)).toBeNull();
  });

  it("wczytywanie po nieudanej probie bije awarie", () => {
    h.rows = undefined;
    h.isLoading = true;
    h.listError = new Error("registrations_failed");
    renderuj();
    expect(screen.getByText(`${M}loading`)).toBeTruthy();
    expect(screen.queryByText("odmowa:registrations_failed")).toBeNull();
  });

  it("pustka mowi to wprost i nie rysuje ani jednego wiersza", () => {
    h.rows = [];
    renderuj();
    expect(screen.getByText(`${M}empty`)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});

describe("dostepnosc", () => {
  it("ekran czlonkostw nie ma naruszen dostepnosci", async () => {
    h.groups = [
      groupRow({ id: "grupa-a", name_pl: "Uczestnicy" }),
      groupRow({ id: "grupa-b", name_pl: "Prelegenci" }),
    ];
    h.rows = [registrationRow({ extra_groups_count: 2 })];
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan awarii nie ma naruszen dostepnosci", async () => {
    h.rows = undefined;
    h.listError = new Error("forbidden: editor role required");
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("droplista grup zanim grupy dojada - para „pusto / gotowe”", () => {
  // ZANIM ODPOWIE ZAPYTANIE O GRUPY, `groupsQ.data` jest `undefined`. Bez
  // domkniecia `?? []` ekran wywracalby sie na `map` - a to jest ten sam ekran,
  // ktory administrator otwiera, zeby dopisac kogos do grupy tuz przed
  // wydarzeniem. Para: pusto (nie ma czego nadac) obok gotowe (mozna nadac).
  it("bez odpowiedzi o grupy droplista nie ma ani jednej pozycji, a akcje sa wygaszone", () => {
    h.groups = undefined;
    renderuj();
    expect(within(screen.getByLabelText(`${M}groupLabel`)).queryAllByRole("option")).toEqual([]);
    expect(
      within(wiersz("Anna Kowalska"))
        .getByText(`${M}addAction`)
        .closest("button")
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("po dojechaniu grup droplista ma pozycje, a akcja daje sie nadac", () => {
    renderuj();
    expect(
      within(screen.getByLabelText(`${M}groupLabel`)).queryAllByRole("option").length,
    ).toBeGreaterThan(0);
    wybierzGrupe("grupa-a");
    fireEvent.click(
      within(wiersz("Anna Kowalska")).getByText(`${M}addAction`).closest("button") as HTMLElement,
    );
    expect(h.memberInputs).toHaveLength(1);
  });
});

describe("nazwa grupy w dropliscie - para „ma tlumaczenie / nie ma”", () => {
  // GRUPA BEZ NAZWY W JEZYKU EKRANU NIE MOZE BYC PUSTA POZYCJA. Droplista jest
  // jedynym miejscem, w ktorym administrator wybiera ADRESATA uprawnienia -
  // pusty napis znaczy „nadalem cos, nie wiem czemu". Baza wymaga obu nazw
  // (`invalid_names`), ale wiersze sprzed tego wymogu nadal siedza w tabeli.
  it("po polsku grupa bez nazwy polskiej pokazuje nazwe angielska", () => {
    h.language = "pl";
    h.groups = [groupRow({ id: "grupa-b", name_pl: "", name_en: "Speakers" })];
    renderuj();
    expect(within(screen.getByLabelText(`${M}groupLabel`)).getByText("Speakers")).toBeTruthy();
  });

  it("po angielsku grupa bez nazwy angielskiej pokazuje nazwe polska", () => {
    h.language = "en";
    h.groups = [groupRow({ id: "grupa-b", name_pl: "Prelegenci", name_en: "" })];
    renderuj();
    expect(within(screen.getByLabelText(`${M}groupLabel`)).getByText("Prelegenci")).toBeTruthy();
  });

  it("grupa z obiema nazwami bierze te z jezyka ekranu, a nie zapasowa", () => {
    h.language = "en";
    h.groups = [groupRow({ id: "grupa-b", name_pl: "Prelegenci", name_en: "Speakers" })];
    renderuj();
    const droplista = screen.getByLabelText(`${M}groupLabel`);
    expect(within(droplista).getByText("Speakers")).toBeTruthy();
    expect(within(droplista).queryByText("Prelegenci")).toBeNull();
  });
});

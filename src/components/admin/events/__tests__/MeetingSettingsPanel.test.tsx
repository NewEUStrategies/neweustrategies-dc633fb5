// Organizm „Ustawienia giełdy spotkań 1:1" - SKLEJENIE odczytu RPC, reguł
// szkicu i dwudziestu pól formularza.
//
// CO TEN PLIK DOWODZI.
//   1. STANY ODCZYTU SĄ ROZRÓŻNIALNE. Wczytywanie, awaria i dane to trzy różne
//      informacje dla organizatora: pierwsza każe czekać, druga odświeżyć,
//      trzecia pozwala pracować. Panel ma na to trzy gałęzie - i jedna z nich
//      (awaria PIERWSZEGO odczytu) jest nieosiągalna, co ten plik zgłasza
//      przez `it.fails`, a nie przykrywa testem zatwierdzającym.
//   2. KAŻDA PUŁAPKA SIATKI MA WIDOCZNY SKUTEK. Koniec dnia przed początkiem,
//      okno krótsze od jednego spotkania i długość slotu spoza zakresu to trzy
//      różne sposoby na giełdę, która wygląda na włączoną i nie ma ani jednego
//      terminu. Każdy z nich musi ZATRZYMAĆ zapis, a nie tylko pokazać zdanie.
//   3. PODGLĄD SIATKI LICZY SIĘ PRZED ZAPISEM. „19 slotów na dzień" bierze się
//      z tych samych czterech liczb, z których policzy je Postgres - więc
//      zmiana długości spotkania musi zmienić tę liczbę NATYCHMIAST.
//   4. ŁADUNEK JEST TYM, CO ZOBACZY BAZA. Puste pole opcjonalne jedzie jako
//      `null` (bez limitu), a nie jako pusty napis ani zero (limit zerowy =
//      giełda martwa), strefa jest obcięta z białych znaków, a przydział grup
//      jedzie WYŁĄCZNIE przy regule `groups`.
//   5. ZAPIS JEST JEDNORAZOWY. Trwający zapis blokuje przycisk, więc podwójne
//      kliknięcie nie zakłada drugiej konfiguracji; odmowa serwera zostawia
//      wpisane wartości na ekranie, bo inaczej organizator traci całą pracę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tabeli reguł szkicu (`validateSettingsDraft`,
// `settingsInputFromDraft`, `slotsPerDay`, `draftFromSettings`) - jest
// w `lib/events/__tests__/meetingsSettingsDraft.test.ts`; tutaj dowodzimy, że
// organizm ich UŻYWA i że skutek widać na ekranie. (2) Mapowania odmów bazy -
// `lib/events/__tests__/adminMeetingErrors.test.ts`. (3) Zachowania hooków -
// są zamockowane na poziomie MODUŁU, bo przedmiotem dowodu jest to, CO panel
// do nich wysyła. Radix `Select` i `Switch` są podmienione na kontrolki
// natywne: pod happy-dom nie ma pełnego API wskaźnika, więc popup Radiksa nie
// otwiera się wcale.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MeetingRuleGroup, MeetingSettings } from "@/lib/events/meetingsApi";
import type { MeetingSettingsInput } from "@/lib/events/meetingsApi";

const h = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  error: null as Error | null,
  /** Ładunki, które panel wysłał do warstwy zapisu - asercje idą TUTAJ. */
  inputs: [] as unknown[],
  /** Domknięcie kończące trwający zapis; ustawia je atrapa mutacji. */
  settle: null as ((outcome: "ok" | "fail") => void) | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Mapowanie odmów bazy ma własny plik testowy, a jego prawdziwa wersja ciągnie
// pełną instancję i18n - tutaj liczy się wyłącznie to, że panel pokazuje TO,
// co mapowanie zwróciło.
vi.mock("@/lib/events/adminMeetingErrors", () => ({
  adminMeetingFailure: (error: unknown) => ({
    key: "adminEventMeetings.errors.unknown",
    params: { detail: error instanceof Error ? error.message : String(error) },
  }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked ?? false}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

// Atrapa warstwy danych trzyma STAN OCZEKIWANIA w Reakcie, a nie w zmiennej
// modułu: tylko wtedy pierwsze kliknięcie realnie przerysowuje przycisk
// i drugie kliknięcie ma o co się odbić.
vi.mock("@/lib/events/useMeetings", async () => {
  const { useState } = await import("react");
  return {
    useMeetingSettings: () => ({ data: h.data, isLoading: h.isLoading, error: h.error }),
    useSaveMeetingSettings: () => {
      const [pending, setPending] = useState(false);
      return {
        isPending: pending,
        mutate: (
          input: unknown,
          opts?: { onSuccess?: (value: unknown) => void; onError?: (error: Error) => void },
        ) => {
          h.inputs.push(input);
          setPending(true);
          h.settle = (outcome) => {
            setPending(false);
            if (outcome === "ok") opts?.onSuccess?.(h.data);
            else opts?.onError?.(new Error("invalid_timezone: Europe/Nowhere"));
          };
        },
      };
    },
  };
});

const { MeetingSettingsPanel } =
  await import("@/components/admin/events/organisms/MeetingSettingsPanel");

const EVENT_ID = "7f3c1d20-0000-4000-8000-00000000ev01";
const S = "adminEventMeetings.settings.";

function group(overrides: Partial<MeetingRuleGroup> & { group_id: string }): MeetingRuleGroup {
  return {
    key: overrides.group_id,
    name_pl: "Delegaci",
    name_en: "Delegates",
    can_meet: true,
    can_lead_retrieval: false,
    ...overrides,
  };
}

/**
 * Odpowiedź `admin_event_meeting_settings_get` - komplet kolumn sygnatury.
 * Atrapa węższa od kontraktu przestałaby się kompilować przy pierwszym nowym
 * polu RPC i to jest ZALETA, nie koszt.
 */
function settings(overrides: Partial<MeetingSettings> = {}): MeetingSettings {
  return {
    configured: true,
    event_id: EVENT_ID,
    event_timezone: "Europe/Warsaw",
    is_enabled: true,
    slot_minutes: 20,
    break_minutes: 5,
    day_start_time: "09:00:00",
    day_end_time: "17:00:00",
    // Kolejność Z BAZY jest odwrotna do alfabetycznej - panel ma ją posortować.
    meeting_days: ["2026-09-02", "2026-09-01"],
    timezone: "Europe/Warsaw",
    invites_open_at: null,
    invites_close_at: null,
    max_invites_per_person: null,
    max_meetings_per_day: null,
    invite_expires_after_hours: 72,
    visibility: "everyone",
    intro_pl: "Zapraszamy do umawiania spotkań.",
    intro_en: "Book your meetings.",
    updated_at: null,
    requester_groups: [],
    invitee_groups: [],
    available_groups: [
      group({ group_id: "grp-delegaci", key: "delegates" }),
      group({
        group_id: "grp-prasa",
        key: "press",
        name_pl: "Prasa",
        name_en: "Press",
        can_meet: false,
      }),
    ],
    tables_count: 4,
    seats_count: 8,
    participants_count: 30,
    with_availability_count: 12,
    ...overrides,
  };
}

function panel(row: MeetingSettings | undefined = settings()) {
  h.data = row;
  return render(<MeetingSettingsPanel eventId={EVENT_ID} />);
}

/** Pole formularza po kluczu etykiety - dokładnie tak, jak znajduje je czytnik. */
function pole(labelKey: string): HTMLInputElement | HTMLTextAreaElement {
  const found = screen.getByLabelText(`${S}${labelKey}`);
  if (!(found instanceof HTMLInputElement) && !(found instanceof HTMLTextAreaElement)) {
    throw new Error(`test: ${labelKey} nie jest polem tekstowym`);
  }
  return found;
}

function wpisz(labelKey: string, value: string): void {
  fireEvent.change(pole(labelKey), { target: { value } });
}

function przyciskZapisu(): HTMLButtonElement {
  const found = screen.getByRole("button", { name: `${S}saveAction` });
  if (!(found instanceof HTMLButtonElement)) throw new Error("test: zapis nie jest przyciskiem");
  return found;
}

/** Lista widocznych powodów odrzucenia - klucze, nie napisy. */
function bledy(): string[] {
  return screen
    .queryAllByRole("listitem")
    .map((item) => item.textContent ?? "")
    .filter((text) => text.startsWith("adminEventMeetings.errors."));
}

function ostatniLadunek(): MeetingSettingsInput {
  const last = h.inputs.at(-1);
  if (last === undefined) throw new Error("test: warstwa zapisu nie dostała nic");
  return last as MeetingSettingsInput;
}

/** Droplista reguły - identyfikowana po wartości jednej ze swoich opcji. */
function droplistaReguly(): HTMLSelectElement {
  const found = Array.from(document.querySelectorAll("select")).find((select) =>
    Array.from(select.options).some((option) => option.value === "groups"),
  );
  if (found === undefined) throw new Error("test: brak droplisty reguły");
  return found;
}

/**
 * Pole wyboru grupy w danej kolumnie.
 *
 * Dopasowanie jest PRZEDROSTKIEM, nie całym napisem: etykieta grupy, która nie
 * może się spotykać, niesie obok nazwy jeszcze znacznik ostrzegawczy.
 */
function grupa(kolumna: HTMLElement, nazwa: string): HTMLElement {
  return within(kolumna).getByLabelText(new RegExp(`^${nazwa}`));
}

/** Kolumna przydziału grup (strona zapraszająca albo zapraszana). */
function kolumnaGrup(labelKey: "requesterGroupsLabel" | "inviteeGroupsLabel"): HTMLElement {
  const heading = screen.getByText(`${S}${labelKey}`);
  const box = heading.parentElement;
  if (box === null) throw new Error(`test: kolumna ${labelKey} bez kontenera`);
  return box;
}

beforeEach(() => {
  cleanup();
  h.data = undefined;
  h.isLoading = false;
  h.error = null;
  h.inputs = [];
  h.settle = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("MeetingSettingsPanel - stany odczytu", () => {
  it("odczyt W LOCIE mówi „wczytuję” i nie pokazuje ani jednego pola", () => {
    h.isLoading = true;
    panel(undefined);

    expect(screen.getByText(`${S}loading`)).toBeTruthy();
    // Formularz z pustymi polami w trakcie odczytu zaprasza do wpisywania
    // wartości, które za sekundę zostaną nadpisane odpowiedzią RPC.
    expect(screen.queryByLabelText(`${S}slotMinutesLabel`)).toBeNull();
    expect(screen.queryByRole("button", { name: `${S}saveAction` })).toBeNull();
  });

  // ZNALEZISKO, NIE BRAK TESTU. Straż wczytywania brzmi
  // `settingsQ.isLoading || draft === null`, a szkic powstaje WYŁĄCZNIE
  // z `settingsQ.data`. Gdy pierwszy odczyt padnie, dane nigdy nie przychodzą,
  // więc `draft` zostaje `null` i panel stoi na kręcącym się kółku BEZ KOŃCA -
  // gałąź `settingsQ.error !== null` dwa wiersze niżej jest wtedy nieosiągalna.
  // Organizator widzi „wczytuję" zamiast „nie udało się", więc czeka i odświeża
  // zamiast zgłosić awarię. To ta sama klasa błędu, którą naprawiono już na
  // trzech ekranach tego modułu (patrz „trzy stany pustej listy"
  // w `EventPagesMenuPanel.test.tsx`).
  it("awaria PIERWSZEGO odczytu mówi „nie udało się”, a nie kręci kółkiem", () => {
    // `h.data` USTAWIAMY WPROST, a nie przez `panel(undefined)`. Pomocnik ma
    // parametr domyślny (`row = settings()`), więc jawne `undefined` PODSTAWIA
    // pełny wiersz - scenariusz „pierwszy odczyt padł, danych nie ma" był przez
    // niego nieosiągalny, a test, który go opisywał, przechodził wyłącznie
    // dlatego, że oczekiwał złego napisu.
    h.isLoading = false;
    h.error = new Error("invalid_timezone: Europe/Nowhere");
    h.data = undefined;
    render(<MeetingSettingsPanel eventId={EVENT_ID} />);

    // Kółko ZNIKA - to jest cała naprawa. Straż wczytywania brzmiała
    // `isLoading || draft === null`, a szkic powstaje wyłącznie z danych, więc
    // przy padniętym PIERWSZYM odczycie `draft` zostawał `null` i panel kręcił
    // kółkiem bez końca; gałąź awarii była w tym scenariuszu NIEOSIĄGALNA.
    expect(screen.queryByText(`${S}loading`)).toBeNull();
    expect(
      screen.getByText((text) => text.startsWith("adminEventMeetings.errors.unknown")),
    ).toBeTruthy();
  });

  it("awaria PO wczytaniu danych zdejmuje formularz i pokazuje zdanie o odmowie", () => {
    // Jedyna osiągalna droga do gałęzi błędu: dane już są w pamięci podręcznej,
    // a odświeżenie w tle padło. Formularz znika w całości - to jest CENA tej
    // gałęzi i powód, dla którego stan awarii musi być rozróżnialny.
    h.error = new Error("invalid_timezone: Europe/Nowhere");
    panel();

    // Atrapa i18n dokleja parametry do klucza (`klucz(nazwa=wartość)`), więc
    // pytamy o POCZĄTEK napisu. W produkcji `unknown` nie ma miejsca na
    // `{{detail}}`, więc i18next ten parametr po prostu pomija - zdanie jest
    // to samo z parametrami i bez nich.
    expect(
      screen.getByText((text) => text.startsWith("adminEventMeetings.errors.unknown")),
    ).toBeTruthy();
    expect(screen.queryByLabelText(`${S}slotMinutesLabel`)).toBeNull();
  });

  // ZNALEZISKO TREŚCIOWE. Odmowy tego modułu mają w słowniku miejsca na dane
  // z bazy („Nieznana strefa czasowa: {{timezone}}."), a `adminMeetingFailure`
  // te dane wyjmuje z komunikatu i oddaje w `params`. Toast zapisu je podaje;
  // zdanie o nieudanym ODCZYCIE wywołuje `t(failure.key)` BEZ parametrów, więc
  // organizator czyta zdanie z pustą dziurą („Nieznana strefa czasowa: .")
  // i nie dowiaduje się, KTÓRA strefa jest nieznana. Naprawa to jeden argument
  // w wywołaniu `t`, ale zmienia treść ekranu - dlatego zgłoszenie, nie poprawka.
  it("zdanie o awarii niesie parametry odmowy, tak jak toast", () => {
    h.error = new Error("invalid_timezone: Europe/Nowhere");
    panel();

    expect(
      screen.getByText(
        "adminEventMeetings.errors.unknown(detail=invalid_timezone: Europe/Nowhere)",
      ),
    ).toBeTruthy();
  });

  it("DANE pokazują formularz wypełniony odpowiedzią RPC, z dniami POSORTOWANYMI", () => {
    panel();

    expect(pole("slotMinutesLabel").value).toBe("20");
    expect(pole("breakMinutesLabel").value).toBe("5");
    // `HH:MM:SS` z bazy nie wejdzie do `<input type="time">` - panel skraca.
    expect(pole("dayStartLabel").value).toBe("09:00");
    expect(pole("dayEndLabel").value).toBe("17:00");
    expect(pole("timezoneLabel").value).toBe("Europe/Warsaw");
    expect(pole("expiryHoursLabel").value).toBe("72");
    expect(pole("introPlLabel").value).toBe("Zapraszamy do umawiania spotkań.");
    expect(pole("introEnLabel").value).toBe("Book your meetings.");
    expect(screen.queryByText(`${S}loading`)).toBeNull();

    const dni = screen.getAllByLabelText(/adminEventMeetings\.tables\.deleteAction/);
    expect(dni.map((button) => button.getAttribute("aria-label"))).toEqual([
      "adminEventMeetings.tables.deleteAction 2026-09-01",
      "adminEventMeetings.tables.deleteAction 2026-09-02",
    ]);
  });

  it("brak limitów w bazie zostawia pola PUSTE z podpowiedzią „bez limitu”", () => {
    panel();
    expect(pole("maxInvitesLabel").value).toBe("");
    expect(pole("maxInvitesLabel").getAttribute("placeholder")).toBe(`${S}unlimited`);
    expect(pole("maxDailyLabel").value).toBe("");
  });
});

describe("MeetingSettingsPanel - siatka slotów", () => {
  it("podgląd siatki liczy sloty PRZED zapisem: 19 na dzień, 38 na dwa dni", () => {
    panel();
    expect(screen.getByText(`${S}gridPreview(perDay=19,slots=38)`)).toBeTruthy();
  });

  it("zmiana długości spotkania przelicza podgląd NATYCHMIAST", () => {
    // Bez tego organizator zapisuje konfigurację i sprawdza jej skutek metodą
    // prób na ekranie uczestnika.
    panel();
    wpisz("slotMinutesLabel", "60");
    expect(screen.getByText(`${S}gridPreview(perDay=7,slots=14)`)).toBeTruthy();
  });

  it("przesunięcie POCZĄTKU dnia też przelicza siatkę - obie godziny są żywe", () => {
    // Kontrapunkt dla testu wyżej: gdyby panel czytał tylko koniec dnia,
    // „siatka liczy się na żywo" przechodziłoby na formularzu, w którym
    // wcześniejsze otwarcie dnia nie daje ani jednego dodatkowego terminu.
    panel();
    wpisz("dayStartLabel", "08:00");
    expect(screen.getByText(`${S}gridPreview(perDay=21,slots=42)`)).toBeTruthy();
  });

  it("koniec dnia PRZED początkiem zeruje siatkę, nazywa błąd i ZATRZYMUJE zapis", () => {
    panel();
    wpisz("dayEndLabel", "08:00");

    expect(bledy()).toContain("adminEventMeetings.errors.dayOrder");
    expect(screen.getByText(`${S}gridPreview(perDay=0,slots=0)`)).toBeTruthy();
    expect(przyciskZapisu().disabled).toBe(true);
    fireEvent.click(przyciskZapisu());
    expect(h.inputs).toHaveLength(0);
  });

  it("dzień KRÓTSZY niż jedno spotkanie ma INNY komunikat niż odwrócony dzień", () => {
    // Oba przypadki dają zero slotów, ale poprawia się je inaczej: raz zamianą
    // godzin, raz skróceniem spotkania. Jeden komunikat na dwa błędy kazałby
    // zgadywać, który to przypadek.
    panel();
    wpisz("dayEndLabel", "09:15");

    expect(bledy()).toContain("adminEventMeetings.errors.dayFitsSlot");
    expect(bledy()).not.toContain("adminEventMeetings.errors.dayOrder");
    expect(przyciskZapisu().disabled).toBe(true);
  });

  it("długość spotkania PONIŻEJ zakresu zatrzymuje zapis", () => {
    panel();
    wpisz("slotMinutesLabel", "3");
    expect(bledy()).toContain("adminEventMeetings.errors.slotRange");
    expect(przyciskZapisu().disabled).toBe(true);
  });

  it("długość spotkania POWYŻEJ zakresu zatrzymuje zapis", () => {
    panel();
    wpisz("slotMinutesLabel", "500");
    expect(bledy()).toContain("adminEventMeetings.errors.slotRange");
    expect(przyciskZapisu().disabled).toBe(true);
  });

  it("pole liczbowe znosi SKASOWANIE ostatniej cyfry, zamiast zamarzać na `NaN`", () => {
    // Kontrolowany input z liczbą (a nie napisem) przestaje reagować po
    // wyczyszczeniu - to jest powód, dla którego szkic trzyma napisy.
    panel();
    wpisz("slotMinutesLabel", "");
    expect(pole("slotMinutesLabel").value).toBe("");
    expect(bledy()).toContain("adminEventMeetings.errors.slotRange");
    wpisz("slotMinutesLabel", "45");
    expect(pole("slotMinutesLabel").value).toBe("45");
    expect(bledy()).toHaveLength(0);
  });

  it("przerwa dłuższa niż dopuszczalna zatrzymuje zapis", () => {
    panel();
    wpisz("breakMinutesLabel", "200");
    expect(bledy()).toContain("adminEventMeetings.errors.breakRange");
    expect(przyciskZapisu().disabled).toBe(true);
  });
});

describe("MeetingSettingsPanel - okno zaproszeń", () => {
  it("zamknięcie PRZED otwarciem zatrzymuje zapis", () => {
    panel();
    wpisz("opensAtLabel", "2026-09-01T09:00");
    wpisz("closesAtLabel", "2026-08-30T09:00");

    expect(bledy()).toContain("adminEventMeetings.errors.invitesWindow");
    expect(przyciskZapisu().disabled).toBe(true);
    fireEvent.click(przyciskZapisu());
    expect(h.inputs).toHaveLength(0);
  });

  it("okno BEZ końca jest poprawne, a brak terminu jedzie jako `null`", () => {
    // Pusty napis w kolumnie `timestamptz` to nie jest „koniec o północy" -
    // to jest brak końca. Asercja idzie na ŁADUNKU, bo na ekranie oba
    // przypadki wyglądają identycznie.
    panel();
    wpisz("opensAtLabel", "2026-09-01T09:00");

    expect(bledy()).toHaveLength(0);
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().invitesOpenAt).toBe(new Date("2026-09-01T09:00").toISOString());
    expect(ostatniLadunek().invitesCloseAt).toBeNull();
  });

  it("oba terminy razem jadą jako ISO, nie jako napis z pola", () => {
    panel();
    wpisz("opensAtLabel", "2026-09-01T09:00");
    wpisz("closesAtLabel", "2026-09-10T18:30");
    fireEvent.click(przyciskZapisu());

    expect(ostatniLadunek().invitesOpenAt).toBe(new Date("2026-09-01T09:00").toISOString());
    expect(ostatniLadunek().invitesCloseAt).toBe(new Date("2026-09-10T18:30").toISOString());
  });
});

describe("MeetingSettingsPanel - limity, strefa i wygaśnięcie", () => {
  it("PUSTE limity jadą jako `null`, a nie jako zero", () => {
    // Zero w `max_invites_per_person` znaczy „nikt nie może zaprosić nikogo",
    // czyli giełda włączona i martwa. To jest dokładnie ta pomyłka, której
    // na ekranie nie widać.
    panel();
    fireEvent.click(przyciskZapisu());

    expect(ostatniLadunek().maxInvitesPerPerson).toBeNull();
    expect(ostatniLadunek().maxMeetingsPerDay).toBeNull();
  });

  it("wpisane limity jadą jako LICZBY, nie jako napisy z pola", () => {
    panel();
    wpisz("maxInvitesLabel", "12");
    wpisz("maxDailyLabel", "4");
    fireEvent.click(przyciskZapisu());

    expect(ostatniLadunek().maxInvitesPerPerson).toBe(12);
    expect(ostatniLadunek().maxMeetingsPerDay).toBe(4);
  });

  it("limit spoza zakresu zatrzymuje zapis", () => {
    panel();
    wpisz("maxInvitesLabel", "0");
    expect(bledy()).toContain("adminEventMeetings.errors.limitRange");
    expect(przyciskZapisu().disabled).toBe(true);
  });

  it("PUSTA strefa zatrzymuje zapis - kolumna w bazie jej nie przyjmie", () => {
    panel();
    wpisz("timezoneLabel", "   ");
    expect(bledy()).toContain("adminEventMeetings.errors.invalidTimezone");
    expect(przyciskZapisu().disabled).toBe(true);
    fireEvent.click(przyciskZapisu());
    expect(h.inputs).toHaveLength(0);
  });

  it("strefa jedzie do bazy OBCIĘTA z białych znaków", () => {
    panel();
    wpisz("timezoneLabel", "  Europe/Brussels  ");
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().timezone).toBe("Europe/Brussels");
  });

  it("wygaśnięcie zaproszenia spoza zakresu zatrzymuje zapis", () => {
    panel();
    wpisz("expiryHoursLabel", "0");
    expect(bledy()).toContain("adminEventMeetings.errors.expiryRange");
    expect(przyciskZapisu().disabled).toBe(true);
  });
});

describe("MeetingSettingsPanel - dni giełdy", () => {
  /** Pole daty i przycisk dodania stoją obok siebie i mają ten sam klucz. */
  function dodajDzien(day: string): void {
    fireEvent.change(screen.getByLabelText(`${S}daysLabel`), { target: { value: day } });
    fireEvent.click(screen.getByRole("button", { name: `${S}daysLabel` }));
  }

  function dni(): string[] {
    return screen
      .getAllByLabelText(/adminEventMeetings\.tables\.deleteAction/)
      .map((button) => (button.getAttribute("aria-label") ?? "").split(" ").at(-1) ?? "");
  }

  it("nowy dzień ląduje w kolejności KALENDARZOWEJ, nie na końcu listy", () => {
    panel();
    dodajDzien("2026-08-31");
    expect(dni()).toEqual(["2026-08-31", "2026-09-01", "2026-09-02"]);
  });

  it("dzień JUŻ dodany nie dubluje się, a pole nie czyści się po odmowie", () => {
    // Dwa te same dni w `meeting_days` znaczą podwójną siatkę na ten sam dzień.
    panel();
    dodajDzien("2026-09-01");
    expect(dni()).toEqual(["2026-09-01", "2026-09-02"]);
    expect(screen.getByLabelText(`${S}daysLabel`)).toHaveValue("2026-09-01");
  });

  it("puste pole daty nie dokłada pozycji", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: `${S}daysLabel` }));
    expect(dni()).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("krzyżyk przy dniu usuwa TEN dzień, a nie całą listę", () => {
    panel();
    fireEvent.click(screen.getByLabelText("adminEventMeetings.tables.deleteAction 2026-09-01"));
    expect(dni()).toEqual(["2026-09-02"]);
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().meetingDays).toEqual(["2026-09-02"]);
  });

  it("giełda WŁĄCZONA bez dni zatrzymuje zapis i mówi, czego brakuje", () => {
    panel(settings({ meeting_days: [] }));

    expect(screen.getByText(`${S}daysEmpty`)).toBeTruthy();
    expect(bledy()).toContain("adminEventMeetings.errors.enabledNeedsDays");
    expect(przyciskZapisu().disabled).toBe(true);
  });

  it("giełda WYŁĄCZONA bez dni zapisuje się bez przeszkód", () => {
    // KONTRAPUNKT: bez niego „brak dni blokuje zapis" przechodziłoby także
    // wtedy, gdyby blokada zapaliła się na wyłączonej giełdzie - czyli tam,
    // gdzie nie ma czego pilnować.
    panel(settings({ is_enabled: false, meeting_days: [] }));

    expect(bledy()).toHaveLength(0);
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().isEnabled).toBe(false);
    expect(ostatniLadunek().meetingDays).toEqual([]);
  });

  it("przełącznik giełdy zmienia to, co pojedzie do bazy", () => {
    panel();
    fireEvent.click(screen.getByLabelText(`${S}enabledLabel`));
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().isEnabled).toBe(false);
  });
});

describe("MeetingSettingsPanel - reguła widoczności i przydział grup", () => {
  it("reguła INNA niż `groups` nie pokazuje przydziału - baza i tak go zignoruje", () => {
    panel();
    expect(screen.queryByText(`${S}requesterGroupsLabel`)).toBeNull();
    expect(screen.queryByText(`${S}inviteeGroupsLabel`)).toBeNull();
    // Podpowiedź opisuje WYBRANĄ regułę, a nie regułę domyślną.
    expect(screen.getByText("eventMeetings.visibilityHints.everyone")).toBeTruthy();
  });

  it("reguła `groups` odsłania obie strony przydziału i żąda ich wypełnienia", () => {
    panel();
    fireEvent.change(droplistaReguly(), { target: { value: "groups" } });

    expect(screen.getByText(`${S}requesterGroupsLabel`)).toBeTruthy();
    expect(screen.getByText(`${S}inviteeGroupsLabel`)).toBeTruthy();
    expect(bledy()).toContain("adminEventMeetings.errors.ruleGroupsRequired");
    expect(przyciskZapisu().disabled).toBe(true);
  });

  it("zaznaczenie grup po OBU stronach odblokowuje zapis i jedzie w ładunku", () => {
    panel();
    fireEvent.change(droplistaReguly(), { target: { value: "groups" } });
    fireEvent.click(grupa(kolumnaGrup("requesterGroupsLabel"), "Delegaci"));
    fireEvent.click(grupa(kolumnaGrup("inviteeGroupsLabel"), "Prasa"));

    expect(bledy()).toHaveLength(0);
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().requesterGroupIds).toEqual(["grp-delegaci"]);
    expect(ostatniLadunek().inviteeGroupIds).toEqual(["grp-prasa"]);
    expect(ostatniLadunek().visibility).toBe("groups");
  });

  it("ponowne kliknięcie ODZNACZA grupę, zamiast dokładać ją drugi raz", () => {
    panel();
    fireEvent.change(droplistaReguly(), { target: { value: "groups" } });
    const kolumna = kolumnaGrup("requesterGroupsLabel");
    fireEvent.click(grupa(kolumna, "Delegaci"));
    fireEvent.click(grupa(kolumna, "Prasa"));
    fireEvent.click(grupa(kolumna, "Delegaci"));

    fireEvent.click(grupa(kolumnaGrup("inviteeGroupsLabel"), "Delegaci"));
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().requesterGroupIds).toEqual(["grp-prasa"]);
  });

  it("przy regule `everyone` ładunek NIE NIESIE kluczy grup", () => {
    // Pusta tablica przy `everyone` skasowałaby przydział, który organizator
    // zobaczy z powrotem po przełączeniu reguły - brak klucza go zachowuje.
    panel(
      settings({
        requester_groups: [group({ group_id: "grp-delegaci" })],
        invitee_groups: [group({ group_id: "grp-prasa", name_pl: "Prasa" })],
      }),
    );
    fireEvent.click(przyciskZapisu());

    const klucze = Object.keys(ostatniLadunek());
    expect(klucze).not.toContain("requesterGroupIds");
    expect(klucze).not.toContain("inviteeGroupIds");
  });

  it("wydarzenie BEZ grup mówi to zdaniem, a nie pustą ramką", () => {
    panel(settings({ available_groups: [] }));
    fireEvent.change(droplistaReguly(), { target: { value: "groups" } });

    expect(within(kolumnaGrup("requesterGroupsLabel")).getByText(`${S}groupsHint`)).toBeTruthy();
    expect(bledy()).toContain("adminEventMeetings.errors.ruleGroupsRequired");
  });

  it("grupa, która NIE MOŻE się spotykać, jest oznaczona przy swojej nazwie", () => {
    // Bez znacznika organizator przydziela stronę, dla której baza i tak
    // odrzuci każde zaproszenie - i dowiaduje się o tym od uczestnika.
    panel();
    fireEvent.change(droplistaReguly(), { target: { value: "groups" } });
    const kolumna = kolumnaGrup("requesterGroupsLabel");

    const prasa = within(kolumna).getByText("Prasa").parentElement;
    expect(prasa?.textContent).toContain(`${S}groupCannotMeetBadge`);
    const delegaci = within(kolumna).getByText("Delegaci").parentElement;
    expect(delegaci?.textContent).not.toContain(`${S}groupCannotMeetBadge`);
  });

  it("nazwa grupy idzie w języku interfejsu, z zapasem drugiego języka", () => {
    panel(
      settings({
        available_groups: [group({ group_id: "grp-vip", name_pl: "", name_en: "VIP guests" })],
      }),
    );
    fireEvent.change(droplistaReguly(), { target: { value: "groups" } });
    expect(within(kolumnaGrup("requesterGroupsLabel")).getByText("VIP guests")).toBeTruthy();
  });
});

describe("MeetingSettingsPanel - gotowość giełdy", () => {
  it("liczby gotowości pochodzą z RPC, a nie z pól formularza", () => {
    panel();
    expect(screen.getByText(`${S}readinessTables(count=4)`)).toBeTruthy();
    expect(screen.getByText(`${S}readinessSeats(count=8)`)).toBeTruthy();
    expect(screen.getByText(`${S}readinessParticipants(count=30)`)).toBeTruthy();
    expect(screen.getByText(`${S}readinessAvailability(count=12)`)).toBeTruthy();
    expect(screen.queryByText(`${S}readinessNoAvailability`)).toBeNull();
    expect(screen.queryByText(`${S}readinessNoTables`)).toBeNull();
  });

  it("zero stolików i zero dostępności to DWA osobne ostrzeżenia", () => {
    // Giełda bez stolików i giełda bez zadeklarowanej dostępności psują się
    // inaczej i poprawia się je w dwóch różnych miejscach panelu.
    panel(settings({ tables_count: 0, with_availability_count: 0 }));
    expect(screen.getByText(`${S}readinessNoAvailability`)).toBeTruthy();
    expect(screen.getByText(`${S}readinessNoTables`)).toBeTruthy();
  });
});

describe("MeetingSettingsPanel - zapis", () => {
  it("zapis wysyła KOMPLET ustawień razem z identyfikatorem wydarzenia", () => {
    panel();
    fireEvent.click(przyciskZapisu());

    expect(h.inputs).toHaveLength(1);
    const ladunek = ostatniLadunek();
    expect(ladunek.eventId).toBe(EVENT_ID);
    expect(ladunek.slotMinutes).toBe(20);
    expect(ladunek.breakMinutes).toBe(5);
    expect(ladunek.dayStartTime).toBe("09:00");
    expect(ladunek.dayEndTime).toBe("17:00");
    expect(ladunek.inviteExpiresAfterHours).toBe(72);
    expect(ladunek.meetingDays).toEqual(["2026-09-01", "2026-09-02"]);
    expect(ladunek.introPl).toBe("Zapraszamy do umawiania spotkań.");
  });

  it("oba zdania wstępu jadą do bazy OSOBNO - polskie i angielskie", () => {
    // Przeklejony blok („wstęp EN" zapisujący do `introPl") przechodzi przez
    // kompilator i przez recenzję; widać go wyłącznie na ładunku.
    panel();
    wpisz("introPlLabel", "Nowy wstęp.");
    wpisz("introEnLabel", "New intro.");
    fireEvent.click(przyciskZapisu());

    expect(ostatniLadunek().introPl).toBe("Nowy wstęp.");
    expect(ostatniLadunek().introEn).toBe("New intro.");
  });

  it("udany zapis potwierdza się komunikatem", () => {
    panel();
    fireEvent.click(przyciskZapisu());
    act(() => h.settle?.("ok"));

    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventMeetings.toasts.settingsSaved");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("TRWAJĄCY zapis blokuje przycisk - podwójne kliknięcie wysyła RAZ", () => {
    panel();
    fireEvent.click(przyciskZapisu());
    expect(przyciskZapisu().disabled).toBe(true);
    fireEvent.click(przyciskZapisu());
    expect(h.inputs).toHaveLength(1);
  });

  it("ODMOWA serwera zostawia wpisane wartości na ekranie i nazywa powód", () => {
    // Formularz wyczyszczony po odmowie znaczy, że organizator wpisuje
    // dwadzieścia pól po raz drugi - i to jest moment, w którym rezygnuje.
    panel();
    wpisz("slotMinutesLabel", "45");
    wpisz("introPlLabel", "Nowe zdanie wstępu.");
    fireEvent.click(przyciskZapisu());
    act(() => h.settle?.("fail"));

    expect(h.toastError).toHaveBeenCalledWith(
      "adminEventMeetings.errors.unknown(detail=invalid_timezone: Europe/Nowhere)",
    );
    expect(pole("slotMinutesLabel").value).toBe("45");
    expect(pole("introPlLabel").value).toBe("Nowe zdanie wstępu.");
    // Po odmowie przycisk WRACA do gry - inaczej poprawka nie ma jak dojechać.
    expect(przyciskZapisu().disabled).toBe(false);
  });
});

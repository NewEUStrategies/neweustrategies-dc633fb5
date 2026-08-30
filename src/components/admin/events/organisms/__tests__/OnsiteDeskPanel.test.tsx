// Organizm „STANOWISKO ODPRAWY" - ekran, przy którym stoi kolejka.
//
// CO TEN PLIK DOWODZI.
//   1. PUNKT KONTROLNY WYBIERA SIĘ RAZ, NA GÓRZE, i bez niego nic nie leci do
//      bazy. Odprawa bez bramki nie ma gdzie policzyć zajętości, więc panel
//      zatrzymuje ją PRZED żądaniem i mówi, czego brakuje.
//   2. DECYZJĘ PODEJMUJE BAZA. Panel wysyła zgłoszenie i pokazuje ZWRÓCONĄ
//      decyzję - nie liczy pojemności ani nie sprawdza statusu zapisu. Dlatego
//      dowodzimy obu wyników (wpuszczenie i odmowa) na tym samym wierszu:
//      różni je wyłącznie odpowiedź bazy.
//   3. ŹRÓDŁEM ODPRAWY JEST `name_search`, NIE „skan". Audyt musi widzieć, że
//      kogoś wpuścił CZŁOWIEK przy stanowisku, a nie piknięcie urządzeniem.
//   4. LISTA PYTA BAZĘ DOPIERO PO WYBRANIU BRAMKI. Flaga `enabled` jedzie do
//      hooka wprost - bez niej stanowisko wysyłałoby zapytania o osoby, zanim
//      wiadomo, przy której bramce stoi.
//   5. WIERSZ MÓWI, CZY OSOBA MA ZAPIS. Brak zapisu to odznaka, a nie cisza -
//      operator ma zobaczyć powód odmowy, zanim kliknie.
//
// DWA DEFEKTY UDOKUMENTOWANE JAKO `it.fails` (opis przy każdym).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Warstwy danych (`recordManualCheckin`,
// `parseCheckinOutcome`) - ma własny dom w `lib/events`. (2) Słownika odmów
// bazy. (3) Formatu godziny ostatniej odprawy - `toLocaleTimeString` zależy
// od wersji ICU maszyny.
//
// OPÓŹNIENIE FRAZY JEST TU TOŻSAMOŚCIĄ (wzór z `ClubThreadsTab.test.tsx`):
// przedmiotem dowodu jest to, CO dojedzie do zapytania, a nie po ilu
// milisekundach.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import { BADGE_PRINT_REASONS } from "@/lib/events/onsiteEnums";
import type {
  BadgePrintInput,
  BadgeTemplateRow,
  CheckinOutcome,
  CheckinSearchRow,
  EventCheckpointRow,
  ManualCheckinInput,
} from "@/lib/events/onsiteApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
}

/** Zapytanie o osoby - panel przekazuje też flagę „wolno pytać". */
interface ZapytanieOsob {
  eventId: string;
  q: string;
  enabled: boolean;
}

type SzablonOpcja = Pick<BadgeTemplateRow, "id" | "is_default">;

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  punkty: [] as unknown[] | undefined,
  szablony: [] as unknown[] | undefined,
  zapytania: [] as unknown[],
  odprawy: [] as unknown[],
  odprawaWynik: null as unknown,
  odprawaBlad: null as unknown,
  odprawaPending: false,
  wydruki: [] as unknown[],
  wydrukBlad: null as unknown,
  wydrukPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/lib/events/adminOnsiteErrors", () => ({
  adminOnsiteErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: (value: string) => value,
}));

// Radix Select nie otwiera listy pod happy-dom. Atrapa jest natywna i przenosi
// z wyzwalacza `id`, `aria-label` i `aria-labelledby`, więc droplista bramek
// nadal ma nazwę dostępną - dokładnie jak w produkcji.
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  interface WyzwalaczProps {
    id?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  }
  const jestWyzwalacz = (node: ReactNode): node is ReactElement<WyzwalaczProps> =>
    react.isValidElement<WyzwalaczProps>(node) &&
    ("aria-label" in node.props || "aria-labelledby" in node.props || "id" in node.props);
  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string;
      onValueChange?: (next: string) => void;
      disabled?: boolean;
      children?: ReactNode;
    }) => {
      const parts = react.Children.toArray(children);
      const wyzwalacz = parts.find(jestWyzwalacz);
      const tresc = parts.filter((part) => part !== wyzwalacz);
      return (
        <select
          id={wyzwalacz?.props.id}
          aria-label={wyzwalacz?.props["aria-label"]}
          aria-labelledby={wyzwalacz?.props["aria-labelledby"]}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {value === undefined ? <option value="" /> : null}
          {tresc}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

vi.mock("@/lib/events/useEventOnsite", () => ({
  useCheckpoints: () => ({ data: h.punkty, isLoading: false, error: null }),
  useBadgeTemplates: () => ({ data: h.szablony, isLoading: false, error: null }),
  useCheckinSearch: (eventId: string, q: string, enabled: boolean) => {
    h.zapytania.push({ eventId, q, enabled });
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useManualCheckin: () => ({
    mutate: (input: ManualCheckinInput, wynik: Wynik<CheckinOutcome>) => {
      h.odprawy.push(input);
      if (h.odprawaBlad === null) wynik.onSuccess?.(h.odprawaWynik as CheckinOutcome);
      else wynik.onError?.(h.odprawaBlad);
    },
    isPending: h.odprawaPending,
  }),
  useRecordBadgePrint: () => ({
    mutate: (input: BadgePrintInput, wynik: Wynik<Record<string, unknown>>) => {
      h.wydruki.push(input);
      if (h.wydrukBlad === null) wynik.onSuccess?.({});
      else wynik.onError?.(h.wydrukBlad);
    },
    isPending: h.wydrukPending,
  }),
}));

import { OnsiteDeskPanel } from "@/components/admin/events/organisms/OnsiteDeskPanel";

const T = "adminEventOnsite";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const PUNKT = "22222222-2222-4222-8222-222222222222";
const PUNKT_WYJSCIOWY = "33333333-3333-4333-8333-333333333333";
const OSOBA = "44444444-4444-4444-8444-444444444444";
const INNA_OSOBA = "55555555-5555-4555-8555-555555555555";
const SZABLON = "66666666-6666-4666-8666-666666666666";

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `string`.
 *
 * `admin_event_checkin_search` oddaje `registration_id`, `last_checkin_at`,
 * `company` i `job_title` jako NULL (osoba bez zapisu, jeszcze nieodprawiona,
 * bez firmy w profilu), a wygenerowany typ obiecuje `string`. Organizm ma na to
 * jawne warunki (`=== null`), więc fixtura musi umieć oddać `null`.
 */
const BRAK = null as unknown as string;

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `number`.
 *
 * `capacity` = NULL znaczy „bramka bez limitu pojemności"; panel jej nie czyta,
 * ale wiersz punktu musi być kompletny i zgodny z tym, co odda RPC.
 */
const BEZ_LIMITU = null as unknown as number;

/** Osoba z zatwierdzonym zapisem, jeszcze nieodprawiona. */
function osoba(overrides: Partial<CheckinSearchRow> = {}): CheckinSearchRow {
  return {
    badge_printed: false,
    company: "Instytut Analiz",
    first_name: "Anna",
    group_name_en: BRAK,
    group_name_pl: BRAK,
    job_title: "Analityczka",
    last_checkin_at: BRAK,
    last_checkin_direction: BRAK,
    last_name: "Kowalska",
    person_id: OSOBA,
    registration_id: "77777777-7777-4777-8777-777777777777",
    registration_status: "approved",
    ticket_name_en: "Standard",
    ticket_name_pl: "Standardowy",
    ...overrides,
  };
}

/** Punkt kontrolny - panel czyta z niego nazwę, aktywność i tryb kierunku. */
function punkt(overrides: Partial<EventCheckpointRow> = {}): EventCheckpointRow {
  return {
    access_mode: "control",
    capacity: BEZ_LIMITU,
    created_at: "2026-08-30T09:00:00.000Z",
    dedupe_window_seconds: 120,
    denied_count: 0,
    device_count: 0,
    direction_mode: "in_only",
    event_id: WYDARZENIE,
    granted_count: 0,
    id: PUNKT,
    is_active: true,
    kind: "event_entry",
    last_checkin_at: BRAK,
    name_en: "Main entrance",
    name_pl: "Wejście główne",
    occupancy: 0,
    repeat_count: 0,
    room_id: BRAK,
    room_name: BRAK,
    session_id: BRAK,
    session_title_en: BRAK,
    session_title_pl: BRAK,
    sort_order: 0,
    sponsor_id: BRAK,
    sponsor_name: BRAK,
    updated_at: "2026-08-30T09:00:00.000Z",
    ...overrides,
  };
}

/** Decyzja bazy - panel jej nie liczy, tylko pokazuje. */
function decyzja(overrides: Partial<CheckinOutcome> = {}): CheckinOutcome {
  return {
    outcome: "recorded",
    admit: true,
    result: "granted",
    checkinId: "88888888-8888-4888-8888-888888888888",
    direction: "in",
    occurredAt: "2026-09-01T08:30:00.000Z",
    repeatCount: 1,
    previousCheckinAt: null,
    checkpoint: {},
    person: {},
    ...overrides,
  };
}

function szablon(overrides: Partial<SzablonOpcja> = {}): SzablonOpcja {
  return { id: SZABLON, is_default: true, ...overrides };
}

function panel() {
  return render(<OnsiteDeskPanel eventId={WYDARZENIE} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liście osób`);
  return found;
};

const dropListaBramek = (): HTMLSelectElement =>
  screen.getByRole("combobox", { name: `${T}.filters.checkpoint` });

const pole = (): HTMLElement => screen.getByLabelText(`${T}.filters.search`);

const ostatnieZapytanie = (): ZapytanieOsob => h.zapytania[h.zapytania.length - 1] as ZapytanieOsob;

/** Wybór bramki + wpisanie frazy - stan wyjściowy większości przypadków. */
function przyBramce(id = PUNKT, fraza = "Kowalska"): void {
  fireEvent.change(dropListaBramek(), { target: { value: id } });
  fireEvent.change(pole(), { target: { value: fraza } });
}

beforeEach(() => {
  h.lang = "pl";
  h.rows = [osoba()];
  h.isLoading = false;
  h.listError = null;
  h.punkty = [punkt()];
  h.szablony = [szablon()];
  h.zapytania = [];
  h.odprawy = [];
  h.odprawaWynik = decyzja();
  h.odprawaBlad = null;
  h.odprawaPending = false;
  h.wydruki = [];
  h.wydrukBlad = null;
  h.wydrukPending = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("wybór bramki bramkuje całą resztę", () => {
  it("bez wybranej bramki zapytanie o osoby jest WYŁĄCZONE", () => {
    panel();

    expect(ostatnieZapytanie()).toEqual({ eventId: WYDARZENIE, q: "", enabled: false });
  });

  it("po wybraniu bramki zapytanie się włącza i niesie wpisaną frazę", () => {
    panel();
    przyBramce();

    expect(ostatnieZapytanie()).toEqual({
      eventId: WYDARZENIE,
      q: "Kowalska",
      enabled: true,
    });
  });

  it("droplista pokazuje TYLKO czynne bramki - przy wyłączonej nie da się odprawiać", () => {
    h.punkty = [
      punkt(),
      punkt({ id: PUNKT_WYJSCIOWY, is_active: false, name_pl: "Bramka boczna" }),
    ];
    panel();

    expect(Array.from(dropListaBramek().options).map((option) => option.value)).toEqual([
      "",
      PUNKT,
    ]);
  });

  it("po angielsku bramki w dropliście są po angielsku", () => {
    h.lang = "en";
    panel();

    expect(Array.from(dropListaBramek().options).map((option) => option.textContent)).toContain(
      "Main entrance",
    );
  });

  it("bramka bez nazwy w języku interfejsu spada na drugi język", () => {
    h.punkty = [punkt({ name_pl: "" })];
    panel();
    expect(Array.from(dropListaBramek().options).map((option) => option.textContent)).toContain(
      "Main entrance",
    );
  });

  it("bramka bez nazwy angielskiej spada po angielsku na polską", () => {
    h.lang = "en";
    h.punkty = [punkt({ name_en: "" })];
    panel();

    expect(Array.from(dropListaBramek().options).map((option) => option.textContent)).toContain(
      "Wejście główne",
    );
  });

  it("nieodczytana lista bramek nie wystawia żadnej opcji", () => {
    h.punkty = undefined;
    panel();

    expect(Array.from(dropListaBramek().options).map((option) => option.value)).toEqual([""]);
  });
});

describe("cztery stany listy osób", () => {
  it("wczytywanie przy frazie od dwóch znaków mówi „wczytywanie”", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();
    przyBramce(PUNKT, "Ko");

    expect(screen.getByText(`${T}.desk.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
  });

  it("wczytywanie przy JEDNOZNAKOWEJ frazie NIE udaje postępu - baza i tak nie pyta", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();
    przyBramce(PUNKT, "K");

    expect(screen.queryByText(`${T}.desk.loading`)).toBeNull();
  });

  it("awaria pokazuje odmowę bazy i NIE mówi, że nikogo nie znaleziono", () => {
    h.rows = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();
    przyBramce();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.desk.empty`)).toBeNull();
  });

  it("brak trafień to „nikogo nie znaleziono”, a nie awaria", () => {
    h.rows = [];
    panel();
    przyBramce();

    expect(screen.getByText(`${T}.desk.empty`)).toBeTruthy();
  });

  it("brak awarii wyrażony jako `undefined` (nie `null`) też nie jest awarią", () => {
    h.listError = undefined;
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.desk.empty`)).toBeTruthy();
  });
});

describe("wiersz osoby przy bramce", () => {
  it("mówi imię, nazwisko, stanowisko i firmę", () => {
    panel();

    expect(within(wiersz()).getByText("Anna Kowalska")).toBeTruthy();
    expect(wiersz().textContent).toContain("Analityczka · Instytut Analiz");
  });

  it("osoba bez firmy nie rysuje pustego separatora", () => {
    h.rows = [osoba({ company: BRAK })];
    panel();

    expect(wiersz().textContent).toContain("Analityczka");
    expect(wiersz().textContent).not.toContain("·");
  });

  it("BRAK ZAPISU jest odznaczony wprost - to powód odmowy widoczny przed kliknięciem", () => {
    h.rows = [osoba({ registration_id: BRAK, registration_status: BRAK })];
    panel();

    expect(within(wiersz()).getByText(`${T}.desk.noRegistration`)).toBeTruthy();
  });

  it("osoba z zapisem pokazuje jego STATUS, a nie napis o braku zapisu", () => {
    h.rows = [osoba({ registration_status: "waitlisted" })];
    panel();

    expect(within(wiersz()).getByText("waitlisted")).toBeTruthy();
    expect(within(wiersz()).queryByText(`${T}.desk.noRegistration`)).toBeNull();
  });

  it("wydrukowany identyfikator jest odznaczony, a niewydrukowany - nie", () => {
    h.rows = [osoba(), osoba({ person_id: INNA_OSOBA, badge_printed: true })];
    panel();

    expect(within(wiersz(0)).queryByText(`${T}.labels.badgePrinted`)).toBeNull();
    expect(within(wiersz(1)).getByText(`${T}.labels.badgePrinted`)).toBeTruthy();
  });

  it("osoba jeszcze nieodprawiona nie ma godziny ostatniej odprawy", () => {
    h.rows = [osoba({ last_checkin_at: BRAK })];
    panel();

    expect(wiersz().textContent).not.toContain(`${T}.labels.lastCheckin`);
  });

  it("osoba już odprawiona ma godzinę ostatniej odprawy", () => {
    h.rows = [osoba({ last_checkin_at: "2026-09-01T08:30:00.000Z" })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.labels.lastCheckin`);
  });
});

describe("zapis odprawy", () => {
  it("bez wybranej bramki odprawa NIE wychodzi do bazy i pada prośba o bramkę", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` }));

    expect(h.odprawy).toHaveLength(0);
    expect(h.toastError).toHaveBeenCalledWith(`${T}.desk.selectCheckpoint`);
  });

  it("ładunek niesie źródło `name_search` - wpis z panelu nie udaje piknięcia", () => {
    panel();
    przyBramce();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` }));

    expect(h.odprawy).toEqual([
      {
        eventId: WYDARZENIE,
        checkpointId: PUNKT,
        personId: OSOBA,
        direction: "in",
        source: "name_search",
      },
    ]);
  });

  it("odprawa idzie z identyfikatorem TEJ osoby, nie pierwszej z listy", () => {
    h.rows = [osoba(), osoba({ person_id: INNA_OSOBA, first_name: "Piotr", last_name: "Nowak" })];
    panel();
    przyBramce();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.actions.checkIn` }));

    expect((h.odprawy[0] as ManualCheckinInput).personId).toBe(INNA_OSOBA);
  });

  it("WPUSZCZENIE potwierdza zdaniem z nazwiskiem i pokazuje decyzję bazy", () => {
    panel();
    przyBramce();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` }));

    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.desk.outcome.granted(name=Anna Kowalska)`);
    expect(screen.getByText(`${T}.results.granted`)).toBeTruthy();
    expect(screen.getByText(`${T}.directions.in`)).toBeTruthy();
  });

  it("ODMOWA mówi POWÓD Z BAZY, a nie ogólne „nie udało się”", () => {
    h.odprawaWynik = decyzja({ admit: false, result: "denied_capacity", outcome: "denied" });
    panel();
    przyBramce();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` }));

    expect(h.toastError).toHaveBeenCalledWith(
      `${T}.desk.outcome.denied(reason=${T}.results.denied_capacity)`,
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("pierwsze wejście nie mówi o powtórzeniu", () => {
    h.odprawaWynik = decyzja({ repeatCount: 1 });
    panel();
    przyBramce();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` }));

    expect(screen.queryByText(/desk\.outcome\.repeat/)).toBeNull();
  });

  it("powtórzone piknięcie tej samej osoby jest policzone na karcie decyzji", () => {
    h.odprawaWynik = decyzja({ repeatCount: 3 });
    panel();
    przyBramce();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` }));

    expect(screen.getByText(`${T}.desk.outcome.repeat(count=3)`)).toBeTruthy();
  });

  it("przed pierwszą odprawą karty decyzji w ogóle nie ma", () => {
    panel();

    expect(screen.queryByText(`${T}.results.granted`)).toBeNull();
  });

  it("odmowa BAZY (wyjątek, nie decyzja) kończy się zdaniem i nie rysuje karty", () => {
    h.odprawaBlad = new Error("checkpoint_not_found: checkpoint does not exist in this event");
    panel();
    przyBramce();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` }));

    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:checkpoint_not_found: checkpoint does not exist in this event",
    );
    expect(screen.queryByText(`${T}.results.granted`)).toBeNull();
  });

  it("zapis w locie gasi przyciski odprawy - dwa kliknięcia to dwa wiersze w dzienniku", () => {
    h.odprawaPending = true;
    panel();

    expect(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` })).toBeDisabled();
  });
});

describe("kierunek zależy od trybu bramki", () => {
  it("bramka tylko na wejście NIE MA przycisku wyjścia", () => {
    panel();
    przyBramce();

    expect(within(wiersz()).queryByRole("button", { name: `${T}.actions.checkOut` })).toBeNull();
  });

  it("bramka dwustronna ma OBA przyciski, a wyjście jedzie z `direction: out`", () => {
    h.punkty = [punkt({ direction_mode: "in_out" })];
    panel();
    przyBramce();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkOut` }));

    expect((h.odprawy[0] as ManualCheckinInput).direction).toBe("out");
  });

  it("przed wybraniem bramki przycisku wyjścia nie ma - nie wiadomo, jaki to tryb", () => {
    h.punkty = [punkt({ direction_mode: "in_out" })];
    panel();

    expect(within(wiersz()).queryByRole("button", { name: `${T}.actions.checkOut` })).toBeNull();
  });

  it.fails(
    "DEFEKT: bramka `out_only` nie dostaje przycisku wyjścia - jedyna dostępna akcja to wejście, które baza odrzuca jako `denied_direction`",
    () => {
      // `CHECKPOINT_DIRECTION_MODES` ma TRZY wartości, a panel rozpoznaje
      // wyłącznie `in_out` (`selected.direction_mode === "in_out"`). Przy
      // bramce wyjściowej operator widzi więc sam przycisk „odpraw", a
      // `_event_checkin_decide` odpowiada na `direction = 'in'` przy
      // `direction_mode = 'out_only'` wynikiem `denied_direction` - czyli
      // KAŻDA odprawa przy takiej bramce kończy się odmową, a w dzienniku
      // rośnie licznik odmów, którego nikt nie umie wytłumaczyć.
      h.punkty = [punkt({ direction_mode: "out_only" })];
      panel();
      przyBramce();

      expect(within(wiersz()).getByRole("button", { name: `${T}.actions.checkOut` })).toBeTruthy();
    },
  );
});

describe("wydruk identyfikatora ze stanowiska", () => {
  it("wydruk idzie z domyślnym szablonem wydarzenia i jedną kopią", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.printBadge` }));

    expect(h.wydruki).toHaveLength(1);
    expect(h.wydruki[0]).toMatchObject({
      eventId: WYDARZENIE,
      personId: OSOBA,
      templateId: SZABLON,
      copies: 1,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.desk.toasts.badgePrinted`);
  });

  it("bez szablonu domyślnego wydruk NIE zgaduje szablonu - wybór zostawia bazie", () => {
    h.szablony = [szablon({ is_default: false })];
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.printBadge` }));

    expect((h.wydruki[0] as BadgePrintInput).templateId).toBeUndefined();
  });

  it("nieodczytana lista szablonów też nie zgaduje szablonu", () => {
    h.szablony = undefined;
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.printBadge` }));

    expect((h.wydruki[0] as BadgePrintInput).templateId).toBeUndefined();
  });

  it("wydruk NIE wymaga wybranej bramki - identyfikator drukuje się przed odprawą", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.printBadge` }));

    expect(h.wydruki).toHaveLength(1);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("odmowa bazy przy wydruku kończy się zdaniem", () => {
    h.wydrukBlad = new Error("template_missing: this event has no default badge template");
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.printBadge` }));

    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:template_missing: this event has no default badge template",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("wydruk w locie gasi przycisk drukarki", () => {
    h.wydrukPending = true;
    panel();

    expect(
      within(wiersz()).getByRole("button", { name: `${T}.actions.printBadge` }),
    ).toBeDisabled();
  });

  it.fails(
    "DEFEKT: powód wydruku `desk` jest spoza słownika `BADGE_PRINT_REASONS`, więc baza go MILCZĄCO podmienia",
    () => {
      // `event_badge_prints_reason_values` dopuszcza pięć wartości:
      // first_issue, reprint_lost, reprint_damaged, data_correction,
      // bulk_preprint. `_event_badge_print_write` normalizuje wszystko inne
      // (`v_reason NOT IN (...)` -> first_issue albo reprint_lost), więc
      // wysłany stąd `desk` NIGDY nie trafia do rejestru. Skutek: w panelu
      // „Identyfikatory" nie da się odróżnić wydruku ze stanowiska odprawy od
      // wydruku z generatora partii, choć panel udaje, że taki ślad zostawia.
      panel();
      fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.printBadge` }));

      const powod = (h.wydruki[0] as BadgePrintInput).reason;
      expect(BADGE_PRINT_REASONS as readonly string[]).toContain(powod);
    },
  );
});

describe("dostępność", () => {
  it("stanowisko z listą osób nie ma naruszeń dostępności", async () => {
    h.punkty = [punkt({ direction_mode: "in_out" })];
    h.rows = [
      osoba({ last_checkin_at: "2026-09-01T08:30:00.000Z", badge_printed: true }),
      osoba({ person_id: INNA_OSOBA, registration_id: BRAK, first_name: "Piotr" }),
    ];
    const { container } = panel();
    przyBramce();
    await screen.findByText("Anna Kowalska");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("stanowisko z kartą decyzji też nie ma naruszeń dostępności", async () => {
    const { container } = panel();
    przyBramce();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.checkIn` }));
    await screen.findByText(`${T}.results.granted`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

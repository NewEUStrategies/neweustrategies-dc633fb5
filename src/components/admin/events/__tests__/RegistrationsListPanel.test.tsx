// Organizm „Zgłoszenia" - SKLEJENIE trzech zapytań, czterech operacji i poczty.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJĄ CZTERY WIDOKI: wczytywanie, awaria, pustka bez
//      filtrów, pustka POD filtrem. Awaria pokazująca komunikat pustki to
//      udokumentowana klasa błędu tego modułu: „nie ma zgłoszeń" po nieudanym
//      zapytaniu w dniu wydarzenia znaczy dla organizatora „nikt nie przyszedł",
//      więc awaria ma tu WŁASNY przypadek z kontrapunktem.
//   2. FILTRY IDĄ DO KLUCZA ZAPYTANIA, A NIE DO STANU WIERSZY - asercje na
//      argumentach, z jakimi zawołano hook listy, nie na wyglądzie kontrolki.
//      Każda zmiana filtra WRACA NA PIERWSZĄ STRONĘ (inaczej lista bywa pusta
//      bez powodu) i NIE gubi wpisanej frazy.
//   3. LICZNIKI NIE BIORĄ FILTRA STATUSU. Zakładka „Oczekujące (7)" licząca
//      oczekujące wśród oczekujących zawsze pokazywałaby tyle, ile wierszy na
//      ekranie - czyli nic.
//   4. DECYZJA BEZ WIADOMOŚCI TO DECYZJA, O KTÓREJ UCZESTNIK SIĘ NIE DOWIE.
//      Zatwierdzenie i odrzucenie ciągną za sobą mail, pozostałe cztery
//      czynności NIE, a nieudana wysyłka NIE cofa decyzji - ma tylko powiedzieć
//      organizatorowi, że mail nie poszedł.
//   5. POWIADOMIENIE O AWANSIE IDZIE SZEREGOWO i liczy osobno wysłane i
//      nieudane; obie liczby trafiają do dwóch różnych komunikatów.
//   6. EKSPORT BIERZE CAŁY PRZEKRÓJ FILTRA, chodząc po stronach po 200 wierszy,
//      i NIE OBIECUJE KOMPLETU, którego nie ma (ostrzeżenie o ucięciu).
//   7. KAŻDA ODMOWA kończy się zdaniem, a nie kodem błędu, i NIE kasuje stanu
//      ekranu: okno decyzji zostaje otwarte, filtr i strona zostają.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) REGUŁ wiersza (`allowedRegistrationActions`,
// tony, etykiety biletu i grupy, stronicowanie) - tabele przypadków są
// w `lib/events/__tests__/registrationRows.test.ts`; tutaj dowodzimy, że
// organizm ich UŻYWA. (2) SŁOWNIKA ODMÓW - ma `eventErrorMaps.test.ts`; tutaj
// jest atrapą, bo liczy się, że odmowa DOCHODZI do organizatora zdaniem.
// (3) OKNA DECYZJI - `RegistrationDecideDialog.test.tsx`; tutaj zostaje
// PRAWDZIWE, bo przedmiotem dowodu jest ładunek, który z niego wychodzi.
// (4) WYSYŁKI maila - server fn ma własny zakres; tu jest atrapą.
//
// ATRAPA PRZYCISKU - RZECZ DO ZROZUMIENIA PRZED CZYTANIEM ASERCJI. Prawdziwy
// `Button` oddaje `disabled` natywnemu przyciskowi, a React nie woła wtedy
// handlera - czyli BRAMKI WEWNĄTRZ handlerów (`if (exporting) return`,
// `if (awaitingIds.length === 0 || notifying) return`) byłyby niesprawdzalne,
// choć to one bronią przed drugą serią maili. Atrapa trzyma stan zgaszenia
// w `aria-disabled` i handler PUSZCZA (wzór z `ClubMembersTab.test.tsx`),
// dlatego asercje „przycisk zgaszony" patrzą na `aria-disabled`.
//
// Radix Select i Dialog nie działają pod happy-dom bez pełnego pointer API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import type { RegistrationCounts } from "@/lib/events/registrationCounts";
import type {
  EventRegistrationRow,
  RegistrationDecisionInput,
  RegistrationsQuery,
  WaitlistPromoteInput,
} from "@/lib/events/registrationsApi";

/** Górna granica jednej strony RPC - lustro stałej `EXPORT_PAGE_SIZE` organizmu. */
const STRONA_EKSPORTU = 200;

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const BILET = "aaaaaaaa-1111-4111-8111-111111111111";
const INNY_BILET = "aaaaaaaa-2222-4222-8222-222222222222";

type Wynik = { onSuccess?: () => void; onError?: (error: unknown) => void };

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  rows: [] as unknown[],
  total: 0,
  listLoading: false,
  listError: null as unknown,
  listQueries: [] as unknown[],
  counts: null as unknown,
  countsQueries: [] as unknown[],
  tickets: [] as unknown[] | undefined,
  refetchList: vi.fn(),
  refetchCounts: vi.fn(),
  markReset: vi.fn(),
  decideCalls: [] as unknown[],
  decideError: null as unknown,
  decidePending: false,
  promoteCalls: [] as unknown[],
  promoteError: null as unknown,
  promotePending: false,
  /** Wywołania server fn poczty, w kolejności - dowód SZEREGOWOŚCI. */
  notifyCalls: [] as { registrationId: string; notice: string }[],
  /** Odpowiedź poczty per identyfikator; brak wpisu = `{ ok: true }`. */
  notifyResults: {} as Record<string, { ok: boolean } | "throw">,
  notifyHang: false,
  /** Kolejne strony eksportu - `shift()` przy każdym wywołaniu. */
  exportPages: [] as { rows: unknown[]; total: number }[],
  exportError: null as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, warning: h.toastWarning },
}));
// Słownik odmów bazy ma własny plik testowy; tutaj potrzebny jest wyłącznie
// dowód, że odmowa DOCHODZI do organizatora zdaniem, a nie kodem `23514`.
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
// Klient bazy jedzie tu wyłącznie tranzytem - `registrationsApi` zostaje
// PRAWDZIWE (stałe `DEFAULT_REGISTRATIONS_QUERY` i `REGISTRATION_STATUSES` są
// kontraktem, którego nie wolno przepisywać w teście), podmieniamy tylko
// pobranie stron eksportu.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: () => undefined } }));
vi.mock("@/lib/events/registrationsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/registrationsApi")>()),
  fetchRegistrations: (query: RegistrationsQuery) => {
    h.listQueries.push({ eksport: true, ...query });
    if (h.exportError !== null) return Promise.reject(h.exportError);
    return Promise.resolve(h.exportPages.shift() ?? { rows: [], total: 0 });
  },
}));

vi.mock("@tanstack/react-start", async () => {
  const { reactStartMock } = await import("@/test/serverFnChain");
  return {
    ...reactStartMock(),
    createMiddleware: () => ({ server: () => ({}) }),
    useServerFn:
      () =>
      async ({ data }: { data: { registrationId: string; notice: string } }) => {
        h.notifyCalls.push(data);
        if (h.notifyHang) return new Promise<never>(() => {});
        const wynik = h.notifyResults[data.registrationId];
        if (wynik === "throw") throw new Error("poczta: sieć padła");
        return wynik ?? { ok: true };
      },
  };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "",
  Button: ({
    children,
    disabled,
    onClick,
    type,
    ...reszta
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    type?: "button" | "submit" | "reset";
    variant?: string;
    size?: string;
    className?: string;
    "aria-label"?: string;
  }) => (
    <button
      type={type ?? "button"}
      aria-label={reszta["aria-label"]}
      aria-disabled={disabled === true}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

// Droplisty stoją na Radix Select, który pod happy-dom nie otwiera listy.
// Atrapa jest natywna i PRZEJMUJE `id` z wyzwalacza - bez tego `<Label htmlFor>`
// wskazywałby w próżnię i asercje musiałyby pytać o klasy zamiast o etykietę.
vi.mock("@/components/ui/select", async () => {
  const { Children, isValidElement } = await import("react");
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (next: string) => void;
      children?: ReactNode;
    }) => {
      const id = Children.toArray(children)
        .filter(isValidElement)
        .map((child) => (child.props as { id?: string }).id)
        .find((kandydat) => kandydat !== undefined);
      return (
        <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
          {children}
        </select>
      );
    },
    SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

// Okno decyzji zostaje PRAWDZIWE, ale jego treść istnieje tylko przy otwartym
// dialogu (portal nie jest montowany) - inaczej „okno nie pada bez kliknięcia"
// byłoby dowodem na atrapę.
vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      return (
        <div>
          <button type="button" data-testid="okno-zamknij" onClick={() => onOpenChange?.(false)} />
          <button type="button" data-testid="okno-otworz" onClick={() => onOpenChange?.(true)} />
          {children}
        </div>
      );
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div role="dialog">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

vi.mock("@/lib/events/useEventRegistrations", () => ({
  useRegistrationsList: (query: unknown) => {
    h.listQueries.push(query);
    return {
      data: h.listError === null ? { rows: h.rows, total: h.total } : undefined,
      isLoading: h.listLoading,
      error: h.listError,
      refetch: h.refetchList,
    };
  },
  useRegistrationCounts: (query: unknown) => {
    h.countsQueries.push(query);
    return { data: h.counts, refetch: h.refetchCounts };
  },
  useEventTickets: () => ({ data: h.tickets }),
  useDecideRegistration: () => ({
    mutate: (input: RegistrationDecisionInput, wynik: Wynik) => {
      h.decideCalls.push(input);
      if (h.decideError === null) wynik.onSuccess?.();
      else wynik.onError?.(h.decideError);
    },
    isPending: h.decidePending,
  }),
  usePromoteFromWaitlist: () => ({
    mutate: (input: WaitlistPromoteInput, wynik: Wynik) => {
      h.promoteCalls.push(input);
      if (h.promoteError === null) wynik.onSuccess?.();
      else wynik.onError?.(h.promoteError);
    },
    isPending: h.promotePending,
  }),
  useMarkRegistrationsNotified: () => ({ reset: h.markReset }),
}));

import { RegistrationsListPanel } from "@/components/admin/events/organisms/RegistrationsListPanel";
import { DEFAULT_REGISTRATIONS_QUERY } from "@/lib/events/registrationsApi";
import { emptyRegistrationCounts } from "@/lib/events/registrationCounts";
import { eventTicketRow } from "@/test/events/adminSalesRows";

/**
 * Kolumny NULL-owalne, które generator typuje jako `string`/`number`.
 *
 * `promoted_at`, `waitlist_notified_at`, `ticket_type_id`, `group_id`,
 * `waitlist_position` i `consent_withdrawn_at` przychodzą z RPC jako `null`
 * („nie awansował", „bez biletu", „zgoda nie wycofana"), ale wygenerowany typ
 * tego nie wie - organizm i moduł reguł mają na to JAWNE warunki
 * (`?? null) === null`). Fixtura, która wstawiłaby tu pusty napis albo zero,
 * testowałaby kształt, którego RPC nigdy nie odda.
 */
type NadpisaniaZgloszenia = Partial<
  Record<keyof EventRegistrationRow, string | number | boolean | null>
>;

/** Zgłoszenie OCZEKUJĄCE, bez biletu, bez grupy, z kompletem zgód. */
function registrationRow(over: NadpisaniaZgloszenia = {}): EventRegistrationRow {
  return {
    accepted_terms_count: 2,
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
    email: "anna@example.test",
    event_id: WYDARZENIE,
    extra_groups_count: 0,
    first_name: "Anna",
    group_color: "",
    group_id: null,
    group_key: null,
    group_name_en: null,
    group_name_pl: null,
    has_qr: false,
    id: "reg-1",
    job_title: "",
    last_name: "Nowak",
    person_id: null,
    person_user_id: null,
    phone: "",
    promoted_at: null,
    registration_mode: "form",
    required_terms_missing: 0,
    social_profile_url: "",
    source: "self_registration",
    status: "pending",
    ticket_currency: "PLN",
    ticket_key: null,
    ticket_name_en: null,
    ticket_name_pl: null,
    ticket_price_cents: 0,
    ticket_type_id: null,
    total_count: 1,
    waitlist_notified_at: null,
    waitlist_position: null,
    ...over,
  } as EventRegistrationRow;
}

function counts(over: Partial<RegistrationCounts> = {}): RegistrationCounts {
  const puste = emptyRegistrationCounts();
  return {
    ...puste,
    all: 3,
    byStatus: { ...puste.byStatus, pending: 2, approved: 1 },
    ...over,
  };
}

const B = "adminEventRegistration.registrations";

function panel(props: { eventSlug?: string } = {}) {
  return render(<RegistrationsListPanel eventId={WYDARZENIE} eventSlug={props.eventSlug ?? ""} />);
}

const przycisk = (nazwa: string | RegExp): HTMLElement =>
  screen.getByRole("button", { name: nazwa });

/**
 * Kontrolki po NAZWIE DOSTĘPNEJ i po ROLI.
 *
 * Sama nazwa nie wystarcza: pole frazy, jego etykieta i przycisk lupy noszą TEN
 * SAM napis (`searchPlaceholder` jedzie i do `<Label>`, i do `aria-label`
 * przycisku), więc `getByLabelText` zwraca dwa elementy. Rola rozstrzyga to
 * jednoznacznie i przy okazji pilnuje, że kontrolka NADAL jest tym, czym była.
 */
const dropka = (nazwa: string): HTMLElement => screen.getByRole("combobox", { name: nazwa });
const poleTekstowe = (nazwa: string): HTMLElement => screen.getByRole("textbox", { name: nazwa });
const poleLiczbowe = (nazwa: string): HTMLElement =>
  screen.getByRole("spinbutton", { name: nazwa });

/**
 * Strzałki stronicowania - PO POZYCJI W NAWIGACJI.
 *
 * Pozycja zostaje CELOWO, choć oba przyciski mają już nazwę dostępną: dzięki
 * temu osobny przypadek niżej sprawdza SAME NAZWY i czerwieni się, gdy znikną,
 * zamiast rozsypywać wszystkie testy stronicowania naraz.
 */
function strzalki(): { poprzednia: HTMLElement; nastepna: HTMLElement } {
  const nav = screen.getByRole("navigation", { name: `${B}.title` });
  const guziki = within(nav).getAllByRole("button");
  return { poprzednia: guziki[0] as HTMLElement, nastepna: guziki[1] as HTMLElement };
}

/** Ostatnie argumenty, z jakimi zawołano hook LISTY (bez wywołań eksportu). */
function ostatnieZapytanie(): RegistrationsQuery {
  const lista = h.listQueries.filter(
    (query) => (query as { eksport?: boolean }).eksport !== true,
  ) as RegistrationsQuery[];
  const last = lista.at(-1);
  if (last === undefined) throw new Error("hook listy nie dostał ani jednego zapytania");
  return last;
}

/** Wywołania `fetchRegistrations` z eksportu - lista chodzi przez hook. */
function zapytaniaEksportu(): RegistrationsQuery[] {
  return h.listQueries.filter(
    (query) => (query as { eksport?: boolean }).eksport === true,
  ) as RegistrationsQuery[];
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

function opcje(el: HTMLElement): string[] {
  return [...el.querySelectorAll("option")].map((option) => option.value);
}

beforeEach(() => {
  h.lang = "pl";
  h.rows = [registrationRow()];
  h.total = 1;
  h.listLoading = false;
  h.listError = null;
  h.listQueries = [];
  h.counts = counts();
  h.countsQueries = [];
  h.tickets = [];
  h.refetchList.mockClear();
  h.refetchCounts.mockClear();
  h.markReset.mockClear();
  h.decideCalls = [];
  h.decideError = null;
  h.decidePending = false;
  h.promoteCalls = [];
  h.promoteError = null;
  h.promotePending = false;
  h.notifyCalls = [];
  h.notifyResults = {};
  h.notifyHang = false;
  h.exportPages = [];
  h.exportError = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.toastWarning.mockClear();
});

describe("cztery stany listy zgłoszeń", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednego wiersza", () => {
    h.listLoading = true;
    h.rows = [];
    panel();

    expect(screen.getByText(`${B}.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${B}.empty`)).toBeNull();
  });

  // TO JEST UDOKUMENTOWANA KLASA BŁĘDU TEGO MODUŁU. „Brak zgłoszeń" po nieudanym
  // zapytaniu w dniu wydarzenia czyta się jako „nikt się nie zapisał", a to jest
  // nieprawda, po której organizator otwiera salę i idzie do domu.
  it("AWARIA pokazuje odmowę i ŻADNEGO z dwóch napisów o pustce", () => {
    h.listError = new Error("registrations: odmowa RPC");
    h.rows = [];
    panel();

    expect(screen.getByText("odmowa:registrations: odmowa RPC")).toBeTruthy();
    expect(screen.queryByText(`${B}.empty`)).toBeNull();
    expect(screen.queryByText(`${B}.emptyFiltered`)).toBeNull();
  });

  it("pustka BEZ filtrów mówi „jeszcze nikt”, a nie „wyczyść filtry”", () => {
    h.rows = [];
    h.total = 0;
    panel();

    expect(screen.getByText(`${B}.empty`)).toBeTruthy();
    expect(screen.queryByText(`${B}.emptyFiltered`)).toBeNull();
  });

  // TRZY DROGI DO ZAWĘŻENIA, jedno zdanie o pustce: status, bilet i fraza.
  // Każda z nich osobno musi zmieniać komunikat - inaczej organizator szuka
  // zgłoszenia, które istnieje, w przekroju, w którym go nie widać.
  it.each([
    [
      "status",
      () => fireEvent.change(dropka(`${B}.filters.status`), { target: { value: "waitlist" } }),
    ],
    ["bilet", () => fireEvent.change(dropka(`${B}.filters.ticket`), { target: { value: BILET } })],
    [
      "fraza",
      () => {
        fireEvent.change(poleTekstowe(`${B}.searchPlaceholder`), { target: { value: "nowak" } });
        fireEvent.click(przycisk(`${B}.searchPlaceholder`));
      },
    ],
  ])("pustka po zawężeniu przez %s mówi drugą rzecz", (_nazwa, zawez) => {
    h.tickets = [eventTicketRow()];
    panel();
    h.rows = [];
    h.total = 0;

    zawez();

    expect(screen.getByText(`${B}.emptyFiltered`)).toBeTruthy();
    expect(screen.queryByText(`${B}.empty`)).toBeNull();
  });

  it("dane rysują wiersz z nazwiskiem i adresem poczty", () => {
    h.rows = [registrationRow({ first_name: "Anna", last_name: "Nowak" })];
    panel();

    expect(wiersze()).toHaveLength(1);
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.getByText("anna@example.test")).toBeTruthy();
  });
});

describe("filtry, fraza i strona", () => {
  it("stan wyjściowy jedzie do zapytania z domyślnym oknem strony", () => {
    panel();

    expect(ostatnieZapytanie()).toEqual({
      eventId: WYDARZENIE,
      status: "all",
      ticketTypeId: null,
      groupId: null,
      q: "",
      from: null,
      to: null,
      limit: DEFAULT_REGISTRATIONS_QUERY.limit,
      offset: 0,
    });
  });

  // LICZNIKI IGNORUJĄ STATUS - inaczej każda pozycja droplisty pokazywałaby
  // liczbę samej siebie, czyli tyle, ile wierszy widać na ekranie.
  it("liczniki dostają te same filtry BEZ statusu, strony i okna", () => {
    panel();

    const args = h.countsQueries.at(-1) as Record<string, unknown>;
    expect(args).toEqual({
      eventId: WYDARZENIE,
      ticketTypeId: null,
      groupId: null,
      q: "",
      from: null,
      to: null,
    });
    expect(args).not.toHaveProperty("status");
  });

  it("zmiana statusu jedzie do zapytania i WRACA na pierwszą stronę", () => {
    h.total = 90;
    panel();
    fireEvent.click(strzalki().nastepna);
    expect(ostatnieZapytanie().offset).toBe(DEFAULT_REGISTRATIONS_QUERY.limit);

    fireEvent.change(dropka(`${B}.filters.status`), { target: { value: "waitlist" } });

    expect(ostatnieZapytanie().status).toBe("waitlist");
    expect(ostatnieZapytanie().offset).toBe(0);
  });

  // KATALOG BILETÓW JEDZIE OSOBNYM ZAPYTANIEM, więc bywa moment, w którym listy
  // jeszcze nie ma. Droplista bez ani jednej pozycji nie dałaby się wyzerować.
  it("zanim katalog biletów dojedzie, droplista ma samą pozycję „wszystkie”", () => {
    h.tickets = undefined;
    panel();

    expect(opcje(dropka(`${B}.filters.ticket`))).toEqual(["__all__"]);
  });

  // NAZWA BILETU SPADA NA DRUGI JĘZYK. Bilet nienazwany po angielsku ma pokazać
  // nazwę polską, a nie pustą pozycję - pusty wiersz droplisty jest nieklikalny
  // wzrokiem i organizator nie wie, co właśnie wybiera.
  it.each([
    ["pl", "", "VIP pass", "VIP pass"],
    ["en", "Karnet VIP", "", "Karnet VIP"],
    ["pl", "Karnet VIP", "VIP pass", "Karnet VIP"],
    ["en", "Karnet VIP", "VIP pass", "VIP pass"],
  ])(
    "droplista biletów w języku „%s” (pl=„%s”, en=„%s”) pokazuje „%s”",
    (jezyk, nazwaPl, nazwaEn, oczekiwana) => {
      h.lang = jezyk;
      h.tickets = [eventTicketRow({ name_pl: nazwaPl, name_en: nazwaEn })];
      panel();

      expect(
        within(dropka(`${B}.filters.ticket`)).getByRole("option", { name: oczekiwana }),
      ).toBeTruthy();
    },
  );

  it("zmiana biletu jedzie do zapytania, a „wszystkie bilety” ZDEJMUJE filtr", () => {
    h.tickets = [eventTicketRow(), eventTicketRow({ id: INNY_BILET, name_pl: "Standard" })];
    panel();

    fireEvent.change(dropka(`${B}.filters.ticket`), { target: { value: INNY_BILET } });
    expect(ostatnieZapytanie().ticketTypeId).toBe(INNY_BILET);

    fireEvent.change(dropka(`${B}.filters.ticket`), { target: { value: "__all__" } });
    expect(ostatnieZapytanie().ticketTypeId).toBeNull();
  });

  // PISANIE NIE PYTA BAZY. Zapytanie na każdą literę to dwadzieścia zapytań
  // na jedno nazwisko - fraza wychodzi dopiero po zatwierdzeniu.
  it("wpisanie frazy NIE wysyła zapytania - dopiero przycisk szukania", () => {
    h.total = 90;
    panel();
    const przed = ostatnieZapytanie();

    fireEvent.change(poleTekstowe(`${B}.searchPlaceholder`), { target: { value: "nowak" } });
    expect(ostatnieZapytanie().q).toBe(przed.q);

    fireEvent.click(przycisk(`${B}.searchPlaceholder`));

    expect(ostatnieZapytanie().q).toBe("nowak");
    // Wpisana fraza ZOSTAJE w polu - inaczej organizator nie wie, czego szukał.
    expect((poleTekstowe(`${B}.searchPlaceholder`) as HTMLInputElement).value).toBe("nowak");
  });

  it("Enter w polu frazy działa jak przycisk, a inny klawisz nie", () => {
    panel();
    const szukajka = poleTekstowe(`${B}.searchPlaceholder`);

    fireEvent.change(szukajka, { target: { value: "nowak" } });
    fireEvent.keyDown(szukajka, { key: "a" });
    expect(ostatnieZapytanie().q).toBe("");

    fireEvent.keyDown(szukajka, { key: "Enter" });
    expect(ostatnieZapytanie().q).toBe("nowak");
  });

  it("zatwierdzenie frazy też WRACA na pierwszą stronę", () => {
    h.total = 90;
    panel();
    fireEvent.click(strzalki().nastepna);

    fireEvent.change(poleTekstowe(`${B}.searchPlaceholder`), { target: { value: "nowak" } });
    fireEvent.click(przycisk(`${B}.searchPlaceholder`));

    expect(ostatnieZapytanie().offset).toBe(0);
  });

  // ZNALEZISKO, NIE ZACHOWANIE DO ZATWIERDZENIA. Obie strzałki stronicowania
  // niosą wyłącznie piktogram: nie mają ani napisu, ani `aria-label`, więc
  // czytnik ekranu ogłasza „przycisk, przycisk" i nie da się z klawiatury
  // stwierdzić, która cofa, a która przewija dalej. Reszta panelu (pole frazy,
  // lupa, droplisty) etykiety MA, więc to nie była przyjęta konwencja ekranu,
  // tylko brak w dwóch przyciskach.
  it("strzałki stronicowania mają nazwę dostępną", () => {
    h.total = 60;
    panel();

    const { poprzednia, nastepna } = strzalki();
    expect(poprzednia).toHaveAccessibleName();
    expect(nastepna).toHaveAccessibleName();
  });

  // ZBIÓR JEST MNIEJSZY NIŻ STRONA - dwie martwe strzałki to szum, nie nawigacja.
  it("stopka stron znika, gdy wszystko mieści się na jednej stronie", () => {
    h.total = 3;
    panel();

    expect(screen.queryByRole("navigation", { name: `${B}.title` })).toBeNull();
  });

  it("stopka stron liczy strony, gasi skrajne strzałki i przesuwa okno", () => {
    h.total = 60;
    panel();

    expect(screen.getByText("1 / 3")).toBeTruthy();
    expect(strzalki().poprzednia).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(strzalki().nastepna);
    expect(ostatnieZapytanie().offset).toBe(25);
    expect(screen.getByText("2 / 3")).toBeTruthy();

    fireEvent.click(strzalki().nastepna);
    expect(ostatnieZapytanie().offset).toBe(50);
    expect(strzalki().nastepna).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(strzalki().poprzednia);
    expect(ostatnieZapytanie().offset).toBe(25);
  });
});

describe("liczniki i pojemność sali", () => {
  it("droplista statusu niesie liczbę przy KAŻDEJ pozycji", () => {
    h.counts = counts({ all: 9 });
    panel();

    const status = dropka(`${B}.filters.status`);
    expect(within(status).getByRole("option", { name: `${B}.tabs.all (9)` })).toBeTruthy();
    expect(
      within(status).getByRole("option", { name: "adminEventRegistration.statuses.pending (2)" }),
    ).toBeTruthy();
    // Zbiór pozycji jest ZAMKNIĘTY i idzie z kontraktu bazy - „wszystkie"
    // plus osiem stanów CHECK-a.
    expect(opcje(status)).toEqual([
      "all",
      "draft",
      "pending",
      "approved",
      "rejected",
      "waitlist",
      "cancelled",
      "attended",
      "no_show",
    ]);
  });

  // ZANIM LICZNIKI DOJADĄ, POZYCJA NIE MA NAWIASU. „(0)" przy oczekujących
  // znaczy „sprawdziłem, nie ma" - a to jest inna informacja niż „jeszcze nie wiem".
  it("bez licznikow pozycje droplisty są BEZ nawiasu, a nie z zerem", () => {
    h.counts = null;
    panel();

    const status = dropka(`${B}.filters.status`);
    expect(within(status).getByRole("option", { name: `${B}.tabs.all` })).toBeTruthy();
    expect(within(status).queryByRole("option", { name: /\(0\)/ })).toBeNull();
  });

  it.each([
    ["bez licznikow", null, `${B}.capacity.unlimited`],
    ["bez limitu miejsc", counts({ capacity: null, seatsLeft: null }), `${B}.capacity.unlimited`],
    ["wyprzedane", counts({ capacity: 100, seatsLeft: 0 }), `${B}.capacity.soldOut`],
    [
      "z miejscami",
      counts({ capacity: 100, seatsLeft: 12 }),
      `${B}.capacity.ofCapacity(capacity=100,left=12)`,
    ],
  ])("pojemność sali %s ma własne zdanie", (_nazwa, dane, napis) => {
    h.counts = dane;
    panel();

    expect(screen.getByText(napis)).toBeTruthy();
  });

  // `seatsLeft === null` PRZY ISTNIEJĄCEJ POJEMNOŚCI to stan, którego RPC nie
  // powinno oddać - ale gdy odda, „0 wolnych" jest bliżej prawdy niż „bez limitu".
  it("brak liczby wolnych miejsc przy znanej pojemności czyta się jak wyprzedane", () => {
    h.counts = counts({ capacity: 100, seatsLeft: null });
    panel();

    expect(screen.getByText(`${B}.capacity.soldOut`)).toBeTruthy();
  });

  it("licznik czekających na powiadomienie pokazuje się TYLKO, gdy ktoś czeka", () => {
    h.counts = counts({ awaitingNotice: 0 });
    const { rerender } = panel();
    expect(screen.queryByText(/waitlist\.awaitingNotice/)).toBeNull();

    h.counts = counts({ awaitingNotice: 4 });
    rerender(<RegistrationsListPanel eventId={WYDARZENIE} />);

    expect(screen.getByText("adminEventRegistration.waitlist.awaitingNotice: 4")).toBeTruthy();
  });
});

describe("co niesie wiersz zgłoszenia", () => {
  it("osoba bez imienia i nazwiska jest pokazana adresem poczty", () => {
    h.rows = [registrationRow({ first_name: "", last_name: "", email: "kto@example.test" })];
    panel();

    expect(screen.getAllByText("kto@example.test")).toHaveLength(2);
  });

  it("stanowisko i firma sklejają się w jeden wiersz, a puste pola go nie brudzą", () => {
    h.rows = [
      registrationRow({ id: "a", job_title: "Analityk", company_name: "Firma SA" }),
      registrationRow({ id: "b", job_title: "", company_name: null, company_text: "" }),
    ];
    panel();

    expect(screen.getByText("Analityk · Firma SA")).toBeTruthy();
    // Drugi wiersz nie ma pokazać ani kropki rozdzielającej, ani „null".
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it("firma WPISANA RĘCZNIE zastępuje kartotekową, gdy tej nie ma", () => {
    h.rows = [registrationRow({ company_name: null, company_text: "Firma z formularza" })];
    panel();

    expect(screen.getByText("Firma z formularza")).toBeTruthy();
  });

  it("bilet i grupa są plakietkami, a zgłoszenie bez nich ich NIE dostaje", () => {
    h.rows = [
      registrationRow({
        id: "a",
        ticket_type_id: BILET,
        ticket_name_pl: "Karnet VIP",
        group_id: "grp",
        group_name_pl: "Prelegenci",
      }),
      registrationRow({ id: "b" }),
    ];
    panel();

    expect(screen.getByText("Karnet VIP")).toBeTruthy();
    expect(screen.getByText("Prelegenci")).toBeTruthy();
    expect(within(wiersze()[1] as HTMLElement).queryByText("Karnet VIP")).toBeNull();
  });

  // POZYCJA W KOLEJCE MA SENS TYLKO W KOLEJCE. Pokazana przy zatwierdzonym
  // zgłoszeniu mówi o miejscu, którego już nie ma.
  it("pozycja w rezerwie stoi TYLKO przy zgłoszeniu z rezerwy", () => {
    h.rows = [
      registrationRow({ id: "a", status: "waitlist", waitlist_position: 3 }),
      registrationRow({ id: "b", status: "approved", waitlist_position: 3 }),
    ];
    panel();

    expect(screen.getAllByText(/waitlist\.position\(position=3\)/)).toHaveLength(1);
  });

  it("rezerwa BEZ policzonej pozycji nie pokazuje pustej plakietki", () => {
    h.rows = [registrationRow({ status: "waitlist", waitlist_position: null })];
    panel();

    expect(screen.queryByText(/waitlist\.position/)).toBeNull();
  });

  // OSOBA BEZ KONTA NIE DOSTAJE POWIADOMIENIA W APLIKACJI, więc „awansowany, ale
  // niepowiadomiony" musi być widoczny, a nie domyślany z daty awansu.
  it("awansowany bez wysłanej wiadomości ma własną plakietkę", () => {
    h.rows = [
      registrationRow({ id: "a", promoted_at: "2026-08-05T10:00:00.000Z" }),
      registrationRow({
        id: "b",
        promoted_at: "2026-08-05T10:00:00.000Z",
        waitlist_notified_at: "2026-08-05T11:00:00.000Z",
      }),
    ];
    panel();

    expect(screen.getAllByText("adminEventRegistration.waitlist.notNotified")).toHaveLength(1);
  });

  it("braki w zgodach obowiązkowych i wycofanie zgody mają dwie różne plakietki", () => {
    h.rows = [
      registrationRow({
        id: "a",
        required_terms_missing: 2,
        consent_withdrawn_at: "2026-08-10T10:00:00.000Z",
      }),
      registrationRow({ id: "b" }),
    ];
    panel();

    expect(screen.getByText(`${B}.consents.requiredMissing(count=2)`)).toBeTruthy();
    expect(screen.getByText(`${B}.consents.withdrawn`)).toBeTruthy();
    expect(within(wiersze()[1] as HTMLElement).queryByText(/consents\./)).toBeNull();
  });

  it("uzasadnienie decyzji pokazuje się tylko wtedy, gdy ktoś je napisał", () => {
    h.rows = [
      registrationRow({ id: "a", decision_note: "brak miejsc" }),
      registrationRow({ id: "b", decision_note: "" }),
      registrationRow({ id: "c", decision_note: null }),
    ];
    panel();

    expect(screen.getByText(`${B}.decision.note: brak miejsc`)).toBeTruthy();
    expect(screen.getAllByText(/decision\.note/)).toHaveLength(1);
  });

  it("nazwa biletu spada na drugi język, a bez obu na klucz", () => {
    h.lang = "en";
    h.rows = [
      registrationRow({
        id: "a",
        ticket_type_id: BILET,
        ticket_name_pl: "Karnet VIP",
        ticket_name_en: "",
      }),
      registrationRow({
        id: "b",
        ticket_type_id: INNY_BILET,
        ticket_name_pl: "",
        ticket_name_en: "",
        ticket_key: "vip_pass",
      }),
    ];
    panel();

    expect(screen.getByText("Karnet VIP")).toBeTruthy();
    expect(screen.getByText("vip_pass")).toBeTruthy();
  });

  // ZESTAW PRZYCISKÓW WYNIKA ZE STANU WIERSZA. Przycisk, który baza odrzuci
  // komunikatem `invalid_transition`, jest gorszy niż jego brak.
  it("zestaw decyzji zależy od stanu zgłoszenia", () => {
    h.rows = [registrationRow({ status: "attended" })];
    panel();

    const wiersz = wiersze()[0] as HTMLElement;
    expect(within(wiersz).getByRole("button", { name: /actions\.no_show/ })).toBeTruthy();
    expect(within(wiersz).queryByRole("button", { name: /actions\.approve/ })).toBeNull();
  });

  it("stan spoza kontraktu bazy nie dostaje ŻADNEGO przycisku decyzji", () => {
    h.rows = [registrationRow({ status: "z_kosmosu" })];
    panel();

    const wiersz = wiersze()[0] as HTMLElement;
    expect(within(wiersz).queryAllByRole("button")).toHaveLength(0);
    // Nieznany stan i tak dostaje plakietkę - pusty pasek statusu czyta się jak
    // uszkodzony wiersz. (Napis awaryjny dokłada i18n przez `defaultValue`,
    // czego atrapa słownika nie pokazuje - tu liczy się, że plakietka JEST.)
    expect(within(wiersz).getByText(/statuses\.z_kosmosu/)).toBeTruthy();
  });
});

describe("decyzja organizatora", () => {
  const otworzDecyzje = (nazwa: string) => {
    const wiersz = wiersze()[0] as HTMLElement;
    fireEvent.click(within(wiersz).getByRole("button", { name: nazwa }));
  };

  const potwierdz = () =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: `${B}.decideDialog.confirmAction`,
      }),
    );

  it("kliknięcie decyzji NIE zapisuje - najpierw pyta, i pytanie niesie NAZWISKO", () => {
    panel();
    expect(screen.queryByRole("dialog")).toBeNull();

    otworzDecyzje("adminEventRegistration.actions.approve");

    const okno = screen.getByRole("dialog");
    expect(within(okno).getByText("Anna Nowak")).toBeTruthy();
    expect(h.decideCalls).toEqual([]);
  });

  it("potwierdzenie wysyła identyfikator, czynność i NOTATKĘ", () => {
    panel();
    otworzDecyzje("adminEventRegistration.actions.approve");

    fireEvent.change(screen.getByLabelText(`${B}.decideDialog.noteLabel`), {
      target: { value: "  gość honorowy  " },
    });
    potwierdz();

    expect(h.decideCalls).toEqual([
      { registrationId: "reg-1", action: "approve", note: "gość honorowy" },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.approved`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("decyzja bez notatki jedzie z `null`, a nie z pustym napisem", () => {
    panel();
    otworzDecyzje("adminEventRegistration.actions.approve");

    potwierdz();

    expect(h.decideCalls).toEqual([{ registrationId: "reg-1", action: "approve", note: null }]);
  });

  // ODMOWA NIE MOŻE KASOWAĆ PRACY. Okno zostaje otwarte z wpisanym powodem -
  // inaczej organizator pisze uzasadnienie drugi raz.
  it("odmowa serwera mówi to wprost i ZOSTAWIA okno otwarte z powodem", () => {
    h.decideError = new Error("registrations: invalid_transition");
    panel();
    otworzDecyzje("adminEventRegistration.actions.reject");
    const powod = screen.getByLabelText(`${B}.decideDialog.reasonLabel`);
    fireEvent.change(powod, { target: { value: "brak miejsc" } });

    potwierdz();

    expect(h.toastError).toHaveBeenCalledWith("odmowa:registrations: invalid_transition");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (screen.getByLabelText(`${B}.decideDialog.reasonLabel`) as HTMLTextAreaElement).value,
    ).toBe("brak miejsc");
    // Poczta NIE leci, skoro decyzja się nie zapisała.
    expect(h.notifyCalls).toEqual([]);
  });

  it("zamknięcie okna bez potwierdzenia niczego nie zapisuje", () => {
    panel();
    otworzDecyzje("adminEventRegistration.actions.approve");

    // Ponowne „otwarcie" już otwartego okna NIE gubi wybranego wiersza - to ta
    // sama ścieżka, którą Radix woła przy przechwyceniu fokusa.
    fireEvent.click(screen.getByTestId("okno-otworz"));
    expect(within(screen.getByRole("dialog")).getByText("Anna Nowak")).toBeTruthy();

    fireEvent.click(screen.getByTestId("okno-zamknij"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.decideCalls).toEqual([]);
  });

  it("trwający zapis GASI przyciski decyzji w wierszu", () => {
    h.decidePending = true;
    panel();

    const wiersz = wiersze()[0] as HTMLElement;
    expect(
      within(wiersz).getByRole("button", { name: "adminEventRegistration.actions.approve" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  // DECYZJA BEZ WIADOMOŚCI TO DECYZJA, O KTÓREJ UCZESTNIK SIĘ NIE DOWIE.
  it.each([
    ["approve", "approved"],
    ["reject", "rejected"],
  ])("decyzja „%s” ciągnie za sobą mail o odpowiedniej treści", async (czynnosc, notice) => {
    h.rows = [registrationRow({ status: "pending" })];
    panel();
    otworzDecyzje(`adminEventRegistration.actions.${czynnosc}`);
    if (czynnosc === "reject") {
      fireEvent.change(screen.getByLabelText(`${B}.decideDialog.reasonLabel`), {
        target: { value: "brak miejsc" },
      });
    }

    potwierdz();

    await waitFor(() => expect(h.notifyCalls).toEqual([{ registrationId: "reg-1", notice }]));
  });

  // POZOSTAŁE CZTERY CZYNNOŚCI TO NOTATKI ORGANIZACYJNE. Mail „odnotowano
  // obecność" jest spamem, a nie informacją.
  it.each(["waitlist", "cancel", "attended", "no_show"])(
    "czynność „%s” NIE wysyła maila",
    async (czynnosc) => {
      h.rows = [
        registrationRow({
          status: czynnosc === "attended" || czynnosc === "no_show" ? "approved" : "pending",
        }),
      ];
      panel();
      otworzDecyzje(`adminEventRegistration.actions.${czynnosc}`);
      if (czynnosc === "cancel") {
        fireEvent.change(screen.getByLabelText(`${B}.decideDialog.reasonLabel`), {
          target: { value: "rezygnacja" },
        });
      }

      potwierdz();

      await waitFor(() => expect(h.decideCalls).toHaveLength(1));
      expect(h.notifyCalls).toEqual([]);
    },
  );

  // FAIL-SOFT: nieudana wysyłka NIE cofa decyzji, ale organizator musi o niej
  // wiedzieć - inaczej uczestnik czeka na mail, który nigdy nie przyszedł.
  it("odmowa poczty NIE cofa decyzji, ale dostaje własny komunikat", async () => {
    h.notifyResults = { "reg-1": { ok: false } };
    panel();
    otworzDecyzje("adminEventRegistration.actions.approve");

    potwierdz();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.notifyFailed`));
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.approved`);
    expect(h.decideCalls).toHaveLength(1);
  });

  it("wyjątek w wysyłce też kończy się komunikatem, a nie ciszą", async () => {
    h.notifyResults = { "reg-1": "throw" };
    panel();
    otworzDecyzje("adminEventRegistration.actions.approve");

    potwierdz();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.notifyFailed`));
  });
});

describe("awans z rezerwy", () => {
  it("awans jedzie z wydarzeniem, filtrem biletu i LICZBĄ z pola", () => {
    h.tickets = [eventTicketRow()];
    panel();
    fireEvent.change(dropka(`${B}.filters.ticket`), { target: { value: BILET } });
    fireEvent.change(poleLiczbowe("adminEventRegistration.waitlist.promoteCountLabel"), {
      target: { value: "3" },
    });

    fireEvent.click(przycisk("adminEventRegistration.actions.promote"));

    expect(h.promoteCalls).toEqual([
      { eventId: WYDARZENIE, registrationId: null, ticketTypeId: BILET, count: 3 },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.promoted(count=3)`);
  });

  // ZERO ALBO ŚMIECI W POLU LICZBOWYM to awans zera osób - operacja, która
  // wygląda na wykonaną i nie robi nic.
  it.each(["0", "-4", "", "abc"])("liczba „%s” w polu awansu podnosi się do 1", (wpis) => {
    panel();
    fireEvent.change(poleLiczbowe("adminEventRegistration.waitlist.promoteCountLabel"), {
      target: { value: wpis },
    });

    fireEvent.click(przycisk("adminEventRegistration.actions.promote"));

    expect((h.promoteCalls[0] as WaitlistPromoteInput).count).toBe(1);
  });

  it("odmowa awansu mówi to wprost", () => {
    h.promoteError = new Error("registrations: no_waitlist");
    panel();

    fireEvent.click(przycisk("adminEventRegistration.actions.promote"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:registrations: no_waitlist");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("trwający awans GASI przycisk", () => {
    h.promotePending = true;
    panel();

    expect(przycisk("adminEventRegistration.actions.promote")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("powiadomienie awansowanych", () => {
  const awansowany = (id: string) =>
    registrationRow({ id, status: "approved", promoted_at: "2026-08-05T10:00:00.000Z" });

  it("bez ani jednego czekającego przycisk jest zgaszony I nic nie wysyła", () => {
    panel();
    const guzik = przycisk("adminEventRegistration.actions.markNotified");
    expect(guzik).toHaveAttribute("aria-disabled", "true");

    // Bramka w handlerze, nie sam atrybut: klawiatura i czytnik ekranu potrafią
    // wywołać `onClick` przy `aria-disabled`, a wtedy poszłaby pusta seria.
    fireEvent.click(guzik);

    expect(h.notifyCalls).toEqual([]);
  });

  // SZEREGOWO, NIE RÓWNOLEGLE. Dwadzieścia równoległych wywołań kończy się
  // limitem po stronie dostawcy, a nie dwudziestoma mailami.
  it("wysyła po JEDNYM mailu na czekający wiersz i liczy wysłane", async () => {
    h.rows = [awansowany("reg-1"), awansowany("reg-2"), registrationRow({ id: "reg-3" })];
    panel();

    fireEvent.click(przycisk("adminEventRegistration.actions.markNotified"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.notified(count=2)`),
    );
    expect(h.notifyCalls).toEqual([
      { registrationId: "reg-1", notice: "promoted" },
      { registrationId: "reg-2", notice: "promoted" },
    ]);
    expect(h.toastError).not.toHaveBeenCalled();
    // Pieczęć stawia serwer, więc lista i liczniki muszą się odświeżyć - inaczej
    // wiersze zostają w „czeka na powiadomienie" i ktoś wyśle mail drugi raz.
    expect(h.refetchList).toHaveBeenCalled();
    expect(h.refetchCounts).toHaveBeenCalled();
    expect(h.markReset).toHaveBeenCalled();
  });

  // DWIE LICZBY, DWA KOMUNIKATY. „Wysłano 1" bez informacji o dwóch porażkach
  // to raport, po którym organizator jest pewien, że powiadomił wszystkich.
  it("część nieudanych dostaje OSOBNY komunikat, obok liczby wysłanych", async () => {
    h.rows = [awansowany("reg-1"), awansowany("reg-2"), awansowany("reg-3")];
    h.notifyResults = { "reg-2": { ok: false }, "reg-3": "throw" };
    panel();

    fireEvent.click(przycisk("adminEventRegistration.actions.markNotified"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.notifyFailedCount(count=2)`),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.notified(count=1)`);
  });

  it("same porażki NIE udają sukcesu", async () => {
    h.rows = [awansowany("reg-1")];
    h.notifyResults = { "reg-1": { ok: false } };
    panel();

    fireEvent.click(przycisk("adminEventRegistration.actions.markNotified"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(`${B}.toasts.notifyFailedCount(count=1)`),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("druga seria NIE rusza, dopóki trwa pierwsza", () => {
    h.rows = [awansowany("reg-1")];
    h.notifyHang = true;
    panel();

    const guzik = przycisk("adminEventRegistration.actions.markNotified");
    fireEvent.click(guzik);
    fireEvent.click(guzik);

    expect(h.notifyCalls).toHaveLength(1);
    expect(guzik).toHaveAttribute("aria-disabled", "true");
  });
});

describe("eksport listy uczestników", () => {
  function przechwycPobranie(): {
    linki: HTMLAnchorElement[];
    utworzUrl: ReturnType<typeof vi.fn>;
  } {
    const utworzUrl = vi.fn().mockReturnValue("blob:csv");
    vi.stubGlobal("URL", { ...URL, createObjectURL: utworzUrl, revokeObjectURL: vi.fn() });
    const linki: HTMLAnchorElement[] = [];
    const realne = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realne(tag);
      if (tag === "a") {
        linki.push(el as HTMLAnchorElement);
        (el as HTMLAnchorElement).click = vi.fn();
      }
      return el;
    });
    return { linki, utworzUrl };
  }

  // Podmianka `document.createElement` MUSI wracać po każdym przypadku - bez
  // tego kolejny test nakłada szpiega na szpiega i render kończy się
  // przepełnieniem stosu.
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pusta lista GASI eksport - plik z samym nagłówkiem to pułapka", () => {
    h.rows = [];
    h.total = 0;
    panel();

    expect(przycisk("adminEventRegistration.actions.exportCsv")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  // BIERZE CAŁY PRZEKRÓJ FILTRA, NIE BIEŻĄCĄ STRONĘ. RPC tnie do 200 wierszy
  // i NIE zgłasza tego błędem - poproszenie o 2000 daje 200 wierszy wyglądających
  // na komplet, czyli plik, któremu organizator ufa.
  it("chodzi po stronach po 200 wierszy z filtrem, który widać na ekranie", async () => {
    h.rows = [registrationRow()];
    h.total = 300;
    h.exportPages = [
      {
        rows: Array.from({ length: STRONA_EKSPORTU }, (_, i) => registrationRow({ id: `a${i}` })),
        total: 300,
      },
      {
        rows: Array.from({ length: 100 }, (_, i) => registrationRow({ id: `b${i}` })),
        total: 300,
      },
    ];
    const { linki, utworzUrl } = przechwycPobranie();
    panel({ eventSlug: "kongres" });
    fireEvent.change(dropka(`${B}.filters.status`), { target: { value: "approved" } });

    fireEvent.click(przycisk("adminEventRegistration.actions.exportCsv"));

    await waitFor(() => expect(utworzUrl).toHaveBeenCalledTimes(1));
    const strony = zapytaniaEksportu();
    expect(strony.map((query) => query.offset)).toEqual([0, STRONA_EKSPORTU]);
    expect(strony[0]?.limit).toBe(STRONA_EKSPORTU);
    expect(strony[0]?.status).toBe("approved");
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.exported(count=300)`);
    expect(h.toastWarning).not.toHaveBeenCalled();
    // Nazwa pliku NIESIE SLUG WYDARZENIA - inaczej trzy eksporty z trzech
    // wydarzeń lądują u odbiorcy jako trzy pliki o tej samej nazwie.
    expect(linki.find((link) => link.download !== "")?.download).toMatch(
      /^uczestnicy-kongres-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  // NIE OBIECUJEMY KOMPLETU, KTÓREGO NIE MAMY. Liczba w komunikacie jest liczbą
  // WIERSZY W PLIKU, a nie liczbą zgłoszeń w bazie.
  it("ucięcie po setnej stronie ostrzega, zamiast udawać komplet", async () => {
    h.rows = [registrationRow()];
    h.total = 30_000;
    h.exportPages = Array.from({ length: 100 }, () => ({
      rows: Array.from({ length: STRONA_EKSPORTU }, (_, i) => registrationRow({ id: `x${i}` })),
      total: 30_000,
    }));
    const { utworzUrl } = przechwycPobranie();
    panel();

    fireEvent.click(przycisk("adminEventRegistration.actions.exportCsv"));

    await waitFor(() => expect(utworzUrl).toHaveBeenCalledTimes(1));
    expect(zapytaniaEksportu()).toHaveLength(100);
    expect(h.toastWarning).toHaveBeenCalledWith(`${B}.toasts.exportTruncated`);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${B}.toasts.exported(count=20000)`);
  });

  it("krótsza strona kończy pętlę po jednym zapytaniu", async () => {
    h.rows = [registrationRow()];
    h.total = 2;
    h.exportPages = [
      { rows: [registrationRow({ id: "a" }), registrationRow({ id: "b" })], total: 2 },
    ];
    const { utworzUrl } = przechwycPobranie();
    panel();

    fireEvent.click(przycisk("adminEventRegistration.actions.exportCsv"));

    await waitFor(() => expect(utworzUrl).toHaveBeenCalledTimes(1));
    expect(zapytaniaEksportu()).toHaveLength(1);
  });

  it("odmowa w trakcie eksportu mówi to wprost i zwalnia przycisk", async () => {
    h.rows = [registrationRow()];
    h.total = 5;
    h.exportError = new Error("registrations: odmowa eksportu");
    panel();

    fireEvent.click(przycisk("adminEventRegistration.actions.exportCsv"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:registrations: odmowa eksportu"),
    );
    expect(przycisk("adminEventRegistration.actions.exportCsv")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("druga seria eksportu NIE rusza, dopóki trwa pierwsza", async () => {
    h.rows = [registrationRow()];
    h.total = 5;
    h.exportPages = [];
    przechwycPobranie();
    panel();

    const guzik = przycisk("adminEventRegistration.actions.exportCsv");
    fireEvent.click(guzik);
    fireEvent.click(guzik);

    await waitFor(() => expect(zapytaniaEksportu()).toHaveLength(1));
  });
});

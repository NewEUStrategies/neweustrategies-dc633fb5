// Organizm „LISTA SPOTKAŃ 1-1" - ekran, na którym organizator odnotowuje
// frekwencję i ODWOŁUJE spotkanie, którego obie strony już się spodziewają.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. „PUSTO" TO NIE „NIE UDAŁO SIĘ". Trzy stany listy (wczytywanie, odmowa
//     bazy, brak wierszy) prowadzą do trzech różnych działań organizatora.
//     Komunikat „brak spotkań" po nieudanym zapytaniu jest nieprawdą o stanie
//     bazy - a organizator wyciąga z niego wniosek, że giełda nie ruszyła.
//
//  2. PUSTO PO FILTRZE MÓWI CO INNEGO NIŻ PUSTO W OGÓLE. „Nikt się nie umówił"
//     i „nikt nie pasuje do zakładki »Nieobecności«" to dwie różne informacje;
//     jedno zdanie na oba każe szukać awarii tam, gdzie jej nie ma.
//
//  3. „WYGASŁE" NIE JEST STANEM W KOLUMNIE. Baza trzyma `invited` i osobną
//     flagę `is_expired`; etykieta wiersza musi mówić prawdę, a zakładka
//     „Wygasłe" musi jechać do SERWERA jako filtr, a nie porównywać dat
//     w przeglądarce - dwie implementacje tej samej reguły rozjeżdżają się
//     przy pierwszej zmianie strefy.
//
//  4. ODWOŁANIE SPOTKANIA PO AKCEPTACJI ZWALNIA MIEJSCE PRZY STOLIKU. Wiersz
//     `accepted` siedzi na konkretnym miejscu; odwołanie musi odświeżyć nie
//     tylko listę, ale i OBCIĄŻENIE STOLIKÓW - inaczej filtr stolika i licznik
//     obok pokazują zajęte miejsce, którego już nie ma, i organizator nie
//     posadzi tam nikogo innego.
//
//  5. ŁADUNEK ODWOŁANIA JEST TYM, CO ZOBACZY BAZA. Pusty powód jedzie jako
//     `null`, a nie jako pusty napis (baza trzyma `NULL` dla „bez powodu”),
//     a odmowa NIE zostawia dialogu otwartego z wpisanym powodem, tylko mówi
//     zdaniem, co się stało.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Dialogu „Umów spotkanie" - ma własny plik
// `ArrangeMeetingDialog.test.tsx`, tutaj jest atrapą, bo przedmiotem dowodu
// jest wyłącznie to, że przycisk go OTWIERA. (2) Mapowania odmów bazy
// (`adminMeetingErrors.test.ts`) - jego prawdziwa wersja ciągnie pełną
// instancję i18n. (3) Zachowania hooków (`useMeetings.test.tsx`) - tutaj hooki
// są PRAWDZIWE, atrapą jest dopiero warstwa sieciowa, żeby test przechodził
// przez ten sam `useQuery`/`useMutation`, co produkcja.
//
// RODO: wszystkie nazwiska i firmy są zmyślone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { axeViolations, summarize } from "@/test/axe";
import type {
  AdminMeetingRow,
  AdminMeetingsQuery,
  MeetingTableRow,
} from "@/lib/events/meetingsApi";

const h = vi.hoisted(() => ({
  meetings: vi.fn(),
  tables: vi.fn(),
  setStatus: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

// Mapowanie odmów bazy ma własny plik testowy, a jego prawdziwa wersja ciągnie
// pełną instancję i18n. Atrapa oddaje GŁOWĘ komunikatu, więc asercja widzi,
// KTÓRA odmowa doszła do ekranu, a nie tylko „coś się nie udało".
vi.mock("@/lib/events/adminMeetingErrors", () => ({
  adminMeetingFailure: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return { key: `adminEventMeetings.errors.${message.split(":")[0]}`, params: {} };
  },
}));

// Dialog umawiania ma własny plik testowy i własną warstwę danych; tutaj liczy
// się WYŁĄCZNIE to, że przycisk nagłówka go otwiera.
vi.mock("@/components/admin/events/organisms/ArrangeMeetingDialog", () => ({
  ArrangeMeetingDialog: ({ open, eventId }: { open: boolean; eventId: string }) => (
    <div data-testid="atrapa-umow" data-open={String(open)} data-event={eventId} />
  ),
}));

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  interface PropsWyzwalacza {
    children?: ReactNode;
    id?: string;
    "aria-label"?: string;
  }
  interface PropsWartosci {
    placeholder?: string;
  }
  // Radixowy `Select` nie otwiera listy pod happy-dom (brak pełnego API
  // wskaźnika). Atrapa jest wierna w tym, na czym stoją asercje: pokazuje PEŁNĄ
  // listę opcji i NAZYWA pole tym samym napisem, którym nazywa je Radix -
  // treścią wyzwalacza, czyli podpowiedzią `SelectValue`. Bez tego asercja
  // dostępności mierzyłaby brak portalu, a nie wadę panelu.
  const podpis = (wyzwalacz: unknown): string | undefined => {
    if (!react.isValidElement(wyzwalacz)) return undefined;
    const props = wyzwalacz.props as PropsWyzwalacza;
    if (typeof props["aria-label"] === "string") return props["aria-label"];
    let znaleziony: string | undefined;
    react.Children.forEach(props.children, (dziecko) => {
      if (!react.isValidElement(dziecko)) return;
      const wartosc = dziecko.props as PropsWartosci;
      if (typeof wartosc.placeholder === "string") znaleziony = wartosc.placeholder;
    });
    return znaleziony;
  };
  const jestWyzwalaczem = (node: unknown): boolean =>
    react.isValidElement(node) && podpis(node) !== undefined;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (next: string) => void;
      children?: ReactNode;
    }) => {
      const czesci = react.Children.toArray(children);
      const wyzwalacz = czesci.find(jestWyzwalaczem);
      const tresc = czesci.filter((czesc) => czesc !== wyzwalacz);
      return (
        <select
          aria-label={podpis(wyzwalacz)}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {tresc}
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

const TYTUL_POTWIERDZENIA = "atrapa-potwierdzenie-tytul";

vi.mock("@/components/ui/alert-dialog", async () => {
  const react = await import("react");
  // Radixowe okno potwierdzenia montuje się w portalu i pod happy-dom nie
  // odtwarza mechaniki fokusa. Atrapa zostawia z niego KONTRAKT: przy
  // zamkniętym oknie w drzewie nie ma nic, a otwarte jest OPISANE swoim
  // tytułem (Radix wiąże je przez `aria-labelledby`).
  const Ctx = react.createContext<{ open: boolean; zamknij: () => void }>({
    open: false,
    zamknij: () => undefined,
  });
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => (
      <Ctx.Provider value={{ open: open === true, zamknij: () => onOpenChange?.(false) }}>
        {children}
      </Ctx.Provider>
    ),
    AlertDialogContent: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return ctx.open ? (
        <div role="alertdialog" aria-labelledby={TYTUL_POTWIERDZENIA}>
          {children}
        </div>
      ) : null;
    },
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => (
      <h3 id={TYTUL_POTWIERDZENIA}>{children}</h3>
    ),
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return (
        <button type="button" onClick={ctx.zamknij}>
          {children}
        </button>
      );
    },
    AlertDialogAction: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Warstwa sieciowa jest JEDYNĄ atrapą logiki - hooki `useMeetings` zostają
// prawdziwe, żeby test przechodził przez ten sam `useMutation`, co produkcja
// (unieważnienie gałęzi, kolejność `onSuccess`/`onError`).
vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  fetchAdminMeetings: (query: unknown) => h.meetings(query),
  fetchMeetingTables: (eventId: string) => h.tables(eventId),
  setMeetingStatus: (input: unknown) => h.setStatus(input),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const { MeetingsListPanel } = await import("@/components/admin/events/organisms/MeetingsListPanel");

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const STOLIK = "22222222-2222-4222-8222-222222222222";
const L = "adminEventMeetings.list";

/**
 * Nadpisania wiersza DOPUSZCZAJĄ `null`, choć wygenerowany typ `Returns` go nie
 * przewiduje. To nie obejście typów, tylko odwzorowanie bazy:
 * `admin_event_meetings_list` naprawdę oddaje NULL w `table_label`,
 * `table_seat`, `topic`, `sponsor_name` i w kolumnach firmy (spotkanie bez
 * stolika, uczestnik bez firmy w profilu), a sam organizm to wie - stąd jego
 * jawne `=== null`. Bez tej mapy najciekawsze przypadki tego pliku byłyby nie
 * do zapisania.
 */
type NadpisanieWiersza = { [K in keyof AdminMeetingRow]?: AdminMeetingRow[K] | null };

function wiersz(over: NadpisanieWiersza = {}): AdminMeetingRow {
  return {
    attendance_marked_at: null,
    cancel_reason: null,
    cancelled_at: null,
    cancelled_side: null,
    created_at: "2026-09-01T08:00:00.000Z",
    decline_reason: null,
    ends_at: "2026-09-10T08:20:00.000Z",
    expires_at: "2026-09-09T08:00:00.000Z",
    id: "m-1",
    invitation_message: null,
    invitee_company: "Instytut Analiz",
    invitee_first_name: "Anna",
    invitee_group_name_en: "Delegates",
    invitee_group_name_pl: "Delegaci",
    invitee_job_title: "Analityczka",
    invitee_last_name: "Kowalska",
    invitee_registration_id: "reg-2",
    is_expired: false,
    requester_company: "Firma Alfa",
    requester_first_name: "Jan",
    requester_group_name_en: "Sponsors",
    requester_group_name_pl: "Sponsorzy",
    requester_job_title: "Dyrektor",
    requester_last_name: "Nowak",
    requester_registration_id: "reg-1",
    rescheduled_from_id: null,
    responded_at: null,
    sponsor_id: null,
    sponsor_name: null,
    starts_at: "2026-09-10T08:00:00.000Z",
    status: "invited",
    table_id: STOLIK,
    table_label: "Stolik 4",
    table_seat: 2,
    table_zone: "Sala A",
    topic: "Energia",
    total_count: 1,
    ...over,
  } as unknown as AdminMeetingRow;
}

/** Stolik listy filtrów; kolumny nullowalne w bazie stawiamy jawnie. */
function stolik(over: Partial<MeetingTableRow> = {}): MeetingTableRow {
  return {
    capacity: 1,
    created_at: "2026-08-01T08:00:00.000Z",
    id: STOLIK,
    is_active: true,
    label: "Stolik 4",
    meetings_count: 3,
    minutes_taken: 60,
    next_meeting_at: "2026-09-10T08:00:00.000Z",
    note: null,
    room_id: null,
    room_name: null,
    sort_order: 0,
    updated_at: "2026-08-01T08:00:00.000Z",
    zone: "Sala A",
    ...over,
  } as unknown as MeetingTableRow;
}

function panel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MeetingsListPanel eventId={WYDARZENIE} />
    </QueryClientProvider>,
  );
}

/** Obietnica, która nigdy się nie rozstrzyga - zamraża stan wczytywania/zapisu. */
function nigdy(): Promise<never> {
  return new Promise<never>(() => {});
}

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });
const potwierdzenie = (): HTMLElement => screen.getByRole("alertdialog");
const ostatnieZapytanie = (): AdminMeetingsQuery =>
  h.meetings.mock.calls[h.meetings.mock.calls.length - 1]?.[0] as AdminMeetingsQuery;

beforeEach(() => {
  vi.clearAllMocks();
  h.meetings.mockResolvedValue([wiersz()]);
  h.tables.mockResolvedValue([stolik()]);
  h.setStatus.mockResolvedValue({});
});

describe("MeetingsListPanel - trzy stany listy to trzy różne informacje", () => {
  it("WCZYTYWANIE nie udaje pustki", async () => {
    h.meetings.mockReturnValue(nigdy());
    panel();
    expect(await screen.findByText(`${L}.loading`)).toBeInTheDocument();
    expect(screen.queryByText(`${L}.empty`)).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("ODMOWA BAZY nie udaje pustki - pokazuje, KTÓRA odmowa doszła", async () => {
    h.meetings.mockRejectedValue(new Error("forbidden: not an editor"));
    panel();
    expect(await screen.findByText("adminEventMeetings.errors.forbidden")).toBeInTheDocument();
    expect(screen.queryByText(`${L}.empty`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${L}.emptyFiltered`)).not.toBeInTheDocument();
  });

  it("PUSTKA mówi to wprost i nie rysuje ani jednego wiersza", async () => {
    h.meetings.mockResolvedValue([]);
    panel();
    expect(await screen.findByText(`${L}.empty`)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("pustka PO FILTRZE ma własne zdanie", async () => {
    h.meetings.mockResolvedValue([]);
    panel();
    await screen.findByText(`${L}.empty`);

    fireEvent.click(przycisk(`${L}.tabs.no_show`));
    expect(await screen.findByText(`${L}.emptyFiltered`)).toBeInTheDocument();
    expect(screen.queryByText(`${L}.empty`)).not.toBeInTheDocument();
  });

  it("filtr można wyczyścić, a przycisk czyszczenia pojawia się dopiero po filtrze", async () => {
    // Powrót do widoku bez filtrów odczytuje się z PAMIĘCI zapytań (ten zbiór
    // był już pobrany przy montowaniu), więc dowodem jest STAN EKRANU, a nie
    // kolejne wyjście do sieci: zniknięty przycisk czyszczenia i puste pola.
    panel();
    await screen.findByRole("listitem");
    expect(screen.queryByRole("button", { name: `${L}.clearFilters` })).not.toBeInTheDocument();
    expect(h.meetings.mock.calls[0]?.[0]).toMatchObject({ search: null, tableId: null });

    fireEvent.change(screen.getByPlaceholderText(`${L}.searchPlaceholder`), {
      target: { value: "  kowalska  " },
    });
    fireEvent.click(przycisk(`${L}.tabs.held`));
    await waitFor(() => expect(ostatnieZapytanie().search).toBe("kowalska"));
    expect(ostatnieZapytanie().status).toBe("held");

    fireEvent.click(przycisk(`${L}.clearFilters`));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: `${L}.clearFilters` })).not.toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText(`${L}.searchPlaceholder`)).toHaveValue("");
    expect(screen.getByRole("combobox", { name: `${L}.tableFilter` })).toHaveValue("all");
  });
});

describe("filtry jadą do SERWERA, a nie do przeglądarki", () => {
  it("zakładka „Wygasłe” jest filtrem serwera, nie porównaniem dat", async () => {
    panel();
    await screen.findByRole("listitem");

    fireEvent.click(przycisk(`${L}.tabs.expired`));
    await waitFor(() => expect(ostatnieZapytanie().status).toBe("expired"));
    expect(ostatnieZapytanie().offset).toBe(0);
  });

  it("wiersz `invited` z flagą `is_expired` ma odznakę WYGASŁEGO, a nie „zaproszony”", async () => {
    // Baza trzyma stan `invited`; etykieta liczona z samej kolumny kłamałaby
    // organizatorowi, że zaproszenie wciąż czeka na odpowiedź.
    h.meetings.mockResolvedValue([wiersz({ status: "invited", is_expired: true })]);
    panel();
    expect(await screen.findByText("eventMeetings.statuses.expired")).toBeInTheDocument();
    expect(screen.queryByText("eventMeetings.statuses.invited")).not.toBeInTheDocument();
  });

  it("wiersz `invited` BEZ flagi zostaje zaproszeniem", async () => {
    panel();
    expect(await screen.findByText("eventMeetings.statuses.invited")).toBeInTheDocument();
  });

  it("filtr stolika wysyła IDENTYFIKATOR, a `all` znaczy „bez filtra”", async () => {
    panel();
    await screen.findByRole("listitem");
    const pole = await screen.findByRole("combobox", { name: `${L}.tableFilter` });
    // Widok bez filtra pyta o `table_id: null` - to jest ładunek z montowania.
    expect(h.meetings.mock.calls[0]?.[0]).toMatchObject({ tableId: null });

    fireEvent.change(pole, { target: { value: STOLIK } });
    await waitFor(() => expect(ostatnieZapytanie().tableId).toBe(STOLIK));
    expect(przycisk(`${L}.clearFilters`)).toBeInTheDocument();

    fireEvent.change(pole, { target: { value: "all" } });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: `${L}.clearFilters` })).not.toBeInTheDocument(),
    );
  });

  it("fraza z samych spacji NIE jest filtrem", async () => {
    // `search.trim().length === 0 ? null : ...` - białe znaki nie mogą zawęzić
    // listy ani zamienić komunikatu pustki na „nic nie pasuje do filtra".
    panel();
    await screen.findByRole("listitem");
    const pole = screen.getByPlaceholderText(`${L}.searchPlaceholder`);
    expect(h.meetings.mock.calls[0]?.[0]).toMatchObject({ search: null });

    fireEvent.change(pole, { target: { value: "nowak" } });
    await waitFor(() => expect(ostatnieZapytanie().search).toBe("nowak"));

    fireEvent.change(pole, { target: { value: "   " } });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: `${L}.clearFilters` })).not.toBeInTheDocument(),
    );
  });

  it("stronicowanie idzie po `total_count` z wiersza i przesuwa `offset`", async () => {
    h.meetings.mockResolvedValue([wiersz({ total_count: 60 })]);
    panel();
    await screen.findByRole("listitem");
    expect(screen.getByText(`${L}.showingRange(from=1,to=1,total=60)`)).toBeInTheDocument();

    fireEvent.click(przycisk(">"));
    await waitFor(() => expect(ostatnieZapytanie().offset).toBe(25));
    expect(ostatnieZapytanie().limit).toBe(25);
  });

  it("jedna strona wyników NIE pokazuje stopki stronicowania", async () => {
    panel();
    await screen.findByRole("listitem");
    expect(screen.queryByRole("button", { name: ">" })).not.toBeInTheDocument();
  });
});

describe("wiersz opisuje spotkanie tak, jak oddaje je baza", () => {
  it("spotkanie BEZ stolika mówi o tym wprost, zamiast pokazywać puste miejsce", async () => {
    h.meetings.mockResolvedValue([wiersz({ table_label: null, table_seat: null })]);
    panel();
    await screen.findByRole("listitem");
    expect(screen.getByText(new RegExp(`${L}\\.noTable`))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`${L}\\.seatLabel`))).not.toBeInTheDocument();
  });

  it("spotkanie PRZY stoliku pokazuje numer miejsca", async () => {
    panel();
    await screen.findByRole("listitem");
    expect(screen.getByText(new RegExp(`${L}\\.seatLabel\\(seat=2\\)`))).toBeInTheDocument();
  });

  it("uczestnik BEZ firmy nie dostaje wiszącego separatora", async () => {
    h.meetings.mockResolvedValue([wiersz({ invitee_company: null })]);
    panel();
    const wiersze = await screen.findAllByRole("listitem");
    expect(wiersze[0]?.textContent).toContain("Jan Nowak · Firma Alfa");
    expect(wiersze[0]?.textContent).toContain("Anna Kowalska");
    expect(wiersze[0]?.textContent).not.toContain("Anna Kowalska ·");
  });

  it("temat rozmowy widać, gdy baza go oddała", async () => {
    panel();
    await screen.findByRole("listitem");
    expect(screen.getByText("Energia")).toBeInTheDocument();
  });

  it("spotkanie BEZ tematu nie rysuje pustego akapitu", async () => {
    h.meetings.mockResolvedValue([wiersz({ topic: null })]);
    panel();
    await screen.findByRole("listitem");
    expect(screen.queryByText("Energia")).not.toBeInTheDocument();
  });

  it("sponsor spotkania jest dopisany dopiero wtedy, gdy jest", async () => {
    h.meetings.mockResolvedValue([wiersz({ sponsor_name: "Firma Alfa sp. z o.o." })]);
    panel();
    const wiersze = await screen.findAllByRole("listitem");
    expect(wiersze[0]?.textContent).toContain("Firma Alfa sp. z o.o.");
  });
});

describe("frekwencja jest odwracalna, odwołanie nie", () => {
  it("„odbyło się” idzie JEDNYM kliknięciem, bez potwierdzenia", async () => {
    panel();
    await screen.findByRole("listitem");

    fireEvent.click(przycisk(`${L}.markHeldAction`));
    await waitFor(() =>
      expect(h.setStatus).toHaveBeenCalledWith({ meetingId: "m-1", status: "held" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(h.success).toHaveBeenCalledWith("adminEventMeetings.toasts.attendanceHeld"),
    );
  });

  it("„nieobecność” ma własny stan i własny komunikat", async () => {
    panel();
    await screen.findByRole("listitem");

    fireEvent.click(przycisk(`${L}.markNoShowAction`));
    await waitFor(() =>
      expect(h.setStatus).toHaveBeenCalledWith({ meetingId: "m-1", status: "no_show" }),
    );
    await waitFor(() =>
      expect(h.success).toHaveBeenCalledWith("adminEventMeetings.toasts.attendanceNoShow"),
    );
  });

  it("odmowa przy frekwencji kończy się ZDANIEM, a nie surowym wyjątkiem", async () => {
    h.setStatus.mockRejectedValue(new Error("meeting_not_active: already cancelled"));
    panel();
    await screen.findByRole("listitem");

    fireEvent.click(przycisk(`${L}.markHeldAction`));
    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("adminEventMeetings.errors.meeting_not_active"),
    );
    expect(h.success).not.toHaveBeenCalled();
  });

  it("odwołanie przechodzi przez POTWIERDZENIE - samo kliknięcie nic nie wysyła", async () => {
    panel();
    await screen.findByRole("listitem");

    fireEvent.click(przycisk(`${L}.cancelAction`));
    expect(potwierdzenie()).toBeInTheDocument();
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it("rezygnacja z potwierdzenia zamyka okno i nie odwołuje spotkania", async () => {
    panel();
    await screen.findByRole("listitem");
    fireEvent.click(przycisk(`${L}.cancelAction`));

    fireEvent.click(
      within(potwierdzenie()).getByRole("button", {
        name: "adminEventMeetings.tables.cancelAction",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.setStatus).not.toHaveBeenCalled();
  });
});

describe("KOLIZJA: odwołanie spotkania PO akceptacji", () => {
  it("zwalnia miejsce przy stoliku - lista I obciążenie stolików czytają się na nowo", async () => {
    // Wiersz `accepted` siedzi na miejscu nr 2 przy „Stoliku 4". Po odwołaniu
    // filtr stolika i licznik obciążenia obok muszą zobaczyć zwolnione miejsce,
    // więc mutacja unieważnia CAŁĄ gałąź wydarzenia, a nie samą listę.
    h.meetings.mockResolvedValue([wiersz({ status: "accepted", table_seat: 2 })]);
    panel();
    await screen.findByRole("listitem");
    await waitFor(() => expect(h.tables).toHaveBeenCalledTimes(1));
    expect(h.meetings).toHaveBeenCalledTimes(1);

    fireEvent.click(przycisk(`${L}.cancelAction`));
    fireEvent.change(screen.getByLabelText(`${L}.cancelReasonLabel`), {
      target: { value: "  sala zajęta  " },
    });
    fireEvent.click(within(potwierdzenie()).getByRole("button", { name: `${L}.cancelAction` }));

    await waitFor(() =>
      expect(h.setStatus).toHaveBeenCalledWith({
        meetingId: "m-1",
        status: "cancelled",
        reason: "sala zajęta",
      }),
    );
    await waitFor(() => expect(h.tables).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.meetings).toHaveBeenCalledTimes(2));
    expect(h.success).toHaveBeenCalledWith("adminEventMeetings.toasts.meetingCancelled");
  });

  it("po udanym odwołaniu okno się zamyka, a powód nie zostaje na następne", async () => {
    h.meetings.mockResolvedValue([wiersz({ status: "accepted" })]);
    panel();
    await screen.findByRole("listitem");

    fireEvent.click(przycisk(`${L}.cancelAction`));
    fireEvent.change(screen.getByLabelText(`${L}.cancelReasonLabel`), {
      target: { value: "kolizja przy stoliku" },
    });
    fireEvent.click(within(potwierdzenie()).getByRole("button", { name: `${L}.cancelAction` }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    fireEvent.click(przycisk(`${L}.cancelAction`));
    expect(screen.getByLabelText(`${L}.cancelReasonLabel`)).toHaveValue("");
  });

  it("PUSTY powód jedzie jako `null`, a nie jako pusty napis", async () => {
    // Baza trzyma „bez powodu" jako NULL; pusty napis zostawiłby w historii
    // spotkania widoczną, pustą adnotację.
    h.meetings.mockResolvedValue([wiersz({ status: "accepted" })]);
    panel();
    await screen.findByRole("listitem");

    fireEvent.click(przycisk(`${L}.cancelAction`));
    fireEvent.change(screen.getByLabelText(`${L}.cancelReasonLabel`), {
      target: { value: "    " },
    });
    fireEvent.click(within(potwierdzenie()).getByRole("button", { name: `${L}.cancelAction` }));

    await waitFor(() =>
      expect(h.setStatus).toHaveBeenCalledWith({
        meetingId: "m-1",
        status: "cancelled",
        reason: null,
      }),
    );
  });

  it("odmowa odwołania zamyka okno i mówi, KTÓRA reguła zablokowała", async () => {
    h.meetings.mockResolvedValue([wiersz({ status: "held" })]);
    h.setStatus.mockRejectedValue(new Error("meeting_not_active: meeting already held"));
    panel();
    await screen.findByRole("listitem");

    fireEvent.click(przycisk(`${L}.cancelAction`));
    fireEvent.click(within(potwierdzenie()).getByRole("button", { name: `${L}.cancelAction` }));

    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("adminEventMeetings.errors.meeting_not_active"),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.success).not.toHaveBeenCalled();
  });

  it.fails(
    "ZAPIS W TOKU NIE BLOKUJE POTWIERDZENIA: drugie kliknięcie wysyła DRUGIE odwołanie",
    async () => {
      // Defekt. `confirmCancel` nie patrzy na `setStatusMutation.isPending`,
      // a przycisk potwierdzenia nie ma `disabled` - dwa kliknięcia w trakcie
      // trwającego zapisu to dwa wywołania `admin_event_meeting_set_status` dla
      // TEGO SAMEGO spotkania. Drugie kończy się odmową `meeting_not_active`,
      // czyli czerwonym komunikatem o błędzie po operacji, która się UDAŁA.
      // Wzorzec „blokuj przycisk na czas zapisu" stoi obok, w
      // `ArrangeMeetingDialog` (`!arrange.isPending` w `canSubmit`) i w
      // `MeetingTableDialog` (`isSaving`), więc ten ekran jest tu wyjątkiem.
      h.meetings.mockResolvedValue([wiersz({ status: "accepted" })]);
      h.setStatus.mockReturnValue(nigdy());
      panel();
      await screen.findByRole("listitem");

      fireEvent.click(przycisk(`${L}.cancelAction`));
      const potwierdz = within(potwierdzenie()).getByRole("button", { name: `${L}.cancelAction` });
      fireEvent.click(potwierdz);
      fireEvent.click(potwierdz);

      // `mutate` odpala funkcję mutacji w mikrozadaniu, więc czekamy na PIERWSZE
      // wywołanie, zanim policzymy wszystkie - inaczej test padałby na zerze,
      // czyli z innego powodu niż opisany defekt.
      await waitFor(() => expect(h.setStatus).toHaveBeenCalled());
      expect(h.setStatus).toHaveBeenCalledTimes(1);
    },
  );
});

describe("nagłówek i dostępność", () => {
  it("przycisk nagłówka otwiera dialog umawiania dla TEGO wydarzenia", async () => {
    panel();
    await screen.findByRole("listitem");
    expect(screen.getByTestId("atrapa-umow")).toHaveAttribute("data-open", "false");

    fireEvent.click(przycisk(`${L}.arrangeAction`));
    expect(screen.getByTestId("atrapa-umow")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("atrapa-umow")).toHaveAttribute("data-event", WYDARZENIE);
  });

  it("lista spotkań nie ma naruszeń dostępności", async () => {
    const { container } = panel();
    await screen.findByRole("listitem");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("otwarte potwierdzenie odwołania też nie ma naruszeń dostępności", async () => {
    const { container } = panel();
    await screen.findByRole("listitem");
    fireEvent.click(przycisk(`${L}.cancelAction`));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// Organizm „Lista wydarzeń" - SKLEJENIE dwóch zapytań, stanu URL i trzech operacji.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJĄ CZTERY WIDOKI: wczytywanie, awaria, pustka
//      bez filtrów, pustka POD filtrem. Awaria pokazująca komunikat pustki to
//      udokumentowana klasa błędu tego modułu - „nie ma wydarzeń" po nieudanym
//      zapytaniu to nieprawda o stanie bazy, a redaktor zakłada wtedy drugie
//      wydarzenie o tej samej nazwie. Dlatego awaria ma tu WŁASNY przypadek
//      z kontrapunktem: żaden z dwóch napisów o pustce nie ma prawa się pojawić.
//   2. KAŻDA ZMIANA FILTRA JEDZIE DO ADRESU, NIE DO `useState`. Asercje idą na
//      ładunku przekazanym do `navigate` - nie na wyglądzie kontrolki - bo to
//      ten ładunek decyduje o argumentach RPC przy następnym renderze. Przy
//      okazji pilnujemy dwóch rzeczy, które łatwo zgubić: zmiana zakładki NIE
//      kasuje wpisanej frazy, a każda zmiana filtra ZERUJE stronę.
//   3. LICZNIKI ZAKŁADEK NIE GASNĄ PRZY PRZEŁĄCZANIU. To był realny błąd:
//      klucz cache liczników niósł `tab`, `page` i `size`, więc każde
//      przełączenie trafiało w pusty klucz, `data` stawało się `undefined`,
//      a sześć liczb mrugało do zera i wracało. Test przełącza zakładkę,
//      stronę i rozmiar strony NA CIEPŁYM CACHE i sprawdza, że liczby stoją,
//      a zapytanie o liczniki poszło DOKŁADNIE RAZ. Dlatego ten plik NIE
//      mockuje hooków - mockuje warstwę RPC i pracuje na prawdziwym
//      `react-query`; na atrapie hooka ten dowód byłby dowodem na atrapę.
//   4. OPERACJE MASOWE: pasek pojawia się dopiero po zaznaczeniu, zaznaczenie
//      jest PRZYCIĘTE do widocznych wierszy, kasowanie idzie PO KOLEI, a
//      odmowa serwera zostawia zaznaczenie na ekranie.
//   5. TRWAJĄCE ŻĄDANIE GASI PRZYCISK - podwójne kliknięcie w eksport i w
//      kasowanie wysyła JEDNO żądanie.
//   6. SORTOWANIE MA TRZY STANY (rosnąco, malejąco, porządek serwera) i cztery
//      klucze; puste wartości lądują na końcu NIEZALEŻNIE od kierunku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Modelu stanu URL - tabele przypadków
// (`parseEventListParams`, `eventListQueryArgs`, `eventCountsQueryArgs`) są
// w `lib/events/__tests__`; tutaj dowodzimy, że organizm ich UŻYWA i co wysyła
// do routera. (2) Molekuł `EventListFilters`, `EventListRow` i
// `AdminCatalogListState` - mają własne pliki. (3) Kontraktu RPC
// (`fetchAdminEvents`, `fetchAdminEventCounts`) - to `eventsListApi`; tutaj
// warstwa danych jest atrapą, bo przedmiotem dowodu jest to, CO organizm do
// niej wysyła i co robi z odpowiedzią.
//
// DLACZEGO PRAWDZIWY `Button`, A NIE ATRAPA. W tym organizmie jedyną ochroną
// przed drugim żądaniem jest atrybut `disabled` (nie ma ani jednej bramki
// wewnątrz handlera), więc atrapa puszczająca handler przy zgaszonym przycisku
// testowałaby zachowanie, którego przeglądarka nigdy nie wywoła.
//
// Radix Select, Checkbox i Dialog nie działają pod happy-dom bez pełnego
// pointer API - mają natywne odpowiedniki.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AdminEventCounts, AdminEventListRow } from "@/lib/events/eventsListApi";
import type { EventListParams } from "@/lib/events/eventListParams";
import type { EventTypeOption } from "@/lib/events/eventTypes";

/** Rozmiar strony eksportu - lustro stałej `EXPORT_CHUNK` organizmu. */
const ROZMIAR_EKSPORTU = 200;

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  /** Wiersze oddawane zapytaniu LISTY (nie eksportowi). */
  rows: [] as unknown[],
  listHang: false,
  listError: null as Error | null,
  /** Argumenty każdego wywołania `fetchAdminEvents`, w kolejności. */
  listCalls: [] as { params: EventListParams; now: Date }[],
  counts: null as unknown,
  countsCalls: [] as EventListParams[],
  /** Kolejne strony eksportu - `shift()` przy każdym wywołaniu z `size: 200`. */
  exportChunks: [] as unknown[][],
  exportError: null as Error | null,
  types: [] as unknown[] | undefined,
  deleted: [] as string[],
  deleteHang: false,
  deleteError: null as Error | null,
  remindersCalls: 0,
  remindersCount: 0,
  remindersError: null as Error | null,
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-community-events", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));

// Selektor ikony ciągnie cały katalog Lucide - tutaj liczy się wyłącznie NAZWA
// ikony, którą wiersz próbuje narysować.
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid={`ikona-${name}`} />,
}));

// Droplisty rodzaju i formatu stoją na Radix Select (przez `FormSelect`).
// Atrapa jest natywna i ETYKIETOWANA, bo przedmiotem dowodu jest to, KTÓRA
// wartość dojedzie do adresu - nie to, jak wygląda popup.
vi.mock("@/components/atoms/FormSelect", () => {
  const FormSelect = ({
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  );
  return { FormSelect, default: FormSelect };
});

// Checkbox nagłówka ma TRZY stany - „część zaznaczona" jedzie do `aria-checked`
// jako `mixed`, dokładnie tak jak robi to Radix, żeby asercja mogła pytać
// dostępnie (`toBePartiallyChecked`), a nie o klasę CSS.
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...reszta
  }: {
    checked?: boolean | "indeterminate";
    onCheckedChange?: (next: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={reszta["aria-label"]}
      aria-checked={checked === "indeterminate" ? "mixed" : undefined}
      checked={checked === true}
      onChange={() => onCheckedChange?.(checked !== true)}
    />
  ),
}));

// Droplisty stopki paginacji. Nazwa dostępna siedzi na WYZWALACZU Radiksa
// (`aria-labelledby`), którego atrapa nie renderuje, więc - jak w
// `ClubMembersTab.test.tsx` - rozpoznajemy je po ZBIORZE OPCJI.
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
    <select
      data-testid="select"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
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

// Okno potwierdzenia: treść istnieje TYLKO przy otwartym dialogu (portal nie
// jest montowany). Bez tego „pytanie nie pada bez kliknięcia" byłoby dowodem
// na atrapę, a nie na organizm.
vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    // Dwa przyciski sterujące (jak w `ClubMembersTab.test.tsx`) zastępują Escape
    // i kliknięcie poza oknem, których happy-dom nie wywoła bez pointer API -
    // a to jedyna droga do handlera `onOpenChange` organizmu.
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

// WARSTWA DANYCH JEST ATRAPĄ, HOOKI SĄ PRAWDZIWE. To jedyny układ, w którym da
// się dowieść, że klucz cache liczników nie niesie zakładki - atrapa hooka
// oddawałaby liczby niezależnie od klucza.
vi.mock("@/lib/events/eventsListApi", () => ({
  fetchAdminEvents: (params: EventListParams, now: Date) => {
    h.listCalls.push({ params, now });
    if (params.size === ROZMIAR_EKSPORTU) {
      if (h.exportError !== null) return Promise.reject(h.exportError);
      return Promise.resolve(h.exportChunks.shift() ?? []);
    }
    if (h.listHang) return new Promise<never>(() => {});
    if (h.listError !== null) return Promise.reject(h.listError);
    return Promise.resolve(h.rows);
  },
  fetchAdminEventCounts: (params: EventListParams) => {
    h.countsCalls.push(params);
    return Promise.resolve(h.counts);
  },
  createEventFromType: () => Promise.resolve("nowe"),
}));

vi.mock("@/lib/events/useEventTypes", () => ({
  eventTypeKeys: { all: ["event-types"] as const },
  useEventTypes: () => ({ data: h.types }),
}));

vi.mock("@/lib/admin/community", () => ({
  deleteEvent: (id: string) => {
    h.deleted.push(id);
    if (h.deleteHang) return new Promise<never>(() => {});
    return h.deleteError === null ? Promise.resolve() : Promise.reject(h.deleteError);
  },
  runEventReminders: () => {
    h.remindersCalls += 1;
    return h.remindersError === null
      ? Promise.resolve(h.remindersCount)
      : Promise.reject(h.remindersError);
  },
}));

import { EventsListManager } from "@/components/admin/events/organisms/EventsListManager";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

/** Zegar podany z zewnątrz - granica „przyszłe/przeszłe" nie może zależeć od maszyny. */
const TERAZ = new Date("2026-08-29T12:00:00.000Z");

const RODZAJ = "0f9c1a2b-3d4e-4f50-8a61-72b83c94d5e6";
const INNY_RODZAJ = "1a2b3c4d-5e6f-4071-8283-94a5b6c7d8e9";

/**
 * Kolumny NULL-owalne, które generator typuje jako `number`/`string`.
 *
 * `seats_left`, `type_icon`, `type_accent_color` i `type_name_*` przychodzą
 * z RPC jako `null` („bez limitu miejsc", „rodzaj skasowany"), ale wygenerowany
 * typ tego nie wie - organizm ma na to JAWNE warunki (`seats_left !== null`,
 * `type_name_pl === null`). Fixtura, która wstawiłaby tu zero albo pusty napis,
 * testowałaby kształt, którego RPC nigdy nie odda, a prawdziwe gałęzie zostałyby
 * nietknięte. Stąd nadpisania są typowane szeroko, a nie przez `Partial` na
 * skłamanym typie.
 */
type NadpisaniaWiersza = Partial<Record<keyof AdminEventListRow, string | number | boolean | null>>;

/** Wydarzenie opublikowane, bez limitu miejsc, bez kolejki - najuboższy wiersz. */
function eventRow(over: NadpisaniaWiersza = {}): AdminEventListRow {
  return {
    cancelled_at: "",
    capacity: 0,
    chatham_house: false,
    cover_url: "",
    ends_at: "",
    event_type_id: RODZAJ,
    format: "onsite",
    going_count: 0,
    guest_mode: "full",
    has_recording: false,
    has_stream: false,
    id: "ev-1",
    interested_count: 0,
    kind: "in_person",
    location: "",
    min_tier_rank: 0,
    published_at: "2026-08-01T10:00:00.000Z",
    registration_flow: "direct",
    registration_mode: "internal",
    seats_left: null,
    slug: "kongres",
    speakers_count: 0,
    starts_at: "2026-09-10T08:00:00.000Z",
    status: "published",
    ticket_currency: "PLN",
    ticket_price_cents: 0,
    timezone: "Europe/Warsaw",
    title_en: "Congress",
    title_pl: "Kongres",
    total_count: 1,
    type_accent_color: null,
    type_icon: null,
    type_key: "congress",
    type_name_en: "Congress",
    type_name_pl: "Kongres",
    visibility: "public",
    waitlist_count: 0,
    ...over,
  } as AdminEventListRow;
}

function eventCounts(over: Partial<AdminEventCounts> = {}): AdminEventCounts {
  return { all: 12, draft: 3, published: 7, cancelled: 1, upcoming: 5, past: 2, ...over };
}

/** Rodzaj z katalogu - droplista filtra czyta z niego trzy pola. */
function typeOption(over: Partial<EventTypeOption> = {}): EventTypeOption {
  return {
    accent_color: "#D73953",
    default_capacity: 0,
    default_chatham_house: false,
    default_duration_minutes: 60,
    default_format: "onsite",
    default_guest_mode: "full",
    default_min_tier_rank: 0,
    default_registration_flow: "direct",
    default_registration_mode: "internal",
    description_en: "",
    description_pl: "",
    icon: "calendar-days",
    id: RODZAJ,
    key: "congress",
    name_en: "Congress",
    name_pl: "Kongres",
    requires_ticket: false,
    sort_order: 10,
    ...over,
  };
}

function panel(params: EventListParams = {}) {
  const wynik = renderWithQueryClient(<EventsListManager params={params} now={TERAZ} />);
  const klient: QueryClient = wynik.queryClient;
  return {
    ...wynik,
    /** Powrót z routera: nowy adres = nowe `params` w tym samym drzewie. */
    przerysuj: (next: EventListParams) =>
      wynik.rerender(
        <QueryClientProvider client={klient}>
          <EventsListManager params={next} now={TERAZ} />
        </QueryClientProvider>,
      ),
  };
}

/** Renderuje panel i czeka, aż lista wierszy naprawdę stanie na ekranie. */
async function panelZWierszami(params: EventListParams = {}) {
  const wynik = panel(params);
  await screen.findByRole("table");
  return wynik;
}

const zakladka = (klucz: string): HTMLElement =>
  screen.getByRole("tab", { name: new RegExp(`^adminEvents\\.list\\.tabs\\.${klucz}\\b`) });

const pole = (nazwa: string): HTMLElement => screen.getByLabelText(nazwa);

/**
 * Droplista filtra po NAZWIE DOSTĘPNEJ.
 *
 * Nie przez `getByLabelText`: pasek zakładek nosi `aria-label` filtra rodzaju
 * (`role="tablist" aria-label={typeLabel}` w `EventListFilters`), więc ta sama
 * nazwa wisi na dwóch elementach naraz. Pytanie o ROLĘ rozstrzyga to jednoznacznie
 * - i przy okazji nazywa defekt dostępności opisany w raporcie.
 */
const dropka = (nazwa: string): HTMLElement => screen.getByRole("combobox", { name: nazwa });

const przycisk = (nazwa: string | RegExp): HTMLElement =>
  screen.getByRole("button", { name: nazwa });

/** Wiersze CIAŁA tabeli - bez nagłówka. */
const wiersze = (): HTMLElement[] => screen.queryAllByRole("row").slice(1);

/** Tytuły w kolejności, w jakiej stoją na ekranie. */
const tytuly = (): string[] =>
  wiersze().map((row) => within(row).getAllByRole("button")[0]?.textContent ?? "");

/** Ostatni ładunek przekazany routerowi. */
function ostatniAdres(): { to: string; search: Record<string, unknown> } {
  const call = h.navigate.mock.calls.at(-1);
  if (call === undefined) throw new Error("router nie dostał ani jednego adresu");
  return call[0] as { to: string; search: Record<string, unknown> };
}

beforeEach(() => {
  h.lang = "pl";
  h.rows = [eventRow()];
  h.listHang = false;
  h.listError = null;
  h.listCalls = [];
  h.counts = eventCounts();
  h.countsCalls = [];
  h.exportChunks = [];
  h.exportError = null;
  h.types = [typeOption()];
  h.deleted = [];
  h.deleteHang = false;
  h.deleteError = null;
  h.remindersCalls = 0;
  h.remindersCount = 0;
  h.remindersError = null;
  h.navigate.mockClear();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednego wiersza", () => {
    h.listHang = true;
    panel();

    expect(screen.getByText("adminEvents.list.loading")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    // Kontrapunkt: gdyby szkielet schodził na pustkę, redaktor dodałby drugie
    // wydarzenie o tej samej nazwie, zanim pierwsze zdąży się pokazać.
    expect(screen.queryByText("adminEvents.list.empty")).toBeNull();
  });

  // TO JEST UDOKUMENTOWANA KLASA BŁĘDU TEGO MODUŁU. „Nie ma wydarzeń" po
  // nieudanym zapytaniu jest nieprawdą o stanie bazy - i to nieprawdą, po
  // której redaktor działa (dodaje duplikat), zamiast odświeżyć ekran.
  it("AWARIA pokazuje treść odmowy i ŻADNEGO z dwóch napisów o pustce", async () => {
    h.listError = new Error("events: odmowa RPC");
    panel();

    expect(await screen.findByText("events: odmowa RPC")).toBeTruthy();
    expect(screen.queryByText("adminEvents.list.empty")).toBeNull();
    expect(screen.queryByText("adminEvents.list.emptyFiltered")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("pustka BEZ filtrów mówi „dodaj pierwsze”, a nie „wyczyść filtry”", async () => {
    h.rows = [];
    panel();

    expect(await screen.findByText("adminEvents.list.empty")).toBeTruthy();
    expect(screen.queryByText("adminEvents.list.emptyFiltered")).toBeNull();
  });

  // DWIE RÓŻNE INFORMACJE. „Nie ma żadnego wydarzenia" wysyła redaktora tworzyć
  // nowe; „nic nie pasuje" - czyścić filtry. Jedno zdanie na oba przypadki
  // wysyła go szukać wydarzenia, które istnieje, tam gdzie go nie widać.
  it("pustka POD FRAZĄ mówi drugą rzecz", async () => {
    h.rows = [];
    panel({ q: "kongres" });

    expect(await screen.findByText("adminEvents.list.emptyFiltered")).toBeTruthy();
    expect(screen.queryByText("adminEvents.list.empty")).toBeNull();
  });

  // ZAKŁADKA TEŻ ZAWĘŻA, choć nie jest „filtrem" w sensie przycisku „wyczyść".
  // Pustka na zakładce „Szkice" nie znaczy „nie ma wydarzeń".
  it("pustka POD ZAKŁADKĄ, bez żadnego filtra, też mówi „nic nie pasuje”", async () => {
    h.rows = [];
    panel({ tab: "draft" });

    expect(await screen.findByText("adminEvents.list.emptyFiltered")).toBeTruthy();
    expect(screen.queryByText("adminEvents.list.empty")).toBeNull();
  });

  it("dane rysują tabelę i tytuł w języku interfejsu", async () => {
    h.rows = [eventRow({ id: "ev-1", title_pl: "Kongres", title_en: "Congress" })];
    await panelZWierszami();

    expect(tytuly()).toEqual(["Kongres"]);
    expect(screen.queryByText("adminEvents.list.loading")).toBeNull();
  });
});

describe("co organizm wysyła do zapytania", () => {
  it("stan URL jedzie do RPC listy razem z zegarem podanym z zewnątrz", async () => {
    await panelZWierszami({ tab: "draft", q: "kongres", t: RODZAJ, f: "online", page: 2 });

    expect(h.listCalls[0]?.params).toEqual({
      tab: "draft",
      q: "kongres",
      t: RODZAJ,
      f: "online",
      page: 2,
    });
    // Zegar jest ZAMROŻONY do minuty - inaczej każdy render zmienia argumenty.
    expect(h.listCalls[0]?.now.toISOString()).toBe("2026-08-29T12:00:00.000Z");
  });

  // LICZNIKI IGNORUJĄ ZAKŁADKĘ I STRONĘ. Inaczej zakładka „Szkice" pokazywałaby
  // liczbę szkiców wśród szkiców, a licznik zmieniałby się przy przewijaniu.
  it("liczniki dostają filtry BEZ zakładki, strony i rozmiaru", async () => {
    await panelZWierszami({ tab: "draft", q: "kongres", t: RODZAJ, page: 3, size: 50 });

    expect(h.countsCalls).toHaveLength(1);
    const args = h.countsCalls[0] ?? {};
    expect(args.q).toBe("kongres");
    expect(args.t).toBe(RODZAJ);
  });
});

describe("filtry i zakładki trafiają do adresu", () => {
  it("przełączenie zakładki NIE gubi wpisanej frazy i zeruje stronę", async () => {
    await panelZWierszami({ q: "kongres", t: RODZAJ, page: 4 });

    fireEvent.click(zakladka("draft"));

    expect(ostatniAdres().to).toBe("/admin/events/list");
    expect(ostatniAdres().search).toEqual({
      tab: "draft",
      q: "kongres",
      t: RODZAJ,
      page: undefined,
    });
  });

  // ZAKŁADKA „WSZYSTKIE" JEST BRAKIEM PARAMETRU, nie wartością `all`: adres
  // z `tab=all` przeszedłby walidator i wyparował, a przycisk „wstecz" cofałby
  // do stanu, którego nikt nie wybierał.
  it("powrót na „wszystkie” ZDEJMUJE zakładkę z adresu", async () => {
    await panelZWierszami({ tab: "draft" });

    fireEvent.click(zakladka("all"));

    expect(ostatniAdres().search.tab).toBeUndefined();
  });

  it("wpisana fraza jedzie do adresu, a fraza z samych spacji ją ZDEJMUJE", async () => {
    await panelZWierszami({ page: 3 });
    const szukajka = pole("adminEvents.list.searchPlaceholderShort");

    fireEvent.change(szukajka, { target: { value: "kongres" } });
    expect(ostatniAdres().search).toEqual({ q: "kongres", page: undefined });

    fireEvent.change(szukajka, { target: { value: "   " } });
    expect(ostatniAdres().search.q).toBeUndefined();
  });

  it("rodzaj i format jadą do adresu, a pozycja „wszystkie” je ZDEJMUJE", async () => {
    h.types = [typeOption(), typeOption({ id: INNY_RODZAJ, name_pl: "Webinar", key: "webinar" })];
    await panelZWierszami({ t: RODZAJ, f: "online" });

    fireEvent.change(dropka("adminEvents.list.filters.typeLabel"), {
      target: { value: INNY_RODZAJ },
    });
    expect(ostatniAdres().search.t).toBe(INNY_RODZAJ);

    fireEvent.change(dropka("adminEvents.list.filters.typeLabel"), { target: { value: "all" } });
    expect(ostatniAdres().search.t).toBeUndefined();

    fireEvent.change(dropka("adminEvents.list.filters.formatLabel"), {
      target: { value: "hybrid" },
    });
    expect(ostatniAdres().search.f).toBe("hybrid");

    fireEvent.change(dropka("adminEvents.list.filters.formatLabel"), { target: { value: "all" } });
    expect(ostatniAdres().search.f).toBeUndefined();
  });

  it("droplista rodzaju niesie nazwę z katalogu i pozycję „wszystkie” na czele", async () => {
    h.types = [typeOption(), typeOption({ id: INNY_RODZAJ, name_pl: "", key: "webinar" })];
    await panelZWierszami();

    const opcje = [...dropka("adminEvents.list.filters.typeLabel").querySelectorAll("option")];
    expect(opcje.map((o) => o.value)).toEqual(["all", RODZAJ, INNY_RODZAJ]);
    // Rodzaj BEZ nazwy w tym języku degraduje do klucza, a nie do pustej pozycji.
    expect(opcje.map((o) => o.textContent)).toEqual([
      "adminEvents.list.filters.typeAll",
      "Kongres",
      "webinar",
    ]);
  });

  // Katalog rodzajów jedzie OSOBNYM zapytaniem, więc bywa moment, w którym
  // listy jeszcze nie ma. Droplista bez ani jednej pozycji nie dałaby się
  // wyzerować - redaktor zostałby z filtrem, którego nie umie zdjąć.
  it("zanim katalog rodzajów dojedzie, droplista ma samą pozycję „wszystkie”", async () => {
    h.types = undefined;
    await panelZWierszami();

    const opcje = [...dropka("adminEvents.list.filters.typeLabel").querySelectorAll("option")];
    expect(opcje.map((o) => o.value)).toEqual(["all"]);
  });

  it("po angielsku droplista rodzaju bierze nazwę angielską, a bez niej klucz", async () => {
    h.lang = "en";
    h.types = [
      typeOption({ name_pl: "Kongres", name_en: "Congress" }),
      typeOption({ id: INNY_RODZAJ, name_pl: "Webinar", name_en: "", key: "webinar" }),
    ];
    await panelZWierszami();

    const opcje = [...dropka("adminEvents.list.filters.typeLabel").querySelectorAll("option")];
    expect(opcje[1]?.textContent).toBe("Congress");
    // Rodzaj nienazwany po angielsku NIE degraduje do nazwy polskiej - klucz jest
    // jednoznaczny, a nazwa w drugim języku wygląda jak brak tłumaczenia całej listy.
    expect(opcje[2]?.textContent).toBe("webinar");
  });

  // PRZYCISK BEZ SKUTKU UCZY, ŻE PRZYCISKI NIC NIE ROBIĄ. „Wyczyść" pojawia się
  // wyłącznie wtedy, gdy jest co czyścić - zakładka czyszczeniu NIE podlega.
  it("„wyczyść” pojawia się dopiero z filtrem i zdejmuje FRAZĘ, RODZAJ i FORMAT", async () => {
    const { przerysuj } = await panelZWierszami({ tab: "draft" });
    expect(screen.queryByRole("button", { name: "adminEvents.list.clearFilters" })).toBeNull();

    przerysuj({ tab: "draft", q: "kongres", t: RODZAJ, f: "online" });
    fireEvent.click(przycisk("adminEvents.list.clearFilters"));

    expect(ostatniAdres().search).toEqual({
      tab: "draft",
      q: undefined,
      t: undefined,
      f: undefined,
      page: undefined,
    });
  });

  it("strzałka stopki zmienia stronę, a powrót na pierwszą ZDEJMUJE ją z adresu", async () => {
    h.rows = [eventRow({ total_count: 137 })];
    await panelZWierszami({ page: 2 });

    fireEvent.click(przycisk("admin.pagination.next"));
    expect(ostatniAdres().search.page).toBe(3);

    fireEvent.click(przycisk("admin.pagination.prev"));
    expect(ostatniAdres().search.page).toBeUndefined();
  });

  // ZMIANA ROZMIARU ZERUJE STRONĘ - inaczej przejście z 200 na 20 ląduje na
  // stronie, której po zmianie nie ma, i lista jest pusta bez powodu.
  it("zmiana rozmiaru strony jedzie do adresu i ZERUJE numer strony", async () => {
    h.rows = [eventRow({ total_count: 137 })];
    await panelZWierszami({ page: 5 });

    const dropki = screen.getAllByTestId("select");
    const rozmiar = dropki.find((el) =>
      [...el.querySelectorAll("option")].map((o) => o.value).includes("200"),
    );
    expect(rozmiar).toBeTruthy();
    fireEvent.change(rozmiar as HTMLElement, { target: { value: "50" } });

    expect(ostatniAdres().search).toEqual({ page: undefined, size: 50 });
  });
});

describe("liczniki zakładek", () => {
  it("każda zakładka niesie swoją liczbę z osobnego zapytania", async () => {
    h.counts = eventCounts({ all: 12, draft: 3, published: 7, upcoming: 5, past: 2, cancelled: 1 });
    await panelZWierszami();

    await waitFor(() => expect(zakladka("all").textContent).toContain("12"));
    expect(zakladka("draft").textContent).toContain("3");
    expect(zakladka("published").textContent).toContain("7");
    expect(zakladka("upcoming").textContent).toContain("5");
    expect(zakladka("past").textContent).toContain("2");
    expect(zakladka("cancelled").textContent).toContain("1");
  });

  // TO JEST TEN BŁĄD. Klucz cache liczników niósł kiedyś `tab`, `page` i `size`,
  // więc przełączenie zakładki trafiało w PUSTY klucz: `data` stawało się
  // `undefined`, sześć liczb mrugało do zera i wracało po odpowiedzi. Test
  // przełącza zakładkę na CIEPŁYM cache i pyta o dwie rzeczy naraz: liczby
  // stoją, a drugiego zapytania w ogóle nie było.
  it("przełączenie zakładki NIE gasi liczb i NIE wysyła drugiego zapytania", async () => {
    const { przerysuj } = await panelZWierszami();
    await waitFor(() => expect(zakladka("all").textContent).toContain("12"));

    przerysuj({ tab: "draft" });

    expect(zakladka("all").textContent).toContain("12");
    expect(zakladka("draft").textContent).toContain("3");
    expect(h.countsCalls).toHaveLength(1);
  });

  it("zmiana strony i rozmiaru też nie rusza licznikow", async () => {
    const { przerysuj } = await panelZWierszami();
    await waitFor(() => expect(zakladka("all").textContent).toContain("12"));

    przerysuj({ page: 4 });
    expect(zakladka("all").textContent).toContain("12");
    przerysuj({ page: 4, size: 100 });
    expect(zakladka("all").textContent).toContain("12");

    expect(h.countsCalls).toHaveLength(1);
  });

  // KONTRAPUNKT. Gdyby klucz IGNOROWAŁ wszystko, liczby przestałyby respektować
  // zawężenie listy - „Szkice (3)" pod frazą, która pasuje do jednego szkicu,
  // to metryka licząca całość pod zawężoną listą.
  it("zmiana FRAZY liczniki przelicza - to nie jest to samo co zmiana zakładki", async () => {
    const { przerysuj } = await panelZWierszami();
    await waitFor(() => expect(h.countsCalls).toHaveLength(1));

    h.counts = eventCounts({ all: 1, draft: 1, published: 0 });
    przerysuj({ q: "kongres" });

    await waitFor(() => expect(h.countsCalls).toHaveLength(2));
    expect(h.countsCalls[1]?.q).toBe("kongres");
  });

  it("zanim liczniki dojadą, zakładki pokazują zero, a nie puste miejsce", () => {
    h.counts = null;
    panel();

    // `undefined` w zakładce to gołe „NaN" albo dziura w pasku - obie rzeczy
    // wyglądają jak awaria panelu.
    expect(zakladka("all").textContent).toContain("0");
  });
});

describe("wiersz listy", () => {
  it("brak tytułu w języku interfejsu degraduje do adresu, nie do pustki", async () => {
    h.rows = [eventRow({ title_pl: "", title_en: "Congress", slug: "kongres-2026" })];
    await panelZWierszami();

    expect(tytuly()).toEqual(["kongres-2026"]);
  });

  it("po angielsku wiersz bierze tytuł angielski", async () => {
    h.lang = "en";
    h.rows = [eventRow({ title_pl: "Kongres", title_en: "Congress" })];
    await panelZWierszami();

    expect(tytuly()).toEqual(["Congress"]);
  });

  it("wydarzenie po skasowanym rodzaju mówi „bez rodzaju”, a nie pokazuje pustej komórki", async () => {
    h.rows = [eventRow({ type_name_pl: null, type_name_en: null })];
    await panelZWierszami();

    expect(screen.getByText("adminEvents.list.row.noType")).toBeTruthy();
  });

  // TRZECI STAN NAZWY RODZAJU. `null` znaczy „wydarzenie bez rodzaju", pusty
  // napis znaczy „rodzaj jest, ale nikt nie nazwał go po angielsku" - i wtedy
  // wiersz spada na KLUCZ katalogu, a nie na pustą komórkę. Sklejenie obu
  // przypadków w jeden napis kłamałoby o tym, czy rodzaj w ogóle istnieje.
  it("po angielsku rodzaj bez nazwy angielskiej degraduje do klucza katalogu", async () => {
    h.lang = "en";
    h.rows = [eventRow({ type_name_pl: "Kongres", type_name_en: null, type_key: "webinar" })];
    await panelZWierszami();

    expect(screen.getByText("webinar")).toBeTruthy();
    expect(screen.queryByText("adminEvents.list.row.noType")).toBeNull();
  });

  it("rodzaj o pustej nazwie i bez klucza zostawia myślnik, a nie gołe „undefined”", async () => {
    h.rows = [eventRow({ type_name_pl: "", type_key: null })];
    await panelZWierszami();

    const komorki = within(wiersze()[0] as HTMLElement).getAllByRole("cell");
    expect(komorki[3]?.textContent).toBe("-");
  });

  it("po angielsku rodzaj bez nazwy i bez klucza też zostawia myślnik", async () => {
    h.lang = "en";
    h.rows = [eventRow({ type_name_pl: "Kongres", type_name_en: null, type_key: null })];
    await panelZWierszami();

    const komorki = within(wiersze()[0] as HTMLElement).getAllByRole("cell");
    expect(komorki[3]?.textContent).toBe("-");
    expect(screen.queryByText("adminEvents.list.row.noType")).toBeNull();
  });

  // TRZY ZDANIA, KTÓRE TŁUMACZĄ LICZBĘ ZAPISANYCH. Sama liczba nie odróżnia
  // pustej sali od wyprzedanej z kolejką - a to są przeciwne decyzje.
  it("kolejka, zainteresowani i wolne miejsca stoją pod liczbą zapisanych", async () => {
    h.rows = [
      eventRow({ going_count: 40, interested_count: 8, waitlist_count: 3, seats_left: 12 }),
    ];
    await panelZWierszami();

    expect(screen.getByText(/row\.interested\(count=8\)/)).toBeTruthy();
    expect(screen.getByText(/row\.waitlist\(count=3\)/)).toBeTruthy();
    expect(screen.getByText(/row\.seatsLeft\(count=12\)/)).toBeTruthy();
  });

  // „BEZ LIMITU MIEJSC" NIE JEST ZDANIEM W TABELI: brak limitu widać po tym, że
  // wiersz nie mówi o miejscach nic. Zero zainteresowanych to też nie jest zdanie.
  it("wiersz bez kolejki i bez limitu NIE mówi o miejscach nic", async () => {
    h.rows = [eventRow({ going_count: 5, interested_count: 0, waitlist_count: 0 })];
    await panelZWierszami();

    expect(screen.queryByText(/row\.seatsLeft/)).toBeNull();
    expect(screen.queryByText(/row\.interested/)).toBeNull();
    expect(screen.queryByText(/row\.waitlist/)).toBeNull();
  });

  // WYPRZEDANE TO ZERO, A NIE BRAK LIMITU. Sklejenie obu przypadków ukrywa
  // dokładnie ten wiersz, na który organizator musi zareagować.
  it("zero wolnych miejsc JEST zdaniem - to nie to samo co brak limitu", async () => {
    h.rows = [eventRow({ seats_left: 0 })];
    await panelZWierszami();

    expect(screen.getByText(/row\.seatsLeft\(count=0\)/)).toBeTruthy();
  });

  it("Chatham House i „tylko członkowie” są plakietkami przy tytule", async () => {
    h.rows = [eventRow({ chatham_house: true, visibility: "members" })];
    await panelZWierszami();

    expect(screen.getByText("adminEvents.list.row.chathamHouse")).toBeTruthy();
    expect(screen.getByText("adminEvents.list.row.membersOnly")).toBeTruthy();
  });

  it("wydarzenie publiczne bez klauzuli nie dostaje żadnej z tych plakietek", async () => {
    await panelZWierszami();

    expect(screen.queryByText("adminEvents.list.row.chathamHouse")).toBeNull();
    expect(screen.queryByText("adminEvents.list.row.membersOnly")).toBeNull();
  });

  // SZKIC NIE MA STRONY PUBLICZNEJ - odsyłacz do adresu, który odda 404, jest
  // obietnicą bez pokrycia.
  it("tylko wydarzenie OPUBLIKOWANE ma odsyłacz do strony publicznej", async () => {
    h.rows = [
      eventRow({ id: "ev-1", slug: "kongres", status: "published" }),
      eventRow({ id: "ev-2", slug: "szkic", status: "draft", title_pl: "Szkic" }),
      eventRow({ id: "ev-3", slug: "odwolane", status: "cancelled", title_pl: "Odwołane" }),
    ];
    await panelZWierszami();

    const link = screen.getByRole("link", {
      name: "adminEvents.list.row.openPublicAction(title=Kongres)",
    });
    expect(link.getAttribute("href")).toBe("/events/kongres");
    expect(
      screen.queryByRole("link", { name: "adminEvents.list.row.openPublicAction(title=Szkic)" }),
    ).toBeNull();
    // Trzy stany statusu mają trzy różne napisy - inaczej „odwołane" czyta się
    // jak „szkic" i redaktor publikuje coś, co zostało odwołane.
    expect(screen.getByText("adminEvents.list.status.published")).toBeTruthy();
    expect(screen.getByText("adminEvents.list.status.draft")).toBeTruthy();
    expect(screen.getByText("adminEvents.list.status.cancelled")).toBeTruthy();
  });

  it("kliknięcie tytułu prowadzi do STUDIA tego wydarzenia", async () => {
    h.rows = [eventRow({ id: "ev-42" })];
    await panelZWierszami();

    fireEvent.click(przycisk("adminEvents.list.row.editAction(title=Kongres)"));

    expect(ostatniAdres()).toEqual({
      to: "/admin/events/$eventId/general",
      params: { eventId: "ev-42" },
    });
  });

  it("ikona rodzaju z katalogu trafia do wiersza pod swoją nazwą", async () => {
    h.rows = [eventRow({ type_icon: "mic" })];
    await panelZWierszami();

    expect(screen.getByTestId("ikona-mic")).toBeTruthy();
  });
});

describe("sortowanie widocznej strony", () => {
  const trzyWiersze = () => [
    eventRow({ id: "a", title_pl: "Beta", starts_at: "2026-09-10T08:00:00.000Z", going_count: 5 }),
    eventRow({ id: "b", title_pl: "Alfa", starts_at: "2026-09-01T08:00:00.000Z", going_count: 9 }),
    eventRow({ id: "c", title_pl: "Gamma", starts_at: "2026-09-20T08:00:00.000Z", going_count: 1 }),
  ];

  const sortuj = (kolumna: string) =>
    fireEvent.click(
      przycisk(`adminEvents.list.sort.by(column=adminEvents.list.columns.${kolumna})`),
    );

  // TRZECIE KLIKNIĘCIE WRACA DO PORZĄDKU SERWERA. „Bez sortowania" jest stanem,
  // a nie brakiem stanu - inaczej z raz posortowanej kolumny nie ma wyjścia.
  it("kolumna tytułu cykluje: rosnąco, malejąco, porządek serwera", async () => {
    h.rows = trzyWiersze();
    await panelZWierszami();
    expect(tytuly()).toEqual(["Beta", "Alfa", "Gamma"]);

    sortuj("title");
    expect(tytuly()).toEqual(["Alfa", "Beta", "Gamma"]);
    sortuj("title");
    expect(tytuly()).toEqual(["Gamma", "Beta", "Alfa"]);
    sortuj("title");
    expect(tytuly()).toEqual(["Beta", "Alfa", "Gamma"]);
  });

  it("przejście na INNĄ kolumnę zaczyna od nowa, rosnąco", async () => {
    h.rows = trzyWiersze();
    await panelZWierszami();

    sortuj("title");
    sortuj("title");
    sortuj("date");
    expect(tytuly()).toEqual(["Alfa", "Beta", "Gamma"]);
  });

  it("kolumna zapisanych i kolumna prelegentów sortują po LICZBACH", async () => {
    h.rows = [
      eventRow({ id: "a", title_pl: "Beta", going_count: 5, speakers_count: 2 }),
      eventRow({ id: "b", title_pl: "Alfa", going_count: 9, speakers_count: 7 }),
    ];
    await panelZWierszami();

    sortuj("registrations");
    expect(tytuly()).toEqual(["Beta", "Alfa"]);
    sortuj("speakers");
    expect(tytuly()).toEqual(["Beta", "Alfa"]);
    sortuj("speakers");
    expect(tytuly()).toEqual(["Alfa", "Beta"]);
  });

  // BRAK WARTOŚCI NIE JEST NAJMNIEJSZĄ WARTOŚCIĄ. Odwracany razem z kierunkiem
  // wypychałby wiersze bez tytułu i bez terminu na sam szczyt listy. DWA puste
  // wiersze, nie jeden: przy jednym porównanie „pusty z pustym" nigdy nie pada,
  // a to ono decyduje, czy lista przestaje być stabilna.
  it("puste tytuły i puste terminy zostają NA KOŃCU w obu kierunkach", async () => {
    h.rows = [
      eventRow({ id: "a", title_pl: "", title_en: "", slug: "", starts_at: "" }),
      eventRow({ id: "b", title_pl: "Alfa", starts_at: "2026-09-01T08:00:00.000Z" }),
      eventRow({ id: "c", title_pl: "", title_en: "", slug: "", starts_at: "" }),
    ];
    await panelZWierszami();

    sortuj("title");
    expect(tytuly()).toEqual(["Alfa", "", ""]);
    sortuj("title");
    expect(tytuly()).toEqual(["Alfa", "", ""]);

    sortuj("date");
    expect(tytuly()).toEqual(["Alfa", "", ""]);
    sortuj("date");
    expect(tytuly()).toEqual(["Alfa", "", ""]);
  });

  it("dwa RÓWNE tytuły nie przestawiają się względem siebie", async () => {
    h.rows = [
      eventRow({ id: "a", title_pl: "Alfa", slug: "pierwszy" }),
      eventRow({ id: "b", title_pl: "Alfa", slug: "drugi" }),
      eventRow({ id: "c", title_pl: "Beta", slug: "trzeci" }),
    ];
    await panelZWierszami();

    sortuj("title");
    expect(
      wiersze().map((row) => within(row).getByText(/^(pierwszy|drugi|trzeci)$/).textContent),
    ).toEqual(["pierwszy", "drugi", "trzeci"]);
  });

  it("wiersze o RÓWNYCH wartościach nie zmieniają kolejności względem siebie", async () => {
    h.rows = [
      eventRow({ id: "a", title_pl: "Alfa", starts_at: "2026-09-01T08:00:00.000Z" }),
      eventRow({ id: "b", title_pl: "Beta", starts_at: "2026-09-01T08:00:00.000Z" }),
    ];
    await panelZWierszami();

    sortuj("date");
    expect(tytuly()).toEqual(["Alfa", "Beta"]);
  });
});

describe("zaznaczenie i operacje masowe", () => {
  const dwaWiersze = () => [
    eventRow({ id: "ev-1", title_pl: "Kongres", total_count: 2 }),
    eventRow({ id: "ev-2", title_pl: "Warsztat", total_count: 2 }),
  ];

  // PASEK NIE ZAJMUJE MIEJSCA, DOPÓKI NIE MA CZEGO DOTYCZYĆ. Kosz stojący nad
  // pustym zaznaczeniem to zaproszenie do kliknięcia, którego nie da się cofnąć.
  it("pasek operacji masowych pojawia się DOPIERO po zaznaczeniu", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();
    expect(screen.queryByText(/select\.count/)).toBeNull();

    fireEvent.click(pole("adminEvents.list.select.row(title=Kongres)"));

    expect(screen.getByText("adminEvents.list.select.count(count=1)")).toBeTruthy();
  });

  it("checkbox nagłówka zaznacza wszystko, a drugie kliknięcie zdejmuje", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();
    const wszystkie = pole("adminEvents.list.select.all");

    fireEvent.click(wszystkie);
    expect(screen.getByText("adminEvents.list.select.count(count=2)")).toBeTruthy();

    fireEvent.click(pole("adminEvents.list.select.all"));
    expect(screen.queryByText(/select\.count/)).toBeNull();
  });

  it("częściowe zaznaczenie stawia checkbox nagłówka w stan nieokreślony", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();

    fireEvent.click(pole("adminEvents.list.select.row(title=Kongres)"));

    expect(pole("adminEvents.list.select.all")).toBePartiallyChecked();
  });

  it("odznaczenie pojedynczego wiersza zdejmuje go z zaznaczenia", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.row(title=Kongres)"));
    fireEvent.click(pole("adminEvents.list.select.row(title=Warsztat)"));
    expect(screen.getByText("adminEvents.list.select.count(count=2)")).toBeTruthy();

    fireEvent.click(pole("adminEvents.list.select.row(title=Kongres)"));

    expect(screen.getByText("adminEvents.list.select.count(count=1)")).toBeTruthy();
    // Ten, który został, ma nadal zaznaczony checkbox - inaczej pasek liczyłby
    // co innego niż pokazuje tabela.
    expect(pole("adminEvents.list.select.row(title=Warsztat)")).toBeChecked();
    expect(pole("adminEvents.list.select.row(title=Kongres)")).not.toBeChecked();
  });

  // ESCAPE I KLIKNIĘCIE POZA OKNEM to ta sama droga wyjścia co „Anuluj”, i musi
  // znaczyć to samo: nie kasujemy. Okno, które przy Escape zostaje otwarte,
  // zamyka redaktora w pytaniu o operację nieodwracalną.
  it("zamknięcie okna poza przyciskami też NIE kasuje, a otwarcie go nie zamyka", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.all"));
    fireEvent.click(przycisk("adminCommunityEvents.actions.deleteEvent"));

    fireEvent.click(screen.getByTestId("okno-otworz"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByTestId("okno-zamknij"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.deleted).toEqual([]);
  });

  it("„wyczyść zaznaczenie” zdejmuje pasek", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.row(title=Kongres)"));

    fireEvent.click(przycisk("adminEvents.list.select.clear"));

    expect(screen.queryByText(/select\.count/)).toBeNull();
  });

  // ZAZNACZENIE PRZYCIĘTE DO WIDOCZNYCH WIERSZY. Po zmianie filtra „trzy
  // zaznaczone" musi znaczyć te trzy, które redaktor widzi - inaczej kosz
  // sięga po wydarzenia, których nie ma na ekranie.
  it("zaznaczenie ZNIKA razem z wierszem, który wypadł po zmianie filtra", async () => {
    h.rows = dwaWiersze();
    const { przerysuj } = await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.row(title=Kongres)"));
    expect(screen.getByText("adminEvents.list.select.count(count=1)")).toBeTruthy();

    h.rows = [eventRow({ id: "ev-2", title_pl: "Warsztat", total_count: 1 })];
    przerysuj({ q: "warsztat" });

    await waitFor(() => expect(screen.queryByText(/select\.count/)).toBeNull());
  });

  it("kosz nie kasuje od razu - najpierw pyta, i pytanie NIESIE LICZBĘ", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.all"));

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(przycisk("adminCommunityEvents.actions.deleteEvent"));

    const okno = screen.getByRole("dialog");
    expect(within(okno).getByText("adminEvents.list.select.count(count=2)")).toBeTruthy();
    expect(h.deleted).toEqual([]);
  });

  it("rezygnacja z potwierdzenia zamyka okno i NIE kasuje niczego", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.all"));
    fireEvent.click(przycisk("adminCommunityEvents.actions.deleteEvent"));

    fireEvent.click(przycisk("adminCommunityEvents.common.cancel"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.deleted).toEqual([]);
  });

  // KASUJEMY PO KOLEI, NIE RÓWNOLEGLE. Przy odmowie na trzecim wydarzeniu dwa
  // pierwsze już nie istnieją, a równoległe żądania zostawiają stan, którego
  // z jednego błędu nikt nie odczyta.
  it("potwierdzenie kasuje KAŻDE zaznaczone wydarzenie i zdejmuje zaznaczenie", async () => {
    h.rows = dwaWiersze();
    await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.all"));
    fireEvent.click(przycisk("adminCommunityEvents.actions.deleteEvent"));

    fireEvent.click(przycisk("adminCommunityEvents.common.delete"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminCommunityEvents.toasts.deleted"),
    );
    expect(h.deleted).toEqual(["ev-1", "ev-2"]);
    expect(screen.queryByText(/select\.count/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // ODMOWA NIE MOŻE KASOWAĆ STANU EKRANU. Redaktor musi zobaczyć, CO wybrał,
  // żeby móc spróbować jeszcze raz albo odznaczyć wiersz, który blokuje.
  it("odmowa serwera pokazuje komunikat i ZOSTAWIA zaznaczenie", async () => {
    h.rows = dwaWiersze();
    h.deleteError = new Error("events: wydarzenie ma zapisy");
    await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.all"));
    fireEvent.click(przycisk("adminCommunityEvents.actions.deleteEvent"));

    fireEvent.click(przycisk("adminCommunityEvents.common.delete"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("events: wydarzenie ma zapisy"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("adminEvents.list.select.count(count=2)")).toBeTruthy();
  });

  it("podwójne kliknięcie w potwierdzenie wysyła JEDNO kasowanie", async () => {
    h.rows = dwaWiersze();
    h.deleteHang = true;
    await panelZWierszami();
    fireEvent.click(pole("adminEvents.list.select.row(title=Kongres)"));
    fireEvent.click(przycisk("adminCommunityEvents.actions.deleteEvent"));

    const potwierdz = przycisk("adminCommunityEvents.common.delete");
    fireEvent.click(potwierdz);
    // Stan „w locie" wchodzi przez kolejkę powiadomień react-query, czyli
    // o mikrozadanie później niż samo kliknięcie - w przeglądarce dzieje się to
    // przed drugim ruchem myszy, w teście trzeba na to poczekać jawnie.
    await waitFor(() => expect(potwierdz).toBeDisabled());
    fireEvent.click(potwierdz);

    expect(h.deleted).toEqual(["ev-1"]);
  });
});

describe("eksport całego zawężonego zbioru", () => {
  /**
   * Przechwycenie POBRANIA PLIKU.
   *
   * `URL.createObjectURL` i kliknięcie w odsyłacz to jedyny widoczny skutek
   * eksportu - happy-dom nie ma pobierania, więc bez tej podmianki dowód
   * kończyłby się na „nie rzuciło wyjątkiem". Zbieramy WSZYSTKIE utworzone
   * kotwice (React tworzy je także na wiersze listy) i filtrujemy po
   * `download`: tylko odsyłacz pobrania go ustawia.
   */
  const przechwycone: { linki: HTMLAnchorElement[]; utworzUrl: ReturnType<typeof vi.fn> } = {
    linki: [],
    utworzUrl: vi.fn(),
  };

  function przechwycPobranie(): typeof przechwycone {
    przechwycone.utworzUrl = vi.fn().mockReturnValue("blob:csv");
    przechwycone.linki = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: przechwycone.utworzUrl,
      revokeObjectURL: vi.fn(),
    });
    const realne = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realne(tag);
      if (tag === "a") {
        przechwycone.linki.push(el as HTMLAnchorElement);
        (el as HTMLAnchorElement).click = vi.fn();
      }
      return el;
    });
    return przechwycone;
  }

  /** Odsyłacz POBRANIA - jedyny z ustawionym `download`. */
  const plik = (): HTMLAnchorElement | undefined =>
    przechwycone.linki.find((link) => link.download !== "");

  // Podmianka `document.createElement` MUSI wracać po każdym przypadku - bez
  // tego kolejny test nakłada szpiega na szpiega i render kończy się
  // przepełnieniem stosu.
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // PRZYCISK, KTÓRY ODDAJE PLIK Z SAMYM NAGŁÓWKIEM, uczy redaktora, że przyciski
  // nie robią tego, co obiecują.
  it("gniazdo eksportu ZNIKA, gdy nie ma czego eksportować", async () => {
    h.rows = [];
    panel();
    await screen.findByText("adminEvents.list.empty");

    expect(screen.queryByRole("button", { name: "adminEvents.list.toolbar.export" })).toBeNull();
  });

  // EKSPORT BIERZE CAŁY ZAWĘŻONY ZBIÓR, nie widoczną stronę. Plik z dwudziestoma
  // wierszami kłamie o tym, ile jest wydarzeń, a pomyłka wychodzi dopiero
  // u odbiorcy pliku - poza systemem.
  it("chodzi po stronach po 200 wierszy, aż zbierze cały licznik całości", async () => {
    h.rows = [eventRow({ total_count: 300 })];
    const pelna = Array.from({ length: ROZMIAR_EKSPORTU }, (_, i) =>
      eventRow({ id: `a${i}`, total_count: 300 }),
    );
    const reszta = Array.from({ length: 100 }, (_, i) =>
      eventRow({ id: `b${i}`, total_count: 300 }),
    );
    h.exportChunks = [pelna, reszta];
    const { utworzUrl } = przechwycPobranie();
    await panelZWierszami({ q: "kongres" });

    fireEvent.click(przycisk("adminEvents.list.toolbar.export"));
    await waitFor(() => expect(utworzUrl).toHaveBeenCalledTimes(1));

    const strony = h.listCalls.filter((call) => call.params.size === ROZMIAR_EKSPORTU);
    expect(strony.map((call) => call.params.page)).toEqual([1, 2]);
    // Zawężenie jedzie razem ze stroną - inaczej plik ma wiersze, których na
    // ekranie nie było.
    expect(strony[0]?.params.q).toBe("kongres");
    expect(plik()?.download).toMatch(/^events-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("krótsza strona kończy pętlę - drugiego zapytania nie ma", async () => {
    h.rows = [eventRow({ total_count: 3 })];
    h.exportChunks = [[eventRow({ total_count: 3 })]];
    const { utworzUrl } = przechwycPobranie();
    await panelZWierszami();

    fireEvent.click(przycisk("adminEvents.list.toolbar.export"));
    await waitFor(() => expect(utworzUrl).toHaveBeenCalledTimes(1));

    expect(h.listCalls.filter((call) => call.params.size === ROZMIAR_EKSPORTU)).toHaveLength(1);
    expect(plik()?.download).toMatch(/^events-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("odmowa w trakcie eksportu mówi to wprost i NIE zostawia zgaszonego przycisku", async () => {
    h.rows = [eventRow({ total_count: 3 })];
    h.exportError = new Error("events: eksport odmowa");
    await panelZWierszami();

    fireEvent.click(przycisk("adminEvents.list.toolbar.export"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("events: eksport odmowa"));
    expect(przycisk("adminEvents.list.toolbar.export")).not.toBeDisabled();
  });

  // ODRZUCENIE, KTÓRE NIE JEST BŁĘDEM. PostgREST potrafi odrzucić napisem,
  // a `error.message` na napisie daje `undefined` - toast z pustą treścią to
  // dokładnie ten stan, w którym redaktor nie wie, czy plik powstał.
  it("odrzucenie NIE-błędem też ma czytelną treść, a nie puste okienko", async () => {
    h.rows = [eventRow({ total_count: 3 })];
    h.exportError = "events: sieć padła" as unknown as Error;
    await panelZWierszami();

    fireEvent.click(przycisk("adminEvents.list.toolbar.export"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("events: sieć padła"));
  });

  it("trwający eksport GASI przycisk - podwójne kliknięcie nie wysyła drugiej serii", async () => {
    h.rows = [eventRow({ total_count: 3 })];
    // Pusta lista stron: pierwsze wywołanie oddaje `[]` dopiero po mikrozadaniu,
    // więc przycisk zdąży zgasnąć - to jest ten moment, o który chodzi.
    h.exportChunks = [];
    await panelZWierszami();

    const eksport = przycisk("adminEvents.list.toolbar.export");
    fireEvent.click(eksport);
    expect(eksport).toBeDisabled();
    fireEvent.click(eksport);

    await waitFor(() =>
      expect(h.listCalls.filter((call) => call.params.size === ROZMIAR_EKSPORTU)).toHaveLength(1),
    );
  });
});

describe("przypomnienia - akcja całego modułu", () => {
  it("przycisk woła kolejkę i nazywa liczbę wysłanych wiadomości", async () => {
    h.remindersCount = 7;
    await panelZWierszami();

    fireEvent.click(przycisk("adminCommunityEvents.remindersAction"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "adminCommunityEvents.toasts.remindersSent(count=7)",
      ),
    );
    expect(h.remindersCalls).toBe(1);
  });

  it("odmowa kolejki mówi to wprost", async () => {
    h.remindersError = new Error("events: kolejka zajęta");
    await panelZWierszami();

    fireEvent.click(przycisk("adminCommunityEvents.remindersAction"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("events: kolejka zajęta"));
  });

  it("katalog rodzajów ma własny adres, a tworzenie własną trasę", async () => {
    await panelZWierszami();

    fireEvent.click(przycisk("adminEvents.list.toolbar.eventTypes"));
    expect(ostatniAdres()).toEqual({ to: "/admin/events/types" });

    fireEvent.click(przycisk("adminEvents.list.createAction"));
    expect(ostatniAdres()).toEqual({ to: "/admin/events/new" });
  });
});

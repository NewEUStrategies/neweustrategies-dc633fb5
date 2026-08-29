// Organizm „UPRAWNIENIA DO STAWEK" - ekran, na którym zapada decyzja o tym,
// kto zapłaci mniej.
//
// DLACZEGO TEN PLIK JEST OSTRZEJSZY OD POZOSTAŁYCH PANELI AGENDY. Pakiet
// zawężony do grupy odbiorców pyta bazę `event_audience_qualifies`, a ta
// odpowiada WYŁĄCZNIE na podstawie nadania z tego ekranu. Pomyłka tutaj nie
// psuje widoku - zmienia cenę i zostawia ślad w księgach.
//
// CO TEN PLIK DOWODZI.
//   1. NADANIE SIĘ NIE KASUJE. „Wycofaj" stempluje `revoked_at`; wiersz zostaje,
//      bo tłumaczy, dlaczego ktoś zapłacił mniej. Dowodzimy OBU stanów osobno:
//      to samo nadanie przed i po wycofaniu jest na liście, ale wygląda inaczej
//      i ma inne akcje. Bez drugiego stanu test nie odróżnia „stempluje" od
//      „kasuje i pokazuje pustkę".
//   2. WYCOFANE NIE WYGLĄDA JAK AKTYWNE. Trzy różnice naraz: nazwa stanu,
//      data wycofania i BRAK przycisku wycofania. Gdyby wiersz wycofany czytał
//      się jak aktywny, audyt rozliczeń dostawałby fałszywy obraz uprawnień.
//   3. FILTR „POKAŻ WYCOFANE" JEDZIE DO BAZY. To nie jest ukrywanie wierszy
//      w przeglądarce - lista domyślnie w ogóle o nie nie pyta, żeby mówiła
//      o stanie DZISIEJSZYM.
//   4. WYCOFANIE IDZIE DO WARSTWY DANYCH Z IDENTYFIKATOREM TEGO wiersza,
//      nie pierwszego z listy, i wyłącznie po potwierdzeniu.
//   5. PODMIOT JEST DOKŁADNIE JEDEN. Baza odrzuca dwa naraz, więc ładunek ma
//      wypełnione JEDNO pole podmiotu, a dwa pozostałe jako `null`. Asercja na
//      pełnym obiekcie, bo to jest kontrakt z bazą.
//   6. KAŻDE POLE WYMAGANE OSOBNO ZATRZYMUJE ZAPIS PRZED ŻĄDANIEM. Nadanie bez
//      podstawy nie ma wartości rozliczeniowej - baza go odrzuci, ale wtedy
//      administrator dowiaduje się o regule z komunikatu odmowy.
//   7. CZTERY STANY LISTY MAJĄ CZTERY WIDOKI, a awaria NIE MOŻE mówić „nie ma
//      żadnych nadań": to nieprawda o stanie uprawnień, po której ktoś nadaje
//      ulgę drugi raz.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł warstwy danych (`fetchAudienceGrants`,
// `audienceGrantState`, kształt `p_payload`) - `audienceGrantState` jest tu
// PRAWDZIWY, bo dowodzimy jego WYNIKU na ekranie; ładunek RPC ma własny plik.
// (2) Dziennika historii - `EventAudienceGrantHistoryPanel` jest osobnym
// organizmem i tutaj jest atrapą; dowodzimy WEJŚCIA do niego. (3) Formatowania
// dat - `lib/i18n/format` ma własne testy, tutaj podmieniamy je na wartość
// deterministyczną, żeby asercja nie zależała od wersji ICU maszyny, ale
// nadal widziała JĘZYK, w którym data jest składana.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { radixSwitchStub } from "@/test/reactStubs";
import type { AudienceGrantInput, EventAudienceGrantRow } from "@/lib/events/audienceGrantsApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: Error) => void;
}

/** Zapytanie listy nadań - to, co organizm wysyła do warstwy danych. */
interface ZapytanieNadan {
  eventId: string | null;
  audience: string;
  includeRevoked: boolean;
  search: string;
}

const h = vi.hoisted(() => ({
  language: "pl",
  rows: undefined as unknown,
  isLoading: false,
  listError: null as Error | null,
  zapytania: [] as unknown[],
  saveInputs: [] as unknown[],
  saveFails: null as string | null,
  savePending: false,
  revokeIds: [] as string[],
  revokeFails: null as string | null,
  historia: [] as { eventId: string; grantId: string | null; embedded: boolean }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Słownik odmów bazy ma własny plik testowy i ciągnie realny i18next; tutaj
// potrzebny jest wyłącznie dowód, że odmowa DOCHODZI zdaniem.
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Data w wierszu ma być DETERMINISTYCZNA: wynik `Intl` zależy od wersji ICU
// maszyny, a przedmiotem dowodu jest to, JAKĄ WARTOŚĆ i W JAKIM JĘZYKU organizm
// oddaje do formatowania - nie sam napis.
vi.mock("@/lib/i18n/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/format")>()),
  formatDateTime: (value: string | number | Date, lang: string | undefined) =>
    `data(${String(value)}|${String(lang)})`,
}));

// Radix Switch nie przełącza się pod happy-dom bez pointer API - oba filtry
// i przełącznik zakresu w oknie są natywnymi polami wyboru z tą samą
// dostępną nazwą.
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

// Radix Select nie renderuje opcji bez pointer API - droplista jest natywnym
// `<select>`, którego wartość jedzie tą samą drogą (`onValueChange`).
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

// Atrapa Radixa: przy zamkniętym oknie NIC z jego wnętrza nie jest w drzewie
// (portal nie jest montowany). Przycisk zamknięcia stoi w korzeniu, bo to
// `Dialog` - nie jego treść - dostaje `onOpenChange`.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    children: ReactNode;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={() => onOpenChange(false)}>
          zamknij-okno
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/alert-dialog", () => {
  let open = false;
  let setOpen: ((next: boolean) => void) | null = null;
  return {
    AlertDialog: ({
      open: isOpen,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
      children: ReactNode;
    }) => {
      open = isOpen;
      setOpen = onOpenChange;
      return <div>{children}</div>;
    },
    AlertDialogContent: ({ children }: { children: ReactNode }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: { children: ReactNode }) => (
      <button type="button" onClick={() => setOpen?.(false)}>
        {children}
      </button>
    ),
    AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Dziennik historii jest osobnym organizmem tylko do odczytu. Tutaj liczy się
// wyłącznie to, Z CZYM organizm go otwiera - całego nadania czy jednego wiersza.
vi.mock("@/components/admin/events/organisms/EventAudienceGrantHistoryPanel", () => ({
  EventAudienceGrantHistoryPanel: (props: {
    eventId: string;
    grantId?: string | null;
    embedded?: boolean;
  }) => {
    h.historia.push({
      eventId: props.eventId,
      grantId: props.grantId ?? null,
      embedded: props.embedded === true,
    });
    return <div aria-label="dziennik-historii" />;
  },
  EventAudienceGrantHistoryButton: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("@/lib/events/useEventAudienceGrants", () => ({
  useAudienceGrants: (query: ZapytanieNadan) => {
    h.zapytania.push(query);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useSaveAudienceGrant: () => ({
    isPending: h.savePending,
    mutate: (input: AudienceGrantInput, res: Wynik<string>) => {
      h.saveInputs.push(input);
      if (h.saveFails !== null) res.onError?.(new Error(h.saveFails));
      else res.onSuccess?.("nowe-nadanie");
    },
  }),
  useRevokeAudienceGrant: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.revokeIds.push(id);
      if (h.revokeFails !== null) res.onError?.(new Error(h.revokeFails));
      else res.onSuccess?.(true);
    },
  }),
}));

const { EventAudienceGrantsPanel } =
  await import("@/components/admin/events/organisms/EventAudienceGrantsPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const UUID_OSOBY = "22222222-2222-4222-8222-222222222222";

/**
 * Wiersz `admin_event_audience_grants_list`. Sygnatura generowana z bazy opisuje
 * kolumny jako `string`, ale RPC oddaje w nich `NULL` - i organizm te `NULL`
 * ROZRÓŻNIA (brak terminu ważności, nadanie poza wydarzeniem, brak wycofania).
 * Rzutowanie jest więc wierne bazie, a nie obejściem typu.
 */
function grantRow(overrides: Partial<EventAudienceGrantRow> = {}): EventAudienceGrantRow {
  return {
    audience: "academic",
    company_id: null as unknown as string,
    company_name: null as unknown as string,
    created_at: "2026-08-01T09:00:00.000Z",
    event_id: EVENT_ID,
    event_title: "Kongres",
    evidence: "Legitymacja studencka 2026",
    id: "grant-a",
    person_id: null as unknown as string,
    revoked_at: null as unknown as string,
    state: "active",
    subject_email: "anna@uczelnia.test",
    subject_name: "Anna Kowalska",
    user_id: UUID_OSOBY,
    valid_from: "2026-08-01T09:00:00.000Z",
    valid_until: null as unknown as string,
    ...overrides,
  };
}

function renderuj() {
  return render(<EventAudienceGrantsPanel eventId={EVENT_ID} />);
}

/** Wiersz listy po widocznej etykiecie podmiotu. */
function wiersz(etykieta: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(etykieta) === true);
  if (li === undefined) throw new Error(`brak wiersza „${etykieta}” na ekranie`);
  return li;
}

/** Ostatnie zapytanie, które organizm wysłał do warstwy danych. */
function ostatnieZapytanie(): ZapytanieNadan {
  const last = h.zapytania.at(-1);
  if (last === undefined) throw new Error("organizm nie zapytał o nadania");
  return last as ZapytanieNadan;
}

/** Otwiera okno nowego nadania i zwraca jego treść. */
function otworzOkno(): HTMLElement {
  fireEvent.click(screen.getByText("adminEventRegistration.audienceGrants.addAction"));
  return screen.getByRole("dialog");
}

/** Wypełnia okno kompletem danych, które baza przyjmie. */
function wypelnij(okno: HTMLElement, dane: { subjectId?: string; evidence?: string } = {}): void {
  fireEvent.change(within(okno).getByLabelText("UUID"), {
    target: { value: dane.subjectId ?? UUID_OSOBY },
  });
  fireEvent.change(
    within(okno).getByLabelText("adminEventRegistration.audienceGrants.evidenceLabel"),
    { target: { value: dane.evidence ?? "Legitymacja studencka 2026" } },
  );
}

function zapisz(okno: HTMLElement): void {
  fireEvent.click(within(okno).getByText("adminEventRegistration.audienceGrants.saveAction"));
}

beforeEach(() => {
  h.language = "pl";
  h.rows = [];
  h.isLoading = false;
  h.listError = null;
  h.zapytania = [];
  h.saveInputs = [];
  h.saveFails = null;
  h.savePending = false;
  h.revokeIds = [];
  h.revokeFails = null;
  h.historia = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy nadań", () => {
  it("wczytywanie pokazuje postęp i NIE mówi o pustce", () => {
    h.rows = undefined;
    h.isLoading = true;
    renderuj();
    expect(screen.getByText("adminEventRegistration.audienceGrants.loading")).toBeTruthy();
    expect(screen.queryByText("adminEventRegistration.audienceGrants.empty")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  // NA EKRANIE UPRAWNIEŃ TO JEST NAJDROŻSZA POMYŁKA: „nie ma żadnych nadań" po
  // nieudanym zapytaniu to nieprawda o stanie uprawnień. Administrator nadaje
  // wtedy ulgę drugi raz - a księga ma po tym dwa wpisy dla jednej osoby.
  it("awaria mówi treścią odmowy i NIE mówi o pustce", () => {
    h.rows = undefined;
    h.listError = new Error("permission denied for function admin_event_audience_grants_list");
    renderuj();
    expect(
      screen.getByText("odmowa:permission denied for function admin_event_audience_grants_list"),
    ).toBeTruthy();
    expect(screen.queryByText("adminEventRegistration.audienceGrants.empty")).toBeNull();
    expect(screen.queryByText("adminEventRegistration.audienceGrants.loading")).toBeNull();
  });

  it("wczytywanie po nieudanej próbie bije awarię", () => {
    h.rows = undefined;
    h.isLoading = true;
    h.listError = new Error("grants_failed");
    renderuj();
    expect(screen.getByText("adminEventRegistration.audienceGrants.loading")).toBeTruthy();
    expect(screen.queryByText("odmowa:grants_failed")).toBeNull();
  });

  it("pustka mówi to wprost i nie rysuje ani jednego wiersza", () => {
    renderuj();
    expect(screen.getByText("adminEventRegistration.audienceGrants.empty")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("lista z danymi rysuje wiersz z podmiotem, grupą, stanem i podstawą", () => {
    h.rows = [grantRow()];
    renderuj();
    const li = wiersz("Anna Kowalska");
    expect(
      within(li).getByText("adminEventRegistration.audienceGrants.audiences.academic"),
    ).toBeTruthy();
    expect(
      within(li).getByText("adminEventRegistration.audienceGrants.states.active"),
    ).toBeTruthy();
    expect(within(li).getByText("Legitymacja studencka 2026")).toBeTruthy();
  });
});

describe("NADANIE SIĘ NIE KASUJE - dwa stany tego samego wiersza", () => {
  const AKTYWNE = () =>
    grantRow({ id: "grant-a", state: "active", revoked_at: null as unknown as string });
  const WYCOFANE = () =>
    grantRow({ id: "grant-a", state: "revoked", revoked_at: "2026-08-20T12:00:00.000Z" });

  it("nadanie aktywne ma przycisk wycofania", () => {
    h.rows = [AKTYWNE()];
    renderuj();
    expect(
      within(wiersz("Anna Kowalska")).getByText(
        "adminEventRegistration.audienceGrants.revokeAction",
      ),
    ).toBeTruthy();
  });

  // NADANIE WYCOFANE ZOSTAJE NA LIŚCIE. Wiersz tłumaczy, dlaczego ktoś zapłacił
  // mniej - skasowany zniknąłby razem z uzasadnieniem faktury.
  it("nadanie wycofane NADAL jest na liście, z podstawą i podmiotem", () => {
    h.rows = [WYCOFANE()];
    renderuj();
    const li = wiersz("Anna Kowalska");
    expect(within(li).getByText("Legitymacja studencka 2026")).toBeTruthy();
  });

  // TRZY RÓŻNICE NARAZ. Każda z osobna dałaby się przeoczyć, a razem znaczą:
  // „to uprawnienie już nie działa i nie ma czego wycofywać".
  it("wycofane NIE wygląda jak aktywne: inny stan, data wycofania, brak akcji", () => {
    h.rows = [WYCOFANE()];
    renderuj();
    const li = wiersz("Anna Kowalska");
    expect(
      within(li).getByText("adminEventRegistration.audienceGrants.states.revoked"),
    ).toBeTruthy();
    expect(
      within(li).queryByText("adminEventRegistration.audienceGrants.states.active"),
    ).toBeNull();
    expect(li.textContent).toContain(
      "adminEventRegistration.audienceGrants.revokedAt(date=data(2026-08-20T12:00:00.000Z|pl))",
    );
    expect(within(li).queryByText("adminEventRegistration.audienceGrants.revokeAction")).toBeNull();
  });

  it("nadanie aktywne NIE dostaje daty wycofania", () => {
    h.rows = [AKTYWNE()];
    renderuj();
    expect(wiersz("Anna Kowalska").textContent).not.toContain(
      "adminEventRegistration.audienceGrants.revokedAt",
    );
  });

  it("stan pośredni („zaplanowane”, „wygasłe”) jest NAZWANY, a nie zrównany z aktywnym", () => {
    h.rows = [
      grantRow({ id: "a", subject_name: "Zaplanowane", state: "scheduled" }),
      grantRow({ id: "b", subject_name: "Wygasłe", state: "expired" }),
    ];
    renderuj();
    expect(
      within(wiersz("Zaplanowane")).getByText(
        "adminEventRegistration.audienceGrants.states.scheduled",
      ),
    ).toBeTruthy();
    expect(
      within(wiersz("Wygasłe")).getByText("adminEventRegistration.audienceGrants.states.expired"),
    ).toBeTruthy();
  });

  // NADANIE, KTÓRE JESZCZE NIE OBOWIĄZUJE ALBO WYGASŁO, NIE JEST WYCOFANE -
  // wycofać je nadal wolno, bo `revoked_at` jest osobną kolumną.
  it("nadanie wygasłe zachowuje przycisk wycofania", () => {
    h.rows = [grantRow({ state: "expired" })];
    renderuj();
    expect(
      within(wiersz("Anna Kowalska")).getByText(
        "adminEventRegistration.audienceGrants.revokeAction",
      ),
    ).toBeTruthy();
  });
});

describe("filtry jadą do bazy, nie do tablicy w przeglądarce", () => {
  it("stan początkowy pyta o TO wydarzenie i BEZ wycofanych", () => {
    renderuj();
    expect(ostatnieZapytanie()).toEqual({
      eventId: EVENT_ID,
      audience: "all",
      includeRevoked: false,
      search: "",
    });
  });

  // FILTR „POKAŻ WYCOFANE" TO PYTANIE DO BAZY, nie ukrywanie wierszy. Gdyby
  // ukrywał je po stronie klienta, lista aktywnych nadań byłaby wycinkiem
  // JEDNEJ strony wyników, a nie stanem uprawnień.
  it("„Pokaż wycofane” zmienia ZAPYTANIE, a nie widoczność wierszy", () => {
    renderuj();
    fireEvent.click(screen.getByLabelText("adminEventRegistration.audienceGrants.includeRevoked"));
    expect(ostatnieZapytanie().includeRevoked).toBe(true);
  });

  it("zdjęcie zakresu wydarzenia pyta o nadania CAŁEGO najemcy", () => {
    renderuj();
    fireEvent.click(screen.getByLabelText("adminEventRegistration.audienceGrants.scopeThis"));
    expect(ostatnieZapytanie().eventId).toBeNull();
  });

  it("wybór grupy odbiorców jedzie w zapytaniu, a „wszystkie” wraca do braku zawężenia", () => {
    renderuj();
    const droplista = screen.getByLabelText("adminEventRegistration.audienceGrants.audienceLabel");
    fireEvent.change(droplista, { target: { value: "ngo" } });
    expect(ostatnieZapytanie().audience).toBe("ngo");
    fireEvent.change(droplista, { target: { value: "all" } });
    expect(ostatnieZapytanie().audience).toBe("all");
  });

  // GRUPA SPOZA CHECK-a BAZY NIE MOŻE POJECHAĆ W ZAPYTANIU. Filtr zawęża
  // ekran uprawnień - wartość, której baza nie zna, oddałaby pustą listę
  // wyglądającą jak „nikt nie ma tej ulgi".
  it("wartość spoza zbioru bazy wraca do „wszystkie”", () => {
    renderuj();
    fireEvent.change(screen.getByLabelText("adminEventRegistration.audienceGrants.audienceLabel"), {
      target: { value: "student" },
    });
    expect(ostatnieZapytanie().audience).toBe("all");
  });

  it("droplista filtra niesie WSZYSTKIE grupy z bazy i pozycję „wszystkie”", () => {
    renderuj();
    const opcje = within(
      screen.getByLabelText("adminEventRegistration.audienceGrants.audienceLabel"),
    )
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual([
      "adminEventRegistration.audienceGrants.audienceAll",
      "adminEventRegistration.audienceGrants.audiences.academic",
      "adminEventRegistration.audienceGrants.audiences.ngo",
      "adminEventRegistration.audienceGrants.audiences.company",
    ]);
  });

  it("fraza jedzie w zapytaniu bez obcinania po stronie ekranu", () => {
    renderuj();
    fireEvent.change(screen.getByLabelText("adminEventRegistration.audienceGrants.searchLabel"), {
      target: { value: "  kowalska  " },
    });
    expect(ostatnieZapytanie().search).toBe("  kowalska  ");
  });
});

describe("etykieta podmiotu - nadanie zawsze wskazuje, KOGO dotyczy", () => {
  it("osoba z nazwiskiem pokazuje nazwisko", () => {
    h.rows = [grantRow({ subject_name: "Anna Kowalska" })];
    renderuj();
    expect(screen.getByText("Anna Kowalska")).toBeTruthy();
  });

  it("nadanie firmowe bez osoby pokazuje nazwę firmy", () => {
    h.rows = [
      grantRow({
        audience: "company",
        subject_name: null as unknown as string,
        company_name: "Fundacja Testowa",
        company_id: "33333333-3333-4333-8333-333333333333",
        user_id: null as unknown as string,
      }),
    ];
    renderuj();
    expect(screen.getByText("Fundacja Testowa")).toBeTruthy();
  });

  it("bez nazwy zostaje adres pocztowy, a bez adresu - identyfikator konta", () => {
    h.rows = [
      grantRow({
        id: "a",
        subject_name: null as unknown as string,
        company_name: null as unknown as string,
        subject_email: "anna@uczelnia.test",
      }),
      grantRow({
        id: "b",
        subject_name: null as unknown as string,
        company_name: null as unknown as string,
        subject_email: null as unknown as string,
        user_id: UUID_OSOBY,
      }),
    ];
    renderuj();
    expect(screen.getByText("anna@uczelnia.test")).toBeTruthy();
    expect(screen.getByText(UUID_OSOBY)).toBeTruthy();
  });

  // NADANIE BEZ ŻADNEGO ROZPOZNAWALNEGO PODMIOTU nadal musi mieć wiersz -
  // pusta etykieta czytałaby się jak uszkodzony wiersz listy.
  it("nadanie bez żadnej z tych wartości pokazuje myślnik, a nie pustkę", () => {
    h.rows = [
      grantRow({
        subject_name: null as unknown as string,
        company_name: null as unknown as string,
        subject_email: null as unknown as string,
        user_id: null as unknown as string,
        person_id: null as unknown as string,
        company_id: null as unknown as string,
      }),
    ];
    renderuj();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("nadanie kartotekowe pokazuje identyfikator osoby z kartoteki", () => {
    h.rows = [
      grantRow({
        subject_name: null as unknown as string,
        company_name: null as unknown as string,
        subject_email: null as unknown as string,
        user_id: null as unknown as string,
        person_id: "44444444-4444-4444-8444-444444444444",
      }),
    ];
    renderuj();
    expect(screen.getByText("44444444-4444-4444-8444-444444444444")).toBeTruthy();
  });
});

describe("zakres i termin ważności w wierszu", () => {
  it("nadanie poza wydarzeniem mówi, że obowiązuje wszędzie", () => {
    h.rows = [grantRow({ event_title: null as unknown as string })];
    renderuj();
    expect(wiersz("Anna Kowalska").textContent).toContain(
      "adminEventRegistration.audienceGrants.scopeAll",
    );
  });

  it("nadanie wydarzenia pokazuje jego tytuł", () => {
    h.rows = [grantRow({ event_title: "Kongres" })];
    renderuj();
    expect(wiersz("Anna Kowalska").textContent).toContain("Kongres");
  });

  it("nadanie bezterminowe mówi to wprost, a terminowe pokazuje datę", () => {
    h.rows = [
      grantRow({ id: "a", subject_name: "Bez terminu", valid_until: null as unknown as string }),
      grantRow({ id: "b", subject_name: "Z terminem", valid_until: "2027-06-30T00:00:00.000Z" }),
    ];
    renderuj();
    expect(wiersz("Bez terminu").textContent).toContain(
      "adminEventRegistration.audienceGrants.neverExpires",
    );
    expect(wiersz("Z terminem").textContent).toContain("data(2027-06-30T00:00:00.000Z|pl)");
  });

  it("po angielsku data składa się w języku angielskim", () => {
    h.language = "en";
    h.rows = [grantRow({ valid_until: "2027-06-30T00:00:00.000Z" })];
    renderuj();
    expect(wiersz("Anna Kowalska").textContent).toContain("data(2027-06-30T00:00:00.000Z|en)");
  });
});

describe("wycofanie nadania", () => {
  it("przycisk OTWIERA pytanie i sam z siebie niczego nie stempluje", () => {
    h.rows = [grantRow()];
    renderuj();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(
      within(wiersz("Anna Kowalska")).getByText(
        "adminEventRegistration.audienceGrants.revokeAction",
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(h.revokeIds).toEqual([]);
  });

  // IDENTYFIKATOR MUSI BYĆ Z TEGO WIERSZA. Pomyłka na tym ekranie odbiera ulgę
  // niewłaściwej osobie - i zostawia w dzienniku ślad, że zrobił to administrator.
  it("potwierdzenie wysyła identyfikator TEGO nadania, nie pierwszego z listy", () => {
    h.rows = [
      grantRow({ id: "grant-a", subject_name: "Anna Kowalska" }),
      grantRow({ id: "grant-b", subject_name: "Bartosz Nowak" }),
    ];
    renderuj();
    fireEvent.click(
      within(wiersz("Bartosz Nowak")).getByText(
        "adminEventRegistration.audienceGrants.revokeAction",
      ),
    );
    // Nagłówek pytania niesie ten sam napis co przycisk - pytamy o ROLĘ,
    // żeby test nie przechodził na kliknięciu w tytuł.
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "adminEventRegistration.audienceGrants.revokeAction",
      }),
    );
    expect(h.revokeIds).toEqual(["grant-b"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "adminEventRegistration.audienceGrants.toasts.revoked",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("wycofanie się z pytania nie woła warstwy danych", () => {
    h.rows = [grantRow()];
    renderuj();
    fireEvent.click(
      within(wiersz("Anna Kowalska")).getByText(
        "adminEventRegistration.audienceGrants.revokeAction",
      ),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEventRegistration.audienceGrants.cancelAction",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.revokeIds).toEqual([]);
  });

  it("odmowa wycofania dochodzi zdaniem i zostawia listę na ekranie", () => {
    h.rows = [grantRow()];
    h.revokeFails = "grant_already_revoked: nothing to do";
    renderuj();
    fireEvent.click(
      within(wiersz("Anna Kowalska")).getByText(
        "adminEventRegistration.audienceGrants.revokeAction",
      ),
    );
    // Nagłówek pytania niesie ten sam napis co przycisk - pytamy o ROLĘ,
    // żeby test nie przechodził na kliknięciu w tytuł.
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "adminEventRegistration.audienceGrants.revokeAction",
      }),
    );
    expect(h.toastError).toHaveBeenCalledWith("odmowa:grant_already_revoked: nothing to do");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(wiersz("Anna Kowalska")).toBeTruthy();
  });
});

describe("nowe nadanie - co zatrzymuje zapis PRZED żądaniem", () => {
  it("pusty formularz nie woła bazy i nazywa brakujący podmiot", () => {
    renderuj();
    const okno = otworzOkno();
    zapisz(okno);
    expect(h.saveInputs).toEqual([]);
    expect(screen.getByRole("alert").textContent).toBe(
      "adminEventRegistration.audienceGrants.errors.subjectRequired",
    );
  });

  // BAZA PRZYJMUJE WYŁĄCZNIE UUID. Bez tej bramki administrator wysyła adres
  // pocztowy, dostaje odmowę `22P02` i nie ma jak zgadnąć, o co chodziło.
  it("podmiot podany nie-UUID-em zatrzymuje zapis", () => {
    renderuj();
    const okno = otworzOkno();
    wypelnij(okno, { subjectId: "anna@uczelnia.test" });
    zapisz(okno);
    expect(h.saveInputs).toEqual([]);
    expect(screen.getByRole("alert").textContent).toBe(
      "adminEventRegistration.audienceGrants.errors.subjectRequired",
    );
  });

  // PODSTAWA JEST OBOWIĄZKOWA PO STRONIE BAZY, bo nadanie bez uzasadnienia nie
  // ma wartości rozliczeniowej. Sprawdzamy JĄ OSOBNO: przy poprawnym podmiocie,
  // żeby nie dało się przejść na komunikacie o podmiocie.
  it("brak podstawy zatrzymuje zapis OSOBNYM komunikatem", () => {
    renderuj();
    const okno = otworzOkno();
    wypelnij(okno, { evidence: "   " });
    zapisz(okno);
    expect(h.saveInputs).toEqual([]);
    expect(screen.getByRole("alert").textContent).toBe(
      "adminEventRegistration.audienceGrants.errors.evidenceRequired",
    );
  });

  it("komplet danych puszcza zapis i zamyka okno", () => {
    renderuj();
    const okno = otworzOkno();
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "adminEventRegistration.audienceGrants.toasts.saved",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("nowe nadanie - kształt ładunku", () => {
  it("konto: wypełnione JEDNO pole podmiotu, dwa pozostałe puste", () => {
    renderuj();
    const okno = otworzOkno();
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs[0]).toEqual({
      audience: "academic",
      userId: UUID_OSOBY,
      personId: null,
      companyId: null,
      eventId: EVENT_ID,
      evidence: "Legitymacja studencka 2026",
      validUntil: null,
    });
  });

  // BAZA ODRZUCA DWA PODMIOTY NARAZ. Rodzaj podmiotu decyduje, KTÓRA kolumna
  // dostaje wartość - pomyłka tutaj to nadanie przypięte do niewłaściwej encji.
  it("kartoteka: wartość ląduje w polu osoby, nie konta", () => {
    renderuj();
    const okno = otworzOkno();
    fireEvent.change(
      within(okno).getByLabelText("adminEventRegistration.audienceGrants.columns.holder"),
      { target: { value: "person" } },
    );
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs[0]).toMatchObject({
      userId: null,
      personId: UUID_OSOBY,
      companyId: null,
    });
  });

  it("organizacja: wartość ląduje w polu firmy", () => {
    renderuj();
    const okno = otworzOkno();
    fireEvent.change(
      within(okno).getByLabelText("adminEventRegistration.audienceGrants.columns.holder"),
      { target: { value: "company" } },
    );
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs[0]).toMatchObject({
      userId: null,
      personId: null,
      companyId: UUID_OSOBY,
    });
  });

  it("rodzaj podmiotu spoza zbioru wraca do konta", () => {
    renderuj();
    const okno = otworzOkno();
    fireEvent.change(
      within(okno).getByLabelText("adminEventRegistration.audienceGrants.columns.holder"),
      { target: { value: "robot" } },
    );
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs[0]).toMatchObject({ userId: UUID_OSOBY, personId: null });
  });

  it("grupa odbiorców z okna jedzie w ładunku", () => {
    renderuj();
    const okno = otworzOkno();
    fireEvent.change(
      within(okno).getByLabelText("adminEventRegistration.audienceGrants.audienceLabel"),
      { target: { value: "ngo" } },
    );
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs[0]).toMatchObject({ audience: "ngo" });
  });

  it("grupa spoza zbioru bazy wraca do akademickiej, zamiast pojechać do bazy", () => {
    renderuj();
    const okno = otworzOkno();
    fireEvent.change(
      within(okno).getByLabelText("adminEventRegistration.audienceGrants.audienceLabel"),
      { target: { value: "student" } },
    );
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs[0]).toMatchObject({ audience: "academic" });
  });

  // ZAKRES „WSZYSTKIE WYDARZENIA" TO INNE UPRAWNIENIE niż ulga na jeden
  // kongres - i tylko brak `eventId` odróżnia je w bazie.
  it("zdjęcie zakresu wydarzenia wysyła nadanie BEZ wydarzenia", () => {
    renderuj();
    const okno = otworzOkno();
    fireEvent.click(
      within(okno).getByLabelText("adminEventRegistration.audienceGrants.scopeLabel"),
    );
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs[0]).toMatchObject({ eventId: null });
  });

  it("przełącznik zakresu NAZYWA stan, który właśnie ustawiono", () => {
    renderuj();
    const okno = otworzOkno();
    expect(
      within(okno).getAllByText("adminEventRegistration.audienceGrants.scopeThis").length,
    ).toBeGreaterThan(0);
    fireEvent.click(
      within(okno).getByLabelText("adminEventRegistration.audienceGrants.scopeLabel"),
    );
    expect(
      within(screen.getByRole("dialog")).getAllByText(
        "adminEventRegistration.audienceGrants.scopeAll",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("termin ważności jedzie jako pełny znacznik czasu, a pusty jako brak terminu", () => {
    renderuj();
    const okno = otworzOkno();
    fireEvent.change(
      within(okno).getByLabelText("adminEventRegistration.audienceGrants.validUntilLabel"),
      { target: { value: "2027-06-30" } },
    );
    wypelnij(okno);
    zapisz(okno);
    expect(h.saveInputs[0]).toMatchObject({
      validUntil: new Date("2027-06-30").toISOString(),
    });
  });
});

describe("nowe nadanie - trwający zapis i odmowa", () => {
  // TRWAJĄCY ZAPIS GASI PRZYCISK. Bez tego dwa kliknięcia to DWA nadania dla
  // tej samej osoby - a każde zostawia własny wpis w dzienniku audytu.
  it("trwający zapis gasi przycisk i drugie kliknięcie nic nie wysyła", () => {
    h.savePending = true;
    renderuj();
    const okno = otworzOkno();
    wypelnij(okno);
    const przycisk = within(okno)
      .getByText("adminEventRegistration.audienceGrants.saveAction")
      .closest("button");
    expect(przycisk?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(przycisk as HTMLElement);
    expect(h.saveInputs).toEqual([]);
  });

  // ODMOWA NIE MOŻE KASOWAĆ PRACY. Komunikat idzie DO OKNA, nie do toasta,
  // który zniknie razem z wpisanym UUID-em i podstawą.
  it("odmowa bazy zostaje w oknie razem z wpisanymi danymi", () => {
    h.saveFails = "audience_grant_duplicate: grant already exists";
    renderuj();
    const okno = otworzOkno();
    wypelnij(okno);
    zapisz(okno);
    expect(screen.getByRole("alert").textContent).toBe(
      "odmowa:audience_grant_duplicate: grant already exists",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (within(screen.getByRole("dialog")).getByLabelText("UUID") as HTMLInputElement).value,
    ).toBe(UUID_OSOBY);
  });

  // PONOWNE OTWARCIE ZACZYNA OD CZYSTEJ KARTKI. Komunikat odmowy sprzed
  // godziny nad pustym formularzem czyta się jak awaria ekranu.
  it("ponowne otwarcie czyści komunikat i wpisane dane", () => {
    renderuj();
    const okno = otworzOkno();
    wypelnij(okno, { subjectId: "nie-uuid" });
    zapisz(okno);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(within(okno).getByText("adminEventRegistration.audienceGrants.cancelAction"));
    const drugie = otworzOkno();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((within(drugie).getByLabelText("UUID") as HTMLInputElement).value).toBe("");
  });

  it("zamknięcie okna z zewnątrz też je gasi", () => {
    renderuj();
    otworzOkno();
    fireEvent.click(screen.getByText("zamknij-okno"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("dziennik historii", () => {
  it("panel pod listą pokazuje historię CAŁEGO wydarzenia", () => {
    renderuj();
    expect(h.historia).toEqual([{ eventId: EVENT_ID, grantId: null, embedded: false }]);
  });

  // AUDYT PYTA ZWYKLE O KONKRETNĄ ULGĘ, nie o cały dziennik naraz - dlatego
  // wejście jest z WIERSZA i niesie identyfikator tego nadania.
  it("wejście z wiersza otwiera historię JEDNEGO nadania", () => {
    h.rows = [
      grantRow({ id: "grant-a", subject_name: "Anna Kowalska" }),
      grantRow({ id: "grant-b", subject_name: "Bartosz Nowak" }),
    ];
    renderuj();
    h.historia = [];
    fireEvent.click(
      within(wiersz("Bartosz Nowak")).getByText(
        "adminEventRegistration.audienceGrantHistory.openAction",
      ),
    );
    expect(h.historia).toContainEqual({
      eventId: EVENT_ID,
      grantId: "grant-b",
      embedded: true,
    });
  });

  it("okno historii podpisuje się podmiotem, którego dotyczy", () => {
    h.rows = [grantRow({ subject_name: "Anna Kowalska" })];
    renderuj();
    fireEvent.click(screen.getByText("adminEventRegistration.audienceGrantHistory.openAction"));
    const okno = screen.getByRole("dialog");
    expect(within(okno).getByText("Anna Kowalska")).toBeTruthy();
    expect(
      within(okno).getByText("adminEventRegistration.audienceGrantHistory.dialogTitle"),
    ).toBeTruthy();
  });

  it("zamknięcie okna historii nie zostawia zagnieżdżonego dziennika w drzewie", () => {
    h.rows = [grantRow()];
    renderuj();
    fireEvent.click(screen.getByText("adminEventRegistration.audienceGrantHistory.openAction"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("zamknij-okno"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByLabelText("dziennik-historii")).toHaveLength(1);
  });
});

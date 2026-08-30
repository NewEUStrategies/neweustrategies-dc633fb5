// Organizm „SALE WYDARZENIA" - katalog miejsc, w których stoi program.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJĄ CZTERY WIDOKI, a awaria NIE MOŻE mówić „nie ma
//      jeszcze sal" - po takim napisie organizator zakłada salę, która już
//      istnieje, a baza odmawia mu z powodu unikalnej nazwy.
//   2. ZAJĘTE MINUTY STOJĄ OBOK POJEMNOŚCI - to jest cała teza nagłówka
//      organizmu. Sala bez ani jednej minuty programu da się skasować; sala
//      z minutami kończy się odmową `room_in_use`. Wiersz, który pokazuje obie
//      liczby, zamienia odmowę w decyzję podjętą PRZED kliknięciem.
//   3. PRZEŁĄCZNIK „AKTYWNA" WYSYŁA CAŁY WIERSZ. RPC zapisu jest upsertem, więc
//      pole pominięte w ładunku znika z bazy - wyłączenie sali skasowałoby jej
//      piętro i notatkę lokalizacyjną. Asercja stoi na PEŁNYM obiekcie.
//   4. PUSTA POJEMNOŚĆ TO BRAK DEKLARACJI, NIE ZERO. Sala na zero osób nie
//      przyjmie żadnej sesji; sala bez deklarowanej pojemności przyjmie każdą.
//      RPC oddaje tu `NULL`, a wygenerowany typ obiecuje `number`.
//   5. ODMOWA BAZY DOCHODZI ZDANIEM I ZAMYKA POTWIERDZENIE, a nie zostawia
//      okna, z którego nie wiadomo, czy coś się stało.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Okna sali - `EventRoomDialog.test.tsx`.
// (2) Reguł wersji roboczej (`roomDraftFromRow`, `roomDraftToInput`) - mają
// tabelę w `lib/events/__tests__/agendaCatalogDraft.test.ts` i tutaj są
// PRAWDZIWE, bo przedmiotem dowodu jest ich WYNIK w ładunku. (3) Hooków
// i unieważnień - `lib/events/__tests__/useEventSessions.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { radixSwitchStub } from "@/test/reactStubs";
import { axeViolations, summarize } from "@/test/axe";
import type { EventRoomInput, EventRoomRow } from "@/lib/events/sessionsApi";

/**
 * Kształt drugiego argumentu `mutate`. Obie gałęzie są OPCJONALNE, bo
 * przełącznik „aktywna" świadomie nie podaje `onSuccess` - i to też jest
 * zachowanie, które ten plik sprawdza.
 */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: Error) => void;
}

/** Propsy okna sali przechwycone z ostatniego renderu. */
interface PropsyOkna {
  open: boolean;
  room: EventRoomRow | null;
  nextSortOrder: number;
  isSaving: boolean;
}

const h = vi.hoisted(() => ({
  rooms: undefined as EventRoomRow[] | undefined,
  isLoading: false,
  listError: null as Error | null,
  saveInputs: [] as EventRoomInput[],
  saveFails: null as string | null,
  savePending: false,
  removeIds: [] as string[],
  removeFails: null as string | null,
  removeSilent: false,
  okno: null as PropsyOkna | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Słownik odmów bazy ma własny plik testowy i ciągnie realny i18next; tutaj
// potrzebny jest wyłącznie dowód, że odmowa DOCHODZI zdaniem, a nie kodem.
vi.mock("@/lib/events/adminAgendaErrors", () => ({
  adminAgendaErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Switch nie przełącza się pod happy-dom bez pointer API - przełącznik
// „aktywna" jest natywnym polem wyboru z tą samą dostępną nazwą.
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

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

vi.mock("@/components/admin/events/molecules/EventRoomDialog", () => ({
  EventRoomDialog: (
    props: PropsyOkna & {
      onSubmit: (input: EventRoomInput) => void;
      onOpenChange: (open: boolean) => void;
    },
  ) => {
    h.okno = {
      open: props.open,
      room: props.room,
      nextSortOrder: props.nextSortOrder,
      isSaving: props.isSaving,
    };
    if (!props.open) return null;
    return (
      <div role="dialog" aria-label="okno-sali">
        <button
          type="button"
          onClick={() =>
            props.onSubmit({
              id: props.room === null ? null : String(props.room.id),
              eventId: EVENT_ID,
              name: "Sala Gdańsk",
              capacity: 40,
              floor: null,
              locationNote: null,
              sortOrder: props.nextSortOrder,
              isActive: true,
            })
          }
        >
          zapisz-sale
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          zamknij-sale
        </button>
      </div>
    );
  },
}));

vi.mock("@/lib/events/useEventSessions", () => ({
  useEventRooms: () => ({ data: h.rooms, isLoading: h.isLoading, error: h.listError }),
  useSaveEventRoom: () => ({
    isPending: h.savePending,
    mutate: (input: EventRoomInput, res: Wynik<string>) => {
      h.saveInputs.push(input);
      if (h.saveFails !== null) res.onError?.(new Error(h.saveFails));
      else res.onSuccess?.("nowa-sala");
    },
  }),
  useDeleteEventRoom: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.removeIds.push(id);
      // `removeSilent` odwzorowuje ZAPIS W TOKU: baza jeszcze nie odpowiedziała,
      // więc ani `onSuccess`, ani `onError` się nie wywołały.
      if (h.removeSilent) return;
      if (h.removeFails !== null) res.onError?.(new Error(h.removeFails));
      else res.onSuccess?.(true);
    },
  }),
}));

const { AgendaRoomsPanel } = await import("@/components/admin/events/organisms/AgendaRoomsPanel");

const EVENT_ID = "e5000000-0000-4000-8000-0000000000a1";

/**
 * Kolumna, którą RPC oddaje jako `NULL`, a generator typuje jako `number`.
 *
 * `admin_event_rooms_list` oddaje `capacity` wprost z tabeli, a sala bez
 * zadeklarowanej pojemności ma tam `NULL` - to jest właśnie stan „przyjmie
 * każdą sesję", odróżniony od sali na zero miejsc. Sygnatura `RETURNS TABLE`
 * nie niesie `NOT NULL`, więc wygenerowany typ obiecuje `number`. To jedyne
 * rzutowanie w tym pliku i stoi po to, żeby fixture mówił PRAWDĘ.
 *
 * DLACZEGO RZUTOWANIE JEST TU JEDYNYM WYJŚCIEM. Fixture musi mieć DOKŁADNIE
 * kształt wiersza z generatora - własny, poluzowany typ przestałby pilnować
 * sygnatury RPC, a to właśnie ona ma tu pęknąć, gdy zmieni się kolumna.
 * Wartość zgodna z typem (pusty napis, zero) byłaby KŁAMSTWEM o odpowiedzi
 * bazy i schowałaby dokładnie te przypadki, dla których ten plik istnieje.
 * Dług należy do wygenerowanych typów i znika, gdy generator nauczy się
 * `NOT NULL` (pilnuje tego `check:types-freshness`).
 */
const BRAK_POJEMNOSCI = null as unknown as number;

/** Wiersz `admin_event_rooms_list` - pełny kształt sygnatury, nie wycinek. */
function roomRow(overrides: Partial<EventRoomRow> = {}): EventRoomRow {
  return {
    booked_minutes: 0,
    capacity: 120,
    created_at: "2026-08-01T09:00:00.000Z",
    event_id: EVENT_ID,
    floor: "Parter",
    id: "a6000000-0000-4000-8000-000000000001",
    is_active: true,
    location_note: "Wejście A",
    name: "Sala Główna",
    sessions_count: 0,
    sort_order: 20,
    updated_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

/** Sala W UŻYCIU - trzy sesje i 180 minut programu. */
const SALA_ZAJETA = roomRow({ sessions_count: 3, booked_minutes: 180 });

/** Sala PUSTA - zero sesji, zero minut, więc wolno ją skasować. */
const SALA_PUSTA = roomRow({
  id: "a6000000-0000-4000-8000-000000000002",
  name: "Foyer Puste",
  floor: "",
  location_note: "Przy szatni",
  capacity: BRAK_POJEMNOSCI,
  sessions_count: 0,
  booked_minutes: 0,
  sort_order: 40,
  is_active: false,
});

function renderuj() {
  return render(<AgendaRoomsPanel eventId={EVENT_ID} />);
}

/** Wiersz listy po widocznej nazwie sali. */
function wiersz(nazwa: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(nazwa) === true);
  if (li === undefined) throw new Error(`brak wiersza „${nazwa}” na ekranie`);
  return li;
}

beforeEach(() => {
  h.rooms = [];
  h.isLoading = false;
  h.listError = null;
  h.saveInputs = [];
  h.saveFails = null;
  h.savePending = false;
  h.removeIds = [];
  h.removeFails = null;
  h.removeSilent = false;
  h.okno = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy sal", () => {
  it("wczytywanie pokazuje postęp i NIE mówi o pustce", () => {
    h.rooms = undefined;
    h.isLoading = true;
    renderuj();

    expect(screen.getByText("adminEventAgenda.rooms.loading")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.rooms.empty")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  // AWARIA WYGLĄDAJĄCA JAK PUSTKA każe organizatorowi założyć salę, która już
  // istnieje - a wtedy baza odmawia z powodu unikalnej nazwy i wygląda to na
  // drugi, niezwiązany błąd.
  it("awaria mówi treścią odmowy i NIE mówi o pustce", () => {
    h.rooms = undefined;
    h.listError = new Error("permission denied for function admin_event_rooms_list");
    renderuj();

    expect(
      screen.getByText("odmowa:permission denied for function admin_event_rooms_list"),
    ).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.rooms.empty")).toBeNull();
  });

  it("wczytywanie po nieudanej próbie bije awarię", () => {
    h.rooms = undefined;
    h.isLoading = true;
    h.listError = new Error("rooms_failed");
    renderuj();

    expect(screen.getByText("adminEventAgenda.rooms.loading")).toBeTruthy();
    expect(screen.queryByText("odmowa:rooms_failed")).toBeNull();
  });

  it("pustka mówi to wprost, ale zostawia przycisk dodania sali", () => {
    renderuj();

    expect(screen.getByText("adminEventAgenda.rooms.empty")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.getByText("adminEventAgenda.rooms.addAction")).toBeTruthy();
  });

  it("lista rysuje po jednym wierszu na salę", () => {
    h.rooms = [SALA_ZAJETA, SALA_PUSTA];
    renderuj();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("adminEventAgenda.rooms.empty")).toBeNull();
  });
});

describe("wiersz sali mówi, czy da się ją skasować", () => {
  // TO JEST TEZA NAGŁÓWKA ORGANIZMU: liczba sesji i zajęte minuty stoją obok
  // pojemności, żeby odmowa `room_in_use` nie była niespodzianką.
  it("sala w użyciu pokazuje liczbę sesji i zajęte minuty", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();

    const li = wiersz("Sala Główna");
    expect(li.textContent).toContain("adminEventAgenda.rooms.sessionsCount(count=3)");
    expect(li.textContent).toContain("adminEventAgenda.rooms.bookedMinutes(count=180)");
    expect(li.textContent).toContain("adminEventAgenda.rooms.capacity(count=120)");
  });

  it("sala pusta pokazuje zero sesji i zero minut - to jest zgoda na skasowanie", () => {
    h.rooms = [SALA_PUSTA];
    renderuj();

    const li = wiersz("Foyer Puste");
    expect(li.textContent).toContain("adminEventAgenda.rooms.sessionsCount(count=0)");
    expect(li.textContent).toContain("adminEventAgenda.rooms.bookedMinutes(count=0)");
  });

  // PUSTA POJEMNOŚĆ TO BRAK DEKLARACJI, NIE ZERO - i wiersz musi to rozróżniać,
  // bo od tego zależy, czy limit miejsc sesji w ogóle da się z czymkolwiek
  // porównać (`capacity_over_room`).
  it("sala BEZ zadeklarowanej pojemności mówi „nieznana”, a nie „0 miejsc”", () => {
    h.rooms = [SALA_PUSTA];
    renderuj();

    const li = wiersz("Foyer Puste");
    expect(li.textContent).toContain("adminEventAgenda.rooms.capacityUnknown");
    expect(li.textContent).not.toContain("adminEventAgenda.rooms.capacity(count=0)");
  });

  it("wiersz pokazuje piętro, a gdy piętra nie ma - notatkę lokalizacyjną", () => {
    h.rooms = [SALA_ZAJETA, SALA_PUSTA];
    renderuj();

    expect(wiersz("Sala Główna").textContent).toContain("Parter");
    expect(wiersz("Foyer Puste").textContent).toContain("Przy szatni");
  });
});

describe("okno sali - kiedy się otwiera i z czym", () => {
  it("okno startuje ZAMKNIĘTE", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();

    expect(h.okno?.open).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("„dodaj salę” otwiera PUSTE okno, bez wiersza do edycji", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.addAction"));

    expect(h.okno?.open).toBe(true);
    expect(h.okno?.room).toBeNull();
  });

  it("ołówek w wierszu otwiera okno z TYM wierszem", () => {
    h.rooms = [SALA_ZAJETA, SALA_PUSTA];
    renderuj();
    fireEvent.click(
      within(wiersz("Foyer Puste")).getByLabelText("adminEventAgenda.rooms.dialog.editTitle"),
    );

    expect(h.okno?.open).toBe(true);
    expect(h.okno?.room?.id).toBe(SALA_PUSTA.id);
  });

  // NOWA SALA MA WEJŚĆ NA KONIEC LISTY, nie w środek - kolejność sal jest
  // kolejnością kolumn siatki czasu.
  it("kolejność nowej sali to NAJWIĘKSZA z listy plus dziesięć", () => {
    h.rooms = [SALA_ZAJETA, SALA_PUSTA];
    renderuj();

    expect(h.okno?.nextSortOrder).toBe(50);
  });

  it("pusta lista daje pierwszej sali kolejność dziesięć", () => {
    renderuj();

    expect(h.okno?.nextSortOrder).toBe(10);
  });

  // EDYCJA WRACA NA LISTĘ PO EDYCJI, a nie zostaje z wierszem w pamięci -
  // inaczej następne „dodaj salę” otworzyłoby formularz poprzedniej sali.
  it("zapis zamyka okno, zeruje edytowany wiersz i mówi o sukcesie", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(
      within(wiersz("Sala Główna")).getByLabelText("adminEventAgenda.rooms.dialog.editTitle"),
    );
    fireEvent.click(screen.getByText("zapisz-sale"));

    expect(h.saveInputs).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.rooms.toasts.saved");
    expect(h.okno?.open).toBe(false);
    expect(h.okno?.room).toBeNull();
  });

  // ODMOWA ZOSTAWIA OKNO OTWARTE - wpisana praca ma zostać na ekranie, żeby
  // dało się poprawić to, o co baza się upomniała.
  it("odmowa zapisu dochodzi zdaniem i NIE zamyka okna", () => {
    h.rooms = [SALA_ZAJETA];
    h.saveFails = "room_name_taken: a room with this name already exists";
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.addAction"));
    fireEvent.click(screen.getByText("zapisz-sale"));

    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:room_name_taken: a room with this name already exists",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.okno?.open).toBe(true);
  });

  // ZAPIS W TOKU JEST JEDYNYM ŹRÓDŁEM BLOKADY PRZYCISKU W OKNIE - bez niego
  // drugie kliknięcie „Zapisz" zakłada drugą salę o tej samej nazwie.
  it("okno dostaje stan „zapis w toku” z haka, a nie zgaduje go samo", () => {
    h.savePending = true;
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.addAction"));

    expect(h.okno?.isSaving).toBe(true);
  });

  it("bez zapisu w toku okno ma odblokowany przycisk", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.addAction"));

    expect(h.okno?.isSaving).toBe(false);
  });

  it("zamknięcie okna z jego wnętrza gasi je także w organizmie", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.addAction"));
    fireEvent.click(screen.getByText("zamknij-sale"));

    expect(h.okno?.open).toBe(false);
  });
});

describe("przełącznik „aktywna” wysyła CAŁY wiersz", () => {
  // RPC ZAPISU JEST UPSERTEM: pole pominięte w ładunku znika z bazy. Wyłączenie
  // sali skasowałoby jej piętro i notatkę lokalizacyjną, gdyby ładunek niósł
  // samą flagę - a odzyskać tego nie ma skąd.
  it("wyłączenie sali niesie nazwę, pojemność, piętro, notatkę i kolejność", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(
      within(wiersz("Sala Główna")).getByRole("switch", {
        name: "adminEventAgenda.rooms.dialog.isActive",
      }),
    );

    expect(h.saveInputs).toEqual([
      {
        id: SALA_ZAJETA.id,
        eventId: EVENT_ID,
        name: "Sala Główna",
        capacity: 120,
        floor: "Parter",
        locationNote: "Wejście A",
        sortOrder: 20,
        isActive: false,
      },
    ]);
  });

  it("włączenie wyłączonej sali odwraca WYŁĄCZNIE flagę", () => {
    h.rooms = [SALA_PUSTA];
    renderuj();
    fireEvent.click(
      within(wiersz("Foyer Puste")).getByRole("switch", {
        name: "adminEventAgenda.rooms.dialog.isActive",
      }),
    );

    expect(h.saveInputs[0]?.isActive).toBe(true);
    expect(h.saveInputs[0]?.name).toBe("Foyer Puste");
  });

  // BRAK POJEMNOŚCI MA POZOSTAĆ BRAKIEM. Gdyby wersja robocza zamieniła `NULL`
  // na `0`, przełączenie widoczności sali odebrałoby jej prawo do przyjęcia
  // jakiejkolwiek sesji z limitem miejsc.
  it("przełącznik nie podmienia braku pojemności na zero", () => {
    h.rooms = [SALA_PUSTA];
    renderuj();
    fireEvent.click(
      within(wiersz("Foyer Puste")).getByRole("switch", {
        name: "adminEventAgenda.rooms.dialog.isActive",
      }),
    );

    expect(h.saveInputs[0]?.capacity).toBeNull();
  });

  // PUSTE PIĘTRO I PUSTA NOTATKA JADĄ JAKO `null`, nie jako pusty napis - baza
  // rozróżnia „nie podano" od „podano pustkę".
  it("puste piętro jedzie jako `null`, a nie jako pusty napis", () => {
    h.rooms = [SALA_PUSTA];
    renderuj();
    fireEvent.click(
      within(wiersz("Foyer Puste")).getByRole("switch", {
        name: "adminEventAgenda.rooms.dialog.isActive",
      }),
    );

    expect(h.saveInputs[0]?.floor).toBeNull();
  });

  // PRZEŁĄCZNIK ŚWIADOMIE NIE MÓWI O SUKCESIE - toast po każdym kliknięciu
  // przełącznika byłby szumem; liczy się, że odmowa dochodzi.
  it("udane przełączenie NIE pokazuje toasta sukcesu", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(
      within(wiersz("Sala Główna")).getByRole("switch", {
        name: "adminEventAgenda.rooms.dialog.isActive",
      }),
    );

    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa przełączenia dochodzi zdaniem", () => {
    h.rooms = [SALA_ZAJETA];
    h.saveFails = "forbidden: event editor role required";
    renderuj();
    fireEvent.click(
      within(wiersz("Sala Główna")).getByRole("switch", {
        name: "adminEventAgenda.rooms.dialog.isActive",
      }),
    );

    expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: event editor role required");
  });
});

describe("kasowanie sali - odmowa `room_in_use` i jej kontrapunkt", () => {
  it("kosz otwiera potwierdzenie i NIE kasuje od razu", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(
      within(wiersz("Sala Główna")).getByLabelText("adminEventAgenda.rooms.deleteConfirm"),
    );

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(h.removeIds).toEqual([]);
  });

  it("potwierdzenie kasuje WSKAZANĄ salę, a nie sąsiada", () => {
    h.rooms = [SALA_ZAJETA, SALA_PUSTA];
    renderuj();
    fireEvent.click(
      within(wiersz("Foyer Puste")).getByLabelText("adminEventAgenda.rooms.deleteConfirm"),
    );
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.dialog.saveAction"));

    expect(h.removeIds).toEqual([SALA_PUSTA.id]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.rooms.toasts.deleted");
  });

  it("rezygnacja zamyka potwierdzenie i nie kasuje niczego", () => {
    h.rooms = [SALA_ZAJETA];
    renderuj();
    fireEvent.click(
      within(wiersz("Sala Główna")).getByLabelText("adminEventAgenda.rooms.deleteConfirm"),
    );
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.dialog.cancelAction"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.removeIds).toEqual([]);
  });

  // BAZA ODMAWIA SKASOWANIA SALI UŻYWANEJ PRZEZ SESJE (`room_in_use`), bo
  // kaskada zabrałaby sesjom miejsce, w którym się odbywają. Odmowa ma dojść
  // zdaniem i ZAMKNĄĆ potwierdzenie - okno wiszące po odmowie sugerowałoby,
  // że wystarczy kliknąć drugi raz.
  it("odmowa `room_in_use` dochodzi zdaniem i zamyka potwierdzenie", () => {
    h.rooms = [SALA_ZAJETA];
    h.removeFails = "room_in_use: 3 sessions still use this room";
    renderuj();
    fireEvent.click(
      within(wiersz("Sala Główna")).getByLabelText("adminEventAgenda.rooms.deleteConfirm"),
    );
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.dialog.saveAction"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:room_in_use: 3 sessions still use this room");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  // KONTRAPUNKT: odmowa dotyczy UŻYCIA, nie operacji. Bez tej pary „sali nie da
  // się skasować" byłoby nieodróżnialne od „kasowanie w ogóle nie działa".
  it("sala bez sesji kasuje się normalnie - kontrapunkt dla `room_in_use`", () => {
    h.rooms = [SALA_PUSTA];
    renderuj();
    fireEvent.click(
      within(wiersz("Foyer Puste")).getByLabelText("adminEventAgenda.rooms.deleteConfirm"),
    );
    fireEvent.click(screen.getByText("adminEventAgenda.rooms.dialog.saveAction"));

    expect(h.removeIds).toEqual([SALA_PUSTA.id]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  // DRUGIE KLIKNIĘCIE W CZASIE ZAPISU. Potwierdzenie kasowania - w odróżnieniu
  // od okna sali - nie dostaje żadnego stanu „zapis w toku": dopóki baza nie
  // odpowie, `pendingDelete` stoi, okno wisi, a każdy kolejny klik wysyła
  // KOLEJNE żądanie usunięcia. Ten przypadek utrwala zastane zachowanie, żeby
  // ewentualna blokada była świadomą zmianą, a nie skutkiem ubocznym.
  it("drugie kliknięcie potwierdzenia w czasie zapisu wysyła DRUGIE żądanie", () => {
    h.rooms = [SALA_PUSTA];
    h.removeSilent = true;
    renderuj();
    fireEvent.click(
      within(wiersz("Foyer Puste")).getByLabelText("adminEventAgenda.rooms.deleteConfirm"),
    );
    const potwierdz = screen.getByText("adminEventAgenda.rooms.dialog.saveAction");
    fireEvent.click(potwierdz);
    fireEvent.click(potwierdz);

    expect(h.removeIds).toEqual([SALA_PUSTA.id, SALA_PUSTA.id]);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("dostępność", () => {
  it("lista sal nie ma naruszeń dostępności", async () => {
    h.rooms = [SALA_ZAJETA, SALA_PUSTA];
    const { container } = renderuj();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusta lista sal nie ma naruszeń dostępności", async () => {
    const { container } = renderuj();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

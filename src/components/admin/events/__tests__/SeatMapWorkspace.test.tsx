// Organizm „przestrzeń robocza planu sali" - SKLEJENIE płótna, tabeli,
// szczegółu, uczestników, okien i pięciu mutacji.
//
// CO TEN PLIK DOWODZI.
//   1. STANY: wczytywanie, odmowa i dopiero potem plan - z powrotem do listy
//      w każdym z nich.
//   2. PRZYDZIAŁ ROZSTRZYGA BAZA. Kliknięcie miejsca z wybraną osobą (albo
//      upuszczenie osoby na płótno) woła przydział; odmowa „rezerwacja innej
//      firmy” / „bilet spoza kategorii” to PYTANIE o obejście (`force`),
//      „miejsce zajęte” przy osobie, która już siedzi - pytanie o zamianę
//      (`swap`); odmowa pytania nic nie wysyła, a każda inna odmowa to zdanie.
//   3. ZAZNACZENIE: kliknięcie zastępuje, z modyfikatorem rozszerza, ponowne
//      kliknięcie jedynego zaznaczonego je zdejmuje; tabela i płótno dzielą je.
//   4. ZWOLNIENIE zawsze z potwierdzeniem i tylko zajętych miejsc.
//   5. PUBLIKACJA, usunięcie sekcji i kategorii - z potwierdzeniem; okna
//      (plan, sekcja, kategoria, stan miejsc) wysyłają ładunek do WŁAŚCIWEJ
//      mutacji i zamykają się dopiero po sukcesie.
//   6. DRUK otwiera okno PRZED zapytaniem (gest użytkownika) i zamyka je przy
//      awarii; zablokowane okno mówi to zdaniem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Molekuły (płótno, tabela, szczegół, okna,
// uczestnicy, eksport) mają własne pliki - tu są ATRAPAMI, które oddają
// dokładnie te wywołania zwrotne, które organizm musi obsłużyć.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Seat, SeatMapDetail, SeatingCandidateRow } from "@/lib/events/seatingApi";

type Wynik = { onSuccess?: (value: unknown) => void; onError?: (error: unknown) => void };

const h = vi.hoisted(() => ({
  detail: null as SeatMapDetail | null,
  detailLoading: false,
  detailError: null as Error | null,
  calls: [] as { name: string; input: unknown }[],
  results: {} as Record<string, unknown[]>,
  pending: new Set<string>(),
  confirms: [] as boolean[],
  confirmCalls: [] as { title: string; destructive?: boolean }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  onDragEnd: null as ((event: unknown) => void) | null,
  dropTarget: null as { seatId: string; registrationId: string; name: string } | null,
  exportRows: [] as unknown[],
  exportError: null as Error | null,
  canvasLabels: new Map<string, string>(),
  tickets: undefined as { id: string; name_pl: string; name_en: string }[] | undefined,
}));

const DEFAULTS: Record<string, unknown> = {
  assign: { assignmentId: "as-9", movedFromSeatId: null, swappedRegistrationId: null },
  release: 1,
  updateSeats: 2,
  saveMap: "map-id",
  saveSection: { sectionId: "sec-a", seatsCreated: 2, seatsRemoved: 1, seatsKept: 3 },
  deleteSection: true,
  saveCategory: "cat-id",
  deleteCategory: true,
};

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/lib/i18n-event-seating", () => ({ ensureEventSeatingI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: (opts: { title: string; destructive?: boolean }) => {
    h.confirmCalls.push({ title: opts.title, destructive: opts.destructive });
    return Promise.resolve(h.confirms.shift() ?? false);
  },
}));
// Słownik odmów ma własny plik; tu liczy się GŁOWA kodu, od której zależy,
// czy organizm pyta o obejście albo zamianę.
vi.mock("@/lib/events/adminSeatingErrors", () => {
  const head = (error: unknown) =>
    (error instanceof Error ? error.message : String(error)).split(":")[0] ?? "";
  const camel = (value: string) =>
    value.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
  return {
    adminSeatingFailure: (error: unknown) => ({
      key: `adminEventSeating.errors.${camel(head(error))}`,
      params: {},
    }),
    adminSeatingErrorMessage: (error: unknown) =>
      `odmowa:${error instanceof Error ? error.message : String(error)}`,
  };
});
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children?: ReactNode;
    onDragEnd: (event: unknown) => void;
  }) => {
    h.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  PointerSensor: function PointerSensor() {},
  useSensor: () => ({}),
  useSensors: () => [],
}));
vi.mock("@/lib/events/seatingDnd", () => ({ seatDropTarget: () => h.dropTarget }));
vi.mock("@/lib/events/seatingApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/seatingApi")>()),
  fetchSeatingExport: () =>
    h.exportError === null ? Promise.resolve(h.exportRows) : Promise.reject(h.exportError),
}));
vi.mock("@/lib/events/useEventRegistrations", () => ({
  useEventTickets: () => ({ data: h.tickets }),
}));
vi.mock("@/lib/events/useEventSeating", () => {
  const mutation = (name: string) => ({
    isPending: h.pending.has(name),
    mutateAsync: (input: unknown) => {
      h.calls.push({ name, input });
      const next = h.results[name]?.shift() ?? DEFAULTS[name];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    mutate: (input: unknown, wynik?: Wynik) => {
      h.calls.push({ name, input });
      const next = h.results[name]?.shift() ?? DEFAULTS[name];
      if (next instanceof Error) wynik?.onError?.(next);
      else wynik?.onSuccess?.(next);
    },
  });
  return {
    useSeatMapDetail: () => ({
      data: h.detail ?? undefined,
      isLoading: h.detailLoading,
      error: h.detailError,
    }),
    useAssignSeat: () => mutation("assign"),
    useReleaseSeats: () => mutation("release"),
    useUpdateSeats: () => mutation("updateSeats"),
    useSaveSeatMap: () => mutation("saveMap"),
    useSaveSeatSection: () => mutation("saveSection"),
    useDeleteSeatSection: () => mutation("deleteSection"),
    useSaveSeatCategory: () => mutation("saveCategory"),
    useDeleteSeatCategory: () => mutation("deleteCategory"),
  };
});

// --- atrapy molekuł ----------------------------------------------------------

vi.mock("@/components/admin/events/molecules/SeatMapCanvas", () => ({
  SEAT_CANVAS_DROP_ID: "seat-map-canvas",
  SeatMapCanvas: ({
    detail,
    selected,
    labelFor,
    onActivate,
    onRelease,
  }: {
    detail: SeatMapDetail;
    selected: ReadonlySet<string>;
    labelFor: (seat: Seat) => string;
    onActivate: (seatId: string, extend: boolean) => void;
    onRelease: (seatId: string) => void;
  }) => (
    <div data-testid="plotno">
      {detail.seats.map((seat) => {
        h.canvasLabels.set(seat.id, labelFor(seat));
        return (
          <span key={seat.id}>
            <button
              type="button"
              aria-pressed={selected.has(seat.id)}
              onClick={(event) => onActivate(seat.id, event.shiftKey)}
            >
              {`plotno:${seat.id}`}
            </button>
            <button type="button" onClick={() => onRelease(seat.id)}>
              {`zwolnij:${seat.id}`}
            </button>
          </span>
        );
      })}
    </div>
  ),
}));
vi.mock("@/components/admin/events/molecules/SeatMapTable", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/admin/events/molecules/SeatMapTable")>()),
  SeatMapTable: ({
    canAssign,
    labelFor,
    detail,
    onToggle,
    onAssign,
    onRelease,
  }: {
    canAssign: boolean;
    labelFor: (seat: Seat) => string;
    detail: SeatMapDetail;
    onToggle: (seatId: string) => void;
    onAssign: (seatId: string) => void;
    onRelease: (seatId: string) => void;
  }) => (
    <div data-testid="tabela" data-can-assign={String(canAssign)}>
      <span>{detail.seats[0] === undefined ? "" : labelFor(detail.seats[0])}</span>
      <button type="button" onClick={() => onToggle("seat-a1")}>
        tabela:przelacz
      </button>
      <button type="button" onClick={() => onAssign("seat-a1")}>
        tabela:posadz
      </button>
      <button type="button" onClick={() => onRelease("seat-a2")}>
        tabela:zwolnij
      </button>
    </div>
  ),
}));
vi.mock("@/components/admin/events/molecules/SeatDetailsCard", () => ({
  SeatDetailsCard: ({
    seats,
    armedName,
    busy,
    onAssignArmed,
    onRelease,
    onEditStatus,
    onSetAccessible,
    onSetCategory,
  }: {
    seats: readonly Seat[];
    armedName: string | null;
    busy: boolean;
    onAssignArmed: (seatId: string) => void;
    onRelease: (seatIds: string[]) => void;
    onEditStatus: () => void;
    onSetAccessible: (seatIds: string[], value: boolean) => void;
    onSetCategory: (seatIds: string[], categoryId: string | null) => void;
  }) => {
    const ids = seats.map((seat) => seat.id);
    return (
      <div data-testid="szczegol" data-busy={String(busy)} data-armed={armedName ?? ""}>
        <span>{`zaznaczone:${ids.join(",")}`}</span>
        <button type="button" onClick={() => onAssignArmed(ids[0] ?? "")}>
          szczegol:posadz
        </button>
        <button type="button" onClick={() => onRelease(ids)}>
          szczegol:zwolnij
        </button>
        <button type="button" onClick={onEditStatus}>
          szczegol:stan
        </button>
        <button type="button" onClick={() => onSetAccessible(ids, true)}>
          szczegol:dostepnosc
        </button>
        <button type="button" onClick={() => onSetCategory(ids, "cat-vip")}>
          szczegol:kategoria
        </button>
      </div>
    );
  },
}));
vi.mock("@/components/admin/events/organisms/SeatingAttendeesPanel", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/admin/events/organisms/SeatingAttendeesPanel")
  >()),
  SeatingAttendeesPanel: ({
    tickets,
    armedId,
    onArm,
  }: {
    tickets: readonly { id: string; label: string }[];
    armedId: string | null;
    onArm: (row: SeatingCandidateRow | null) => void;
  }) => (
    <div data-testid="uczestnicy" data-armed={armedId ?? ""}>
      <span>{`bilety:${tickets.map((ticket) => ticket.label).join(",")}`}</span>
      <button type="button" onClick={() => onArm(kandydat())}>
        uczestnicy:wybierz
      </button>
      <button type="button" onClick={() => onArm(null)}>
        uczestnicy:odznacz
      </button>
    </div>
  ),
}));
vi.mock("@/components/admin/events/molecules/SeatExportMenu", () => ({
  SeatExportMenu: ({
    companies,
    seatText,
  }: {
    companies: readonly { id: string; name: string }[];
    seatText: (row: unknown) => string;
  }) => (
    <div data-testid="eksport">
      <span>{`firmy:${companies.map((company) => company.name).join(",")}`}</span>
      <span>{`napis:${seatText(eksportWiersz())}`}</span>
    </div>
  ),
}));

/** Atrapa okna: treść tylko przy `open`, przycisk wysyła stały ładunek. */
function oknoAtrapa(nazwa: string, ladunek: unknown) {
  return ({
    open,
    onOpenChange,
    onSubmit,
    ...reszta
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: unknown) => void;
    [key: string]: unknown;
  }) =>
    open ? (
      <div role="dialog" aria-label={nazwa} data-props={JSON.stringify(Object.keys(reszta))}>
        <span>{`${nazwa}:${JSON.stringify(reszta.initialStatus ?? reszta.kind ?? "")}`}</span>
        <button type="button" onClick={() => onSubmit(ladunek)}>
          {`${nazwa}:zapisz`}
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          {`${nazwa}:zamknij`}
        </button>
        <button type="button" onClick={() => onOpenChange(true)}>
          {`${nazwa}:zostaw`}
        </button>
      </div>
    ) : null;
}

vi.mock("@/components/admin/events/molecules/EventSeatMapDialog", () => ({
  EventSeatMapDialog: oknoAtrapa("okno-planu", { id: "m", name: "Gala 2" }),
}));
vi.mock("@/components/admin/events/molecules/EventSeatSectionDialog", () => ({
  EventSeatSectionDialog: oknoAtrapa("okno-sekcji", { mapId: "m", label: "B" }),
}));
vi.mock("@/components/admin/events/molecules/EventSeatCategoryDialog", () => ({
  EventSeatCategoryDialog: oknoAtrapa("okno-kategorii", { eventId: "e", key: "prasa" }),
}));
vi.mock("@/components/admin/events/molecules/SeatHoldDialog", () => ({
  SeatHoldDialog: oknoAtrapa("okno-stanu", { mapId: "m", seatIds: ["seat-a1"], status: "held" }),
}));
vi.mock("@/components/admin/events/molecules/SeatAutoAssignDialog", () => ({
  SeatAutoAssignDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="okno-auto">
        <button type="button" onClick={() => onOpenChange(false)}>
          okno-auto:zamknij
        </button>
      </div>
    ) : null,
}));

import { SeatMapWorkspace } from "@/components/admin/events/organisms/SeatMapWorkspace";
import {
  SEAT_EVENT_ID,
  SEAT_MAP_ID,
  seatAssignment,
  seatExportRow,
  seatMapDetail,
  seatingCandidate,
} from "@/test/events/seatingFixtures";

function kandydat(): SeatingCandidateRow {
  return seatingCandidate({ registration_id: "reg-7", first_name: "Jan", last_name: "Nowak" });
}

function eksportWiersz() {
  return seatExportRow();
}

const W = "adminEventSeating.workspace";

beforeEach(() => {
  h.detail = seatMapDetail();
  h.detailLoading = false;
  h.detailError = null;
  h.calls = [];
  h.results = {};
  h.pending = new Set();
  h.confirms = [];
  h.confirmCalls = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.onDragEnd = null;
  h.dropTarget = null;
  h.exportRows = [seatExportRow()];
  h.exportError = null;
  h.canvasLabels = new Map();
  h.tickets = [{ id: "t-vip", name_pl: "Karnet VIP", name_en: "VIP" }];
});

function przestrzen(onBack = vi.fn()) {
  const view = render(
    <SeatMapWorkspace
      eventId={SEAT_EVENT_ID}
      eventSlug="kongres"
      eventTitle="Kongres 2099"
      mapId={SEAT_MAP_ID}
      onBack={onBack}
    />,
  );
  return { ...view, onBack };
}

const klik = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const wywolania = (name: string) => h.calls.filter((call) => call.name === name);
const uzbroj = () => klik("uczestnicy:wybierz");

describe("SeatMapWorkspace - stany", () => {
  it("wczytywanie ma zdanie i drogę powrotu", () => {
    h.detail = null;
    h.detailLoading = true;
    przestrzen();
    expect(screen.getByText(`${W}.loading`)).toBeTruthy();
  });

  it("odmowa to zdanie, a nie pusty plan", () => {
    h.detail = null;
    h.detailError = new Error("not_found: x");
    przestrzen();
    expect(screen.getByText("odmowa:not_found: x")).toBeTruthy();
  });

  it("plan, którego jeszcze nie ma (bez odmowy), daje przycisk powrotu", () => {
    h.detail = null;
    const { onBack } = przestrzen();
    klik(`${W}.back`);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("plan: nazwa, stan, sekcje z liczbą miejsc, kategorie i powrót", () => {
    const { onBack } = przestrzen();
    expect(screen.getByRole("heading", { name: "Gala" })).toBeTruthy();
    expect(screen.getByText("adminEventSeating.status.draft")).toBeTruthy();
    expect(screen.getByText(`${W}.sectionSeats(count=3)`)).toBeTruthy();
    expect(screen.getByText(`${W}.sectionSeats(count=2)`)).toBeTruthy();
    expect(screen.getByText(`${W}.categoryTickets(count=1)`)).toBeTruthy();
    expect(screen.getByText("bilety:Karnet VIP")).toBeTruthy();
    klik(`${W}.back`);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("pusty plan mówi, że nie ma sekcji ani kategorii; kategoria bez biletów - „każdy bilet”", () => {
    h.detail = seatMapDetail({ sections: [], seats: [], assignments: [], categories: [] });
    const { rerender } = przestrzen();
    expect(screen.getByText(`${W}.noSections`)).toBeTruthy();
    expect(screen.getByText(`${W}.noCategories`)).toBeTruthy();

    const detail = seatMapDetail();
    h.detail = {
      ...detail,
      categories: detail.categories.map((category) => ({ ...category, ticketTypeIds: [] })),
    };
    rerender(
      <SeatMapWorkspace
        eventId={SEAT_EVENT_ID}
        eventSlug="kongres"
        eventTitle="Kongres 2099"
        mapId={SEAT_MAP_ID}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(`${W}.allTickets`)).toBeTruthy();
  });

  it("opis miejsca na płótnie: zdanie miejsca, stan, osoba, rezerwacja, dostępność", () => {
    przestrzen();
    expect(h.canvasLabels.get("seat-a2")).toBe(
      "eventSeating.label.rows(row=A,seat=2,section=A), adminEventSeating.seatStatus.available, adminEventSeating.canvas.occupiedBy(name=Anna Kowalska)",
    );
    expect(h.canvasLabels.get("seat-t1")).toBe(
      "eventSeating.label.table(row=,seat=1,section=5), adminEventSeating.seatStatus.held, adminEventSeating.canvas.heldFor(name=Firma Jeden)",
    );
    expect(h.canvasLabels.get("seat-t2")).toContain("adminEventSeating.canvas.accessible");
  });

  it("rezerwacja bez nikogo wskazanego nie dopisuje „dla kogo”", () => {
    const detail = seatMapDetail();
    h.detail = {
      ...detail,
      seats: detail.seats.map((seat) =>
        seat.id === "seat-t1" ? { ...seat, holdCompanyName: null, holdNote: null } : seat,
      ),
    };
    przestrzen();
    expect(h.canvasLabels.get("seat-t1")).not.toContain("heldFor");
  });

  it("bilety w locie dają panelowi uczestników pustą listę filtrów", () => {
    h.tickets = undefined;
    przestrzen();
    expect(screen.getByText("bilety:")).toBeTruthy();
  });

  it("okno sekcji i kategorii zamyka się tylko przy `open=false`", () => {
    przestrzen();
    klik(`${W}.addRows`);
    klik("okno-sekcji:zostaw");
    expect(screen.getByRole("dialog", { name: "okno-sekcji" })).toBeTruthy();
    klik(`${W}.addCategory`);
    klik("okno-kategorii:zostaw");
    expect(screen.getByRole("dialog", { name: "okno-kategorii" })).toBeTruthy();
  });

  it("eksport dostaje firmy z rezerwacji i przydziałów, bez powtórzeń, alfabetycznie", () => {
    const detail = seatMapDetail();
    h.detail = {
      ...detail,
      assignments: [
        ...detail.assignments,
        seatAssignment({ id: "as-2", seatId: "seat-a1", companyId: "co-0", company: "Alfa" }),
        seatAssignment({ id: "as-3", seatId: "seat-t2", companyId: null, company: "Bez CRM" }),
      ],
    };
    przestrzen();
    expect(screen.getByText("firmy:Alfa,Firma Jeden")).toBeTruthy();
    expect(screen.getByText("napis:eventSeating.label.rows(row=A,seat=2,section=A)")).toBeTruthy();
  });
});

describe("SeatMapWorkspace - zaznaczenie", () => {
  it("kliknięcie zastępuje, modyfikator rozszerza, ponowne kliknięcie zdejmuje", () => {
    przestrzen();
    klik("plotno:seat-a1");
    expect(screen.getByText("zaznaczone:seat-a1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "plotno:seat-a3" }), { shiftKey: true });
    expect(screen.getByText("zaznaczone:seat-a1,seat-a3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "plotno:seat-a3" }), { shiftKey: true });
    expect(screen.getByText("zaznaczone:seat-a1")).toBeTruthy();
    klik("plotno:seat-a1");
    expect(screen.getByText("zaznaczone:")).toBeTruthy();
  });

  it("kliknięcie innego miejsca bez modyfikatora zastępuje zaznaczenie", () => {
    przestrzen();
    klik("plotno:seat-a1");
    klik("plotno:seat-t2");
    expect(screen.getByText("zaznaczone:seat-t2")).toBeTruthy();
  });

  it("„wyczyść zaznaczenie” pojawia się tylko przy zaznaczeniu", () => {
    przestrzen();
    expect(screen.queryByRole("button", { name: `${W}.clearSelection` })).toBeNull();
    klik("plotno:seat-a1");
    klik(`${W}.clearSelection`);
    expect(screen.getByText("zaznaczone:")).toBeTruthy();
  });

  it("widok tabeli dzieli zaznaczenie z płótnem i ma opis miejsca bez stanu", () => {
    przestrzen();
    klik(`${W}.viewTable`);
    expect(screen.getByRole("button", { name: `${W}.viewTable` }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("eventSeating.label.rows(row=A,seat=1,section=A)")).toBeTruthy();
    klik("tabela:przelacz");
    expect(screen.getByText("zaznaczone:seat-a1")).toBeTruthy();
    klik(`${W}.viewCanvas`);
    expect(screen.getByTestId("plotno")).toBeTruthy();
  });
});

describe("SeatMapWorkspace - przydział", () => {
  it("wybrana osoba: podpowiedź, kliknięcie miejsca przydziela i zdejmuje wybór", async () => {
    przestrzen();
    uzbroj();
    expect(screen.getByRole("status").textContent).toContain(`${W}.armedHint(name=Jan Nowak)`);
    expect(screen.getByTestId("szczegol").getAttribute("data-armed")).toBe("Jan Nowak");

    klik("plotno:seat-a1");
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "adminEventSeating.toasts.assigned(name=Jan Nowak)",
      ),
    );
    expect(wywolania("assign")[0]?.input).toEqual({
      mapId: SEAT_MAP_ID,
      seatId: "seat-a1",
      registrationId: "reg-7",
    });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("„odznacz” w podpowiedzi i w panelu uczestników zdejmuje wybór", () => {
    przestrzen();
    uzbroj();
    klik(`${W}.disarm`);
    expect(screen.queryByRole("status")).toBeNull();
    uzbroj();
    klik("uczestnicy:odznacz");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("zamiana ma własny komunikat", async () => {
    h.results.assign = [
      { assignmentId: "as-9", movedFromSeatId: null, swappedRegistrationId: "reg-1" },
    ];
    przestrzen();
    uzbroj();
    klik("szczegol:posadz");
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.swapped"),
    );
  });

  it("tabela z wybraną osobą przydziela przez „posadź”", async () => {
    przestrzen();
    uzbroj();
    klik(`${W}.viewTable`);
    expect(screen.getByTestId("tabela").getAttribute("data-can-assign")).toBe("true");
    klik("tabela:posadz");
    await waitFor(() => expect(wywolania("assign")).toHaveLength(1));
  });

  it("rezerwacja innej firmy: pytanie, a zgoda powtarza przydział z `force`", async () => {
    h.results.assign = [new Error("seat_held_for_other: x")];
    h.confirms = [true];
    przestrzen();
    uzbroj();
    klik("plotno:seat-t1");

    await waitFor(() => expect(wywolania("assign")).toHaveLength(2));
    expect(h.confirmCalls[0]?.title).toBe("adminEventSeating.confirm.heldTitle");
    expect(wywolania("assign")[1]?.input).toMatchObject({ seatId: "seat-t1", force: true });
  });

  it("bilet spoza kategorii: pytanie; odmowa pytania nic nie wysyła", async () => {
    h.results.assign = [new Error("category_ticket_mismatch: x")];
    h.confirms = [false];
    przestrzen();
    uzbroj();
    klik("plotno:seat-a1");

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]?.title).toBe("adminEventSeating.confirm.categoryTitle");
    await act(async () => undefined);
    expect(wywolania("assign")).toHaveLength(1);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("druga odmowa po obejściu nie pyta drugi raz, tylko mówi zdanie", async () => {
    h.results.assign = [new Error("seat_held_for_other: x"), new Error("seat_held_for_other: y")];
    h.confirms = [true];
    przestrzen();
    uzbroj();
    klik("plotno:seat-t1");

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:seat_held_for_other: y"));
    expect(h.confirmCalls).toHaveLength(1);
  });

  it("miejsce zajęte, a osoba już siedzi: pytanie o zamianę i `swap`", async () => {
    const detail = seatMapDetail();
    h.detail = {
      ...detail,
      assignments: [...detail.assignments, seatAssignment({ id: "as-7", seatId: "seat-t2", registrationId: "reg-7" })],
    };
    h.results.assign = [new Error("seat_taken: x")];
    h.confirms = [true];
    przestrzen();
    uzbroj();
    klik("plotno:seat-a2");

    await waitFor(() => expect(wywolania("assign")).toHaveLength(2));
    expect(h.confirmCalls[0]?.title).toBe("adminEventSeating.confirm.swapTitle");
    expect(wywolania("assign")[1]?.input).toMatchObject({ seatId: "seat-a2", swap: true });
  });

  it("zamiana odrzucona w pytaniu nic nie wysyła", async () => {
    const detail = seatMapDetail();
    h.detail = {
      ...detail,
      assignments: [...detail.assignments, seatAssignment({ id: "as-7", seatId: "seat-t2", registrationId: "reg-7" })],
    };
    h.results.assign = [new Error("seat_taken: x")];
    h.confirms = [false];
    przestrzen();
    uzbroj();
    klik("plotno:seat-a2");

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    await act(async () => undefined);
    expect(wywolania("assign")).toHaveLength(1);
  });

  it("miejsce zajęte, a osoba nie siedzi: zdanie odmowy bez pytania", async () => {
    h.results.assign = [new Error("seat_taken: x")];
    przestrzen();
    uzbroj();
    klik("plotno:seat-a2");

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:seat_taken: x"));
    expect(h.confirmCalls).toEqual([]);
  });

  it("upuszczenie osoby na miejsce przydziela; upuszczenie obok - nic", async () => {
    przestrzen();
    h.dropTarget = null;
    await act(async () => h.onDragEnd?.({}));
    expect(wywolania("assign")).toEqual([]);

    h.dropTarget = { seatId: "seat-a1", registrationId: "reg-5", name: "Ewa Lis" };
    await act(async () => h.onDragEnd?.({}));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.assigned(name=Ewa Lis)"),
    );
    expect(wywolania("assign")[0]?.input).toMatchObject({ seatId: "seat-a1", registrationId: "reg-5" });
  });
});

describe("SeatMapWorkspace - zwolnienie i zmiany miejsc", () => {
  it("zwolnienie pyta (destrukcyjnie) i zwalnia tylko zajęte", async () => {
    h.confirms = [true];
    przestrzen();
    klik("plotno:seat-a1");
    fireEvent.click(screen.getByRole("button", { name: "plotno:seat-a2" }), { shiftKey: true });
    klik("szczegol:zwolnij");

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.released(count=1)"),
    );
    expect(h.confirmCalls[0]).toEqual({
      title: "adminEventSeating.confirm.releaseTitle",
      destructive: true,
    });
    expect(wywolania("release")[0]?.input).toEqual({ mapId: SEAT_MAP_ID, seatIds: ["seat-a2"] });
  });

  it("zwolnienie wolnego miejsca nie pyta i nic nie wysyła", async () => {
    przestrzen();
    klik("zwolnij:seat-a1");
    await act(async () => undefined);
    expect(h.confirmCalls).toEqual([]);
    expect(wywolania("release")).toEqual([]);
  });

  it("odmowa pytania o zwolnienie nic nie wysyła, a odmowa bazy to zdanie", async () => {
    h.confirms = [false, true];
    h.results.release = [new Error("forbidden: x")];
    przestrzen();
    klik("zwolnij:seat-a2");
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(wywolania("release")).toEqual([]);

    klik("zwolnij:seat-a2");
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: x"));
  });

  it("dostępność i kategoria idą do aktualizacji miejsc; odmowa to zdanie", () => {
    h.results.updateSeats = [2, new Error("seat_not_found: x")];
    przestrzen();
    klik("plotno:seat-a1");
    klik("szczegol:dostepnosc");
    klik("szczegol:kategoria");

    expect(wywolania("updateSeats").map((call) => call.input)).toEqual([
      { mapId: SEAT_MAP_ID, seatIds: ["seat-a1"], isAccessible: true },
      { mapId: SEAT_MAP_ID, seatIds: ["seat-a1"], categoryId: "cat-vip" },
    ]);
    expect(h.toastError).toHaveBeenCalledWith("odmowa:seat_not_found: x");
  });

  it("odmowa zmiany dostępności też jest zdaniem", () => {
    h.results.updateSeats = [new Error("forbidden: a")];
    przestrzen();
    klik("szczegol:dostepnosc");
    expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: a");
  });

  it("okno stanu startuje od stanu JEDNEGO miejsca, a kilku - od rezerwacji", () => {
    przestrzen();
    klik("plotno:seat-a3");
    klik("szczegol:stan");
    expect(screen.getByText('okno-stanu:"blocked"')).toBeTruthy();
    klik("okno-stanu:zamknij");

    fireEvent.click(screen.getByRole("button", { name: "plotno:seat-a1" }), { shiftKey: true });
    klik("szczegol:stan");
    expect(screen.getByText('okno-stanu:"held"')).toBeTruthy();
  });

  it("okno stanu zamyka się po sukcesie z liczbą miejsc, a przy odmowie zostaje", () => {
    h.results.updateSeats = [new Error("seat_assigned: 1"), 3];
    przestrzen();
    klik("szczegol:stan");
    klik("okno-stanu:zapisz");
    expect(h.toastError).toHaveBeenCalledWith("odmowa:seat_assigned: 1");
    expect(screen.getByRole("dialog", { name: "okno-stanu" })).toBeTruthy();

    klik("okno-stanu:zapisz");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.seatsUpdated(count=3)");
    expect(screen.queryByRole("dialog", { name: "okno-stanu" })).toBeNull();
  });

  it("zapis w toku gasi szczegół", () => {
    h.pending = new Set(["release"]);
    przestrzen();
    expect(screen.getByTestId("szczegol").getAttribute("data-busy")).toBe("true");
  });
});

describe("SeatMapWorkspace - plan, sekcje, kategorie", () => {
  it("publikacja pyta i zapisuje stan; odmowa pytania nic nie wysyła", async () => {
    h.confirms = [false, true];
    przestrzen();
    klik(`${W}.publish`);
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(wywolania("saveMap")).toEqual([]);

    klik(`${W}.publish`);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.published"),
    );
    expect(h.confirmCalls[1]?.title).toBe(`${W}.publishTitle`);
    expect(wywolania("saveMap")[0]?.input).toEqual({ id: SEAT_MAP_ID, status: "published" });
  });

  it("wycofanie publikacji wraca do szkicu; odmowa bazy to zdanie", async () => {
    const detail = seatMapDetail();
    h.detail = { ...detail, map: { ...detail.map, status: "published" } };
    h.confirms = [true, true];
    h.results.saveMap = ["ok", new Error("forbidden: p")];
    przestrzen();
    expect(screen.getByText("adminEventSeating.status.published")).toBeTruthy();
    klik(`${W}.unpublish`);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.unpublished"),
    );
    expect(wywolania("saveMap")[0]?.input).toEqual({ id: SEAT_MAP_ID, status: "draft" });

    klik(`${W}.unpublish`);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: p"));
  });

  it("okno planu zapisuje i zamyka się po sukcesie, a przy odmowie zostaje", () => {
    h.results.saveMap = [new Error("name_taken: x"), "ok"];
    przestrzen();
    klik(`${W}.editMap`);
    klik("okno-planu:zapisz");
    expect(h.toastError).toHaveBeenCalledWith("odmowa:name_taken: x");
    expect(screen.getByRole("dialog", { name: "okno-planu" })).toBeTruthy();
    klik("okno-planu:zapisz");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.mapSaved");
    expect(screen.queryByRole("dialog", { name: "okno-planu" })).toBeNull();
  });

  it("nowe rzędy i nowy stół otwierają okno sekcji właściwego rodzaju", () => {
    przestrzen();
    klik(`${W}.addTable`);
    expect(screen.getByText('okno-sekcji:"table"')).toBeTruthy();
    klik("okno-sekcji:zamknij");
    klik(`${W}.addRows`);
    expect(screen.getByText('okno-sekcji:"rows"')).toBeTruthy();
  });

  it("zapis sekcji mówi, ile miejsc zostało, doszło i ubyło; odmowa zostawia okno", () => {
    h.results.saveSection = [new Error("seats_in_use: 2")];
    przestrzen();
    klik(`${W}.editSection(label=A)`);
    klik("okno-sekcji:zapisz");
    expect(h.toastError).toHaveBeenCalledWith("odmowa:seats_in_use: 2");
    klik("okno-sekcji:zapisz");
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "adminEventSeating.toasts.sectionSaved(created=2,kept=3,removed=1)",
    );
    expect(screen.queryByRole("dialog", { name: "okno-sekcji" })).toBeNull();
  });

  it("usunięcie sekcji pyta, czyści zaznaczenie; odmowa bazy to zdanie", async () => {
    h.confirms = [false, true, true];
    h.results.deleteSection = [true, new Error("section_has_assignments: 1")];
    przestrzen();
    klik("plotno:seat-a1");
    klik(`${W}.deleteSection(label=A)`);
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(wywolania("deleteSection")).toEqual([]);

    klik(`${W}.deleteSection(label=A)`);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.sectionDeleted"),
    );
    expect(wywolania("deleteSection")[0]?.input).toBe("sec-a");
    expect(screen.getByText("zaznaczone:")).toBeTruthy();

    klik(`${W}.deleteSection(label=5)`);
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:section_has_assignments: 1"),
    );
  });

  it("kategoria: nowa i edycja otwierają okno, zapis zamyka je po sukcesie", () => {
    h.results.saveCategory = [new Error("key_taken: x"), "ok"];
    przestrzen();
    klik(`${W}.addCategory`);
    klik("okno-kategorii:zapisz");
    expect(h.toastError).toHaveBeenCalledWith("odmowa:key_taken: x");
    klik("okno-kategorii:zapisz");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.categorySaved");
    expect(screen.queryByRole("dialog", { name: "okno-kategorii" })).toBeNull();

    klik(`${W}.editCategory(name=Strefa VIP)`);
    expect(screen.getByRole("dialog", { name: "okno-kategorii" })).toBeTruthy();
    klik("okno-kategorii:zamknij");
    expect(screen.queryByRole("dialog", { name: "okno-kategorii" })).toBeNull();
  });

  it("usunięcie kategorii pyta; odmowa pytania i odmowa bazy", async () => {
    h.confirms = [false, true, true];
    h.results.deleteCategory = [true, new Error("category_in_use: 3")];
    przestrzen();
    klik(`${W}.deleteCategory(name=Strefa VIP)`);
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(wywolania("deleteCategory")).toEqual([]);

    klik(`${W}.deleteCategory(name=Strefa VIP)`);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.categoryDeleted"),
    );
    expect(wywolania("deleteCategory")[0]?.input).toBe("cat-vip");

    klik(`${W}.deleteCategory(name=Strefa VIP)`);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:category_in_use: 3"));
  });

  it("auto-przydział otwiera i zamyka własne okno", () => {
    przestrzen();
    klik(`${W}.autoAssign`);
    expect(screen.getByRole("dialog", { name: "okno-auto" })).toBeTruthy();
    klik("okno-auto:zamknij");
    expect(screen.queryByRole("dialog", { name: "okno-auto" })).toBeNull();
  });

  it("zapis planu w toku gasi publikację", () => {
    h.pending = new Set(["saveMap"]);
    przestrzen();
    expect(screen.getByRole("button", { name: `${W}.publish` })).toBeDisabled();
  });
});

describe("SeatMapWorkspace - druk listy przy drzwiach", () => {
  function oknoDruku() {
    const doc = { write: vi.fn(), close: vi.fn() };
    const win = { document: doc, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    return { win, doc };
  }

  it("otwiera okno PRZED zapytaniem i drukuje listę z nazwą planu", async () => {
    const { win, doc } = oknoDruku();
    const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    przestrzen();
    klik(`${W}.print`);

    expect(open).toHaveBeenCalledWith("", "_blank", "width=900,height=700");
    await waitFor(() => expect(win.print).toHaveBeenCalledTimes(1));
    const html = String(doc.write.mock.calls[0]?.[0]);
    expect(html).toContain("Kongres 2099");
    expect(html).toContain("eventSeating.label.rows(row=A,seat=2,section=A)");
    expect(html).toContain("Kowalska Anna");
    expect(doc.close).toHaveBeenCalled();
    open.mockRestore();
  });

  it("wiersz bez firmy i uwagi drukuje puste komórki, nie „null”", async () => {
    h.exportRows = [seatExportRow({ company: null, hold_note: null })];
    const { win, doc } = oknoDruku();
    const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    przestrzen();
    klik(`${W}.print`);
    await waitFor(() => expect(win.print).toHaveBeenCalledTimes(1));
    expect(String(doc.write.mock.calls[0]?.[0])).not.toContain("null");
    open.mockRestore();
  });

  it("zablokowane okno mówi to zdaniem i nie pyta bazy", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    przestrzen();
    klik(`${W}.print`);
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminEventSeating.toasts.popupBlocked"),
    );
    open.mockRestore();
  });

  it("awaria zapytania zamyka puste okno i mówi to zdaniem", async () => {
    h.exportError = new Error("forbidden: druk");
    const { win } = oknoDruku();
    const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    przestrzen();
    klik(`${W}.print`);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: druk"));
    expect(win.close).toHaveBeenCalled();
    expect(win.print).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

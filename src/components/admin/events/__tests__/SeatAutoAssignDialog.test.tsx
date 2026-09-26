// Molekuła „auto-przydział miejsc" - propozycja, podgląd, zatwierdzenie.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. ZAMKNIĘTE OKNO NIE PYTA o kandydatów, sponsorów ani bilety.
//   2. Podgląd pokazuje liczbę propozycji i osoby bez miejsca Z POWODEM, zanim
//      cokolwiek trafi do bazy; przełączniki (rezerwacje najpierw, razem)
//      i filtr biletów przeliczają propozycję.
//   3. Zapis idzie PACZKAMI po 500 ze źródłem `auto`; pełny sukces zamyka okno,
//      odrzucone pozycje zostają na ekranie tym samym zdaniem, co odmowa
//      ręcznego przydziału, a awaria mówi to wprost.
//   4. Wczytywanie, pusta propozycja i zapis w toku gaszą „zastosuj”.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  SeatBatchResult,
  SeatingCandidateRow,
  assignSeatsBatch,
} from "@/lib/events/seatingApi";

/** Ładunek jednej paczki - kształt wejścia `assignSeatsBatch`. */
type SeatAssignBatchInput = Parameters<typeof assignSeatsBatch>[0];

const h = vi.hoisted(() => ({
  candidateCalls: [] as { eventId: string; mapId: string; enabled: boolean }[],
  sponsorCalls: [] as boolean[],
  ticketCalls: [] as (string | null)[],
  candidates: [] as SeatingCandidateRow[],
  loading: false,
  pending: false,
  batches: [] as SeatAssignBatchInput[],
  results: [] as (SeatBatchResult | Error)[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/dialog", async () =>
  (await import("@/test/events/seatingUiMocks")).dialogModule(),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/adminSeatingErrors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/adminSeatingErrors")>()),
  adminSeatingErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@/lib/events/useEventSeating", () => ({
  useAllSeatingCandidates: (eventId: string, mapId: string, enabled: boolean) => {
    h.candidateCalls.push({ eventId, mapId, enabled });
    return { data: enabled ? h.candidates : undefined, isLoading: h.loading };
  },
  useAssignSeatsBatch: () => ({
    isPending: h.pending,
    mutateAsync: (input: SeatAssignBatchInput) => {
      h.batches.push(input);
      const next = h.results.shift() ?? { applied: input.items.length, rejected: [] };
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  }),
}));
vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsors: (_query: unknown, enabled: boolean) => {
    h.sponsorCalls.push(enabled);
    return { data: enabled ? [{ id: "sp-1", company_id: "co-9" }] : undefined };
  },
}));
vi.mock("@/lib/events/useEventRegistrations", () => ({
  useEventTickets: (eventId: string | null) => {
    h.ticketCalls.push(eventId);
    return {
      data:
        eventId === null
          ? undefined
          : [
              { id: "t-vip", name_pl: "Karnet VIP", name_en: "VIP pass" },
              { id: "t-std", name_pl: "Standard", name_en: "Standard" },
            ],
    };
  },
}));

import {
  SeatAutoAssignDialog,
  type SeatAutoAssignDialogProps,
} from "@/components/admin/events/molecules/SeatAutoAssignDialog";
import {
  SEAT_EVENT_ID,
  SEAT_MAP_ID,
  seat,
  seatMapDetail,
  seatSection,
  seatingCandidate,
} from "@/test/events/seatingFixtures";

const A = "adminEventSeating.autoDialog";

/** Jan (firma co-1, VIP) siada na rezerwacji T1, Ewa (Standard) na wolnym T2, Olga - nie. */
function kandydaci(): SeatingCandidateRow[] {
  return [
    seatingCandidate(),
    seatingCandidate({
      registration_id: "reg-2",
      party_key: "reg-2",
      first_name: "Jan",
      last_name: "Nowak",
      company_id: "co-1",
    }),
    seatingCandidate({
      registration_id: "reg-3",
      party_key: "reg-3",
      first_name: "Ewa",
      last_name: "Lis",
      company_id: null,
      company: null,
      ticket_type_id: "t-std",
    }),
    seatingCandidate({
      registration_id: "reg-4",
      party_key: "reg-4",
      first_name: "Olga",
      last_name: "Wrona",
      company_id: null,
      company: null,
      ticket_type_id: "t-std",
    }),
  ].map((row) => (row.registration_id === "reg-1" ? { ...row, seat_id: "seat-a2" } : row));
}

beforeEach(() => {
  h.candidateCalls = [];
  h.sponsorCalls = [];
  h.ticketCalls = [];
  h.candidates = kandydaci();
  h.loading = false;
  h.pending = false;
  h.batches = [];
  h.results = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

function okno(over: Partial<SeatAutoAssignDialogProps> = {}) {
  const props: SeatAutoAssignDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    eventId: SEAT_EVENT_ID,
    detail: seatMapDetail(),
    ...over,
  };
  const view = render(<SeatAutoAssignDialog {...props} />);
  return { ...view, props };
}

const zastosuj = () => screen.getByRole("button", { name: `${A}.apply` });

describe("SeatAutoAssignDialog - podgląd", () => {
  it("zamknięte okno nie pyta o kandydatów, sponsorów ani bilety", () => {
    okno({ open: false });
    expect(h.candidateCalls.at(-1)).toEqual({
      eventId: SEAT_EVENT_ID,
      mapId: SEAT_MAP_ID,
      enabled: false,
    });
    expect(h.sponsorCalls.at(-1)).toBe(false);
    expect(h.ticketCalls.at(-1)).toBeNull();
  });

  it("pokazuje liczbę propozycji i osoby bez miejsca z powodem", () => {
    okno();

    expect(screen.getByText(`${A}.proposed(count=2)`)).toBeTruthy();
    expect(screen.getByText(`${A}.unplaced(count=1)`)).toBeTruthy();
    expect(
      // Stół T2 dopuszcza bilet Olgi, ale zajęła go Ewa - plan jest PEŁNY dla
      // tego biletu (no_seat), a nie „żadne miejsce nie pasuje”.
      screen.getByText(`${A}.unplacedItem(name=Olga Wrona,reason=${A}.reasons.no_seat)`),
    ).toBeTruthy();
  });

  it("filtr biletów zawęża propozycję do wybranych biletów", () => {
    okno();
    fireEvent.click(screen.getByRole("checkbox", { name: "Karnet VIP" }));
    expect(screen.getByText(`${A}.proposed(count=1)`)).toBeTruthy();
    expect(screen.queryByText(/unplaced\(/)).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Karnet VIP" }));
    expect(screen.getByText(`${A}.proposed(count=2)`)).toBeTruthy();
  });

  it("wyłączenie „rezerwacje najpierw” i „razem” przelicza propozycję", () => {
    okno();
    fireEvent.click(screen.getByRole("switch", { name: `${A}.holdsFirst` }));
    fireEvent.click(screen.getByRole("switch", { name: `${A}.keepTogether` }));
    // Bez pierwszeństwa rezerwacji wynik się nie zmienia co do liczby - planer
    // nadal nie sadza obcej osoby na rezerwacji firmy.
    expect(screen.getByText(`${A}.proposed(count=2)`)).toBeTruthy();
  });

  it("rezerwacja SPONSORA liczy się jako rezerwacja jego firmy", () => {
    const detail = seatMapDetail({
      seats: [
        seat({
          id: "seat-sp",
          status: "held",
          holdSponsorId: "sp-1",
          holdSponsorName: "Sponsor",
        }),
      ],
      assignments: [],
    });
    h.candidates = [
      seatingCandidate({ registration_id: "reg-9", party_key: "reg-9", company_id: "co-9" }),
    ];
    okno({ detail });
    expect(screen.getByText(`${A}.proposed(count=1)`)).toBeTruthy();
  });

  it("wczytywanie mówi to zdaniem i gasi „zastosuj”", () => {
    h.loading = true;
    okno();
    expect(screen.getByText(`${A}.loading`)).toBeTruthy();
    expect(zastosuj()).toBeDisabled();
  });

  it("brak kogokolwiek do posadzenia mówi to zdaniem i gasi „zastosuj”", () => {
    h.candidates = [];
    okno();
    expect(screen.getByText(`${A}.nothing`)).toBeTruthy();
    expect(zastosuj()).toBeDisabled();
  });

  it("plan, na którym ŻADNE miejsce nie dopuszcza biletu, podaje ten powód", () => {
    h.candidates = [
      seatingCandidate({ registration_id: "reg-3", party_key: "reg-3", ticket_type_id: "t-std" }),
    ];
    const detail = seatMapDetail({
      sections: [seatSection()],
      seats: [seat()],
      assignments: [],
    });
    okno({ detail });
    expect(
      screen.getByText(`${A}.unplacedItem(name=Anna Kowalska,reason=${A}.reasons.no_allowed_seat)`),
    ).toBeTruthy();
  });
});

describe("SeatAutoAssignDialog - zapis", () => {
  it("pełny sukces: jedna paczka ze źródłem auto, komunikat i zamknięcie okna", async () => {
    const { props } = okno();
    fireEvent.click(zastosuj());

    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(h.batches).toEqual([
      {
        mapId: SEAT_MAP_ID,
        source: "auto",
        items: [
          { seatId: "seat-t1", registrationId: "reg-2" },
          { seatId: "seat-t2", registrationId: "reg-3" },
        ],
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${A}.applied(count=2)`);
  });

  it("ponad 500 propozycji idzie kilkoma paczkami", async () => {
    const seats = Array.from({ length: 501 }, (_, i) =>
      seat({ id: `s-${i}`, seatNumber: i + 1, sortKey: i, x: i * 50 }),
    );
    h.candidates = Array.from({ length: 501 }, (_, i) =>
      seatingCandidate({
        registration_id: `r-${i}`,
        party_key: `r-${i}`,
        company_id: null,
        company: null,
      }),
    );
    const { props } = okno({ detail: seatMapDetail({ seats, assignments: [], categories: [] }) });
    fireEvent.click(zastosuj());

    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(h.batches.map((batch) => batch.items.length)).toEqual([500, 1]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${A}.applied(count=501)`);
  });

  it("odrzucone pozycje zostają na ekranie zdaniem odmowy, a okno zostaje otwarte", async () => {
    h.results = [
      {
        applied: 1,
        rejected: [{ seatId: "seat-t2", registrationId: "reg-3", code: "seat_taken" }],
      },
    ];
    const { props } = okno();
    fireEvent.click(zastosuj());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(`${A}.rejected(count=1)`);
    expect(alert.textContent).toContain(
      `${A}.rejectedItem(name=Ewa Lis,reason=adminEventSeating.errors.seatTaken)`,
    );
    expect(h.toastSuccess).toHaveBeenCalledWith(`${A}.applied(count=1)`);
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("odrzucenie osoby spoza listy pokazuje jej identyfikator", async () => {
    h.results = [
      { applied: 0, rejected: [{ seatId: "seat-t2", registrationId: "obcy", code: "nieznany" }] },
    ];
    okno();
    fireEvent.click(zastosuj());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      `${A}.rejectedItem(name=obcy,reason=adminEventSeating.errors.unknown)`,
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("awaria paczki mówi to wprost i nie zamyka okna", async () => {
    h.results = [new Error("map_locked: x")];
    const { props } = okno();
    fireEvent.click(zastosuj());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:map_locked: x"));
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("ponowne otwarcie czyści listę odrzuconych", async () => {
    h.results = [
      {
        applied: 0,
        rejected: [{ seatId: "seat-t2", registrationId: "reg-3", code: "seat_taken" }],
      },
    ];
    const { props, rerender } = okno();
    fireEvent.click(zastosuj());
    await screen.findByRole("alert");

    rerender(<SeatAutoAssignDialog {...props} open={false} />);
    rerender(<SeatAutoAssignDialog {...props} open />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("zapis w toku gasi oba przyciski; anuluj zamyka okno", () => {
    const { props, rerender } = okno();
    fireEvent.click(screen.getByRole("button", { name: `${A}.cancel` }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);

    h.pending = true;
    rerender(<SeatAutoAssignDialog {...props} />);
    expect(zastosuj()).toBeDisabled();
    expect(screen.getByRole("button", { name: `${A}.cancel` })).toBeDisabled();
  });
});

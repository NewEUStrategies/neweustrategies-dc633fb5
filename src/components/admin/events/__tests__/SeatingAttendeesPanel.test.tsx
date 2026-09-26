// Organizm „uczestnicy do rozsadzenia" - filtry w bazie, dwie drogi do miejsca.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. FILTRY IDĄ DO ZAPYTANIA, nie do stanu wierszy: fraza (po Enter albo
//      lupie, przycięta), bilet, „tylko bez miejsca” (domyślnie włączone).
//      Każda zmiana filtra wraca do pierwszej strony.
//   2. „Pokaż więcej” rośnie po 50 do limitu bazy (500); dalej zdanie
//      „zawęź wyszukiwanie” zamiast przycisku, który nic nie da.
//   3. Każda osoba ma uchwyt przeciągania z prefiksem rozpoznawanym przez
//      płótno i przycisk „wskaż miejsce” (klawiatura) - ponowne kliknięcie
//      wybranej osoby ją odznacza.
//   4. Wczytywanie, odmowa i dwie pustki (bez filtrów / pod filtrem) mają
//      własne zdania.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SeatingCandidateRow, SeatingCandidatesQuery } from "@/lib/events/seatingApi";

const h = vi.hoisted(() => ({
  queries: [] as SeatingCandidatesQuery[],
  rows: [] as SeatingCandidateRow[],
  total: 0,
  loading: false,
  error: null as Error | null,
  drags: [] as { id: string; data: unknown }[],
  dragging: false,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/seatingUiMocks")).formSelectModule(),
);
vi.mock("@/lib/events/adminSeatingErrors", () => ({
  adminSeatingErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: ({ id, data }: { id: string; data: unknown }) => {
    h.drags.push({ id, data });
    return {
      attributes: { "aria-roledescription": "draggable" },
      listeners: {},
      setNodeRef: () => undefined,
      isDragging: h.dragging,
    };
  },
}));
vi.mock("@/lib/events/useEventSeating", () => ({
  useSeatingCandidates: (_eventId: string, query: SeatingCandidatesQuery) => {
    h.queries.push(query);
    return {
      data: h.loading || h.error !== null ? undefined : { rows: h.rows, total: h.total },
      isLoading: h.loading,
      error: h.error,
    };
  },
}));

import {
  CANDIDATE_DRAG_PREFIX,
  SeatingAttendeesPanel,
  type SeatingAttendeesPanelProps,
} from "@/components/admin/events/organisms/SeatingAttendeesPanel";
import { SEAT_EVENT_ID, SEAT_MAP_ID, seatingCandidate } from "@/test/events/seatingFixtures";

const P = "adminEventSeating.attendees";

beforeEach(() => {
  h.queries = [];
  h.rows = [
    seatingCandidate(),
    seatingCandidate({
      registration_id: "reg-2",
      first_name: "Jan",
      last_name: "Nowak",
      company: null,
      ticket_name_pl: null,
      ticket_name_en: null,
      seat_id: "seat-a1",
      seat_label: "A 1",
    }),
  ];
  h.total = 2;
  h.loading = false;
  h.error = null;
  h.drags = [];
  h.dragging = false;
});

function panel(over: Partial<SeatingAttendeesPanelProps> = {}) {
  const props: SeatingAttendeesPanelProps = {
    eventId: SEAT_EVENT_ID,
    mapId: SEAT_MAP_ID,
    tickets: [{ id: "t-vip", label: "VIP" }],
    armedId: null,
    onArm: vi.fn(),
    ...over,
  };
  const view = render(<SeatingAttendeesPanel {...props} />);
  return { ...view, props };
}

const ostatnie = (): SeatingCandidatesQuery => {
  const last = h.queries.at(-1);
  if (last === undefined) throw new Error("brak zapytania");
  return last;
};

describe("SeatingAttendeesPanel - filtry", () => {
  it("startuje od „tylko bez miejsca”, pierwszej strony 50 i planu", () => {
    panel();
    expect(ostatnie()).toEqual({
      mapId: SEAT_MAP_ID,
      q: "",
      ticketTypeId: null,
      onlyUnassigned: true,
      limit: 50,
      offset: 0,
    });
    expect(screen.getByText(`${P}.count(count=2)`)).toBeTruthy();
  });

  it("fraza idzie przycięta po Enter albo lupie, a nie po każdej literze", () => {
    panel();
    const pole = screen.getByRole("textbox", { name: `${P}.search` });
    fireEvent.change(pole, { target: { value: "  Nowak " } });
    expect(ostatnie().q).toBe("");

    fireEvent.keyDown(pole, { key: "a" });
    expect(ostatnie().q).toBe("");
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(ostatnie().q).toBe("Nowak");

    fireEvent.change(pole, { target: { value: "Firma" } });
    fireEvent.click(screen.getByRole("button", { name: `${P}.search` }));
    expect(ostatnie().q).toBe("Firma");
  });

  it("bilet i przełącznik idą do zapytania i wracają do pierwszej strony", () => {
    h.total = 120;
    panel();
    fireEvent.click(screen.getByRole("button", { name: `${P}.loadMore` }));
    expect(ostatnie().limit).toBe(100);

    fireEvent.change(screen.getByLabelText(`${P}.ticket`), { target: { value: "t-vip" } });
    expect(ostatnie()).toMatchObject({ ticketTypeId: "t-vip", limit: 50 });

    fireEvent.click(screen.getByRole("button", { name: `${P}.loadMore` }));
    fireEvent.click(screen.getByRole("switch", { name: `${P}.onlyUnassigned` }));
    expect(ostatnie()).toMatchObject({ onlyUnassigned: false, limit: 50 });

    fireEvent.change(screen.getByLabelText(`${P}.ticket`), { target: { value: "__all__" } });
    expect(ostatnie().ticketTypeId).toBeNull();
  });

  it("wydarzenie bez biletów nie pokazuje filtra biletu", () => {
    panel({ tickets: [] });
    expect(screen.queryByLabelText(`${P}.ticket`)).toBeNull();
  });

  it("„pokaż więcej” kończy się na limicie bazy zdaniem „zawęź wyszukiwanie”", () => {
    h.total = 900;
    panel();
    for (let i = 0; i < 9; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: `${P}.loadMore` }));
    }
    expect(ostatnie().limit).toBe(500);
    expect(screen.queryByRole("button", { name: `${P}.loadMore` })).toBeNull();
    expect(screen.getByText(`${P}.refine(shown=2,total=900)`)).toBeTruthy();
  });

  it("komplet na ekranie nie ma ani przycisku, ani zdania o zawężeniu", () => {
    panel();
    expect(screen.queryByRole("button", { name: `${P}.loadMore` })).toBeNull();
    expect(screen.queryByText(/refine/)).toBeNull();
  });
});

describe("SeatingAttendeesPanel - osoby", () => {
  it("osoba z firmą, biletem i stanem miejsca; bez firmy - bez pustej linii", () => {
    panel();
    const [anna, jan] = screen.getAllByRole("listitem");
    expect(within(anna as HTMLElement).getByText("Firma Jeden · VIP")).toBeTruthy();
    expect(within(anna as HTMLElement).getByText(`${P}.noSeat`)).toBeTruthy();
    expect(within(jan as HTMLElement).getByText(`${P}.seat(label=A 1)`)).toBeTruthy();
    expect((jan as HTMLElement).querySelectorAll("p")).toHaveLength(2);
  });

  it("uchwyt przeciągania niesie prefiks rozpoznawany przez płótno", () => {
    panel();
    expect(h.drags.map((drag) => drag.id)).toEqual([
      `${CANDIDATE_DRAG_PREFIX}reg-1`,
      `${CANDIDATE_DRAG_PREFIX}reg-2`,
    ]);
    expect(h.drags[0]?.data).toEqual({ registrationId: "reg-1", name: "Anna Kowalska" });
    expect(
      screen
        .getByRole("button", { name: `${P}.drag(name=Anna Kowalska)` })
        .getAttribute("aria-roledescription"),
    ).toBe("draggable");
  });

  it("„wskaż miejsce” wybiera osobę, a ponowne kliknięcie ją odznacza", () => {
    const { props, rerender } = panel();
    fireEvent.click(screen.getByRole("button", { name: `${P}.arm(name=Anna Kowalska)` }));
    expect(props.onArm).toHaveBeenLastCalledWith(h.rows[0]);

    rerender(<SeatingAttendeesPanel {...props} armedId="reg-1" />);
    const przycisk = screen.getByRole("button", { name: `${P}.arm(name=Anna Kowalska)` });
    expect(przycisk.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(`${P}.armed`)).toBeTruthy();
    fireEvent.click(przycisk);
    expect(props.onArm).toHaveBeenLastCalledWith(null);
  });

  it("przeciągana osoba jest przygaszona", () => {
    h.dragging = true;
    panel();
    expect(screen.getAllByRole("listitem")[0]?.className).toContain("opacity-60");
  });
});

describe("SeatingAttendeesPanel - stany listy", () => {
  it("wczytywanie ma własne zdanie", () => {
    h.loading = true;
    panel();
    expect(screen.getByText(`${P}.loading`)).toBeTruthy();
  });

  it("odmowa bazy to zdanie, nie pustka", () => {
    h.error = new Error("forbidden: x");
    panel();
    expect(screen.getByText("odmowa:forbidden: x")).toBeTruthy();
    expect(screen.queryByText(`${P}.empty`)).toBeNull();
  });

  it("pustka pod filtrem i pustka bez filtrów mają różne zdania", () => {
    h.rows = [];
    h.total = 0;
    panel();
    expect(screen.getByText(`${P}.emptyFiltered`)).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: `${P}.onlyUnassigned` }));
    expect(screen.getByText(`${P}.empty`)).toBeTruthy();
  });
});

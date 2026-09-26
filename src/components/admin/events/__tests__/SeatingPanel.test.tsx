// Organizm „plan sali” w studiu - lista planów albo jeden plan.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. OTWARTY PLAN Z ADRESU: `mapId` podany przez trasę pokazuje przestrzeń
//      roboczą, a „wstecz” prosi trasę o listę (`onOpenMap(null)`).
//   2. LICZNIKI Z BAZY: kafelki pokazują liczby z `admin_event_seat_maps_list`,
//      a „bez miejsca” to uprawnieni minus zajęci (nigdy poniżej zera).
//   3. Sala i sesja w opisie planu; plan bez sesji to „całe wydarzenie”.
//   4. Nowy plan po zapisie OTWIERA SIĘ (adres dostaje jego identyfikator);
//      edycja nie zmienia adresu, a niesie scenę z listy (`mapInfoFromRow`).
//   5. Usunięcie z potwierdzeniem; odmowa pytania nic nie wysyła, odmowa bazy
//      to zdanie. Cztery stany listy mają cztery widoki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SeatMapInfo, SeatMapInput, SeatMapRow } from "@/lib/events/seatingApi";

type Wynik = { onSuccess?: (value: string) => void; onError?: (error: unknown) => void };

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as SeatMapRow[],
  loading: false,
  error: null as Error | null,
  saves: [] as SeatMapInput[],
  saveResults: [] as (string | Error)[],
  deletes: [] as string[],
  deleteError: null as Error | null,
  confirms: [] as boolean[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  dialogMap: undefined as SeatMapInfo | null | undefined,
  workspace: null as { mapId: string; onBack: () => void } | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: () => Promise.resolve(h.confirms.shift() ?? false),
}));
vi.mock("@/lib/events/adminSeatingErrors", () => ({
  adminSeatingErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@/lib/events/useEventSeating", () => ({
  useSeatMaps: () => ({
    data: h.loading || h.error !== null ? undefined : h.rows,
    isLoading: h.loading,
    error: h.error,
  }),
  useSaveSeatMap: () => ({
    isPending: false,
    mutate: (input: SeatMapInput, wynik: Wynik) => {
      h.saves.push(input);
      const next = h.saveResults.shift() ?? "map-new";
      if (next instanceof Error) wynik.onError?.(next);
      else wynik.onSuccess?.(next);
    },
  }),
  useDeleteSeatMap: () => ({
    mutateAsync: (id: string) => {
      h.deletes.push(id);
      return h.deleteError === null ? Promise.resolve(true) : Promise.reject(h.deleteError);
    },
  }),
}));
vi.mock("@/components/admin/events/organisms/SeatMapWorkspace", () => ({
  SeatMapWorkspace: (props: { mapId: string; onBack: () => void }) => {
    h.workspace = props;
    return (
      <button type="button" onClick={props.onBack}>
        {`plan:${props.mapId}`}
      </button>
    );
  },
}));
vi.mock("@/components/admin/events/molecules/EventSeatMapDialog", () => ({
  EventSeatMapDialog: ({
    open,
    map,
    onOpenChange,
    onSubmit,
  }: {
    open: boolean;
    map: SeatMapInfo | null;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: SeatMapInput) => void;
  }) => {
    if (open) h.dialogMap = map;
    return open ? (
      <div role="dialog">
        <button
          type="button"
          onClick={() =>
            onSubmit(map === null ? { eventId: "e", name: "Nowy" } : { id: map.id, name: "Zmiana" })
          }
        >
          okno:zapisz
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          okno:zamknij
        </button>
        <button type="button" onClick={() => onOpenChange(true)}>
          okno:zostaw
        </button>
      </div>
    ) : null;
  },
}));

import { SeatingPanel } from "@/components/admin/events/organisms/SeatingPanel";
import { SEAT_EVENT_ID, SEAT_MAP_ID, seatMapRow } from "@/test/events/seatingFixtures";

const L = "adminEventSeating.list";

beforeEach(() => {
  h.lang = "pl";
  h.rows = [seatMapRow()];
  h.loading = false;
  h.error = null;
  h.saves = [];
  h.saveResults = [];
  h.deletes = [];
  h.deleteError = null;
  h.confirms = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.dialogMap = undefined;
  h.workspace = null;
});

function panel(mapId: string | null = null) {
  const onOpenMap = vi.fn();
  const view = render(
    <SeatingPanel
      eventId={SEAT_EVENT_ID}
      eventSlug="kongres"
      eventTitle="Kongres"
      mapId={mapId}
      onOpenMap={onOpenMap}
    />,
  );
  return { ...view, onOpenMap };
}

const klik = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("SeatingPanel - otwarty plan", () => {
  it("identyfikator z adresu pokazuje przestrzeń roboczą, a „wstecz” prosi o listę", () => {
    const { onOpenMap } = panel("m-1");
    expect(h.workspace?.mapId).toBe("m-1");
    klik("plan:m-1");
    expect(onOpenMap).toHaveBeenCalledWith(null);
  });
});

describe("SeatingPanel - lista planów", () => {
  it("kafelki z bazy, „bez miejsca” = uprawnieni minus zajęci, opis sali i sesji", () => {
    h.rows = [
      seatMapRow({ room_name: "Sala A", session_title_pl: "Gala", session_title_en: "Gala EN" }),
    ];
    panel();

    const plan = screen.getAllByRole("listitem")[0] as HTMLElement;
    expect(within(plan).getByRole("heading", { name: "Gala" })).toBeTruthy();
    expect(
      within(plan).getByText(`${L}.room(name=Sala A) · ${L}.session(title=Gala)`),
    ).toBeTruthy();
    expect(within(plan).getByText("20")).toBeTruthy();
    expect(within(plan).getByText("6")).toBeTruthy();
    expect(within(plan).getByText("adminEventSeating.status.draft")).toBeTruthy();
  });

  it("plan bez sesji to „całe wydarzenie”, a nadmiar zajętych nie daje liczby ujemnej", () => {
    h.rows = [seatMapRow({ status: "published", seatable_registrations: 2, seats_assigned: 5 })];
    panel();
    expect(screen.getByText(`${L}.wholeEvent`)).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("adminEventSeating.status.published")).toBeTruthy();
  });

  it("„otwórz” niesie nazwę planu i prosi trasę o jego identyfikator", () => {
    const { onOpenMap } = panel();
    klik(`${L}.openNamed(name=Gala)`);
    expect(onOpenMap).toHaveBeenCalledWith(SEAT_MAP_ID);
  });

  it("nowy plan po zapisie otwiera się; odmowa zostawia okno", () => {
    h.saveResults = [new Error("name_taken: x"), "map-new"];
    const { onOpenMap } = panel();
    klik(`${L}.add`);
    expect(h.dialogMap).toBeNull();
    klik("okno:zapisz");
    expect(h.toastError).toHaveBeenCalledWith("odmowa:name_taken: x");
    expect(screen.getByRole("dialog")).toBeTruthy();

    klik("okno:zapisz");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.mapSaved");
    expect(onOpenMap).toHaveBeenCalledWith("map-new");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("edycja startuje z wiersza (razem ze sceną) i nie zmienia adresu", () => {
    h.rows = [seatMapRow({ stage_x: 400, stage_y: 20, stage_w: 400, stage_h: 80 })];
    const { onOpenMap } = panel();
    klik(`${L}.edit(name=Gala)`);
    expect(h.dialogMap?.stage).toEqual({ x: 400, y: 20, w: 400, h: 80 });
    klik("okno:zapisz");
    expect(h.saves[0]).toEqual({ id: SEAT_MAP_ID, name: "Zmiana" });
    expect(onOpenMap).not.toHaveBeenCalled();
  });

  it("zamknięcie okna bez zapisu niczego nie wysyła", () => {
    panel();
    klik(`${L}.add`);
    klik("okno:zostaw");
    expect(screen.getByRole("dialog")).toBeTruthy();
    klik("okno:zamknij");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.saves).toEqual([]);
  });

  it("usunięcie pyta; odmowa pytania nic nie wysyła, sukces i odmowa bazy mówią zdanie", async () => {
    h.confirms = [false, true, true];
    panel();
    klik(`${L}.delete(name=Gala)`);
    await waitFor(() => expect(h.confirms).toHaveLength(2));
    expect(h.deletes).toEqual([]);

    klik(`${L}.delete(name=Gala)`);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.mapDeleted"),
    );
    expect(h.deletes).toEqual([SEAT_MAP_ID]);

    h.deleteError = new Error("map_has_assignments: 4");
    klik(`${L}.delete(name=Gala)`);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:map_has_assignments: 4"));
  });
});

describe("SeatingPanel - stany listy", () => {
  it("wczytywanie, odmowa i pustka mają własne zdania", () => {
    h.loading = true;
    const { rerender } = panel();
    expect(screen.getByText(`${L}.loading`)).toBeTruthy();

    h.loading = false;
    h.error = new Error("forbidden: x");
    rerender(
      <SeatingPanel
        eventId={SEAT_EVENT_ID}
        eventSlug="kongres"
        eventTitle="Kongres"
        mapId={null}
        onOpenMap={vi.fn()}
      />,
    );
    expect(screen.getByText("odmowa:forbidden: x")).toBeTruthy();

    h.error = null;
    h.rows = [];
    rerender(
      <SeatingPanel
        eventId={SEAT_EVENT_ID}
        eventSlug="kongres"
        eventTitle="Kongres"
        mapId={null}
        onOpenMap={vi.fn()}
      />,
    );
    expect(screen.getByText(`${L}.empty`)).toBeTruthy();
  });
});

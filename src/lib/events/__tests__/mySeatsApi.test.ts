// Moje miejsce na sali - odczyt uczestnika i strony biletu.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Kod biletu wyjeżdża do zapytania także wtedy, gdy nie ma klucza
//      samoobsługi (`manage_token: null` w ciele) - albo nie wyjeżdża wcale.
//   2. Karta z brakującą geometrią wywraca mini-mapę zamiast narysować scenę.
//   3. Wiersz bez numeru miejsca udaje miejsce „0”.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => (h.rpc as SupabaseRpcStub).rpc(name, args),
  },
}));

const api = await import("@/lib/events/mySeatsApi");
const hooks = await import("@/lib/events/useMySeats");

const CARD = {
  map_id: "m1",
  map_name: "Gala",
  room_name: "Sala A",
  room_floor: "1",
  room_note: null,
  session_title_pl: "Kolacja",
  session_title_en: "Dinner",
  section_label: "5",
  section_kind: "table",
  row_label: null,
  seat_number: 3,
  is_accessible: true,
  category: { name_pl: "VIP", name_en: "VIP", color: "#112233" },
  geometry: {
    width: 1600,
    height: 900,
    stage: { x: 1, y: 2, w: 3, h: 4 },
    section: { kind: "table", table_shape: "rect", origin_x: 5, origin_y: 6, rotation_deg: 7, seat_pitch: 40, row_pitch: 70 },
    seats: [{ x: 1, y: 2, mine: true }, { x: 3, y: 4 }, { x: "a" }, null],
  },
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("parser kart miejsca", () => {
  it("komplet pól", () => {
    expect(api.parseMySeatCards({ seats: [CARD] })).toEqual([
      {
        mapId: "m1",
        mapName: "Gala",
        roomName: "Sala A",
        roomFloor: "1",
        roomNote: null,
        sessionTitlePl: "Kolacja",
        sessionTitleEn: "Dinner",
        sectionLabel: "5",
        sectionKind: "table",
        rowLabel: null,
        seatNumber: 3,
        isAccessible: true,
        category: { namePl: "VIP", nameEn: "VIP", color: "#112233" },
        geometry: {
          width: 1600,
          height: 900,
          stage: { x: 1, y: 2, w: 3, h: 4 },
          section: { kind: "table", tableShape: "rect", originX: 5, originY: 6, rotationDeg: 7, seatPitch: 40, rowPitch: 70 },
          seats: [
            { x: 1, y: 2, mine: true },
            { x: 3, y: 4, mine: false },
          ],
        },
      },
    ]);
  });

  it("braki: wartości domyślne, karta bez planu albo numeru pominięta", () => {
    const cards = api.parseMySeatCards({
      seats: [
        { map_id: "m2", seat_number: 1, category: { color: null }, geometry: { stage: { x: 1 }, section: { table_shape: "oval" } } },
        { map_id: "m3", seat_number: 2, section_kind: "rows" },
        { map_id: "bez-numeru" },
        "śmieć",
      ],
    });
    expect(cards.map((card) => card.mapId)).toEqual(["m2", "m3"]);
    expect(cards[0]).toMatchObject({
      mapName: "",
      sectionKind: "rows",
      category: { namePl: "", nameEn: "", color: "#6b7280" },
      geometry: {
        width: 1200,
        height: 800,
        stage: null,
        section: { kind: "rows", tableShape: null, originX: 0, originY: 0, rotationDeg: 0, seatPitch: 50, rowPitch: 60 },
        seats: [],
      },
    });
    expect(cards[1]).toMatchObject({ category: null, geometry: { section: { tableShape: null } } });
    expect(api.parseMySeatCards(null)).toEqual([]);
    expect(
      api.parseMySeatCards({ seats: [{ map_id: "m", seat_number: 1, geometry: { section: { table_shape: "round" } } }] })[0]
        .geometry.section.tableShape,
    ).toBe("round");
  });
});

describe("odczyty", () => {
  it("event_my_seats: slug w ciele, błąd przechodzi dalej", async () => {
    h.rpc?.setData("event_my_seats", { seats: [CARD] });
    await expect(api.fetchMySeats("gala")).resolves.toHaveLength(1);
    expect(h.rpc?.lastCall("event_my_seats")?.arg("p_payload")).toEqual({ slug: "gala" });
    h.rpc?.setError("event_my_seats", "auth_required: x");
    await expect(api.fetchMySeats("gala")).rejects.toThrow("auth_required");
  });

  it("event_ticket_seats: kod QR zawsze, klucz samoobsługi tylko gdy jest", async () => {
    h.rpc?.setData("event_ticket_seats", { seats: [] });
    await api.fetchTicketSeats("gala", { qrToken: "q".repeat(32), manageToken: null });
    expect(h.rpc?.lastCall("event_ticket_seats")?.arg("p_payload")).toEqual({ slug: "gala", qr_token: "q".repeat(32) });
    await api.fetchTicketSeats("gala", { qrToken: "q".repeat(32), manageToken: "m".repeat(32) });
    expect(h.rpc?.lastCall("event_ticket_seats")?.arg("p_payload")).toEqual({
      slug: "gala",
      qr_token: "q".repeat(32),
      manage_token: "m".repeat(32),
    });
    h.rpc?.setError("event_ticket_seats", "boom");
    await expect(api.fetchTicketSeats("gala", { qrToken: "q", manageToken: null })).rejects.toThrow("boom");
  });
});

describe("hooki uczestnika", () => {
  it("klucze bez kodu biletu", () => {
    expect(hooks.mySeatsKey("gala")).toEqual(["event-me", "gala", "seats"]);
    expect(hooks.ticketSeatsKey("gala")).toEqual(["event-ticket-seats", "gala"]);
  });

  it("useMySeats i useTicketSeats czytają, gdy wolno", async () => {
    h.rpc?.setData("event_my_seats", { seats: [CARD] });
    h.rpc?.setData("event_ticket_seats", { seats: [CARD] });
    const { result } = renderHookWithQueryClient(() => ({
      mine: hooks.useMySeats("gala", true),
      ticket: hooks.useTicketSeats("gala", { qrToken: "q", manageToken: null }),
    }));
    await waitFor(() => expect(result.current.ticket.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.mine.data).toHaveLength(1));
  });

  it("wyłączone, bez sluga albo bez kodu - bez zapytań", async () => {
    const { result } = renderHookWithQueryClient(() => ({
      a: hooks.useMySeats("gala", false),
      b: hooks.useMySeats("", true),
      c: hooks.useTicketSeats("gala", null),
      d: hooks.useTicketSeats("", { qrToken: "q", manageToken: null }),
    }));
    await Promise.resolve();
    for (const query of Object.values(result.current)) expect(query.fetchStatus).toBe("idle");
    expect(h.rpc?.calls).toHaveLength(0);
  });
});

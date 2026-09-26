// Hooki PLANU SALI: klucze, bramy `enabled`, unieważnienie gałęzi wydarzenia.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Klucz bez identyfikatora wydarzenia - ekran kongresu rysuje plan gali
//      innego wydarzenia z pamięci podręcznej.
//   2. Zapytanie wysłane przed wyborem planu (`mapId === ""`) kończy się odmową
//      wyświetloną organizatorowi, który jeszcze nic nie zrobił.
//   3. Mutacja odświeża tylko listę planów - otwarty plan pokazuje stare
//      miejsca, a lista zgłoszeń starą plakietkę miejsca.
// PARA: gałąź TEGO wydarzenia unieważniona, gałąź innego - nietknięta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { QueryClient, UseMutationResult } from "@tanstack/react-query";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const api = vi.hoisted(() => ({
  fetchSeatMaps: vi.fn(),
  fetchSeatMapDetail: vi.fn(),
  fetchSeatingCandidates: vi.fn(),
  fetchAllSeatingCandidates: vi.fn(),
  fetchSeatLookup: vi.fn(),
  saveSeatMap: vi.fn(),
  deleteSeatMap: vi.fn(),
  saveSeatCategory: vi.fn(),
  deleteSeatCategory: vi.fn(),
  saveSeatSection: vi.fn(),
  deleteSeatSection: vi.fn(),
  updateSeats: vi.fn(),
  assignSeat: vi.fn(),
  assignSeatsBatch: vi.fn(),
  releaseSeats: vi.fn(),
}));

vi.mock("@/lib/events/seatingApi", () => api);

const hooks = await import("@/lib/events/useEventSeating");
const { seatingKeys } = hooks;

const EVENT = "e-1";
const OTHER = "e-2";

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("klucze planu sali", () => {
  it("wszystko pod gałęzią wydarzenia", () => {
    expect(seatingKeys.event(EVENT)).toEqual(["event-seating", EVENT]);
    expect(seatingKeys.maps(EVENT)).toEqual(["event-seating", EVENT, "maps"]);
    expect(seatingKeys.map(EVENT, "m")).toEqual(["event-seating", EVENT, "map", "m"]);
    expect(seatingKeys.planner(EVENT, "m")).toEqual(["event-seating", EVENT, "planner", "m"]);
    expect(seatingKeys.candidates(EVENT, { mapId: "m" })).toEqual([
      "event-seating",
      EVENT,
      "candidates",
      { mapId: "m" },
    ]);
    expect(seatingKeys.lookup(EVENT, ["r"])).toEqual(["event-seating", EVENT, "lookup", ["r"]]);
  });
});

describe("odczyty i bramy enabled", () => {
  it("lista planów, szczegół, kandydaci, wszyscy kandydaci, lookup", async () => {
    api.fetchSeatMaps.mockResolvedValue([{ id: "m" }]);
    api.fetchSeatMapDetail.mockResolvedValue({ map: { id: "m" } });
    api.fetchSeatingCandidates.mockResolvedValue({ rows: [], total: 0 });
    api.fetchAllSeatingCandidates.mockResolvedValue([]);
    api.fetchSeatLookup.mockResolvedValue([]);
    const { result } = renderHookWithQueryClient(() => ({
      maps: hooks.useSeatMaps(EVENT),
      detail: hooks.useSeatMapDetail(EVENT, "m"),
      candidates: hooks.useSeatingCandidates(EVENT, { mapId: "m" }),
      all: hooks.useAllSeatingCandidates(EVENT, "m", true),
      lookup: hooks.useSeatLookup(EVENT, ["r1"]),
    }));
    await waitFor(() => expect(result.current.lookup.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.all.isSuccess).toBe(true));
    expect(result.current.maps.data).toEqual([{ id: "m" }]);
    expect(api.fetchSeatMaps).toHaveBeenCalledWith(EVENT);
    expect(api.fetchSeatMapDetail).toHaveBeenCalledWith("m");
    expect(api.fetchSeatingCandidates).toHaveBeenCalledWith({ mapId: "m" });
    expect(api.fetchAllSeatingCandidates).toHaveBeenCalledWith("m");
    expect(api.fetchSeatLookup).toHaveBeenCalledWith(EVENT, ["r1"]);
  });

  it("puste identyfikatory, null zapytania, pusta lista i zamknięty dialog nie pytają sieci", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => ({
      maps: hooks.useSeatMaps(""),
      detail: hooks.useSeatMapDetail(EVENT, ""),
      detail2: hooks.useSeatMapDetail("", "m"),
      candidates: hooks.useSeatingCandidates(EVENT, null),
      candidates2: hooks.useSeatingCandidates("", { mapId: "m" }),
      all: hooks.useAllSeatingCandidates(EVENT, "m", false),
      all2: hooks.useAllSeatingCandidates("", "m", true),
      all3: hooks.useAllSeatingCandidates(EVENT, "", true),
      lookup: hooks.useSeatLookup(EVENT, []),
      lookup2: hooks.useSeatLookup("", ["r"]),
    }));
    await Promise.resolve();
    for (const query of Object.values(result.current)) expect(query.fetchStatus).toBe("idle");
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: [...seatingKeys.event(EVENT), "candidates", "idle"] }),
    ).toBeDefined();
  });
});

type Hook = (eventId: string) => UseMutationResult<unknown, Error, never>;

const MUTATIONS: [string, Hook, keyof typeof api][] = [
  ["zapis planu", hooks.useSaveSeatMap as unknown as Hook, "saveSeatMap"],
  ["usunięcie planu", hooks.useDeleteSeatMap as unknown as Hook, "deleteSeatMap"],
  ["zapis kategorii", hooks.useSaveSeatCategory as unknown as Hook, "saveSeatCategory"],
  ["usunięcie kategorii", hooks.useDeleteSeatCategory as unknown as Hook, "deleteSeatCategory"],
  ["zapis sekcji", hooks.useSaveSeatSection as unknown as Hook, "saveSeatSection"],
  ["usunięcie sekcji", hooks.useDeleteSeatSection as unknown as Hook, "deleteSeatSection"],
  ["zmiana miejsc", hooks.useUpdateSeats as unknown as Hook, "updateSeats"],
  ["przydział", hooks.useAssignSeat as unknown as Hook, "assignSeat"],
  ["przydział zbiorczy", hooks.useAssignSeatsBatch as unknown as Hook, "assignSeatsBatch"],
  ["zwolnienie", hooks.useReleaseSeats as unknown as Hook, "releaseSeats"],
];

function seed(client: QueryClient): void {
  client.setQueryData(seatingKeys.maps(EVENT), []);
  client.setQueryData(seatingKeys.map(EVENT, "m"), {});
  client.setQueryData(seatingKeys.maps(OTHER), []);
}

describe.each(MUTATIONS)("mutacja: %s", (_label, useHook, fn) => {
  it("unieważnia całą gałąź tego wydarzenia, cudzej nie rusza", async () => {
    api[fn].mockResolvedValue("ok");
    const { result, queryClient } = renderHookWithQueryClient(() => useHook(EVENT));
    seed(queryClient);
    await result.current.mutateAsync({} as never);
    expect(api[fn]).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(queryClient.getQueryState(seatingKeys.maps(EVENT))?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(seatingKeys.map(EVENT, "m"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(seatingKeys.maps(OTHER))?.isInvalidated).toBe(false);
  });

  it("odmowa bazy nie unieważnia niczego", async () => {
    api[fn].mockRejectedValue(new Error("seat_taken: x"));
    const { result, queryClient } = renderHookWithQueryClient(() => useHook(EVENT));
    seed(queryClient);
    await expect(result.current.mutateAsync({} as never)).rejects.toThrow("seat_taken");
    expect(queryClient.getQueryState(seatingKeys.maps(EVENT))?.isInvalidated).toBe(false);
  });
});

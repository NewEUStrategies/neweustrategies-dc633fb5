// Molekuła „miejsce na sali" na stronie biletu.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. Kod biletu idzie do hooka w CAŁOŚCI (fragment), a nie w kluczu - klucz
//      i sama warstwa danych mają testy w `mySeatsApi.test.ts`.
//   2. PUSTO = NIC: bilet bez miejsca (brak planu, plan w szkicu, obcy kod)
//      nie rysuje ani nagłówka, ani zdania „miejsca brak".
//   3. Jest miejsce - nazwana sekcja z kartą na każdy plan.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MySeatCard } from "@/lib/events/mySeatsApi";
import type { TicketFragment } from "@/lib/events/manageToken";

const h = vi.hoisted(() => ({
  calls: [] as { slug: string; fragment: TicketFragment | null }[],
  data: undefined as MySeatCard[] | undefined,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-event-seating", () => ({ ensureEventSeatingI18n: () => undefined }));
vi.mock("@/lib/events/useMySeats", () => ({
  useTicketSeats: (slug: string, fragment: TicketFragment | null) => {
    h.calls.push({ slug, fragment });
    return { data: h.data };
  },
}));

import { TicketSeatCards } from "@/components/events/registration/TicketSeatCards";
import { mySeatCard } from "@/test/events/seatingFixtures";

const BILET: TicketFragment = { qrToken: "q".repeat(32), manageToken: null };

beforeEach(() => {
  h.calls = [];
  h.data = undefined;
});

describe("TicketSeatCards", () => {
  it("w locie i przy pustej odpowiedzi nie rysuje niczego", () => {
    const { container, rerender } = render(<TicketSeatCards slug="kongres" ticket={BILET} />);
    expect(container.innerHTML).toBe("");
    expect(h.calls.at(-1)).toEqual({ slug: "kongres", fragment: BILET });

    h.data = [];
    rerender(<TicketSeatCards slug="kongres" ticket={BILET} />);
    expect(container.innerHTML).toBe("");
  });

  it("miejsce to nazwana sekcja z kartą na każdy plan", () => {
    h.data = [mySeatCard(), mySeatCard({ mapId: "m-2", mapName: "Konferencja" })];
    render(<TicketSeatCards slug="kongres" ticket={BILET} />);

    expect(screen.getByRole("region", { name: "eventSeating.card.title" })).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
});

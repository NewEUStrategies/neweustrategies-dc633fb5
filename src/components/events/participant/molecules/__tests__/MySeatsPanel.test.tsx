// Molekuła „Twoje miejsce na sali" w panelu uczestnika.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. CZTERY STANY MAJĄ CZTERY WIDOKI: wczytywanie, awaria z ponowieniem,
//      zapowiedź („organizator nie przydzielił Ci jeszcze miejsca" - to nie
//      błąd) i karty.
//   5. ZAPOWIEDŹ TYLKO GDY JEST PRAWDĄ: zgłoszenie zajmuje miejsce i plan jest
//      opublikowany. Zgłoszenie oczekujące, brak zgłoszenia, wydarzenie bez
//      planu albo plan w szkicu = sekcji nie ma wcale (jak na stronie biletu).
//   2. Panel pyta o miejsca WŁASNEGO wydarzenia (slug) i zawsze jest włączony -
//      decyzję „tylko z sesją" podejmuje panel „Moje", który go renderuje.
//   3. Jedna karta na plan (konferencja + gala = dwie karty).
//   4. Render serwerowy (stan wczytywania) hydratuje się bez rozjazdu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import type { MySeatsResult } from "@/lib/events/mySeatsApi";

const h = vi.hoisted(() => ({
  calls: [] as { slug: string; enabled: boolean }[],
  state: {
    data: undefined as MySeatsResult | undefined,
    isLoading: false,
    isError: false,
  },
  refetch: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-event-seating", () => ({ ensureEventSeatingI18n: () => undefined }));
vi.mock("@/lib/events/useMySeats", () => ({
  useMySeats: (slug: string, enabled: boolean) => {
    h.calls.push({ slug, enabled });
    return { ...h.state, refetch: h.refetch };
  },
}));

import { MySeatsPanel } from "@/components/events/participant/molecules/MySeatsPanel";
import { mySeatCard } from "@/test/events/seatingFixtures";

beforeEach(() => {
  h.calls = [];
  h.state = { data: undefined, isLoading: false, isError: false };
  h.refetch.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("MySeatsPanel", () => {
  it("wczytywanie to szkielet z opisem dla czytnika", () => {
    h.state.isLoading = true;
    render(<MySeatsPanel slug="kongres" />);

    expect(h.calls.at(-1)).toEqual({ slug: "kongres", enabled: true });
    expect(screen.getByText("eventSeating.card.loading")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("awaria mówi to wprost i pozwala ponowić", () => {
    h.state.isError = true;
    render(<MySeatsPanel slug="kongres" />);

    expect(screen.getByRole("alert").textContent).toContain("eventSeating.card.error");
    fireEvent.click(screen.getByRole("button", { name: "eventSeating.card.retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("zgłoszenie zajmuje miejsce, plan opublikowany, miejsca brak - zapowiedź, a nie błąd", () => {
    h.state.data = { cards: [], seatable: true, hasPublishedPlan: true };
    render(<MySeatsPanel slug="kongres" />);

    expect(screen.getByRole("region", { name: "eventSeating.card.title" })).toBeTruthy();
    expect(screen.getByText("eventSeating.card.none")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["zgłoszenie nie zajmuje miejsca (oczekujące, brak zgłoszenia)", false, true],
    ["wydarzenie bez planu albo plan w szkicu", true, false],
    ["ani jedno, ani drugie", false, false],
  ])("%s - bez kart nic nie rysuje", (_label, seatable, hasPublishedPlan) => {
    h.state.data = { cards: [], seatable, hasPublishedPlan };
    const { container } = render(<MySeatsPanel slug="kongres" />);

    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("eventSeating.card.none")).toBeNull();
  });

  it("zapytanie bez danych i bez stanu (wyłączone) nic nie rysuje", () => {
    const { container } = render(<MySeatsPanel slug="kongres" />);
    expect(container.innerHTML).toBe("");
  });

  it("jedna karta na plan, pod nazwanym nagłówkiem sekcji", () => {
    h.state.data = {
      cards: [mySeatCard(), mySeatCard({ mapId: "m-2", mapName: "Konferencja", seatNumber: 9 })],
      seatable: true,
      hasPublishedPlan: true,
    };
    render(<MySeatsPanel slug="kongres" />);

    expect(screen.getByRole("region", { name: "eventSeating.card.title" })).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("eventSeating.card.plan(name=Konferencja)")).toBeTruthy();
  });

  it("karty rysują się także bez flag (starsza odpowiedź) - miejsce jest faktem", () => {
    h.state.data = { cards: [mySeatCard()], seatable: false, hasPublishedPlan: false };
    render(<MySeatsPanel slug="kongres" />);

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText("eventSeating.card.none")).toBeNull();
  });

  it("render serwerowy hydratuje się bez rozjazdu", async () => {
    h.state.isLoading = true;
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args[0]);
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(<MySeatsPanel slug="kongres" />);
    document.body.appendChild(container);
    const serwerowy = container.innerHTML;

    await act(async () => {
      hydrateRoot(container, <MySeatsPanel slug="kongres" />);
    });

    expect(errors, errors.map(String).join(" | ")).toEqual([]);
    expect(container.innerHTML).toBe(serwerowy);
    const tytul = container.querySelector("h2");
    expect(container.querySelector("section")?.getAttribute("aria-labelledby")).toBe(tytul?.id);
  });
});

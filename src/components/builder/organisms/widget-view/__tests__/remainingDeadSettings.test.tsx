// Ostatnia partia martwych ustawien: kazde z nich bylo widoczne w panelu,
// a renderer go nie czytal (albo czytal w sposob, ktory nic nie zmienial).
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventCountdownCardView } from "../EventCountdownCardView";
import { InteractiveCircleWidget } from "../InteractiveCircleWidget";
import { newId, type WidgetContent, type WidgetNode } from "@/lib/builder/types";

afterEach(cleanup);

/** Data w przyszlosci, zeby odliczanie mialo co renderowac. */
const FUTURE = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function countdownCard(extra: WidgetContent) {
  return withQuery(
    <EventCountdownCardView
      c={{ mode: "custom", targetAt: FUTURE, showCountdown: true, ...extra }}
      lang="pl"
    />,
  );
}

function circleNode(content: WidgetContent): WidgetNode {
  return { id: newId(), kind: "widget", type: "interactive-circle", content };
}

describe("event-countdown-card honoruje rozmiar kafelka", () => {
  it("uses the compact tile height by default", () => {
    const { container } = countdownCard({});
    expect(container.querySelector(".h-14")).not.toBeNull();
    expect(container.querySelector(".h-20")).toBeNull();
  });

  it("scales the tiles up for size=lg", () => {
    // Wczesniej kafelki mialy sztywna wysokosc, wiec wybor md/lg dziedziczony
    // z edytora odliczania byl cichym no-opem.
    const { container } = countdownCard({ size: "lg" });
    expect(container.querySelector(".h-20")).not.toBeNull();
  });

  it("falls back to md for an unknown size", () => {
    const { container } = countdownCard({ size: "gigantic" });
    expect(container.querySelector(".h-14")).not.toBeNull();
    expect(container.querySelector(".h-20")).toBeNull();
  });
});

describe("interactive-circle: tresc widgetu to wstep, nie fallback srodka", () => {
  it("renders the widget description once, as the intro above the circle", () => {
    // Regresja na "poprawke", ktora kusi po przeczytaniu starej etykiety pola:
    // uczynienie `desc` fallbackiem srodka kola pokazywaloby ten sam tekst
    // dwa razy, bo wstep renderuje sie nad kolem bezwarunkowo.
    render(
      <InteractiveCircleWidget
        node={circleNode({
          items: [{ label_pl: "Jeden", desc_pl: "" }],
          desc_pl: "Wstep widgetu",
        })}
        lang="pl"
      />,
    );
    expect(screen.getAllByText("Wstep widgetu")).toHaveLength(1);
  });

  it("shows the active item's own description in the centre", () => {
    render(
      <InteractiveCircleWidget
        node={circleNode({
          items: [{ label_pl: "Jeden", desc_pl: "Opis pozycji" }],
          desc_pl: "Wstep widgetu",
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("Opis pozycji")).toBeTruthy();
    expect(screen.getAllByText("Wstep widgetu")).toHaveLength(1);
  });
});

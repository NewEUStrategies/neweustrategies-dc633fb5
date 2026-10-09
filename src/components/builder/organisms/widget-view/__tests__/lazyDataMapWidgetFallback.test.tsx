// LENIWY WIDGET MAPY DANYCH, KTÓREGO CHUNK SIĘ NIE ZAŁADOWAŁ.
//
// Ten sam kontrakt co w bloku CMS (`lazyDataMapFallback.test.tsx` w rendererze
// bloków): widget wykresu i widget mapy jadą jednym leniwym chunkiem
// (`DataVizWidgets`), a awaria importu ma dać w miejscu rysunku komunikat
// `ChartLoadFailed`, nie pustą dziurę ani wywrotkę granicy błędu strony.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { WidgetNode } from "@/lib/builder/types";

vi.mock("../DataVizWidgets", () => {
  throw new Error("chunk 404");
});

const { ChartWidgetView, DataMapWidgetView } = await import("../lazyWidgets");

const KOMUNIKAT = "Biblioteka wykresów nie załadowała się. Sprawdź połączenie.";

function node(type: WidgetNode["type"]): WidgetNode {
  return { id: "w1", kind: "widget", type, content: { data: "PL; 1" } };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("leniwe widgety data-viz - awaria chunka", () => {
  it("widget mapy danych pokazuje komunikat", async () => {
    render(<DataMapWidgetView node={node("data-map")} lang="pl" />);
    expect((await screen.findByRole("status")).textContent).toBe(KOMUNIKAT);
  });

  it("widget wykresu - ten sam komunikat", async () => {
    render(<ChartWidgetView node={node("chart")} lang="pl" />);
    expect((await screen.findByRole("status")).textContent).toBe(KOMUNIKAT);
  });
});

// Regresja: widget "event-countdown-card" w trybie "event" nie mial ramienia
// prefetchu SSR (rejestr dopasowywal wylacznie "event-countdown"), wiec serwer
// renderowal karte z placeholderami, a tytul, okladka i data wskakiwaly dopiero
// po hydratacji i osobnym zapytaniu klienta.
import { describe, it, expect } from "vitest";
import type { WidgetNode } from "@/lib/builder/types";
import { widgetCacheTargets, widgetQueryOptionsList } from "@/lib/builder/prefetch";
import { eventByIdQueryOptions } from "@/lib/builder/eventsQuery";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

const widgetOf = (type: WidgetNode["type"], content: WidgetNode["content"]): WidgetNode => ({
  id: "w-1",
  kind: "widget",
  type,
  content,
});

describe("ramie prefetchu event-countdown-card", () => {
  it("grzeje ten sam klucz co event-countdown (builder-event-by-id, to samo id)", () => {
    const card = widgetOf("event-countdown-card", { mode: "event", eventId: "e-42" });
    const opts = widgetQueryOptionsList(card, "pl");
    expect(opts).toHaveLength(1);
    expect(opts[0].queryKey).toEqual(eventByIdQueryOptions("e-42").queryKey);
    expect(opts[0].queryKey[0]).toBe(WIDGET_QUERY_ROOTS.eventById);

    const plain = widgetOf("event-countdown", { mode: "event", eventId: "e-42" });
    expect(opts[0].queryKey).toEqual(widgetQueryOptionsList(plain, "pl")[0].queryKey);
  });

  it("wystawia cel cache dla bramki SWR", () => {
    const card = widgetOf("event-countdown-card", { mode: "event", eventId: "e-42" });
    const targets = widgetCacheTargets(card, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key).toEqual(eventByIdQueryOptions("e-42").queryKey);
    expect(targets[0].staleTime).toBeGreaterThan(0);
  });

  it("nie grzeje niczego w trybie custom ani bez wskazanego wydarzenia", () => {
    expect(
      widgetQueryOptionsList(
        widgetOf("event-countdown-card", { mode: "custom", eventId: "e-42" }),
        "pl",
      ),
    ).toEqual([]);
    expect(
      widgetQueryOptionsList(widgetOf("event-countdown-card", { mode: "event" }), "pl"),
    ).toEqual([]);
    expect(widgetCacheTargets(widgetOf("event-countdown-card", {}), "pl")).toEqual([]);
  });
});

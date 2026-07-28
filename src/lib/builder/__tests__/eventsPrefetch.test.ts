// Ramiona prefetchu SSR dla ekosystemu widgetow wydarzen: rejestr
// (widgetQueryOptionsList) i cele cache (widgetCacheTargets) musza wskazywac
// dokladnie te same klucze, ktore czytaja widoki - inaczej streamowana sekcja
// refetchuje po hydratacji.
import { describe, it, expect } from "vitest";
import type { WidgetNode } from "@/lib/builder/types";
import { widgetCacheTargets, widgetQueryOptionsList } from "@/lib/builder/prefetch";
import { eventsListQueryOptions, eventByIdQueryOptions } from "@/lib/builder/eventsQuery";
import { speakersByIdsQueryOptions, speakersQueryOptions } from "@/lib/builder/speakersQuery";

const widgetOf = (type: WidgetNode["type"], content: WidgetNode["content"]): WidgetNode => ({
  id: "w-1",
  kind: "widget",
  type,
  content,
});

describe("event-list prefetch arm", () => {
  it("enumerates the same key the view reads", () => {
    const widget = widgetOf("event-list", { scope: "upcoming", limit: 6 });
    const opts = widgetQueryOptionsList(widget, "pl");
    expect(opts).toHaveLength(1);
    expect(opts[0].queryKey).toEqual(eventsListQueryOptions(widget.content, "pl").queryKey);
    const targets = widgetCacheTargets(widget, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key[0]).toBe("builder-event-list");
  });
});

describe("event-countdown prefetch arm", () => {
  it("prefetches the event row only in event mode with an id", () => {
    const withEvent = widgetOf("event-countdown", { mode: "event", eventId: "e-1" });
    const opts = widgetQueryOptionsList(withEvent, "pl");
    expect(opts).toHaveLength(1);
    expect(opts[0].queryKey).toEqual(eventByIdQueryOptions("e-1").queryKey);
    expect(widgetCacheTargets(withEvent, "pl")[0].key[0]).toBe("builder-event-by-id");

    expect(widgetQueryOptionsList(widgetOf("event-countdown", { mode: "event" }), "pl")).toEqual(
      [],
    );
    expect(
      widgetQueryOptionsList(
        widgetOf("event-countdown", { mode: "custom", eventId: "e-1", targetAt: "2027-01-01" }),
        "pl",
      ),
    ).toEqual([]);
  });
});

describe("speakers prefetch arm", () => {
  it("prefetches only for DB-backed sources", () => {
    expect(widgetQueryOptionsList(widgetOf("speakers", { speakers: [] }), "pl")).toEqual([]);
    expect(
      widgetQueryOptionsList(widgetOf("speakers", { source: "manual", speakers: [] }), "pl"),
    ).toEqual([]);

    const directory = widgetOf("speakers", { source: "directory", limit: 24 });
    const opts = widgetQueryOptionsList(directory, "pl");
    expect(opts).toHaveLength(1);
    expect(opts[0].queryKey).toEqual(speakersQueryOptions(directory.content, "pl").queryKey);
    expect(widgetCacheTargets(directory, "pl")[0].key[0]).toBe("builder-speakers");
  });
});

describe("event-schedule prefetch arm", () => {
  it("prefetches linked speaker profiles and skips inline-only schedules", () => {
    const inlineOnly = widgetOf("event-schedule", {
      days: [
        {
          id: "d",
          sessions: [{ id: "s", speakers: [{ id: "sp", name: "Manual Only" }] }],
        },
      ],
    });
    expect(widgetQueryOptionsList(inlineOnly, "pl")).toEqual([]);

    const linked = widgetOf("event-schedule", {
      days: [
        {
          id: "d",
          sessions: [
            {
              id: "s1",
              speakers: [
                { id: "a", userId: "u-2" },
                { id: "b", userId: "u-1" },
              ],
            },
            { id: "s2", speakers: [{ id: "c", userId: "u-2" }] },
          ],
        },
      ],
    });
    const opts = widgetQueryOptionsList(linked, "pl");
    expect(opts).toHaveLength(1);
    // Klucz sortuje id, wiec kolejnosc w tresci nie uniewaznia cache.
    expect(opts[0].queryKey).toEqual(speakersByIdsQueryOptions(["u-1", "u-2"]).queryKey);
    expect(widgetCacheTargets(linked, "pl")[0].key[0]).toBe("builder-speakers-by-ids");
  });
});

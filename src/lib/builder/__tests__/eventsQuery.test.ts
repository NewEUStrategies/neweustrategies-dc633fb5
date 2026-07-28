// Kontrakt normalizacji inputow widgetow wydarzen: klucze zapytan musza byc
// pochodna WYLACZNIE tresci widgetu (identyczne miedzy prefetchem SSR a
// klientem), a wartosci - zaciskane do bezpiecznych zakresow.
import { describe, it, expect } from "vitest";
import type { WidgetContent } from "@/lib/builder/types";
import { EVENT_KINDS, eventsListInput } from "@/lib/builder/eventsQuery";
import { mapSpeakerRow, speakersInput, speakersSource } from "@/lib/builder/speakersQuery";

describe("eventsListInput", () => {
  it("defaults: upcoming scope, no kind filter, limit 6", () => {
    expect(eventsListInput({})).toEqual({ scope: "upcoming", kind: "", limit: 6 });
  });

  it("accepts valid scopes and falls back to upcoming for garbage", () => {
    expect(eventsListInput({ scope: "past" }).scope).toBe("past");
    expect(eventsListInput({ scope: "all" }).scope).toBe("all");
    expect(eventsListInput({ scope: "nonsense" }).scope).toBe("upcoming");
  });

  it("whitelists event kinds", () => {
    for (const kind of EVENT_KINDS) {
      expect(eventsListInput({ kind }).kind).toBe(kind);
    }
    expect(eventsListInput({ kind: "conference" }).kind).toBe("");
  });

  it("clamps limit to 1..50 and coerces strings", () => {
    expect(eventsListInput({ limit: 0 }).limit).toBe(1);
    expect(eventsListInput({ limit: 999 }).limit).toBe(50);
    expect(eventsListInput({ limit: "12" } as WidgetContent).limit).toBe(12);
    expect(eventsListInput({ limit: "abc" } as WidgetContent).limit).toBe(6);
  });

  it("is time-independent (no timestamp in the input)", () => {
    const input = eventsListInput({ scope: "upcoming" });
    expect(JSON.stringify(input)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("speakersSource / speakersInput", () => {
  it("treats legacy content without a source as manual", () => {
    expect(speakersSource({})).toBe("manual");
    expect(speakersSource({ source: "weird" })).toBe("manual");
    expect(speakersSource({ source: "directory" })).toBe("directory");
    expect(speakersSource({ source: "event" })).toBe("event");
  });

  it("normalizes the query input with clamped limit", () => {
    expect(speakersInput({ source: "event", eventId: "e-1", limit: 500 })).toEqual({
      source: "event",
      eventId: "e-1",
      userIds: [],
      limit: 200,
    });
    expect(speakersInput({}).limit).toBe(24);
  });
});

describe("mapSpeakerRow", () => {
  it("maps a full RPC row into the normalized shape", () => {
    const row = mapSpeakerRow({
      user_id: "u-1",
      slug: "jan-kowalski",
      display_name: "Jan Kowalski",
      avatar_url: "https://x.test/a.jpg",
      job_title: "Director",
      company: "NES",
      headline_pl: "Dyrektor programu",
      headline_en: "Programme director",
      bio_pl: "Bio PL",
      bio_en: "Bio EN",
      topics_pl: ["cyber", 42, "energia"],
      topics_en: ["cyber"],
      languages: ["pl", "en"],
      talks_count: 12,
      rating: 4.6,
      reviews_count: 9,
      is_expert: true,
      has_speaker_profile: true,
      sort_order: 3,
    });
    expect(row.user_id).toBe("u-1");
    expect(row.topics_pl).toEqual(["cyber", "energia"]);
    expect(row.rating).toBe(4.6);
    expect(row.is_expert).toBe(true);
    expect(row.sort_order).toBe(3);
  });

  it("clamps stats and nulls empty strings", () => {
    const row = mapSpeakerRow({
      user_id: "u-2",
      slug: "",
      display_name: "",
      rating: 9,
      talks_count: -5,
      reviews_count: "7",
    });
    expect(row.slug).toBeNull();
    expect(row.display_name).toBeNull();
    expect(row.rating).toBe(5);
    expect(row.talks_count).toBe(0);
    expect(row.reviews_count).toBe(7);
    expect(row.is_expert).toBe(false);
    expect(row.has_speaker_profile).toBe(false);
  });
});

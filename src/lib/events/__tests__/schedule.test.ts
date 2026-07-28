// Kontrakt czystej logiki agendy (event-schedule): parsowanie tresci widgetu,
// odpornosc na smieci, zbieranie user_id prelegentow i formatowanie.
import { describe, it, expect } from "vitest";
import type { WidgetContent } from "@/lib/builder/types";
import {
  collectProfileSpeakerIds,
  dayLabel,
  formatDayDate,
  formatTimeRange,
  parseScheduleDays,
} from "@/lib/events/schedule";

const sampleContent = (): WidgetContent => ({
  days: [
    {
      id: "day-1",
      label_pl: "Dzien 1",
      label_en: "Day 1",
      date: "2026-10-12",
      sessions: [
        {
          id: "ses-1",
          timeStart: "09:00",
          timeEnd: "10:00",
          kind: "session",
          title_pl: "Otwarcie",
          title_en: "Opening",
          description_pl: "",
          description_en: "",
          room: "A",
          href: "",
          speakers: [
            {
              id: "sp-1",
              userId: "u-1",
              name: "Jan Kowalski",
              role_pl: "CEO",
              role_en: "CEO",
              photo: "",
            },
            {
              id: "sp-2",
              userId: "",
              name: "Anna Nowak",
              role_pl: "CTO",
              role_en: "CTO",
              photo: "",
            },
          ],
          sponsors: [],
        },
        {
          id: "ses-2",
          timeStart: "10:00",
          timeEnd: "",
          kind: "break",
          title_pl: "Kawa",
          title_en: "Coffee",
          description_pl: "",
          description_en: "",
          room: "",
          href: "",
          speakers: [],
          sponsors: [{ id: "spn-1", name: "Acme", logo: "https://x.test/logo.png", url: "" }],
        },
      ],
    },
    {
      id: "day-2",
      label_pl: "Dzien 2",
      label_en: "",
      date: "",
      sessions: [
        {
          id: "ses-3",
          timeStart: "",
          timeEnd: "",
          kind: "session",
          title_pl: "Panel",
          title_en: "Panel",
          description_pl: "",
          description_en: "",
          room: "",
          href: "",
          speakers: [
            { id: "sp-3", userId: "u-1", name: "", role_pl: "", role_en: "", photo: "" },
            { id: "sp-4", userId: "u-2", name: "", role_pl: "", role_en: "", photo: "" },
          ],
          sponsors: [],
        },
      ],
    },
  ],
});

describe("parseScheduleDays", () => {
  it("parses a well-formed document into a typed model", () => {
    const days = parseScheduleDays(sampleContent());
    expect(days).toHaveLength(2);
    expect(days[0].sessions).toHaveLength(2);
    expect(days[0].sessions[0].speakers).toHaveLength(2);
    expect(days[0].sessions[1].kind).toBe("break");
    expect(days[0].sessions[1].sponsors[0].name).toBe("Acme");
  });

  it("tolerates garbage: non-arrays, non-objects and empty entries are dropped", () => {
    expect(parseScheduleDays({})).toEqual([]);
    expect(parseScheduleDays({ days: "not-an-array" })).toEqual([]);
    const days = parseScheduleDays({
      days: [
        null,
        42,
        {
          id: "d",
          sessions: [
            null,
            {
              kind: "unknown-kind",
              speakers: [null, { name: "" }, { name: "Ala" }],
              sponsors: [{}],
            },
          ],
        },
      ],
    } as unknown as WidgetContent);
    expect(days).toHaveLength(1);
    expect(days[0].sessions).toHaveLength(1);
    // Nieznany kind degraduje do "session"; pusty speaker/sponsor odpada.
    expect(days[0].sessions[0].kind).toBe("session");
    expect(days[0].sessions[0].speakers).toHaveLength(1);
    expect(days[0].sessions[0].sponsors).toHaveLength(0);
  });

  it("keeps authored session order (no auto-sorting by time)", () => {
    const days = parseScheduleDays({
      days: [
        {
          id: "d",
          sessions: [
            { id: "b", timeStart: "12:00", title_pl: "B" },
            { id: "a", timeStart: "09:00", title_pl: "A" },
          ],
        },
      ],
    } as unknown as WidgetContent);
    expect(days[0].sessions.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("collectProfileSpeakerIds", () => {
  it("deduplicates across days preserving first-seen order", () => {
    const ids = collectProfileSpeakerIds(parseScheduleDays(sampleContent()));
    expect(ids).toEqual(["u-1", "u-2"]);
  });

  it("returns empty for schedules without linked profiles", () => {
    expect(collectProfileSpeakerIds([])).toEqual([]);
  });
});

describe("dayLabel", () => {
  it("prefers the active language and falls back PL <-> EN", () => {
    const days = parseScheduleDays(sampleContent());
    expect(dayLabel(days[0], "en")).toBe("Day 1");
    // Dzien 2 nie ma etykiety EN -> fallback na PL.
    expect(dayLabel(days[1], "en")).toBe("Dzien 2");
  });
});

describe("formatTimeRange", () => {
  it("joins start and end with a hyphen (never an em dash)", () => {
    expect(formatTimeRange("09:00", "10:30")).toBe("09:00 - 10:30");
    expect(formatTimeRange("09:00", "10:30")).not.toContain("—");
  });

  it("degrades to the single known bound", () => {
    expect(formatTimeRange("09:00", "")).toBe("09:00");
    expect(formatTimeRange("", "10:00")).toBe("10:00");
    expect(formatTimeRange("", "")).toBe("");
  });
});

describe("formatDayDate", () => {
  it("localizes per language and stays empty for invalid input", () => {
    expect(formatDayDate("2026-10-12", "en")).toMatch(/October/);
    expect(formatDayDate("2026-10-12", "pl")).toMatch(/pa/i);
    expect(formatDayDate("", "pl")).toBe("");
    expect(formatDayDate("not-a-date", "en")).toBe("");
  });
});

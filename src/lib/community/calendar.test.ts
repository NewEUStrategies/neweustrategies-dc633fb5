// Testy jednostkowe generacji ICS/linków kalendarza (RFC 5545).
import { describe, expect, it } from "vitest";
import {
  buildEventIcs,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  icsFileName,
  outlookCalendarUrl,
  toIcsUtc,
  type CalendarEventInput,
} from "./calendar";

const BASE: CalendarEventInput = {
  uid: "11111111-2222-3333-4444-555555555555",
  title: "Briefing: AI Act w praktyce",
  description: "Sesja pytań; odpowiedzi ekspertów, część 1\nDruga linia.",
  location: "Bruksela, Rue de la Loi 200",
  url: "https://neweuropeanstrategies.com/events/ai-act",
  startsAt: new Date("2026-09-15T16:00:00.000Z"),
  endsAt: new Date("2026-09-15T17:30:00.000Z"),
};

describe("toIcsUtc", () => {
  it("formats UTC timestamps as YYYYMMDDTHHMMSSZ", () => {
    expect(toIcsUtc(new Date("2026-09-15T16:05:09.000Z"))).toBe("20260915T160509Z");
  });

  it("pads single-digit fields", () => {
    expect(toIcsUtc(new Date("2026-01-02T03:04:05.000Z"))).toBe("20260102T030405Z");
  });
});

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma and newlines", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
});

describe("foldIcsLine", () => {
  it("keeps short lines intact", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds long lines at 75 octets with CRLF + space", () => {
    const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(folded.split("\r\n ").join("")).toBe(`SUMMARY:${"x".repeat(200)}`);
  });

  it("never splits inside a multi-byte UTF-8 character", () => {
    const folded = foldIcsLine(`SUMMARY:${"ą".repeat(120)}`);
    const unfolded = folded.split("\r\n ").join("");
    expect(unfolded).toBe(`SUMMARY:${"ą".repeat(120)}`);
    for (const part of folded.split("\r\n")) {
      // Re-dekodowalna część = cięcie wyłącznie na granicach znaków.
      expect(part.includes("�")).toBe(false);
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildEventIcs", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");

  it("produces a well-formed VCALENDAR with UTC times and CRLF endings", () => {
    const ics = buildEventIcs(BASE, now);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20260915T160000Z");
    expect(ics).toContain("DTEND:20260915T173000Z");
    expect(ics).toContain("DTSTAMP:20260721T120000Z");
    expect(ics).toContain(`UID:${BASE.uid}@`);
    expect(ics).toContain("SUMMARY:Briefing: AI Act w praktyce");
    expect(ics).toContain("LOCATION:Bruksela\\, Rue de la Loi 200");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("escapes description newlines and separators", () => {
    const ics = buildEventIcs(BASE, now);
    const unfolded = ics.split("\r\n ").join("");
    expect(unfolded).toContain("Sesja pytań\\; odpowiedzi ekspertów\\, część 1\\nDruga linia.");
  });

  it("defaults to a 1-hour duration when endsAt is missing", () => {
    const ics = buildEventIcs({ ...BASE, endsAt: null }, now);
    expect(ics).toContain("DTEND:20260915T170000Z");
  });

  it("omits optional fields when absent", () => {
    const ics = buildEventIcs(
      { uid: "u1", title: "T", startsAt: BASE.startsAt, description: null, location: null },
      now,
    );
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("URL:");
  });
});

describe("calendar deep links", () => {
  it("builds a Google Calendar template URL with UTC range", () => {
    const url = new URL(googleCalendarUrl(BASE));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(BASE.title);
    expect(url.searchParams.get("dates")).toBe("20260915T160000Z/20260915T173000Z");
    expect(url.searchParams.get("location")).toBe(BASE.location);
    expect(url.searchParams.get("details")).toContain(BASE.url);
  });

  it("builds an Outlook compose URL with ISO datetimes", () => {
    const url = new URL(outlookCalendarUrl(BASE));
    expect(url.hostname).toBe("outlook.live.com");
    expect(url.searchParams.get("subject")).toBe(BASE.title);
    expect(url.searchParams.get("startdt")).toBe("2026-09-15T16:00:00.000Z");
    expect(url.searchParams.get("enddt")).toBe("2026-09-15T17:30:00.000Z");
  });
});

describe("icsFileName", () => {
  it("derives a safe file name from the slug", () => {
    expect(icsFileName("ai-act-2026")).toBe("ai-act-2026.ics");
    expect(icsFileName("Weird Slug!")).toBe("weird-slug-.ics");
    expect(icsFileName("")).toBe("event.ics");
  });
});

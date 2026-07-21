// "Dodaj do kalendarza" dla wydarzeń: plik ICS (RFC 5545) + głębokie linki
// Google/Outlook. Czyste funkcje bez zależności od DOM (poza downloadIcs),
// więc generacja jest w pełni testowalna jednostkowo.
//
// Decyzje projektowe:
//   * DTSTART/DTEND w UTC (sufiks Z) - zero VTIMEZONE, każdy klient kalendarza
//     przelicza na strefę użytkownika; starts_at w bazie to timestamptz.
//   * UID stabilny per wydarzenie (id@host) - ponowny import aktualizuje
//     wpis zamiast go duplikować.
//   * Escaping i łamanie linii po 75 OKTETACH (nie znakach) zgodnie z RFC -
//     tytuły PL z diakrytykami nie mogą rozciąć się w środku znaku UTF-8.

export interface CalendarEventInput {
  /** Stabilny identyfikator (u nas: events.id). */
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  /** Kanoniczny adres wydarzenia (ląduje w URL i w opisie linkowym). */
  url?: string | null;
  startsAt: Date;
  /** Brak = domyślny czas trwania 1 h. */
  endsAt?: Date | null;
}

const DEFAULT_DURATION_MS = 60 * 60 * 1000;
const PROD_ID = "-//New European Strategies//Community Events//PL";
const UID_HOST = "neweuropeanstrategies.com";

/** Znacznik czasu ICS w UTC: YYYYMMDDTHHMMSSZ. */
export function toIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Escaping wartości tekstowych ICS: backslash, średnik, przecinek, newline. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * Łamanie linii ICS po maks. 75 oktetach (RFC 5545 §3.1): kontynuacja to
 * CRLF + spacja. Liczymy bajty UTF-8 i tniemy wyłącznie na granicach znaków.
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Pierwsza linia mieści 75 oktetów, każda kontynuacja 74 (wiodąca spacja).
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

/** Kompletny dokument VCALENDAR z pojedynczym VEVENT. */
export function buildEventIcs(event: CalendarEventInput, now: Date = new Date()): string {
  const start = event.startsAt;
  const end = event.endsAt ?? new Date(start.getTime() + DEFAULT_DURATION_MS);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PROD_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@${UID_HOST}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (event.description?.trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description.trim())}`);
  }
  if (event.location?.trim()) {
    lines.push(`LOCATION:${escapeIcsText(event.location.trim())}`);
  }
  if (event.url) {
    lines.push(`URL:${escapeIcsText(event.url)}`);
  }
  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Głęboki link "dodaj wydarzenie" w Google Calendar. */
export function googleCalendarUrl(event: CalendarEventInput): string {
  const start = event.startsAt;
  const end = event.endsAt ?? new Date(start.getTime() + DEFAULT_DURATION_MS);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toIcsUtc(start)}/${toIcsUtc(end)}`,
  });
  const details = [event.description?.trim(), event.url].filter(Boolean).join("\n\n");
  if (details) params.set("details", details);
  if (event.location?.trim()) params.set("location", event.location.trim());
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Głęboki link "dodaj wydarzenie" w Outlook (konta osobiste i firmowe). */
export function outlookCalendarUrl(event: CalendarEventInput): string {
  const start = event.startsAt;
  const end = event.endsAt ?? new Date(start.getTime() + DEFAULT_DURATION_MS);
  const params = new URLSearchParams({
    rru: "addevent",
    path: "/calendar/action/compose",
    subject: event.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
  });
  const body = [event.description?.trim(), event.url].filter(Boolean).join("\n\n");
  if (body) params.set("body", body);
  if (event.location?.trim()) params.set("location", event.location.trim());
  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

/** Nazwa pliku do pobrania: slug wydarzenia + rozszerzenie .ics. */
export function icsFileName(slug: string): string {
  return `${slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "event"}.ics`;
}

/** Pobranie pliku ICS w przeglądarce (Blob + tymczasowy anchor). */
export function downloadIcs(event: CalendarEventInput, fileName: string): void {
  const blob = new Blob([buildEventIcs(event)], {
    type: "text/calendar;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

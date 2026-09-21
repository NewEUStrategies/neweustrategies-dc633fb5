// Testy jednostkowe generacji ICS/linków kalendarza (RFC 5545).
//
// PO CO TEN PLIK ISTNIEJE. Wpis kalendarza jedzie do OBCEGO klienta (Apple
// Calendar, Thunderbird, Outlook, Google) i nikt po drodze go nie waliduje.
// Jeden NIEZAESKEJPOWANY PRZECINEK w tytule rozcina wartość SUMMARY na dwie
// i odbiorca dostaje wpis z uciętą nazwą albo w ogóle nieimportowalny plik -
// awaria widoczna dopiero u gościa, nigdy u nas. Dlatego przedmiotem dowodu
// jest FORMAT I ESKAPOWANIE, nie „czy funkcja coś zwróciła":
//
//   1. Cztery znaki specjalne RFC 5545 (`\`, `;`, `,`, złamanie linii)
//      w TYTULE i w OPISIE - oba pola idą od redaktora, oba trafiają do
//      wartości tekstowej ICS.
//   2. Te same znaki w GŁĘBOKICH LINKACH nie mogą dostać eskejpowania ICS:
//      tam obowiązuje procentowanie URL, a backslash przed przecinkiem
//      pojawiłby się w tytule wydarzenia u odbiorcy dosłownie.
//   3. Strefa czasowa: wszystko jedzie w UTC z sufiksem `Z`, także dla daty
//      podanej z przesunięciem (`+02:00`) - klient przelicza sam.
//   4. Wydarzenie BEZ `ends_at` dostaje godzinę domyślną w KAŻDEJ z trzech
//      ścieżek (ICS, Google, Outlook), bo rozjazd między nimi znaczy trzy
//      różne końce tego samego wydarzenia w trzech kalendarzach.
//   5. Brak lokalizacji / opisu / adresu: pole ma ZNIKNĄĆ, a nie pojechać
//      puste - pusty `LOCATION:` i pusty `location=` w linku pokazują
//      w kalendarzu pustą etykietę miejsca.
//
// CO JEST ATRAPOWANE I DLACZEGO. `downloadIcs` jest jedyną funkcją modułu
// dotykającą DOM i przeglądarkowego API: `URL.createObjectURL` w happy-dom
// tworzy prawdziwy wpis w rejestrze obiektów, a `anchor.click()` na linku
// z `download` to próba nawigacji. Obie są tu podmienione szpiegami - test
// czyta Blob, który POWSTAŁ, zamiast udawać, że go widzi. Żadnego wyjścia
// do sieci ten plik nie robi (i nie ma czym: moduł nie zna fetcha).
//
// GRANICA DOWODU. Nie sprawdzamy, czy Google/Outlook przyjmą link (to jest
// kontrakt cudzego serwisu) - tylko czy nasza strona kontraktu jest spełniona:
// host, komplet parametrów i wartości wracające z parsera bit w bit takie,
// jakie wpisał redaktor. Warstwę komponentu pokrywa
// `src/components/community/__tests__/AddToCalendar.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEventIcs,
  downloadIcs,
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

// --- ESKAPOWANIE RFC 5545 W POLACH REDAKTORA --------------------------------

/**
 * Tytuł, w którym siedzą WSZYSTKIE cztery znaki wymagające eskejpowania
 * w wartości tekstowej ICS. Taki tytuł jest realny (dwukropek, przecinek
 * i średnik to typowa polska interpunkcja nagłówka panelu), a każdy z nich
 * bez ucieczki znaczy w gramatyce ICS co innego niż litera.
 */
const NASTY_TITLE = "Panel: prawo, ryzyko; wersja C:\\dane\nlinia druga";

describe("eskapowanie tekstu w ICS", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");

  it("SUMMARY eskejpuje backslash, przecinek, średnik i złamanie linii", () => {
    const ics = buildEventIcs({ ...BASE, title: NASTY_TITLE }, now);
    const unfolded = ics.split("\r\n ").join("");
    // Kolejność ucieczek ma znaczenie: backslash musi być podwojony PIERWSZY,
    // inaczej „\\," wyszłoby jako „\\\\,” albo jako niepoprawne „\\\,”.
    expect(unfolded).toContain("SUMMARY:Panel: prawo\\, ryzyko\\; wersja C:\\\\dane\\nlinia druga");
    // Kontrola negatywna na sam sedno defektu: w całym dokumencie nie ma
    // ANI JEDNEGO przecinka bez poprzedzającego backslasha wewnątrz wartości.
    const summary = unfolded.split("\r\n").find((l) => l.startsWith("SUMMARY:")) ?? "";
    expect(summary.replace(/\\[\\,;n]/g, "")).not.toContain(",");
    expect(summary.replace(/\\[\\,;n]/g, "")).not.toContain(";");
  });

  it("DESCRIPTION eskejpuje te same znaki i zwija CRLF do jednego \\n", () => {
    const ics = buildEventIcs(
      { ...BASE, description: "a\\b;c,d\r\ne\rf\ng", location: null, url: null },
      now,
    );
    const unfolded = ics.split("\r\n ").join("");
    expect(unfolded).toContain("DESCRIPTION:a\\\\b\\;c\\,d\\ne\\nf\\ng");
  });

  it("wartość po odwinięciu składania daje z powrotem oryginał redaktora", () => {
    // Dowód end-to-end na parę „escape + fold": bierzemy długi tytuł ze znakami
    // specjalnymi i diakrytykami, odwijamy złożenie i cofamy ucieczki - musi
    // wyjść dokładnie to, co wpisano. Bez tego składanie mogłoby rozciąć samą
    // sekwencję ucieczki („\\" na granicy 75 oktetu) i zepsuć wartość.
    const title = `Debata: ${"żółć, ćma; ".repeat(12)}koniec`;
    const ics = buildEventIcs({ ...BASE, title }, now);
    const line = ics
      .split("\r\n ")
      .join("")
      .split("\r\n")
      .find((l) => l.startsWith("SUMMARY:"));
    const roundTrip = (line ?? "")
      .slice("SUMMARY:".length)
      .replace(/\\n/g, "\n")
      .replace(/\\([,;\\])/g, "$1");
    expect(roundTrip).toBe(title);
  });

  it("puste pola opcjonalne (sam biały znak) NIE trafiają do dokumentu", () => {
    const ics = buildEventIcs({ ...BASE, description: "   ", location: "\t ", url: null }, now);
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("URL:");
  });

  it("bez podanego `now` DTSTAMP i tak jest poprawnym znacznikiem UTC", () => {
    // Domyślny argument `now = new Date()` to ścieżka produkcyjna: `downloadIcs`
    // woła `buildEventIcs` bez drugiego argumentu.
    const stamp = buildEventIcs(BASE)
      .split("\r\n")
      .find((l) => l.startsWith("DTSTAMP:"));
    expect(stamp).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  });
});

describe("strefa czasowa", () => {
  it("data podana z przesunięciem lokalnym jedzie do ICS jako UTC", () => {
    // 18:30 czasu brukselskiego latem (+02:00) to 16:30 UTC. Klient kalendarza
    // przelicza z powrotem sam - my nie wysyłamy VTIMEZONE, więc wartość MUSI
    // być w UTC, inaczej wydarzenie przesuwa się o dwie godziny.
    const ics = buildEventIcs(
      { ...BASE, startsAt: new Date("2026-09-15T18:30:00+02:00"), endsAt: null },
      new Date("2026-07-21T12:00:00.000Z"),
    );
    expect(ics).toContain("DTSTART:20260915T163000Z");
    expect(ics).toContain("DTEND:20260915T173000Z");
    // Zero deklaracji strefy - gdyby się pojawiła, sufiks „Z” byłby sprzeczny.
    expect(ics).not.toContain("VTIMEZONE");
    expect(ics).not.toContain("TZID");
  });

  it("Outlook dostaje ten sam moment w ISO 8601 z sufiksem Z", () => {
    const url = new URL(
      outlookCalendarUrl({ ...BASE, startsAt: new Date("2026-09-15T18:30:00+02:00") }),
    );
    expect(url.searchParams.get("startdt")).toBe("2026-09-15T16:30:00.000Z");
  });
});

describe("wydarzenie bez godziny zakończenia", () => {
  it("Google dostaje zakres z domyślną godziną, nie pustą drugą połowę", () => {
    const url = new URL(googleCalendarUrl({ ...BASE, endsAt: null }));
    expect(url.searchParams.get("dates")).toBe("20260915T160000Z/20260915T170000Z");
  });

  it("Outlook dostaje enddt godzinę po starcie", () => {
    const url = new URL(outlookCalendarUrl({ ...BASE, endsAt: undefined }));
    expect(url.searchParams.get("enddt")).toBe("2026-09-15T17:00:00.000Z");
  });

  it("wszystkie trzy ścieżki mówią o TYM SAMYM końcu wydarzenia", () => {
    // Trzy niezależne wyliczenia domyślnego czasu trwania to trzy okazje do
    // rozjazdu; ten test wiąże je jedną asercją.
    const input: CalendarEventInput = { ...BASE, endsAt: null };
    const ics = buildEventIcs(input, new Date("2026-07-21T12:00:00.000Z"));
    const google = new URL(googleCalendarUrl(input)).searchParams.get("dates") ?? "";
    const outlook = new URL(outlookCalendarUrl(input)).searchParams.get("enddt") ?? "";
    expect(ics).toContain("DTEND:20260915T170000Z");
    expect(google.split("/")[1]).toBe("20260915T170000Z");
    expect(toIcsUtc(new Date(outlook))).toBe("20260915T170000Z");
  });
});

describe("głębokie linki bez lokalizacji i bez opisu", () => {
  const BARE: CalendarEventInput = {
    uid: "u-bare",
    title: "Spotkanie zamknięte",
    startsAt: new Date("2026-09-15T16:00:00.000Z"),
    endsAt: null,
    description: "   ",
    location: "   ",
    url: null,
  };

  it("Google pomija `location` i `details`, zamiast wysyłać puste", () => {
    const url = new URL(googleCalendarUrl(BARE));
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.has("details")).toBe(false);
    expect(url.searchParams.get("text")).toBe("Spotkanie zamknięte");
  });

  it("Outlook pomija `location` i `body`, zamiast wysyłać puste", () => {
    const url = new URL(outlookCalendarUrl(BARE));
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.has("body")).toBe(false);
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("path")).toBe("/calendar/action/compose");
  });

  it("sam adres kanoniczny wystarczy, żeby opis linku powstał", () => {
    const withUrl: CalendarEventInput = { ...BARE, url: "https://example.com/events/x" };
    expect(new URL(googleCalendarUrl(withUrl)).searchParams.get("details")).toBe(
      "https://example.com/events/x",
    );
    expect(new URL(outlookCalendarUrl(withUrl)).searchParams.get("body")).toBe(
      "https://example.com/events/x",
    );
  });
});

describe("linki NIE dostają eskejpowania ICS", () => {
  it("przecinek i średnik w tytule jadą procentowane, bez backslashy", () => {
    const raw = googleCalendarUrl({ ...BASE, title: NASTY_TITLE });
    const url = new URL(raw);
    // Surowy query string: procentowanie URL, a nie ucieczki RFC 5545.
    expect(raw).toContain("%2C");
    expect(raw).not.toContain("%5C%2C");
    // Po sparsowaniu wraca DOKŁADNIE to, co wpisał redaktor - włącznie
    // z backslashem, który w ICS jest podwajany, a tu nie ma prawa być.
    expect(url.searchParams.get("text")).toBe(NASTY_TITLE);
  });

  it("Outlook: tytuł i lokalizacja wracają z parsera bit w bit", () => {
    const url = new URL(
      outlookCalendarUrl({ ...BASE, title: NASTY_TITLE, location: "Sala A, piętro 2; wejście C" }),
    );
    expect(url.searchParams.get("subject")).toBe(NASTY_TITLE);
    expect(url.searchParams.get("location")).toBe("Sala A, piętro 2; wejście C");
  });

  it("opis i adres sklejają się dwoma złamaniami linii, bez `\\n` z ICS", () => {
    const url = new URL(googleCalendarUrl(BASE));
    expect(url.searchParams.get("details")).toBe(
      `${(BASE.description ?? "").trim()}\n\n${BASE.url ?? ""}`,
    );
    expect(url.searchParams.get("details")).not.toContain("\\n");
  });
});

// --- POBRANIE PLIKU ---------------------------------------------------------

describe("downloadIcs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("buduje Blob z typem kalendarza, klika kotwicę i sprząta po sobie", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/kalendarz");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    // Kliknięcie kotwicy z `download` to w happy-dom próba nawigacji - szpieg
    // zatrzymuje ją i JEDNOCZEŚNIE utrwala stan elementu w chwili kliknięcia,
    // bo produkcja usuwa go natychmiast potem.
    const clicked: Array<{ href: string; download: string; inDom: boolean }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({
        href: this.getAttribute("href") ?? "",
        download: this.getAttribute("download") ?? "",
        inDom: this.isConnected,
      });
    });

    downloadIcs({ ...BASE, title: NASTY_TITLE }, icsFileName("AI Act 2026"));

    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked[0]).toEqual({
      href: "blob:test/kalendarz",
      download: "ai-act-2026.ics",
      // Kotwica MUSI być w dokumencie w chwili kliknięcia - odpięty element
      // nie wywoła pobrania w części przeglądarek.
      inDom: true,
    });
    // Po pobraniu ani śladu: żadnej sierocej kotwiki i żadnego żywego blob URL
    // (wyciek pamięci trzymający cały dokument ICS do przeładowania karty).
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/kalendarz");

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new Error("test: oczekiwano Bloba");
    expect(blob.type).toBe("text/calendar;charset=utf-8");
    const text = await blob.text();
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.split("\r\n ").join("")).toContain("SUMMARY:Panel: prawo\\, ryzyko\\;");
  });
});

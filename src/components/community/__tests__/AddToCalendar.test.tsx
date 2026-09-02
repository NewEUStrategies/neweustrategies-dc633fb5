// „Dodaj do kalendarza" na stronie wydarzenia - trzy ścieżki wyjścia z danymi.
//
// PO CO TEN PLIK ISTNIEJE. To jedyne miejsce, w którym dane wydarzenia
// OPUSZCZAJĄ platformę w formacie, którego nikt po naszej stronie już nie
// zwaliduje: plik ICS ląduje w Apple Calendar albo Thunderbirdzie, a dwa linki
// w cudzych formularzach Google i Microsoftu. Skutkiem błędu nie jest wyjątek
// w konsoli, tylko wpis w kalendarzu GOŚCIA - z uciętym tytułem, złą godziną
// albo w ogóle nieimportowalny. Dlatego przedmiotem dowodu jest TREŚĆ, która
// wychodzi, a nie to, czy popover się otworzył:
//
//   1. ESKAPOWANIE RFC 5545 W PLIKU. Tytuł i opis pochodzą od redaktora
//      i regularnie mają przecinki i średniki („Panel: prawo, ryzyko; część 2").
//      Niezaeskejpowany przecinek rozcina wartość SUMMARY na dwie - test czyta
//      BLOB, który naprawdę powstał, a nie napis zbudowany obok komponentu.
//   2. LINKI DOSTAJĄ TEKST SUROWY. W URL-u obowiązuje procentowanie, nie
//      ucieczki ICS; backslash przed przecinkiem trafiłby do tytułu wydarzenia
//      u odbiorcy dosłownie. Sprawdzamy round-trip przez parser URL.
//   3. STREFA CZASOWA. `starts_at` to timestamptz - do kalendarza jedzie UTC
//      z sufiksem `Z`, także dla daty zapisanej z przesunięciem.
//   4. WYDARZENIE BEZ `ends_at` i BEZ LOKALIZACJI. Pierwsze dostaje godzinę
//      domyślną (spójnie w trzech ścieżkach), drugie ma pole ZNIKNĄĆ, a nie
//      pojechać puste.
//   5. JĘZYK KARTY. Prop `lang` wybiera tytuł i opis z pary PL/EN wraz
//      z awaryjnym przejściem na drugi język, gdy wersja jest pusta - inaczej
//      anglojęzyczny gość dostaje wpis bez nazwy.
//
// CO JEST ATRAPOWANE I DLACZEGO.
//   * `@/components/ui/popover` - Radix pod happy-dom nie otwiera warstwy
//     (potrzebuje pomiarów układu i pełnego API wskaźnika), a otwarcie jest
//     warunkiem dojścia do trzech opcji. Atrapa obsługuje tryb STEROWANY, bo
//     taki jest w produkcji, i dzięki temu widać też zamykanie po wyborze.
//   * `URL.createObjectURL` / `URL.revokeObjectURL` / `HTMLAnchorElement#click`
//     - pobranie pliku. happy-dom tworzy prawdziwy wpis w rejestrze obiektów,
//     a kliknięcie kotwicy z `download` to próba nawigacji. Szpiedzy zatrzymują
//     jedno i drugie, ale generacja ICS zostaje PRAWDZIWA - to ona jest tu
//     dowodzona.
//   * Nic więcej. Tłumaczenia idą z prawdziwej instancji i18next (`@/test/i18nReal`),
//     więc zniknięcie klucza ze słownika oblewa test; żadnego wyjścia do sieci
//     ten plik nie ma.
//
// GRANICA DOWODU. Reguły generacji (składanie linii po 75 oktetach, domyślna
// godzina, nazwa pliku) mają własny dowód w `src/lib/community/calendar.test.ts`;
// tutaj sprawdzamy, że komponent podaje im WŁAŚCIWE dane wydarzenia i że nic
// po drodze ich nie psuje.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/ui/popover", async () => {
  const react = await import("react");
  const Ctx = react.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({
    open: false,
    setOpen: () => undefined,
  });
  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => {
      const [internal, setInternal] = react.useState(false);
      const isOpen = open ?? internal;
      const setOpen = (next: boolean) => {
        if (open === undefined) setInternal(next);
        onOpenChange?.(next);
      };
      return <Ctx.Provider value={{ open: isOpen, setOpen }}>{children}</Ctx.Provider>;
    },
    PopoverTrigger: ({ asChild, children }: { asChild?: boolean; children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      const toggle = () => ctx.setOpen(!ctx.open);
      if (asChild === true && react.isValidElement<{ onClick?: () => void }>(children)) {
        return react.cloneElement(children, { onClick: toggle });
      }
      return (
        <button type="button" onClick={toggle}>
          {children}
        </button>
      );
    },
    PopoverContent: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return ctx.open ? <div data-testid="calendar-popover">{children}</div> : null;
    },
  };
});

import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { publicEventRow } from "@/test/events/publicEventRow";
import type { PublicEvent } from "@/lib/community/publicQueries";
import { AddToCalendar } from "../AddToCalendar";

const tPl = realT("pl");
const tEn = realT("en");

/** Tytuł z kompletem znaków, które w ICS znaczą coś innego niż litera. */
const NASTY_TITLE = "Panel: prawo, ryzyko; wersja C:\\dane";

const ORIGIN = window.location.origin;

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return publicEventRow({
    id: "22222222-2222-4222-8222-222222222222",
    slug: "ai-act-w-praktyce",
    title_pl: "Briefing: AI Act w praktyce",
    title_en: "Briefing: the AI Act in practice",
    description_pl: "Sesja pytań; odpowiedzi ekspertów, część 1\nDruga linia.",
    description_en: "Q&A with experts, part 1",
    starts_at: "2099-09-15T16:00:00.000Z",
    ends_at: "2099-09-15T17:30:00.000Z",
    location: "Bruksela, Rue de la Loi 200",
    ...overrides,
  });
}

function renderCard(overrides: Partial<PublicEvent> = {}, lang: "pl" | "en" = "pl") {
  return render(<AddToCalendar event={event(overrides)} lang={lang} />);
}

/** Otwiera warstwę i oddaje trzy jej wyjścia. */
function open(overrides: Partial<PublicEvent> = {}, lang: "pl" | "en" = "pl") {
  const utils = renderCard(overrides, lang);
  fireEvent.click(screen.getByRole("button", { name: tPl("community.events.calendarAdd") }));
  const google = screen.getByRole("link", { name: tPl("community.events.calendarGoogle") });
  const outlook = screen.getByRole("link", { name: tPl("community.events.calendarOutlook") });
  const ics = screen.getByRole("button", { name: tPl("community.events.calendarIcs") });
  return { ...utils, google, outlook, ics };
}

/** Szpiedzy pobrania pliku - oddają Blob, który NAPRAWDĘ powstał. */
function spyDownload() {
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/ics");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  const anchors: Array<{ download: string; href: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchors.push({
      download: this.getAttribute("download") ?? "",
      href: this.getAttribute("href") ?? "",
    });
  });
  return {
    anchors,
    async icsText(): Promise<string> {
      const blob = createObjectURL.mock.calls[0]?.[0];
      if (!(blob instanceof Blob)) throw new Error("test: nie powstał Blob z plikiem ICS");
      // Odwinięte składanie linii - asercje mówią o WARTOŚCIACH, nie o tym,
      // w którym miejscu RFC kazał złamać wiersz.
      return (await blob.text()).split("\r\n ").join("");
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("wejście w warstwę", () => {
  it("startuje zamknięty - żadnej opcji nie da się kliknąć na ślepo", () => {
    renderCard();
    expect(screen.queryByTestId("calendar-popover")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("wyzwalacz ma nazwę ze słownika, a warstwa - nagłówek wyboru kalendarza", () => {
    const { google, outlook, ics } = open();
    expect(screen.getByText(tPl("community.events.calendarPick"))).toBeInTheDocument();
    expect(google).toHaveAttribute("target", "_blank");
    expect(google).toHaveAttribute("rel", "noreferrer");
    expect(outlook).toHaveAttribute("target", "_blank");
    expect(ics).toHaveAttribute("type", "button");
  });

  it("wybór pliku ICS zamyka warstwę - lista opcji nie zostaje otwarta nad stroną", () => {
    spyDownload();
    const { ics } = open();
    fireEvent.click(ics);
    expect(screen.queryByTestId("calendar-popover")).toBeNull();
  });

  it("wybór Google i Outlook też zamyka warstwę", () => {
    // Nawigacja jest tu zatrzymana na poziomie dokumentu: link ma
    // `target="_blank"`, a happy-dom próbowałby otworzyć okno. Przedmiotem
    // dowodu jest STAN WARSTWY po wyborze, nie nawigacja przeglądarki.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("click", stop);
    try {
      const first = open();
      fireEvent.click(first.google);
      expect(screen.queryByTestId("calendar-popover")).toBeNull();
      cleanup();

      const second = open();
      fireEvent.click(second.outlook);
      expect(screen.queryByTestId("calendar-popover")).toBeNull();
    } finally {
      document.removeEventListener("click", stop);
    }
  });

  it("napisy są w słowniku PL i EN, a na ekranie nie ma surowego klucza", () => {
    open();
    for (const key of [
      "community.events.calendarAdd",
      "community.events.calendarPick",
      "community.events.calendarGoogle",
      "community.events.calendarOutlook",
      "community.events.calendarIcs",
    ]) {
      expect(tPl(key), `brak klucza PL: ${key}`).not.toBe(key);
      expect(tEn(key), `brak klucza EN: ${key}`).not.toBe(key);
    }
    expect(document.body.textContent ?? "").not.toContain("community.events.");
  });

  it("nie wnosi naruszeń dostępności przy otwartej warstwie", async () => {
    const { container } = open();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("głębokie linki", () => {
  it("Google dostaje komplet: zakres UTC, miejsce i opis z adresem strony", () => {
    const { google } = open();
    const url = new URL(google.getAttribute("href") ?? "");
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Briefing: AI Act w praktyce");
    expect(url.searchParams.get("dates")).toBe("20990915T160000Z/20990915T173000Z");
    expect(url.searchParams.get("location")).toBe("Bruksela, Rue de la Loi 200");
    // Kanoniczny adres wydarzenia jedzie z ORIGINU BIEŻĄCEJ STRONY - link
    // wysłany ze środowiska podglądowego musi prowadzić do podglądu.
    expect(url.searchParams.get("details")).toBe(
      `Sesja pytań; odpowiedzi ekspertów, część 1\nDruga linia.\n\n${ORIGIN}/events/ai-act-w-praktyce`,
    );
  });

  it("Outlook dostaje ten sam moment w ISO 8601", () => {
    const { outlook } = open();
    const url = new URL(outlook.getAttribute("href") ?? "");
    expect(url.hostname).toBe("outlook.live.com");
    expect(url.searchParams.get("subject")).toBe("Briefing: AI Act w praktyce");
    expect(url.searchParams.get("startdt")).toBe("2099-09-15T16:00:00.000Z");
    expect(url.searchParams.get("enddt")).toBe("2099-09-15T17:30:00.000Z");
  });

  it("przecinek i średnik w tytule NIE dostają ucieczek ICS w adresie", () => {
    const { google, outlook } = open({ title_pl: NASTY_TITLE });
    const href = google.getAttribute("href") ?? "";
    expect(href).toContain("%2C");
    // `%5C%2C` / `%5C%3B` = przecinek i średnik zaeskejpowane po ICS-owemu
    // w URL-u. Gdyby tam były, gość zobaczyłby w tytule wydarzenia backslash.
    // Sam `%5C` w adresie JEST poprawny - to backslash wpisany przez redaktora
    // („C:\dane"), i on też musi dojechać pojedynczy, a nie podwojony.
    expect(href).not.toContain("%5C%2C");
    expect(href).not.toContain("%5C%3B");
    expect(href).not.toContain("%5C%5C");
    expect(new URL(href).searchParams.get("text")).toBe(NASTY_TITLE);
    expect(new URL(outlook.getAttribute("href") ?? "").searchParams.get("subject")).toBe(
      NASTY_TITLE,
    );
  });
});

describe("plik ICS", () => {
  it("pobiera się pod nazwą ze sluga i niesie zaeskejpowaną treść wydarzenia", async () => {
    const spy = spyDownload();
    const { ics } = open({ title_pl: NASTY_TITLE });
    fireEvent.click(ics);

    expect(spy.anchors).toEqual([{ download: "ai-act-w-praktyce.ics", href: "blob:test/ics" }]);
    const text = await spy.icsText();
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("SUMMARY:Panel: prawo\\, ryzyko\\; wersja C:\\\\dane");
    expect(text).toContain("DESCRIPTION:Sesja pytań\\; odpowiedzi ekspertów\\, część 1\\nDruga");
    expect(text).toContain("LOCATION:Bruksela\\, Rue de la Loi 200");
    // UID stabilny per wydarzenie - ponowny import aktualizuje wpis zamiast
    // dokładać drugi.
    expect(text).toContain("UID:22222222-2222-4222-8222-222222222222@");
    expect(text).toContain(`URL:${ORIGIN}/events/ai-act-w-praktyce`);
  });

  it("czas jedzie w UTC także dla daty zapisanej z przesunięciem strefowym", async () => {
    const spy = spyDownload();
    // 18:30 w Brukseli latem to 16:30 UTC. `timezone` wydarzenia jest etykietą
    // dla prezentacji - do kalendarza idzie moment, nie napis.
    const { ics } = open({
      starts_at: "2099-09-15T18:30:00+02:00",
      ends_at: "2099-09-15T20:00:00+02:00",
      timezone: "Europe/Brussels",
    });
    fireEvent.click(ics);
    const text = await spy.icsText();
    expect(text).toContain("DTSTART:20990915T163000Z");
    expect(text).toContain("DTEND:20990915T180000Z");
    expect(text).not.toContain("TZID");
  });
});

describe("wydarzenie niekompletne", () => {
  it("bez godziny zakończenia: trzy ścieżki mówią o tym samym końcu (+1 h)", async () => {
    const spy = spyDownload();
    const { google, outlook, ics } = open({ ends_at: null });
    expect(new URL(google.getAttribute("href") ?? "").searchParams.get("dates")).toBe(
      "20990915T160000Z/20990915T170000Z",
    );
    expect(new URL(outlook.getAttribute("href") ?? "").searchParams.get("enddt")).toBe(
      "2099-09-15T17:00:00.000Z",
    );
    fireEvent.click(ics);
    expect(await spy.icsText()).toContain("DTEND:20990915T170000Z");
  });

  it("bez lokalizacji: pole znika z pliku i z obu linków", async () => {
    const spy = spyDownload();
    const { google, outlook, ics } = open({ location: null });
    expect(new URL(google.getAttribute("href") ?? "").searchParams.has("location")).toBe(false);
    expect(new URL(outlook.getAttribute("href") ?? "").searchParams.has("location")).toBe(false);
    fireEvent.click(ics);
    // Puste `LOCATION:` pokazuje w kalendarzu pustą etykietę miejsca - to nie
    // to samo, co brak miejsca.
    expect(await spy.icsText()).not.toContain("LOCATION:");
  });

  it("uszkodzona data startu chowa CAŁY przycisk zamiast oferować pusty wpis", () => {
    renderCard({ starts_at: "nie-data" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent ?? "").toBe("");
  });
});

describe("język karty kalendarza", () => {
  it("EN bierze wersję angielską tytułu i opisu", async () => {
    const spy = spyDownload();
    const { google, ics } = open({}, "en");
    expect(new URL(google.getAttribute("href") ?? "").searchParams.get("text")).toBe(
      "Briefing: the AI Act in practice",
    );
    fireEvent.click(ics);
    const text = await spy.icsText();
    expect(text).toContain("SUMMARY:Briefing: the AI Act in practice");
    expect(text).toContain("DESCRIPTION:Q&A with experts\\, part 1");
  });

  it("pusta wersja językowa spada na drugi język, a nie na pusty tytuł", () => {
    const { google } = open({ title_en: "" }, "en");
    expect(new URL(google.getAttribute("href") ?? "").searchParams.get("text")).toBe(
      "Briefing: AI Act w praktyce",
    );
    cleanup();

    const pl = open({ title_pl: "" }, "pl");
    expect(new URL(pl.google.getAttribute("href") ?? "").searchParams.get("text")).toBe(
      "Briefing: the AI Act in practice",
    );
  });
});

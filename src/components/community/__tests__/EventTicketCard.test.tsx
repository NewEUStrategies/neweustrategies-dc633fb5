// Karta potwierdzenia rezerwacji na stronie wydarzenia („mój bilet").
//
// CO JEST PRZEDMIOTEM DOWODU. Ta karta jest jedynym miejscem w serwisie, które
// pokazuje uczestnikowi jego WŁASNE dane osobowe razem z numerem transakcji
// i numerem potwierdzenia. Trzy rzeczy są tu warte testu, a żadna z nich nie
// jest „czy się wyrenderowało":
//
//   1. BRAK KODU QR (REG-12, kryterium audytu „brak ticketQrPayload w UI").
//      Dawniej karta rysowała QR z numerem `NES-…` w adresie `?ticket=`, którego
//      skaner przy bramce nie zna - każdy skan był „nieznanym kodem" liczonym
//      do blokady urządzenia. Karta nie rysuje już żadnego obrazka, nie woła
//      generatora kodu, a zamiast tego mówi, gdzie jest prawdziwy kod wejścia
//      (`ticket.entry`). Statyczny skan `src/` pilnuje, że funkcja budująca tamten
//      adres nie wraca.
//
//   2. KTÓRE RUBRYKI ZNIKAJĄ. Bilet bezpłatny nie ma kwoty ani numeru
//      transakcji, wydarzenie online nie ma miejsca. Pusta rubryka na
//      potwierdzeniu wygląda jak brakujące dane, więc każdy wiersz jest
//      warunkowy - i każdy warunek ma tu własny opis.
//
//   3. RZĄD WIELKOŚCI KWOTY. Ta sama pułapka co przy zakupie: kwota leży
//      w groszach. Asercja jest na literale (`1,00 zł`), nie na wyniku tej
//      samej funkcji, którą liczy komponent.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * `@tanstack/react-start` -> `useServerFn` zwraca przekazaną funkcję, więc
//     atrapa `getMyEventTicket` jest wołana pod własną nazwą;
//   * `qrcode` - atrapa ZOSTAJE, żeby dowieść, że karta nie woła generatora
//     kodu wcale (gdyby ktoś przywrócił QR, test zobaczy wywołanie);
//   * `@tanstack/react-router` -> `Link` jako zwykły `<a>` (karta nie stoi tu
//     w drzewie tras);
//   * `./ticketDocument` - ma WŁASNY test (ucieczka znaków w pliku HTML, 100%);
//     tutaj dowodzimy tylko tego, CO karta mu podaje i pod jaką nazwą pliku.
//     Powtarzanie tam asercji o treści dokumentu byłoby duplikatem.
//   * `react-i18next` - PRAWDZIWY tłumacz (`realT`).
//
// RODO: fixture jest jawnie zmyślony (nazwisko „Przykładowska", adres
// `@example.org`, numer transakcji bez związku z operatorem). Żadna wartość
// w tym pliku nie wygląda na prawdziwą osobę.
//
// GRANICA DOWODU: nic tutaj nie dowodzi, że backend pokazuje bilet TYLKO
// właścicielowi - to trzyma RLS i `loadMyEventTicket` (własne testy warstwy
// serwerowej). Ten plik odpowiada za to, co widzi posiadacz biletu.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { MyEventTicket } from "@/lib/events/ticketTypes";
import type { TicketDocumentInput } from "@/components/community/ticketDocument";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
  loadTicket: vi.fn(),
  // Atrapy z PODPISEM, nie gołe `vi.fn()`: dzięki temu `mock.calls[0][0]`
  // ma typ i asercje o argumentach obywają się bez rzutowania.
  toDataURL:
    vi.fn<(text: string, options?: { width?: number; margin?: number }) => Promise<string>>(),
  buildDoc: vi.fn<(input: TicketDocumentInput) => string>(),
  downloadDoc: vi.fn<(html: string, filename: string) => void>(),
}));

// FABRYKA NIC NIE IMPORTUJE - skrót `reactI18nextMock()` w fabryce ZAKLESZCZA
// plik, bo sięga po `@/lib/i18n`, a ten importuje mockowany moduł (ten sam
// wniosek ma `community/__tests__/ReputationLevelChip.test.tsx`). Prawdziwy `t`
// jest wstrzykiwany do atrapy pod importami.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
// Częściowa atrapa: reszta pakietu (`createIsomorphicFn`, na którym stoi
// `@/lib/i18n`) musi zostać prawdziwa. Podmieniamy WYŁĄCZNIE `useServerFn`,
// i to na identyczność - dzięki temu atrapy server fn są wołane pod własnymi
// nazwami i w asercji widać, KTÓRA z nich poszła.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/lib/events/ticket.functions", () => ({ getMyEventTicket: h.loadTicket }));
vi.mock("qrcode", () => ({ default: { toDataURL: h.toDataURL } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/community/ticketDocument", () => ({
  buildTicketDocument: h.buildDoc,
  downloadTicketDocument: h.downloadDoc,
}));

import { EventTicketCard } from "@/components/community/EventTicketCard";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { EVENT_IDS } from "@/test/events/fixtures";
import "@/lib/i18n-community";

h.fixedT = realT;

const QR_PNG = "data:image/png;base64,QUFB";
const CODE = "NES-1A2B-3C4D";

/**
 * Bilet w kształcie, jaki wraca z `getMyEventTicket`. Dane są jawnie zmyślone -
 * karta niesie dane osobowe, więc fixture nie może przypominać nikogo realnego.
 * Termin celowo w POŁOWIE miesiąca: przesunięcie strefowe maszyny (±14 h) nie
 * może wtedy przenieść daty do innego miesiąca i asercje o nazwie miesiąca są
 * niezależne od `TZ` runnera.
 */
function ticket(overrides: Partial<MyEventTicket> = {}): MyEventTicket {
  return {
    eventId: EVENT_IDS.event,
    slug: "szczyt-energetyczny",
    titlePl: "Szczyt energetyczny",
    titleEn: "Energy summit",
    startsAt: "2026-09-15T12:00:00.000Z",
    endsAt: null,
    timezone: "Europe/Warsaw",
    location: "Bruksela, sala Europa",
    code: CODE,
    transactionId: "tx_zmyslone_0001",
    amountCents: 12_000,
    currency: "PLN",
    paidAt: "2026-09-01T10:00:00.000Z",
    holderName: "Ada Przykładowska",
    holderEmail: "ada.przykladowska@example.org",
    entry: "emailed_qr",
    ...overrides,
  };
}

function renderCard(props: { eventId?: string; enabled?: boolean } = {}) {
  return renderWithQueryClient(
    <EventTicketCard
      eventId={props.eventId ?? EVENT_IDS.event}
      lang={h.lang}
      enabled={props.enabled ?? true}
    />,
  );
}

/**
 * Wartość rubryki listy definicyjnej - po etykiecie ze SŁOWNIKA.
 *
 * Odstępy są normalizowane, bo `Intl` wstawia przed symbolem waluty spację
 * NIEROZDZIELAJĄCĄ. Asercja na surowym tekście mierzyłaby kodowanie spacji,
 * a nie kwotę - a to jest inny przedmiot dowodu niż rząd wielkości.
 */
function rowValue(container: HTMLElement, label: string): string | null {
  const dt = Array.from(container.querySelectorAll("dt")).find((el) => el.textContent === label);
  const value = dt?.nextElementSibling?.textContent;
  return value === undefined || value === null ? null : value.replace(/\s+/g, " ").trim();
}

function label(key: string, lang: "pl" | "en" = "pl"): string {
  return realT(lang)(`community.events.ticket.${key}`);
}

/** Karta jest asynchroniczna (odczyt biletu) - czekamy na rubryki. */
async function waitForRows(container: HTMLElement): Promise<void> {
  await waitFor(() => expect(container.querySelector("dl")).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.loadTicket.mockResolvedValue(ticket());
  h.toDataURL.mockResolvedValue(QR_PNG);
  h.buildDoc.mockReturnValue("<!doctype html>ATRAPA DOKUMENTU");
});

describe("kiedy karty nie ma", () => {
  it("wyłączona karta nie pyta nawet backendu o bilet", () => {
    // `enabled` jest zdaniem trasy: bilet pokazujemy dopiero, gdy backend
    // potwierdził wejściówkę. Zapytanie „na wszelki wypadek" byłoby odczytem
    // danych osobowych bez powodu.
    const { container } = renderCard({ enabled: false });
    expect(container).toBeEmptyDOMElement();
    expect(h.loadTicket).not.toHaveBeenCalled();
  });

  it("brak identyfikatora wydarzenia też wstrzymuje odczyt", () => {
    const { container } = renderCard({ eventId: "" });
    expect(container).toBeEmptyDOMElement();
    expect(h.loadTicket).not.toHaveBeenCalled();
  });

  it("backend bez biletu zwraca puste miejsce, a nie pustą kartę", async () => {
    h.loadTicket.mockResolvedValue(null);
    const { container } = renderCard();
    await waitFor(() =>
      expect(h.loadTicket).toHaveBeenCalledWith({ data: { eventId: EVENT_IDS.event } }),
    );
    expect(container).toBeEmptyDOMElement();
    expect(h.toDataURL).not.toHaveBeenCalled();
  });
});

/** Wszystkie pliki `.ts`/`.tsx` w `src/` poza testami - do skanu statycznego. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe("REG-12: karta NIE rysuje kodu QR (numer potwierdzenia to nie kod wejścia)", () => {
  it("brak obrazka, brak wywołania generatora kodu, brak tekstu alternatywnego QR", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(h.toDataURL).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain("?ticket=");
  });

  it("numer potwierdzenia stoi jako etykieta z wyjaśnieniem, że nie otwiera bramki", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("code"))).toBe(CODE);
    expect(label("code")).toBe("Numer potwierdzenia");
    expect(container.textContent).toContain(label("notEntryCode"));
  });

  it("`emailed_qr`: zdanie o mailu „Twój bilet” i odnośnik do listy zgłoszeń w profilu", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    expect(container.textContent).toContain(label("entryEmailedQr"));
    const link = screen.getByRole("link", { name: label("myRegistrations") });
    expect(link).toHaveAttribute("href", "/profile/tickets");
  });

  it.each([
    ["qr_pending", "entryQrPending"],
    ["contact_organizer", "entryContactOrganizer"],
    ["guest_list", "entryGuestList"],
  ] as const)("`%s` mówi swoje zdanie i nie odsyła do kodu z maila", async (entry, key) => {
    h.loadTicket.mockResolvedValue(ticket({ entry }));
    const { container } = renderCard();
    await waitForRows(container);
    expect(container.textContent).toContain(label(key));
    expect(container.textContent).not.toContain(label("entryEmailedQr"));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("pobranie jest dostępne od razu - nie czeka na żaden obrazek", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    expect(screen.getByRole("button", { name: label("download") })).toBeEnabled();
  });

  it("adres e-mail posiadacza nie trafia do DOM karty", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    expect(container.innerHTML).not.toContain("example.org");
    expect(container.textContent).toContain("Ada Przykładowska");
  });

  it("STATYCZNIE: w `src/` nie ma już `ticketQrPayload` ani QR rysowanego z numeru potwierdzenia", () => {
    // Kryterium audytu REG-12 dosłownie. Skan obejmuje cały kod produkcyjny,
    // nie tylko kartę - powrót funkcji w dowolnym innym miejscu też jest błędem.
    const offenders = sourceFiles(join(process.cwd(), "src")).filter((file) => {
      const text = readFileSync(file, "utf8");
      // Drugi warunek: plik, który rysuje QR (`qrcode`) i dotyka numeru
      // potwierdzenia (`ticketCodeFrom` / `ticket.code`) - czyli QR z numeru,
      // którego skaner nie zna, pod dowolną nową nazwą.
      const drawsQr = /from "qrcode"/.test(text);
      return (
        text.includes("ticketQrPayload") ||
        (drawsQr && /ticketCodeFrom|\bticket\.code\b/.test(text))
      );
    });
    expect(offenders).toEqual([]);
  });

  it("STATYCZNIE: moduł numeru potwierdzenia nie eksportuje `ticketQrPayload`", async () => {
    const mod = await import("@/lib/events/ticketCode");
    expect(Object.keys(mod)).not.toContain("ticketQrPayload");
  });
});

describe("rubryki potwierdzenia pochodzą z propsów i z biletu", () => {
  it("bilet płatny pokazuje numer, termin, miejsce, uczestnika, kwotę i transakcję", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("code"))).toBe(CODE);
    expect(rowValue(container, label("place"))).toBe("Bruksela, sala Europa");
    expect(rowValue(container, label("holder"))).toBe("Ada Przykładowska");
    expect(rowValue(container, label("amount"))).toBe("120,00 zł");
    expect(rowValue(container, label("transaction"))).toBe("tx_zmyslone_0001");
    expect(rowValue(container, label("date"))).toContain("września 2026");
    expect(container.textContent).toContain(label("confirmed"));
    expect(container.textContent).toContain(label("hint"));
  });

  it("bilet bezpłatny POMIJA kwotę, transakcję, miejsce i termin", async () => {
    // Pusta rubryka na potwierdzeniu wygląda jak brakujące dane.
    h.loadTicket.mockResolvedValue(
      ticket({ amountCents: null, transactionId: null, location: null, startsAt: null }),
    );
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("code"))).toBe(CODE);
    expect(rowValue(container, label("amount"))).toBeNull();
    expect(rowValue(container, label("transaction"))).toBeNull();
    expect(rowValue(container, label("place"))).toBeNull();
    expect(rowValue(container, label("date"))).toBeNull();
  });

  it("bilet bez imienia nie pokazuje pustej rubryki uczestnika", async () => {
    h.loadTicket.mockResolvedValue(ticket({ holderName: null }));
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("holder"))).toBeNull();
  });

  it("kwota zerowa jest traktowana jak brak kwoty, nie jak „0,00 zł”", async () => {
    // Zapis obecnego zachowania: wejściówka za zero nie ma o czym informować,
    // a „Kwota: 0,00 zł" na wydruku wygląda jak błąd rozliczenia.
    h.loadTicket.mockResolvedValue(ticket({ amountCents: 0 }));
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("amount"))).toBeNull();
  });

  it("sto groszy to ZŁOTÓWKA, nie sto złotych", async () => {
    h.loadTicket.mockResolvedValue(ticket({ amountCents: 100 }));
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("amount"))).toBe("1,00 zł");
  });

  it("brak waluty w wierszu spada na PLN, a nie na pustą jednostkę", async () => {
    h.loadTicket.mockResolvedValue(ticket({ currency: null }));
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("amount"))).toBe("120,00 zł");
  });

  it("kwota w innej walucie idzie z wiersza biletu", async () => {
    h.loadTicket.mockResolvedValue(ticket({ amountCents: 12_000, currency: "EUR" }));
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("amount"))).toContain("120,00");
    expect(rowValue(container, label("amount"))).not.toContain("zł");
  });
});

describe("język strony rozstrzyga tytuł i format terminu", () => {
  it("strona angielska bierze tytuł angielski i etykiety angielskie", async () => {
    h.lang = "en";
    const { container } = renderCard();
    await waitForRows(container);
    expect(rowValue(container, label("date", "en"))).toContain("September 2026");
    expect(container.textContent).toContain(realT("en")("community.events.ticket.title"));
    expect(container.textContent).not.toContain("Numer potwierdzenia");
    expect(rowValue(container, label("code", "en"))).toBe(CODE);
  });

  it("pusty tytuł angielski spada na polski, a nie na pustkę", async () => {
    // Redakcja nie zawsze tłumaczy tytuł. Bilet bez tytułu byłby wydrukiem
    // „bilet na nic".
    h.lang = "en";
    h.loadTicket.mockResolvedValue(ticket({ titleEn: "" }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: label("download", "en") }));
    const input = h.buildDoc.mock.calls[0]?.[0];
    expect(input?.title).toBe("Szczyt energetyczny");
  });
});

describe("pobranie potwierdzenia", () => {
  it("dokument dostaje bilet, język, tytuł i termin - bez żadnego kodu QR", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    fireEvent.click(await screen.findByRole("button", { name: label("download") }));
    const input = h.buildDoc.mock.calls[0]?.[0];
    expect(input?.lang).toBe("pl");
    expect(input?.title).toBe("Szczyt energetyczny");
    expect(input?.dateLabel).toContain("września 2026");
    expect(input?.ticket.code).toBe(CODE);
    expect(input === undefined ? [] : Object.keys(input)).not.toContain("qrDataUrl");
    expect(h.toDataURL).not.toHaveBeenCalled();
  });

  it("plik nazywa się numerem biletu, a nie „ticket.html”", async () => {
    // Uczestnik pobiera potwierdzenia z kilku wydarzeń do jednego katalogu.
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: label("download") }));
    expect(h.downloadDoc).toHaveBeenCalledWith("<!doctype html>ATRAPA DOKUMENTU", `${CODE}.html`);
  });
});

describe("termin biletu a strefa wydarzenia", () => {
  /** Etykieta terminu dla biletu różniącego się WYŁĄCZNIE strefą wydarzenia. */
  async function dateLabelFor(timezone: string, eventId: string): Promise<string | null> {
    h.loadTicket.mockResolvedValue(ticket({ timezone, eventId }));
    const { container, unmount } = renderCard({ eventId });
    await waitForRows(container);
    // Etykieta rubryki jest w JĘZYKU STRONY - kontrola dodatnia renderuje
    // kartę po angielsku, więc szukanie po polskim „Termin" nic by nie dało.
    const value = rowValue(container, label("date", h.lang));
    unmount();
    return value;
  }

  it("KONTROLA DODATNIA: etykieta terminu naprawdę zależy od danych", async () => {
    // Sąsiedni, poprawny przypadek: ta sama chwila w dwóch JĘZYKACH daje dwie
    // różne etykiety. Dowodzi, że porównanie etykiet potrafi wykryć różnicę -
    // czyli że test poniżej pada z powodu komponentu, nie metody pomiaru.
    const pl = await dateLabelFor("Europe/Warsaw", EVENT_IDS.event);
    h.lang = "en";
    const en = await dateLabelFor("Europe/Warsaw", EVENT_IDS.otherEvent);
    expect(pl).not.toBe(en);
    expect(pl).toContain("września");
    expect(en).toContain("September");
  });

  it.fails("ZNALEZISKO: termin liczy się w strefie WYDARZENIA, nie przeglądarki", async () => {
    // Kontrakt (EB-912, `src/lib/events/__tests__/timezoneAdoption.gate.test.ts`):
    // powierzchnia wydarzeń nie formatuje dat sama, bo `events.timezone` jest
    // autorytetem. Ta karta woła `toLocaleString` BEZ opcji `timeZone`, więc
    // godzina na bilecie to godzina PRZEGLĄDARKI - uczestnik z innej strefy
    // przyjdzie o złej porze. Dowód jest niezależny od `TZ` maszyny: dwa bilety
    // różniące się WYŁĄCZNIE strefą wydarzenia muszą dać różne etykiety.
    const warsaw = await dateLabelFor("Europe/Warsaw", EVENT_IDS.event);
    const auckland = await dateLabelFor("Pacific/Auckland", EVENT_IDS.otherEvent);
    expect(warsaw).not.toBe(auckland);
  });
});

describe("dostępność", () => {
  it("gotowa karta biletu nie ma naruszeń axe", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("karta trybu listy gości (bez odnośnika) też nie ma naruszeń axe", async () => {
    h.loadTicket.mockResolvedValue(ticket({ entry: "guest_list" }));
    const { container } = renderCard();
    await waitForRows(container);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// Karta „mój bilet" - 32 linie, do dziś 0% pokrycia.
//
// CO JEST PRZEDMIOTEM DOWODU. Ta karta jest jedynym miejscem w serwisie, które
// pokazuje uczestnikowi jego WŁASNE dane osobowe razem z numerem transakcji
// i kodem wejściowym. Trzy rzeczy są tu warte testu, a żadna z nich nie jest
// „czy się wyrenderowało":
//
//   1. CO NIESIE KOD QR. Kod jest skanowany przy wejściu przez obcą osobę
//      i bywa pokazywany z ekranu telefonu w kolejce. Wolno mu nieść WYŁĄCZNIE
//      adres weryfikacyjny z numerem biletu - nie imię, nie e-mail, nie numer
//      transakcji. Test czyta ARGUMENT, z jakim komponent woła generator kodu,
//      i sprawdza, czego w nim NIE MA.
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
//   * `qrcode` - prawdziwa biblioteka rysuje bitmapę, a nas interesuje TREŚĆ
//      kodu, nie jego piksele; atrapa pozwala też sterować momentem, w którym
//      obrazek jest gotowy (stan „QR jeszcze się liczy");
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
vi.mock("@/components/community/ticketDocument", () => ({
  buildTicketDocument: h.buildDoc,
  downloadTicketDocument: h.downloadDoc,
}));

import { EventTicketCard } from "@/components/community/EventTicketCard";
import { ticketQrPayload } from "@/lib/events/ticketCode";
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
    ...overrides,
  };
}

/**
 * Obietnica z zewnętrznym spustem - potrzebna tam, gdzie test musi ZATRZYMAĆ
 * odpowiedź w locie (odmontowanie w trakcie rysowania kodu QR). Ten sam idiom
 * co `src/components/admin/seo/__tests__/UrlInspectionWidget.test.tsx`.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

/** Karta jest asynchroniczna (bilet + rysowanie kodu) - czekamy na rubryki. */
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

describe("kod QR niesie WYŁĄCZNIE numer biletu", () => {
  it("treść kodu to adres weryfikacyjny z numerem biletu", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    await waitFor(() => expect(h.toDataURL).toHaveBeenCalled());
    const payload = h.toDataURL.mock.calls[0]?.[0];
    expect(payload).toBe(ticketQrPayload(window.location.origin, "szczyt-energetyczny", CODE));
    expect(payload).toContain(CODE);
  });

  it("w kodzie nie ma imienia, adresu e-mail ani numeru transakcji", async () => {
    // To jest cała stawka tej rubryki: kod skanuje obcy człowiek przy wejściu.
    const { container } = renderCard();
    await waitForRows(container);
    await waitFor(() => expect(h.toDataURL).toHaveBeenCalled());
    const payload = h.toDataURL.mock.calls[0]?.[0] ?? "";
    for (const secret of ["Ada", "Przykładowska", "example.org", "tx_zmyslone_0001"]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("adres e-mail posiadacza nie trafia do DOM karty", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    expect(container.innerHTML).not.toContain("example.org");
    expect(container.textContent).toContain("Ada Przykładowska");
  });

  it("tekst alternatywny obrazka mówi tylko o numerze biletu", async () => {
    renderCard();
    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", QR_PNG);
    expect(img).toHaveAccessibleName(label("qrAlt").replace("{{code}}", CODE));
  });

  it("dopóki kod się liczy, jest zastępnik i pobranie jest zablokowane", async () => {
    // Potwierdzenie BEZ kodu QR jest bezużyteczne przy wejściu, więc przycisk
    // pobrania czeka na obrazek.
    h.toDataURL.mockReturnValue(new Promise<string>(() => {}));
    const { container } = renderCard();
    await waitForRows(container);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: label("download") })).toBeDisabled();
  });

  it("odmontowanie przed dorysowaniem kodu nie aktualizuje już stanu", async () => {
    // Strażnik `cancelled` w efekcie. Bez niego React zgłasza aktualizację
    // stanu odmontowanego komponentu - a to sygnał wycieku, nie kosmetyka.
    const qr = deferred<string>();
    h.toDataURL.mockReturnValue(qr.promise);
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args[0]);
    });
    const { container, unmount } = renderCard();
    await waitForRows(container);
    await waitFor(() => expect(h.toDataURL).toHaveBeenCalled());
    unmount();
    qr.resolve(QR_PNG);
    await Promise.resolve();
    spy.mockRestore();
    expect(errors).toEqual([]);
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
    expect(container.textContent).not.toContain("Numer biletu");
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
  it("dokument dostaje bilet, język, tytuł, termin i gotowy kod QR", async () => {
    const { container } = renderCard();
    await waitForRows(container);
    fireEvent.click(await screen.findByRole("button", { name: label("download") }));
    const input = h.buildDoc.mock.calls[0]?.[0];
    expect(input?.lang).toBe("pl");
    expect(input?.title).toBe("Szczyt energetyczny");
    expect(input?.qrDataUrl).toBe(QR_PNG);
    expect(input?.dateLabel).toContain("września 2026");
    expect(input?.ticket.code).toBe(CODE);
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
    await screen.findByRole("img");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("karta z niegotowym kodem QR też nie ma naruszeń axe", async () => {
    h.toDataURL.mockReturnValue(new Promise<string>(() => {}));
    const { container } = renderCard();
    await waitForRows(container);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

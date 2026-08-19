// Numer biletu i treść kodu QR.
//
// DLACZEGO TO MA TEST, SKORO „KOD NIE JEST SEKRETEM": bo jest OBIETNICĄ.
// Uczestnik dostaje ten napis mailem, pokazuje go przy wejściu, a obsługa
// przepisuje go do wyszukiwarki. Kod, który zmienia się między mailem a
// ekranem biletu, jest gorszy niż brak kodu - wygląda na poprawny i wysyła
// człowieka z powrotem do kolejki. Determinizm jest więc tu funkcją produktu,
// nie właściwością techniczną, a `ticketCodeFrom` nie ma ani jednego wywołania
// w testach do dziś (audyt pokrycia 18.08.2026, MODUŁ 7).
import { describe, expect, it } from "vitest";
import { ticketCodeFrom, ticketQrPayload } from "@/lib/events/ticketCode";

const ORDER_ID = "55555555-5555-4555-8555-555555555555";
const RSVP_ID = "44444444-4444-4444-8444-444444444444";

/**
 * Identyfikator w kształcie UUID v4 z deterministycznego xorshifta. `crypto
 * .randomUUID()` dałby test migoczący raz na wiele przebiegów - a migoczący
 * test biletu jest gorszy niż jego brak, bo uczy zespół ignorować czerwień.
 */
function pseudoUuid(seed: number): string {
  let state = seed >>> 0 || 1;
  const nextHex = (length: number): string => {
    let out = "";
    while (out.length < length) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      out += state.toString(16).padStart(8, "0");
    }
    return out.slice(0, length);
  };
  return `${nextHex(8)}-${nextHex(4)}-4${nextHex(3)}-8${nextHex(3)}-${nextHex(12)}`;
}

describe("ticketCodeFrom", () => {
  it("jest idempotentny - ten sam identyfikator daje ten sam kod", () => {
    // Reguła numer jeden: mail wysłany w poniedziałek i ekran biletu otwarty
    // w piątek muszą pokazać ten sam napis. Kod jest wyprowadzany, nie losowany.
    expect(ticketCodeFrom(ORDER_ID)).toBe(ticketCodeFrom(ORDER_ID));
  });

  it("ma format NES-XXXX-XXXX", () => {
    expect(ticketCodeFrom(ORDER_ID)).toMatch(/^NES-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/);
  });

  it("nie używa liter I ani O - mylą się z 1 i 0 przy przepisywaniu", () => {
    // Alfabet bez I/O jest jedynym powodem, dla którego obsługa przy wejściu
    // może zaufać temu, co uczestnik podyktował przez telefon.
    const codes = [ORDER_ID, RSVP_ID, "abcdef01-2345-6789-abcd-ef0123456789"].map(ticketCodeFrom);
    for (const code of codes) {
      expect(code.slice(4)).not.toMatch(/[IO]/);
    }
  });

  it("różne identyfikatory dają różne kody", () => {
    expect(ticketCodeFrom(ORDER_ID)).not.toBe(ticketCodeFrom(RSVP_ID));
  });

  it("nie zderza kodów na 500 identyfikatorach w kształcie UUID v4", () => {
    // Nie dowód matematyczny, tylko zapora: gdyby ktoś skrócił pętlę z ośmiu
    // znaków do czterech, ta asercja zgaśnie, zanim dwie osoby dostaną ten sam
    // bilet. Generator jest DETERMINISTYCZNY (xorshift ze stałym ziarnem) -
    // test biletu nie ma prawa migotać raz na sto przebiegów.
    const ids = Array.from({ length: 500 }, (_, i) => pseudoUuid(i + 1));
    expect(new Set(ids).size).toBe(500);
    expect(new Set(ids.map(ticketCodeFrom)).size).toBe(500);
  });

  it("czyta WYŁĄCZNIE pierwsze 24 znaki szesnastkowe ziarna", () => {
    // Własność, która zaskakuje przy czytaniu kodu i której nikt dotąd nie
    // przypiął: pętla bierze osiem kawałków po trzy znaki, więc UUID (32 znaki
    // hex) oddaje do kodu tylko 24 pierwsze. Dwa zamówienia różniące się
    // wyłącznie końcówką dostaną TEN SAM numer biletu.
    //
    // Dla `gen_random_uuid()` to zdarzenie o prawdopodobieństwie rzędu 16^-8,
    // więc nie jest to defekt do naprawienia dzisiaj - ale JEST to cicha
    // właściwość, którą refaktor mógłby zmienić bez ani jednego czerwonego
    // testu, unieważniając wydrukowane bilety. Stąd asercja zamiast komentarza.
    const head = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee";
    expect(ticketCodeFrom(`${head}1111`)).toBe(ticketCodeFrom(`${head}9999`));
  });

  it("ignoruje znaki spoza zapisu szesnastkowego (myślniki UUID)", () => {
    expect(ticketCodeFrom(ORDER_ID)).toBe(ticketCodeFrom(ORDER_ID.replaceAll("-", "")));
  });

  it("nie skraca kodu dla krótkiego identyfikatora", () => {
    // Ścieżka `chunk || String(i)`: gdy zabraknie znaków wejściowych, pozycja
    // domyka się numerem indeksu zamiast zostawić puste miejsce.
    expect(ticketCodeFrom("abc")).toMatch(/^NES-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/);
  });

  it("nie wywraca się na identyfikatorze bez ani jednego znaku szesnastkowego", () => {
    // Ścieżka `Number.isNaN` - seed z samych liter spoza [0-9a-f].
    expect(ticketCodeFrom("zzz-xxx-www")).toMatch(/^NES-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/);
  });

  it("nie wywraca się na pustym identyfikatorze", () => {
    expect(ticketCodeFrom("")).toMatch(/^NES-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/);
  });

  it("czyta identyfikator bez względu na wielkość liter", () => {
    expect(ticketCodeFrom(ORDER_ID.toUpperCase())).toBe(ticketCodeFrom(ORDER_ID.toLowerCase()));
  });
});

describe("ticketQrPayload", () => {
  const CODE = "NES-1A2B-3C4D";

  it("buduje adres weryfikacyjny biletu", () => {
    expect(ticketQrPayload("https://nes.example", "szczyt-energetyczny", CODE)).toBe(
      "https://nes.example/events/szczyt-energetyczny?ticket=NES-1A2B-3C4D",
    );
  });

  it("obcina końcowe ukośniki origin", () => {
    // Origin bywa podawany z ukośnikiem (konfiguracja, `window.location.origin`
    // za proxy). Bez obcięcia kod QR prowadziłby pod `//events/...`, czyli na
    // adres protokołowo-względny - w czytniku telefonu to inny host.
    expect(ticketQrPayload("https://nes.example/", "slug", CODE)).toBe(
      "https://nes.example/events/slug?ticket=NES-1A2B-3C4D",
    );
    expect(ticketQrPayload("https://nes.example///", "slug", CODE)).toBe(
      "https://nes.example/events/slug?ticket=NES-1A2B-3C4D",
    );
  });

  it("koduje kod w parametrze zapytania", () => {
    expect(ticketQrPayload("https://nes.example", "slug", "NES 1A/2B&x")).toBe(
      "https://nes.example/events/slug?ticket=NES%201A%2F2B%26x",
    );
  });

  it("dla pustego origin daje adres względny, nie protokołowo-względny", () => {
    // SSR nie zna origin. Wynik musi zaczynać się od JEDNEGO ukośnika.
    const payload = ticketQrPayload("", "slug", CODE);
    expect(payload).toBe("/events/slug?ticket=NES-1A2B-3C4D");
    expect(payload.startsWith("//")).toBe(false);
  });
});

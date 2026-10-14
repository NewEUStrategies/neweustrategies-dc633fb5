// Numer potwierdzenia rezerwacji i bramka skanera (REG-12).
//
// DLACZEGO TO MA TEST, SKORO „KOD NIE JEST SEKRETEM": bo jest OBIETNICĄ.
// Uczestnik dostaje ten napis mailem, pokazuje go przy wejściu, a obsługa
// przepisuje go do wyszukiwarki. Kod, który zmienia się między mailem a
// ekranem biletu, jest gorszy niż brak kodu - wygląda na poprawny i wysyła
// człowieka z powrotem do kolejki. Determinizm jest więc tu funkcją produktu,
// nie właściwością techniczną, a `ticketCodeFrom` nie ma ani jednego wywołania
// w testach do dziś (audyt pokrycia 18.08.2026, MODUŁ 7).
import { describe, expect, it } from "vitest";
import {
  BOOKING_REFERENCE_PATTERN,
  assertScannableCode,
  classifyScannedCode,
  ticketCodeFrom,
} from "@/lib/events/ticketCode";

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

// BRAMKA SKANERA (REG-12, kryterium „test skanu kodu z karty"). Dawna karta na
// stronie wydarzenia rysowała QR z adresem `?ticket=NES-…`, a obsługa i goście
// przepisują numer z wydruku. Ani jedno, ani drugie nie jest kodem biletu -
// baza odrzuciłaby to jako nieznany kod i doliczyła do blokady urządzenia.
describe("classifyScannedCode / assertScannableCode", () => {
  const CARD_CODE = ticketCodeFrom(ORDER_ID);
  const OLD_CARD_QR = `https://neweuropeanstrategies.com/events/szczyt-energetyczny?ticket=${encodeURIComponent(CARD_CODE)}`;
  /** Prawdziwy kod biletu: 24 bajty base64url (`_event_new_qr_token()`). */
  const REAL_CODE = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

  it("numer potwierdzenia z karty pasuje do wzorca i jest rozpoznany", () => {
    expect(CARD_CODE).toMatch(BOOKING_REFERENCE_PATTERN);
    expect(classifyScannedCode(CARD_CODE)).toBe("booking_reference");
    expect(classifyScannedCode(` ${CARD_CODE.toLowerCase()}\n`)).toBe("booking_reference");
  });

  it("dawny QR karty (adres strony z `?ticket=NES-…`) to też numer potwierdzenia", () => {
    expect(classifyScannedCode(OLD_CARD_QR)).toBe("booking_reference");
  });

  it("inny adres (np. QR parowania urządzenia) to `url`", () => {
    expect(classifyScannedCode("https://nes.example/scanner?t=abc")).toBe("url");
    expect(classifyScannedCode("http://nes.example/events/x?ticket=nie-numer")).toBe("url");
    expect(classifyScannedCode("https://")).toBe("url");
  });

  it("prawdziwy kod biletu i kody o nietypowym kształcie rozstrzyga baza", () => {
    expect(classifyScannedCode(REAL_CODE)).toBe("candidate");
    expect(classifyScannedCode("AAA")).toBe("candidate");
    expect(classifyScannedCode("NES-1234")).toBe("candidate");
    // Alfabet numeru nie ma I ani O - napis z nimi nie jest numerem potwierdzenia.
    expect(classifyScannedCode("NES-IIII-OOOO")).toBe("candidate");
  });

  it("odmowa ma głowę `not_entry_code` - klasa „odmowa” skanera, bez ponawiania", () => {
    expect(() => assertScannableCode(CARD_CODE)).toThrow(/^not_entry_code: /);
    expect(() => assertScannableCode(OLD_CARD_QR)).toThrow(/^not_entry_code: /);
    expect(() => assertScannableCode("https://nes.example/scanner?t=abc")).toThrow(
      /^not_entry_code: /,
    );
    expect(() => assertScannableCode(REAL_CODE)).not.toThrow();
    expect(() => assertScannableCode("AAA")).not.toThrow();
  });

  it("moduł nie eksportuje już `ticketQrPayload` (kryterium „brak ticketQrPayload w UI”)", async () => {
    const mod = await import("@/lib/events/ticketCode");
    expect(Object.keys(mod)).not.toContain("ticketQrPayload");
  });
});

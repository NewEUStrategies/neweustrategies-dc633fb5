// Granica terminu poświadczenia urządzenia (OPS-12) - lustro
// `_event_scanner_expiry_limit` - i odmowa `expiry_too_late` po ludzku.
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Okno wydania liczy granicę inaczej niż baza (np. od startu zamiast od
//      końca) - kalendarz pozwala wybrać datę, którą baza odrzuci, albo
//      blokuje datę, którą baza przyjmie.
//   2. Odmowa bazy `expiry_too_late` (oba warianty komunikatu) kończy się
//      ogólnym „Coś poszło nie tak", bo klucz i18n nie dochodzi do panelu.
import { describe, expect, it } from "vitest";

import { adminOnsiteErrorMessage, adminOnsiteFailure } from "@/lib/events/adminOnsiteErrors";
import {
  SCANNER_EXPIRY_GRACE_DAYS,
  isExpiryTooLate,
  isIssueWindowClosed,
  scannerExpiryLimit,
} from "@/lib/events/scannerExpiryLimit";
import i18n from "@/lib/i18n";
import { eventScannerPl } from "@/lib/i18n-event-scanner";

describe("granica terminu poświadczenia", () => {
  it("koniec wydarzenia + 7 dni", () => {
    expect(SCANNER_EXPIRY_GRACE_DAYS).toBe(7);
    expect(
      scannerExpiryLimit({
        starts_at: "2026-10-12T08:00:00Z",
        ends_at: "2026-10-14T18:00:00Z",
      }),
    ).toBe("2026-10-21T18:00:00.000Z");
  });

  it("wydarzenie bez końca: start + 1 dzień + 7 dni (jak `COALESCE` w bazie)", () => {
    expect(scannerExpiryLimit({ starts_at: "2026-10-12T08:00:00Z", ends_at: null })).toBe(
      "2026-10-20T08:00:00.000Z",
    );
  });

  it("bez czytelnych dat granicę zna tylko baza", () => {
    expect(scannerExpiryLimit(null)).toBeNull();
    expect(scannerExpiryLimit(undefined)).toBeNull();
    expect(scannerExpiryLimit({ starts_at: null, ends_at: null })).toBeNull();
    expect(scannerExpiryLimit({ starts_at: "kiedyś", ends_at: "nigdy" })).toBeNull();
  });

  it("termin po granicy jest za późny; równy granicy - nie (baza: `> limit`)", () => {
    const limit = "2026-10-21T18:00:00.000Z";
    expect(isExpiryTooLate("2026-10-21T18:00:01.000Z", limit)).toBe(true);
    expect(isExpiryTooLate(limit, limit)).toBe(false);
    expect(isExpiryTooLate("2026-10-20T10:00:00.000Z", limit)).toBe(false);
    expect(isExpiryTooLate(null, limit)).toBe(false);
    expect(isExpiryTooLate("2026-12-01T00:00:00.000Z", null)).toBe(false);
  });

  it("po granicy okno wydania jest zamknięte (baza: `limit <= now()`)", () => {
    const limit = "2026-10-21T18:00:00.000Z";
    expect(isIssueWindowClosed(limit, Date.parse(limit))).toBe(true);
    expect(isIssueWindowClosed(limit, Date.parse(limit) - 1)).toBe(false);
    expect(isIssueWindowClosed(null, Date.now())).toBe(false);
  });
});

describe("odmowa `expiry_too_late` od bazy do zdania w panelu", () => {
  // Oba warianty komunikatu z `admin_event_scanner_device_issue` (20261013110900).
  const MESSAGES = [
    "expiry_too_late: the credential must expire at most 7 days after the event ends",
    "expiry_too_late: the event ended more than 7 days ago - a scanner credential can no longer be issued",
  ];

  it.each(MESSAGES)("„%s” trafia w klucz `adminEventOnsite.errors.expiryTooLate`", (message) => {
    expect(adminOnsiteFailure(new Error(message)).key).toBe(
      "adminEventOnsite.errors.expiryTooLate",
    );
  });

  it("zdanie istnieje po polsku i po angielsku (nie ogólny błąd)", async () => {
    // Słownik skanera tylko po to, żeby i18n był zainicjalizowany jak w aplikacji.
    expect(eventScannerPl.eventScanner.appName).toBeTruthy();
    await i18n.changeLanguage("pl");
    expect(adminOnsiteErrorMessage(new Error(MESSAGES[0]))).toBe(
      "Poświadczenie może być ważne najwyżej 7 dni po zakończeniu wydarzenia.",
    );
    await i18n.changeLanguage("en");
    expect(adminOnsiteErrorMessage(new Error(MESSAGES[1]))).toBe(
      "A credential can be valid for at most 7 days after the event ends.",
    );
    await i18n.changeLanguage("pl");
  });
});

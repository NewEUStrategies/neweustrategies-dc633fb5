import { describe, expect, it } from "vitest";
import {
  badgeTemplateDraftToInput,
  checkpointDraftToInput,
  emptyBadgeTemplateDraft,
  emptyCheckpointDraft,
  emptyScannerDeviceDraft,
  intOrNull,
  isOnsiteUrl,
  isoToLocal,
  localToIso,
  scannerDeviceDraftToInput,
  validateBadgeTemplateDraft,
  validateCheckpointDraft,
  validateScannerDeviceDraft,
} from "@/lib/events/onsiteDraft";
import { parseCheckinOutcome, parseOnsiteStats } from "@/lib/events/onsiteApi";

const EVENT = "11111111-1111-1111-1111-111111111111";

describe("konwersje pomocnicze", () => {
  it("pusty tekst to brak wartosci, a nie zero", () => {
    expect(intOrNull("")).toBeNull();
    expect(intOrNull("0")).toBe(0);
    expect(intOrNull("abc")).toBe(false);
    expect(intOrNull("-3")).toBe(false);
  });

  it("adres tla przyjmuje https i sciezke wewnetrzna, odrzuca protocol-relative", () => {
    expect(isOnsiteUrl("https://example.com/a.png")).toBe(true);
    expect(isOnsiteUrl("/badges/bg.png")).toBe(true);
    expect(isOnsiteUrl("//evil.com/x.png")).toBe(false);
    expect(isOnsiteUrl("http://example.com/a.png")).toBe(false);
  });

  it("datetime-local zamienia sie w ISO i wraca bez utraty minuty", () => {
    const iso = localToIso("2026-09-01T10:30");
    expect(typeof iso).toBe("string");
    expect(isoToLocal(iso as string)).toBe("2026-09-01T10:30");
    expect(localToIso("")).toBeNull();
    expect(localToIso("nie-data")).toBe(false);
  });
});

describe("punkt kontrolny", () => {
  it("wymaga obu nazw", () => {
    const errors = validateCheckpointDraft(emptyCheckpointDraft());
    expect(errors.map((error) => error.field)).toEqual(["namePl", "nameEn"]);
  });

  it("punkt sesyjny bez sesji i stanowisko bez sponsora sa odrzucane", () => {
    const base = { ...emptyCheckpointDraft(), namePl: "Sesja A", nameEn: "Session A" };
    expect(validateCheckpointDraft({ ...base, kind: "session" })[0]?.messageKey).toContain(
      "sessionRequired",
    );
    expect(validateCheckpointDraft({ ...base, kind: "company_booth" })[0]?.messageKey).toContain(
      "sponsorRequired",
    );
  });

  it("zmiana rodzaju czysci powiazania jawnym nullem", () => {
    const input = checkpointDraftToInput(
      {
        ...emptyCheckpointDraft(),
        namePl: "Wejscie",
        nameEn: "Entrance",
        kind: "event_entry",
        sessionId: "aaa",
        sponsorId: "bbb",
      },
      EVENT,
    );
    expect(input.sessionId).toBeNull();
    expect(input.sponsorId).toBeNull();
    expect(input.eventId).toBe(EVENT);
  });

  it("pusta pojemnosc to brak limitu, a zero to zakaz wejscia", () => {
    const draft = { ...emptyCheckpointDraft(), namePl: "A", nameEn: "A" };
    expect(checkpointDraftToInput({ ...draft, capacity: "" }, EVENT).capacity).toBeNull();
    expect(checkpointDraftToInput({ ...draft, capacity: "0" }, EVENT).capacity).toBe(0);
  });

  it("edycja nie wysyla event_id", () => {
    const input = checkpointDraftToInput(
      { ...emptyCheckpointDraft(), id: "cp-1", namePl: "A1", nameEn: "A1" },
      EVENT,
    );
    expect(input.eventId).toBeUndefined();
    expect(input.id).toBe("cp-1");
  });
});

describe("poswiadczenie urzadzenia", () => {
  it("wymaga nazwy i co najmniej jednego uprawnienia", () => {
    const errors = validateScannerDeviceDraft({ ...emptyScannerDeviceDraft(), scopes: [] });
    expect(errors.map((error) => error.field)).toEqual(["label", "scopes"]);
  });

  it("uprawnienie leadowe wymaga sponsora", () => {
    const errors = validateScannerDeviceDraft({
      ...emptyScannerDeviceDraft(),
      label: "Stoisko 1",
      scopes: ["lead"],
    });
    expect(errors.map((error) => error.field)).toEqual(["sponsorId"]);
  });

  it("termin w przeszlosci jest odrzucany, pusty przechodzi", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const past = validateScannerDeviceDraft(
      { ...emptyScannerDeviceDraft(), label: "Brama", expiresAtLocal: "2026-08-01T10:00" },
      now,
    );
    expect(past.map((error) => error.field)).toEqual(["expiresAtLocal"]);
    expect(
      validateScannerDeviceDraft({ ...emptyScannerDeviceDraft(), label: "Brama" }, now),
    ).toEqual([]);
  });

  it("pusty termin nie jedzie do bazy - domyslny liczy migracja", () => {
    const input = scannerDeviceDraftToInput(
      { ...emptyScannerDeviceDraft(), label: "Brama" },
      EVENT,
    );
    expect(input.expiresAt).toBeUndefined();
    expect(input.scopes).toEqual(["checkin"]);
    expect(input.checkpointId).toBeNull();
  });
});

describe("szablon identyfikatora", () => {
  it("wlasny format wymaga obu wymiarow", () => {
    const errors = validateBadgeTemplateDraft({
      ...emptyBadgeTemplateDraft(),
      name: "Karta",
      paperFormat: "custom",
    });
    expect(errors.map((error) => error.field)).toEqual(["widthMm", "heightMm"]);
  });

  it("wymiary poza zakresem 20-420 mm sa odrzucane", () => {
    const errors = validateBadgeTemplateDraft({
      ...emptyBadgeTemplateDraft(),
      name: "Karta",
      paperFormat: "custom",
      widthMm: "10",
      heightMm: "500",
    });
    expect(errors.map((error) => error.messageKey)).toEqual([
      "adminEventOnsite.errors.invalidDimensions",
      "adminEventOnsite.errors.invalidDimensions",
    ]);
  });

  it("rozmiar QR sprawdzamy tylko, gdy kod jest wlaczony", () => {
    const base = { ...emptyBadgeTemplateDraft(), name: "Karta", qrSizeMm: "5" };
    expect(validateBadgeTemplateDraft(base).map((error) => error.field)).toEqual(["qrSizeMm"]);
    expect(validateBadgeTemplateDraft({ ...base, showQr: false })).toEqual([]);
  });

  it("kolor tla musi byc w postaci #rrggbb", () => {
    const errors = validateBadgeTemplateDraft({
      ...emptyBadgeTemplateDraft(),
      name: "Karta",
      backgroundColor: "czerwony",
    });
    expect(errors.map((error) => error.field)).toEqual(["backgroundColor"]);
  });

  it("puste tlo i kolor jada jako null, nie jako pusty napis", () => {
    const input = badgeTemplateDraftToInput(
      { ...emptyBadgeTemplateDraft(), name: "Karta" },
      EVENT,
    );
    expect(input.backgroundColor).toBeNull();
    expect(input.backgroundImageUrl).toBeNull();
    expect(input.widthMm).toBeNull();
  });
});

describe("parsery odpowiedzi bazy", () => {
  it("decyzja odprawy ma stale pola takze przy pustej odpowiedzi", () => {
    const outcome = parseCheckinOutcome(null);
    expect(outcome.admit).toBe(false);
    expect(outcome.result).toBe("unknown");
    expect(outcome.repeatCount).toBe(0);
  });

  it("decyzja odprawy przepisuje pola bazy", () => {
    const outcome = parseCheckinOutcome({
      outcome: "granted",
      admit: true,
      result: "granted",
      checkin_id: "chk-1",
      direction: "in",
      occurred_at: "2026-09-01T10:00:00Z",
      repeat_count: 2,
      checkpoint: { id: "cp-1" },
      person: { id: "p-1" },
    });
    expect(outcome.admit).toBe(true);
    expect(outcome.checkinId).toBe("chk-1");
    expect(outcome.repeatCount).toBe(2);
    expect(outcome.checkpoint.id).toBe("cp-1");
  });

  it("brakujaca metryka to zero, a nie pusty pulpit", () => {
    const stats = parseOnsiteStats({ registered_total: 12, histogram: "nie-tablica" });
    expect(stats.registeredTotal).toBe(12);
    expect(stats.arrivedTotal).toBe(0);
    expect(stats.bucketMinutes).toBe(15);
    expect(stats.histogram).toEqual([]);
    expect(stats.attendanceRate).toBeNull();
  });
});

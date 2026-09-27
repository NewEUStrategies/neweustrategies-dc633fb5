// Konflikty decyzji offline i skany odrzucone - reguła czysta i eksport.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. KONFLIKT NIEWIDZIALNY. Urządzenie wpuściło bez sieci, baza odmawia
//      (zapis anulowany po pobraniu listy) - bez `detectConflict` wynik
//      synchronizacji znika, a organizator nie wie, że ktoś wszedł bez prawa.
//   2. KONFLIKT W ODWROTNĄ STRONĘ (odmowa offline, baza by wpuściła) też musi
//      trafić na listę: człowiek został odesłany od bramki.
//   3. DUPLIKATY. Ponowna wysyłka tego samego skanu (`replay`) nie może
//      dopisać drugiego konfliktu.
//   4. USZKODZONY REKORD Z DYSKU wysypuje panel albo udaje konflikt bez
//      wyniku serwera.
//   5. EKSPORT Z WSTRZYKNIĘCIEM FORMUŁY. Kod biletu albo nazwisko zaczynające
//      się od `=` wykonałoby się w arkuszu organizatora.
import { afterEach, describe, expect, it, vi } from "vitest";
import { freezeClock } from "@/test/time";
import { OBJECT_URL_REVOKE_DELAY_MS } from "@/lib/files/downloadBlob";

import type { CheckinScanResult } from "@/lib/events/scannerApi";
import type { OutboxItem, RejectedScan } from "@/lib/events/scannerOutbox";
import {
  CONFLICTS_CAPACITY,
  appendConflict,
  detectConflict,
  downloadTextFile,
  parseConflicts,
  parseRejected,
  syncIssuesCsv,
  syncIssuesFileName,
  syncIssuesJson,
  type ScanConflict,
  type SyncIssuesCsvLabels,
} from "@/lib/events/scannerSyncIssues";

freezeClock();

const NOW = "2026-09-26T10:00:00.000Z";

function item(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "scan-1",
    kind: "checkin",
    code: "QR-1",
    checkpointId: "c1",
    direction: "in",
    note: null,
    interestRating: null,
    deviceScannedAt: "2026-09-26T09:00:00.000Z",
    attempts: 0,
    nextAttemptAt: "2026-09-26T09:00:00.000Z",
    lastError: null,
    offlineAdmitted: true,
    offlineOutcome: "granted",
    rosterGeneratedAt: "2026-09-26T08:00:00.000Z",
    deviceId: "dev-1",
    ...over,
  };
}

function result(over: Partial<CheckinScanResult> = {}): CheckinScanResult {
  return {
    outcome: "denied_not_registered",
    admit: false,
    result: "denied_not_registered",
    checkinId: "k1",
    direction: "in",
    occurredAt: null,
    repeatCount: 0,
    previousCheckinAt: null,
    deviceLocked: false,
    checkpoint: {
      id: "c1",
      namePl: null,
      nameEn: null,
      kind: null,
      directionMode: null,
      accessMode: null,
      capacity: null,
      occupancy: null,
    },
    person: {
      personId: "p1",
      firstName: "Anna",
      lastName: "Kowalska",
      company: null,
      jobTitle: null,
      registrationId: "r1",
      registrationStatus: "cancelled",
      ticketNamePl: null,
      ticketNameEn: null,
      groupNamePl: null,
      groupNameEn: null,
      groupColor: null,
      badgePrinted: false,
      badgePrintedAt: null,
      badgePrintedVersion: null,
    },
    otherEventTitlePl: null,
    otherEventTitleEn: null,
    ...over,
    // Baza bez decyzji urządzenia ma to samo zdanie, chyba że test mówi inaczej.
    serverAdmit: over.serverAdmit ?? over.admit ?? false,
  };
}

function conflict(over: Partial<ScanConflict> = {}): ScanConflict {
  return {
    id: "scan-1",
    kind: "admitted_offline",
    checkinId: "k1",
    checkpointId: "c1",
    direction: "in",
    deviceScannedAt: "2026-09-26T09:00:00.000Z",
    offlineOutcome: "granted",
    serverOutcome: "denied_not_registered",
    personName: "Anna Kowalska",
    registrationId: "r1",
    detectedAt: NOW,
    ...over,
  };
}

const LABELS: SyncIssuesCsvLabels = {
  type: "Typ",
  kind: "Rodzaj",
  scannedAt: "Czas",
  checkpoint: "Punkt",
  direction: "Kierunek",
  offlineOutcome: "Offline",
  serverResult: "Serwer",
  person: "Osoba",
  registrationId: "Zgloszenie",
  code: "Kod",
  reference: "Id",
  conflict: "konflikt",
  rejected: "odrzucony",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wykrycie konfliktu po synchronizacji", () => {
  it("wpuszczony offline, baza odmawia - konflikt z osobą i wynikami obu stron", () => {
    expect(detectConflict(item(), result(), NOW)).toEqual(conflict());
  });

  it("odmowa offline, baza wpuszcza - konflikt ODWROTNY (człowieka odesłano)", () => {
    const found = detectConflict(
      item({ offlineAdmitted: false, offlineOutcome: "unknown_code" }),
      result({ outcome: "granted", admit: true, result: "granted" }),
      NOW,
    );
    expect(found).toMatchObject({ kind: "denied_offline", offlineOutcome: "unknown_code" });
  });

  it("odmowa offline zapisana przez bazę jako odmowa bramki (admit false), ale bilet ważny (serverAdmit) - konflikt ODWROTNY", () => {
    // Od 20260926150000 (review #33) baza nie zamienia odesłania w obecność:
    // wiersz ma odmowę, `admit` jest false, a o ważnym bilecie mówi
    // `serverAdmit`. Porównanie z `admit` zgubiłoby ten konflikt.
    const found = detectConflict(
      item({ offlineAdmitted: false, offlineOutcome: "unknown_code" }),
      result({ admit: false, serverAdmit: true }),
      NOW,
    );
    expect(found).toMatchObject({ kind: "denied_offline", serverOutcome: "denied_not_registered" });
  });

  it("zgodne decyzje i skan bez decyzji offline NIE są konfliktem", () => {
    expect(detectConflict(item(), result({ admit: true }), NOW)).toBeNull();
    expect(detectConflict(item({ offlineOutcome: null }), result(), NOW)).toBeNull();
    expect(detectConflict(item({ offlineOutcome: undefined }), result(), NOW)).toBeNull();
  });

  it("brak osoby w odpowiedzi daje konflikt bez nazwiska, a nie „null null”", () => {
    const found = detectConflict(item(), result({ person: null }), NOW);
    expect(found?.personName).toBeNull();
    expect(found?.registrationId).toBeNull();
  });

  it("brak flagi offlineAdmitted przy wyniku offline liczy się jak odmowa urządzenia", () => {
    const found = detectConflict(
      item({ offlineAdmitted: undefined, offlineOutcome: "denied_direction" }),
      result({ admit: true }),
      NOW,
    );
    expect(found?.kind).toBe("denied_offline");
  });
});

describe("lista konfliktów", () => {
  it("ten sam skan (replay) nie dubluje konfliktu - nowszy wypiera starszy", () => {
    const list = appendConflict(
      [conflict({ detectedAt: "stary" })],
      conflict({ detectedAt: "nowy" }),
    );
    expect(list).toHaveLength(1);
    expect(list[0].detectedAt).toBe("nowy");
  });

  it("przepełnienie zjada najstarsze", () => {
    const full = Array.from({ length: CONFLICTS_CAPACITY }, (_, i) => conflict({ id: `s${i}` }));
    const next = appendConflict(full, conflict({ id: "nowy" }));
    expect(next).toHaveLength(CONFLICTS_CAPACITY);
    expect(next[0].id).toBe("s1");
  });

  it("odczyt z dysku zostawia pełne konflikty i odsiewa niepełne", () => {
    const ok = conflict({ checkinId: null, direction: null, personName: null });
    expect(
      parseConflicts([
        ok,
        { ...conflict(), direction: "bok" },
        { ...conflict(), direction: 1 },
        { ...conflict(), kind: "inny" },
        { ...conflict(), offlineOutcome: "denied_capacity" },
        { ...conflict(), offlineOutcome: 3 },
        { ...conflict(), id: "" },
        { ...conflict(), deviceScannedAt: null },
        { ...conflict(), serverOutcome: null },
        { ...conflict(), detectedAt: null },
        "smiec",
      ]),
    ).toEqual([ok, { ...conflict(), direction: null }, { ...conflict(), direction: null }]);
    expect(parseConflicts("nie-lista")).toEqual([]);
    // Pełny konflikt wraca w całości, z kierunkiem.
    expect(parseConflicts([conflict()])).toEqual([conflict()]);
  });
});

describe("lista odrzuconych z dysku", () => {
  it("zostawia pozycje z kodem, błędem i chwilą; resztę odsiewa", () => {
    const ok: RejectedScan = { item: item(), error: "device_revoked: x", rejectedAt: NOW };
    expect(
      parseRejected([
        ok,
        { item: { id: "x" }, error: "e", rejectedAt: NOW },
        { item: item(), error: "", rejectedAt: NOW },
        { item: item(), error: "e", rejectedAt: null },
        null,
      ]),
    ).toEqual([ok]);
    expect(parseRejected({})).toEqual([]);
  });
});

describe("eksport dla organizatora", () => {
  const rejected: RejectedScan = {
    item: item({ code: "=HYPERLINK(1)", offlineOutcome: undefined, kind: "lead", direction: null }),
    error: "device_revoked: gone",
    rejectedAt: NOW,
  };

  it("CSV ma BOM, nagłówek w języku operatora i neutralizuje formuły", () => {
    const csv = syncIssuesCsv([conflict({ checkinId: null })], [rejected], LABELS);
    const lines = csv.slice(1).split("\n");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(lines[0]).toBe("Typ,Rodzaj,Czas,Punkt,Kierunek,Offline,Serwer,Osoba,Zgloszenie,Kod,Id");
    // Konflikt bez identyfikatora odprawy odsyła do klucza skanu.
    expect(lines[1]).toContain("konflikt,admitted_offline");
    expect(lines[1].endsWith(",scan-1")).toBe(true);
    expect(lines[2]).toContain("odrzucony,lead");
    expect(lines[2]).toContain("'=HYPERLINK(1)");
  });

  it("konflikt z identyfikatorem odprawy podaje właśnie jego", () => {
    const csv = syncIssuesCsv([conflict()], [], LABELS);
    expect(csv.split("\n")[1].endsWith(",k1")).toBe(true);
  });

  it("JSON niesie urządzenie, wydarzenie, chwilę eksportu i obie listy", () => {
    const parsed = JSON.parse(
      syncIssuesJson([conflict()], [rejected], {
        deviceLabel: "Brama 1",
        eventSlug: "kongres",
        exportedAt: NOW,
      }),
    ) as Record<string, unknown>;
    expect(parsed).toMatchObject({ deviceLabel: "Brama 1", eventSlug: "kongres", exportedAt: NOW });
    expect(parsed.conflicts).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(1);
  });

  it("nazwa pliku niesie wydarzenie i dzień; bez wydarzenia - słowo zapasowe", () => {
    expect(syncIssuesFileName("Kongres Energii 2026!", NOW, "csv")).toBe(
      "skaner-kongres-energii-2026-2026-09-26.csv",
    );
    expect(syncIssuesFileName(null, NOW, "json")).toBe("skaner-wydarzenie-2026-09-26.json");
    expect(syncIssuesFileName("!!!", NOW, "json")).toBe("skaner-wydarzenie-2026-09-26.json");
  });

  it("pobranie tworzy odnośnik do Bloba, klika go i zwalnia adres dopiero PO CHWILI", () => {
    // Tu sterujemy także `setTimeout` - zwolnienie adresu jest odroczone.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    downloadTextFile("a.csv", "text/csv", "x");
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    // iOS Safari i Chrome na Androidzie gubią plik, gdy adres znika w tym samym
    // albo w następnym takcie - wspólny `downloadBlob` czeka dłużej.
    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith("blob:x");
    // Kotwica nie zostaje w dokumencie.
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

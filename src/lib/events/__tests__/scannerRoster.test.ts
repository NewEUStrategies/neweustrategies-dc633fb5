// Lista offline skanera i decyzja BEZ SIECI - reguła czysta.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. DECYZJA OFFLINE ROZJEŻDŻA SIĘ Z BAZĄ. `decideOffline` jest lustrem
//      `_event_checkin_evaluate` - tabela parytetu niżej zapisuje KAŻDY wiersz
//      reguły bazy (kolejność: kod nieznany, kierunek, status, limit, zgoda)
//      i to, co odpowiada na niego urządzenie. Zmiana kolejności warunków
//      w kodzie (np. status przed kierunkiem) dałaby inną odpowiedź przy
//      bramce niż w bazie po synchronizacji - czyli konflikt na zawołanie.
//   2. PUNKT `track` ODMAWIA offline, choć baza liczy tam wejście mimo odmowy
//      statusu - wolontariusz zatrzymałby człowieka, którego baza wpuszcza.
//   3. PODWÓJNE PIKNIĘCIE offline daje drugą zgodę zamiast „już odprawiony".
//   4. PRZYROST LISTY GUBI USUNIĘCIA - bilet anulowany po pobraniu listy nadal
//      otwiera bramkę; albo nowy skrót po ponownym wydaniu biletu nie wypiera
//      starego.
//   5. `roster_resync_required` z bazy kończy synchronizację zamiast pełnego
//      pobrania - urządzenie zostaje z listą sprzed godzin.
//   6. USZKODZONY REKORD Z DYSKU udaje listę z dziurami (wiersz bez skrótu
//      pasuje do niczego, ale liczy się do „1 234 osób").
import { describe, expect, it, vi } from "vitest";

import {
  LOCAL_LOG_CAPACITY,
  LOCAL_LOG_MAX_AGE_MS,
  ROSTER_STALE_MS,
  appendDecisionLog,
  applyRosterPage,
  buildRosterIndex,
  decideOffline,
  parseDecisionLog,
  parseRosterEntry,
  parseRosterPage,
  parseRosterSnapshot,
  rosterEntryToPerson,
  rosterEntryToRecord,
  rosterSnapshotToRecord,
  rosterState,
  syncRosterSnapshot,
  type LocalDecisionLogEntry,
  type RosterEntry,
  type RosterPage,
} from "@/lib/events/scannerRoster";
import type { ScannerCheckpoint } from "@/lib/events/scannerSession";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const H3 = "c".repeat(64);
const NOW = Date.parse("2026-09-26T10:00:00.000Z");

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    registrationId: "r1",
    hash: H1,
    status: "approved",
    firstName: "Anna",
    lastName: "Kowalska",
    company: "Acme",
    ticketNamePl: "Standard",
    ticketNameEn: "Standard",
    groupNamePl: "Uczestnicy",
    groupNameEn: "Attendees",
    groupColor: "#123456",
    badgePrinted: false,
    ...over,
  };
}

function checkpoint(over: Partial<ScannerCheckpoint> = {}): ScannerCheckpoint {
  return {
    id: "c1",
    namePl: "Brama",
    nameEn: "Gate",
    kind: "event_entry",
    directionMode: "in_out",
    accessMode: "control",
    capacity: null,
    dedupeWindowSeconds: 60,
    sortOrder: 0,
    ...over,
  };
}

function page(over: Partial<RosterPage> = {}): RosterPage {
  return {
    generatedAt: "2026-09-26T09:00:00.123456+00:00",
    full: true,
    total: null,
    nextAfter: null,
    rows: [],
    removed: [],
    ...over,
  };
}

describe("wiersz listy offline", () => {
  it("czyta minimalny kształt z bazy i dopełnia brakujące pola wartościami pustymi", () => {
    expect(
      parseRosterEntry({ r: "r1", h: H1, s: "approved", fn: "Anna", ln: "", bp: true }),
    ).toEqual({
      registrationId: "r1",
      hash: H1,
      status: "approved",
      firstName: "Anna",
      lastName: null,
      company: null,
      ticketNamePl: null,
      ticketNameEn: null,
      groupNamePl: null,
      groupNameEn: null,
      groupColor: null,
      badgePrinted: true,
    });
  });

  it("wiersz bez identyfikatora, skrótu albo statusu nie nadaje się do decyzji", () => {
    expect(parseRosterEntry({ h: H1, s: "approved" })).toBeNull();
    expect(parseRosterEntry({ r: "r1", s: "approved" })).toBeNull();
    expect(parseRosterEntry({ r: "r1", h: H1 })).toBeNull();
    expect(parseRosterEntry(null)).toBeNull();
    expect(parseRosterEntry(["r1"])).toBeNull();
  });

  it("skrót innego kształtu niż sha256 hex (np. jawny token) jest odrzucany", () => {
    expect(parseRosterEntry({ r: "r1", h: "qr-jawny-token", s: "approved" })).toBeNull();
    expect(parseRosterEntry({ r: "r1", h: H1.toUpperCase(), s: "approved" })).toBeNull();
  });

  it("zapis do pamięci i odczyt dają ten sam wiersz", () => {
    const row = entry({ badgePrinted: true, company: null });
    expect(parseRosterEntry(rosterEntryToRecord(row))).toEqual(row);
  });

  it("karta osoby z listy NIE ma stanowiska ani identyfikatora osoby", () => {
    const person = rosterEntryToPerson(entry({ badgePrinted: true }));
    expect(person).toMatchObject({
      personId: null,
      jobTitle: null,
      firstName: "Anna",
      registrationId: "r1",
      registrationStatus: "approved",
      groupColor: "#123456",
      badgePrinted: true,
      badgePrintedAt: null,
      badgePrintedVersion: null,
    });
  });
});

describe("strona listy offline", () => {
  it("wersja listy to DOSŁOWNY napis z bazy (mikrosekundy wracają jako `since`)", () => {
    const parsed = parseRosterPage({
      generated_at: "2026-09-26T09:00:00.123456+00:00",
      full: true,
      total: 2,
      next_after: "r9",
      rows: [
        { r: "r1", h: H1, s: "approved" },
        { r: "r2", h: "zly" },
      ],
      removed: ["r3", "", 5, null],
    });
    expect(parsed?.generatedAt).toBe("2026-09-26T09:00:00.123456+00:00");
    expect(parsed?.total).toBe(2);
    expect(parsed?.nextAfter).toBe("r9");
    expect(parsed?.rows.map((row) => row.registrationId)).toEqual(["r1"]);
    expect(parsed?.removed).toEqual(["r3"]);
  });

  it("odpowiedź bez wersji jest nieczytelna - nie nakładamy pustki na listę", () => {
    expect(parseRosterPage({ rows: [] })).toBeNull();
    expect(parseRosterPage(null)).toBeNull();
  });

  it("delta bez `full`, `total` i kursora ma wartości domyślne, a śmieci to puste listy", () => {
    const parsed = parseRosterPage({
      generated_at: "2026-09-26T09:00:00Z",
      total: "7",
      rows: "nie-lista",
      removed: "nie-lista",
    });
    expect(parsed).toEqual({
      generatedAt: "2026-09-26T09:00:00Z",
      full: false,
      total: null,
      nextAfter: null,
      rows: [],
      removed: [],
    });
  });

  it("nałożenie strony usuwa `removed`, podmienia po zapisie i dokłada nowe", () => {
    const before = [entry(), entry({ registrationId: "r2", hash: H2 })];
    const after = applyRosterPage(
      before,
      page({
        rows: [entry({ hash: H3, status: "attended" }), entry({ registrationId: "r4", hash: H2 })],
        removed: ["r2"],
      }),
    );
    expect(after.map((row) => [row.registrationId, row.hash, row.status])).toEqual([
      ["r1", H3, "attended"],
      ["r4", H2, "approved"],
    ]);
    const index = buildRosterIndex(after);
    // Stary skrót r1 (sprzed ponownego wydania biletu) nie otwiera już bramki.
    expect(index.get(H1)).toBeUndefined();
    expect(index.get(H3)?.registrationId).toBe("r1");
  });
});

describe("lista na dysku i jej świeżość", () => {
  it("zapis i odczyt listy dają tę samą listę", () => {
    const snapshot = { deviceId: "d1", generatedAt: "2026-09-26T09:00:00Z", rows: [entry()] };
    expect(parseRosterSnapshot(rosterSnapshotToRecord(snapshot))).toEqual(snapshot);
  });

  it("uszkodzony rekord to BRAK listy, a zły wiersz wypada", () => {
    expect(parseRosterSnapshot({ deviceId: "d1", generatedAt: "x" })).toBeNull();
    expect(parseRosterSnapshot({ generatedAt: "x", rows: [] })).toBeNull();
    expect(parseRosterSnapshot({ deviceId: "d1", rows: [] })).toBeNull();
    expect(parseRosterSnapshot(null)).toBeNull();
    expect(
      parseRosterSnapshot({ deviceId: "d1", generatedAt: "x", rows: [{ r: "r1" }] })?.rows,
    ).toEqual([]);
  });

  it("stan listy: wyłączona, brak, świeża, nieświeża, nieczytelna", () => {
    const at = new Date(NOW).toISOString();
    expect(rosterState({ enabled: false, generatedAt: at, nowMs: NOW })).toBe("disabled");
    expect(rosterState({ enabled: true, generatedAt: null, nowMs: NOW })).toBe("none");
    expect(rosterState({ enabled: true, generatedAt: at, nowMs: NOW + ROSTER_STALE_MS })).toBe(
      "fresh",
    );
    expect(rosterState({ enabled: true, generatedAt: at, nowMs: NOW + ROSTER_STALE_MS + 1 })).toBe(
      "stale",
    );
    expect(rosterState({ enabled: true, generatedAt: "nie-data", nowMs: NOW })).toBe("stale");
  });

  it("zanim zegar jest znany (pierwszy render) lista, która JEST, liczy się za świeżą", () => {
    expect(rosterState({ enabled: true, generatedAt: "nie-data", nowMs: null })).toBe("fresh");
    expect(rosterState({ enabled: true, generatedAt: null, nowMs: null })).toBe("none");
  });
});

describe("synchronizacja listy", () => {
  it("bez poprzedniej wersji pobiera CAŁOŚĆ, strona po stronie, z wersją pierwszej strony", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ generatedAt: "v1", rows: [entry()], nextAfter: "r1" }))
      .mockResolvedValueOnce(
        page({ generatedAt: "v2", rows: [entry({ registrationId: "r2", hash: H2 })] }),
      );

    const snapshot = await syncRosterSnapshot({ deviceId: "d1", previous: null, fetchPage });

    expect(fetchPage.mock.calls.map((call) => call[0])).toEqual([
      { after: undefined },
      { after: "r1" },
    ]);
    expect(snapshot.generatedAt).toBe("v1");
    expect(snapshot.rows).toHaveLength(2);
  });

  it("z poprzednią wersją pobiera PRZYROST od niej i nakłada go na starą listę", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue(page({ generatedAt: "v9", full: false, removed: ["r1"] }));
    const previous = {
      deviceId: "d1",
      generatedAt: "v8",
      rows: [entry(), entry({ registrationId: "r2", hash: H2 })],
    };

    const snapshot = await syncRosterSnapshot({ deviceId: "d1", previous, fetchPage });

    expect(fetchPage).toHaveBeenCalledWith({ since: "v8", after: undefined });
    expect(snapshot).toEqual({ deviceId: "d1", generatedAt: "v9", rows: [previous.rows[1]] });
  });

  it("baza każe zacząć od nowa - przyrost zamienia się w pełne pobranie", async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("roster_resync_required: too old"))
      .mockResolvedValueOnce(page({ generatedAt: "v10", rows: [entry({ registrationId: "r7" })] }));
    const previous = { deviceId: "d1", generatedAt: "v1", rows: [entry()] };

    const snapshot = await syncRosterSnapshot({ deviceId: "d1", previous, fetchPage });

    expect(fetchPage.mock.calls[1][0]).toEqual({ after: undefined });
    expect(snapshot.rows.map((row) => row.registrationId)).toEqual(["r7"]);
  });

  it("inna odmowa przy przyroście wychodzi do wołającego - stara lista zostaje u niego", async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error("roster_throttled: wait"));
    const previous = { deviceId: "d1", generatedAt: "v1", rows: [entry()] };

    await expect(syncRosterSnapshot({ deviceId: "d1", previous, fetchPage })).rejects.toThrow(
      "roster_throttled",
    );
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("błąd bez głowy (sieć) przy przyroście też wychodzi, a nie wymusza pełnego pobrania", async () => {
    const fetchPage = vi.fn().mockRejectedValue("Failed to fetch");
    const previous = { deviceId: "d1", generatedAt: "v1", rows: [] };

    await expect(syncRosterSnapshot({ deviceId: "d1", previous, fetchPage })).rejects.toBe(
      "Failed to fetch",
    );
  });

  it("lista INNEGO urządzenia na tym telefonie nie jest bazą przyrostu", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ generatedAt: "v2" }));
    const previous = { deviceId: "stare", generatedAt: "v1", rows: [entry()] };

    const snapshot = await syncRosterSnapshot({ deviceId: "d1", previous, fetchPage });

    expect(fetchPage).toHaveBeenCalledWith({ after: undefined });
    expect(snapshot.rows).toEqual([]);
  });
});

describe("lokalny dziennik zgód", () => {
  const row = (at: string, over: Partial<LocalDecisionLogEntry> = {}): LocalDecisionLogEntry => ({
    checkpointId: "c1",
    registrationId: "r1",
    direction: "in",
    at,
    ...over,
  });

  it("dopisuje zgodę i wycina wpisy starsze niż 12 godzin oraz nieczytelne", () => {
    const old = new Date(NOW - LOCAL_LOG_MAX_AGE_MS - 1).toISOString();
    const edge = new Date(NOW - LOCAL_LOG_MAX_AGE_MS).toISOString();
    const next = appendDecisionLog(
      [row(old), row(edge), row("nie-data")],
      row(new Date(NOW).toISOString()),
      NOW,
    );
    expect(next.map((item) => item.at)).toEqual([edge, new Date(NOW).toISOString()]);
  });

  it("przepełnienie zjada najstarsze wpisy", () => {
    const at = new Date(NOW).toISOString();
    const full = Array.from({ length: LOCAL_LOG_CAPACITY }, (_, i) =>
      row(at, { registrationId: `r${i}` }),
    );
    const next = appendDecisionLog(full, row(at, { registrationId: "nowy" }), NOW);
    expect(next).toHaveLength(LOCAL_LOG_CAPACITY);
    expect(next[0].registrationId).toBe("r1");
    expect(next.at(-1)?.registrationId).toBe("nowy");
  });

  it("odczyt z dysku odsiewa wpisy niepełne i z nieznanym kierunkiem", () => {
    expect(
      parseDecisionLog([
        row("2026-09-26T09:00:00Z"),
        { ...row("2026-09-26T09:00:00Z"), direction: "bok" },
        { ...row("2026-09-26T09:00:00Z"), direction: 3 },
        { registrationId: "r1", direction: "in", at: "x" },
        { checkpointId: "c1", direction: "in", at: "x" },
        { checkpointId: "c1", registrationId: "r1", direction: "out" },
        "smiec",
      ]),
    ).toEqual([row("2026-09-26T09:00:00Z")]);
    expect(parseDecisionLog("nie-lista")).toEqual([]);
  });
});

/**
 * TABELA PARYTETU z `_event_checkin_evaluate` (20260824102000) i regułą
 * `admit` z `_event_checkin_write`: [opis, wiersz listy, punkt, kierunek,
 * oczekiwany wynik offline, oczekiwane `admit`].
 */
const PARITY: ReadonlyArray<
  readonly [string, RosterEntry | null, Partial<ScannerCheckpoint>, "in" | "out", string, boolean]
> = [
  ["kod spoza listy (baza: brak zapisu z tym skrótem)", null, {}, "in", "unknown_code", false],
  [
    "kod spoza listy na punkcie track też odmawia",
    null,
    { accessMode: "track" },
    "in",
    "unknown_code",
    false,
  ],
  [
    "wejście na punkt tylko-wyjściowy",
    entry(),
    { directionMode: "out_only" },
    "in",
    "denied_direction",
    false,
  ],
  [
    "wyjście z punktu tylko-wejściowego",
    entry(),
    { directionMode: "in_only" },
    "out",
    "denied_direction",
    false,
  ],
  [
    "kierunek sprawdzany PRZED statusem",
    entry({ status: "pending" }),
    { directionMode: "out_only" },
    "in",
    "denied_direction",
    false,
  ],
  [
    "zapis oczekujący na punkcie control",
    entry({ status: "pending" }),
    {},
    "in",
    "denied_registration_status",
    false,
  ],
  [
    "zapis oczekujący na punkcie track - baza liczy i wpuszcza",
    entry({ status: "waitlisted" }),
    { accessMode: "track" },
    "in",
    "denied_registration_status",
    true,
  ],
  ["zapis zatwierdzony", entry({ status: "approved" }), {}, "in", "granted", true],
  ["zapis już obecny (attended)", entry({ status: "attended" }), {}, "in", "granted", true],
  ["wyjście zatwierdzonego przez punkt in_out", entry(), {}, "out", "granted", true],
];

describe("decyzja offline - lustro reguły bazy", () => {
  it.each(PARITY)("%s", (_opis, row, cp, direction, outcome, admit) => {
    const decision = decideOffline({
      entry: row,
      checkpoint: checkpoint(cp),
      direction,
      log: [],
      nowMs: NOW,
      rosterGeneratedAt: "v1",
    });
    expect(decision.outcome).toBe(outcome);
    expect(decision.admit).toBe(admit);
    expect(decision.entry).toBe(row);
    expect(decision.rosterGeneratedAt).toBe("v1");
  });

  it("limit obecności NIE odmawia offline - jest tylko oznaczony jako przybliżony", () => {
    const decision = decideOffline({
      entry: entry(),
      checkpoint: checkpoint({ capacity: 10 }),
      direction: "in",
      log: [],
      nowMs: NOW,
      rosterGeneratedAt: "v1",
    });
    expect(decision).toMatchObject({ outcome: "granted", admit: true, approximateCapacity: true });
  });

  it("limit nie dotyczy wyjścia, a punkt bez limitu nie ostrzega", () => {
    const base = { entry: entry(), log: [], nowMs: NOW, rosterGeneratedAt: "v1" };
    expect(
      decideOffline({ ...base, checkpoint: checkpoint({ capacity: 10 }), direction: "out" })
        .approximateCapacity,
    ).toBe(false);
    expect(
      decideOffline({ ...base, checkpoint: checkpoint(), direction: "in" }).approximateCapacity,
    ).toBe(false);
  });

  describe("powtórzenie w oknie punktu (lustro `dedupe_range`)", () => {
    const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
    const log = (over: Partial<LocalDecisionLogEntry> = {}): LocalDecisionLogEntry[] => [
      { checkpointId: "c1", registrationId: "r1", direction: "in", at: at(-30_000), ...over },
    ];
    const decide = (entries: LocalDecisionLogEntry[], cp: Partial<ScannerCheckpoint> = {}) =>
      decideOffline({
        entry: entry(),
        checkpoint: checkpoint(cp),
        direction: "in",
        log: entries,
        nowMs: NOW,
        rosterGeneratedAt: "v1",
      });

    it("zgoda sprzed 30 s w oknie 60 s to „już odprawiony”, nadal wpuszczony", () => {
      expect(decide(log())).toMatchObject({ outcome: "repeat", admit: true });
    });

    it("zgoda na brzegu okna (dokładnie 60 s) jest już NOWĄ zgodą", () => {
      expect(decide(log({ at: at(-60_000) })).outcome).toBe("granted");
    });

    it("okno zero wyłącza wykrywanie powtórzeń", () => {
      expect(decide(log(), { dedupeWindowSeconds: 0 }).outcome).toBe("granted");
    });

    it("inny punkt, inny zapis, inny kierunek albo wpis „z przyszłości” nie są powtórzeniem", () => {
      expect(decide(log({ checkpointId: "c2" })).outcome).toBe("granted");
      expect(decide(log({ registrationId: "r2" })).outcome).toBe("granted");
      expect(decide(log({ direction: "out" })).outcome).toBe("granted");
      expect(decide(log({ at: at(5_000) })).outcome).toBe("granted");
    });
  });
});

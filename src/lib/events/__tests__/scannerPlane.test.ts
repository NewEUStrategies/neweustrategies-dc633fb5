// Plaszczyzna urzadzenia skanujacego: sesja, zakresy i kolejka offline.
//
// TE REGULY DECYDUJA O TYM, CZY LUDZIE WEJDA NA KONGRES. Kolejka bez
// idempotencji zdublowalaby odprawy, kolejka bez wycofania dobijalaby sie do
// bazy do konca baterii, a zakresy bez sprawdzenia otworzylyby wolontariuszowi
// z bramki liste leadow partnera. Kazda z tych rzeczy ma tu wlasny przypadek.
import { describe, expect, it } from "vitest";

import {
  availableModes,
  checkpointDirections,
  defaultCheckpointId,
  findCheckpoint,
  hasScope,
  hoursUntilExpiry,
  isScannerToken,
  isSessionExpired,
  modeScope,
  parseScannerSession,
} from "@/lib/events/scannerSession";
import {
  backoffDelayMs,
  dueItems,
  enqueueScan,
  errorHead,
  isPermanentFailure,
  outboxCounts,
  OUTBOX_CAPACITY,
  OUTBOX_MAX_ATTEMPTS,
  stuckItems,
  withFailure,
  withoutItem,
  type OutboxItem,
} from "@/lib/events/scannerOutbox";
import { invalidatesSession, scannerErrorText } from "@/lib/events/scannerErrors";

const BOOTSTRAP = {
  device_id: "d1",
  label: "Recepcja A",
  scopes: ["checkin", "badge_print"],
  expires_at: "2026-09-02T20:00:00Z",
  pinned_checkpoint_id: null,
  sponsor_id: null,
  event: {
    id: "e1",
    slug: "kongres",
    title_pl: "Kongres",
    title_en: "Congress",
    starts_at: "2026-09-01T07:00:00Z",
    ends_at: "2026-09-02T16:00:00Z",
    timezone: "Europe/Warsaw",
  },
  checkpoints: [
    {
      id: "c2",
      name_pl: "Sala B",
      name_en: "Room B",
      kind: "room",
      direction_mode: "in_out",
      access_mode: "track",
      capacity: 120,
      dedupe_window_seconds: 60,
      sort_order: 2,
    },
    {
      id: "c1",
      name_pl: "Wejscie glowne",
      name_en: "Main entrance",
      kind: "event_entry",
      direction_mode: "in_only",
      access_mode: "control",
      capacity: null,
      dedupe_window_seconds: 300,
      sort_order: 1,
    },
  ],
};

function item(over: Partial<OutboxItem>): OutboxItem {
  return {
    id: "i1",
    kind: "checkin",
    code: "AAA",
    checkpointId: "c1",
    direction: "in",
    note: null,
    interestRating: null,
    deviceScannedAt: "2026-09-01T08:00:00Z",
    attempts: 0,
    nextAttemptAt: "2026-09-01T08:00:00Z",
    lastError: null,
    ...over,
  };
}

describe("scannerSession - poswiadczenie i zakresy", () => {
  it("przyjmuje token o ksztalcie z `_event_scanner_device_auth`, reszte odrzuca", () => {
    expect(isScannerToken("a".repeat(32))).toBe(true);
    expect(isScannerToken("krotki")).toBe(false);
    expect(isScannerToken(`${"a".repeat(31)}$`)).toBe(false);
  });

  it("odpowiedz bez urzadzenia albo bez wydarzenia nie udaje sesji", () => {
    expect(parseScannerSession({ ...BOOTSTRAP, device_id: null })).toBeNull();
    expect(parseScannerSession({ ...BOOTSTRAP, event: {} })).toBeNull();
    expect(parseScannerSession(null)).toBeNull();
  });

  it("porzadkuje punkty kontrolne i odrzuca zakresy spoza slownika", () => {
    const session = parseScannerSession({ ...BOOTSTRAP, scopes: ["checkin", "kosmos"] });
    expect(session?.checkpoints.map((checkpoint) => checkpoint.id)).toEqual(["c1", "c2"]);
    expect(session?.scopes).toEqual(["checkin"]);
  });

  it("pokazuje TYLKO tryby, ktore poswiadczenie naprawde niesie", () => {
    const session = parseScannerSession(BOOTSTRAP);
    expect(session).not.toBeNull();
    if (session === null) return;
    expect(availableModes(session)).toEqual(["checkin", "badge"]);
    expect(hasScope(session, "lead")).toBe(false);
    expect(modeScope("badge")).toBe("badge_print");
  });

  it("przypiety punkt wygrywa nad pierwszym z listy", () => {
    const free = parseScannerSession(BOOTSTRAP);
    const pinned = parseScannerSession({ ...BOOTSTRAP, pinned_checkpoint_id: "c2" });
    expect(free === null ? null : defaultCheckpointId(free)).toBe("c1");
    expect(pinned === null ? null : defaultCheckpointId(pinned)).toBe("c2");
  });

  it("kierunki wynikaja z `direction_mode` punktu", () => {
    const session = parseScannerSession(BOOTSTRAP);
    if (session === null) throw new Error("test: sesja powinna sie sparsowac");
    expect(checkpointDirections(findCheckpoint(session, "c1"))).toEqual(["in"]);
    expect(checkpointDirections(findCheckpoint(session, "c2"))).toEqual(["in", "out"]);
    expect(checkpointDirections(null)).toEqual(["in"]);
  });

  it("termin poswiadczenia liczy sie zanim ktokolwiek zeskanuje bilet", () => {
    const session = parseScannerSession(BOOTSTRAP);
    if (session === null) throw new Error("test: sesja powinna sie sparsowac");
    expect(isSessionExpired(session, "2026-09-01T08:00:00Z")).toBe(false);
    expect(isSessionExpired(session, "2026-09-03T08:00:00Z")).toBe(true);
    expect(hoursUntilExpiry(session, "2026-09-02T18:00:00Z")).toBe(2);
  });
});

describe("scannerOutbox - kolejka bez sieci", () => {
  it("leady SKLEJA po kodzie, odpraw NIE", () => {
    const leads = enqueueScan(
      enqueueScan([], item({ id: "l1", kind: "lead", code: "X", note: "pierwsza" })),
      item({ id: "l2", kind: "lead", code: "X", note: "druga" }),
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].note).toBe("druga");

    const checkins = enqueueScan(
      enqueueScan([], item({ id: "c1", code: "X" })),
      item({ id: "c2", code: "X" }),
    );
    expect(checkins).toHaveLength(2);
  });

  it("pusta notatka nowego skanu nie kasuje starszej", () => {
    const queue = enqueueScan(
      enqueueScan(
        [],
        item({ id: "l1", kind: "lead", code: "X", note: "rozmowa", interestRating: 4 }),
      ),
      item({ id: "l2", kind: "lead", code: "X", note: null, interestRating: null }),
    );
    expect(queue[0].note).toBe("rozmowa");
    expect(queue[0].interestRating).toBe(4);
  });

  it("przepelnienie zjada NAJSTARSZE pozycje, nie najnowsze", () => {
    let queue: OutboxItem[] = [];
    for (let index = 0; index < OUTBOX_CAPACITY + 5; index += 1) {
      queue = enqueueScan(queue, item({ id: `i${index}`, code: `C${index}` }));
    }
    expect(queue).toHaveLength(OUTBOX_CAPACITY);
    expect(queue[0].id).toBe("i5");
  });

  it("wycofanie rosnie wykladniczo i ma sufit", () => {
    expect(backoffDelayMs(0)).toBe(2_000);
    expect(backoffDelayMs(3)).toBe(16_000);
    expect(backoffDelayMs(30)).toBe(300_000);
  });

  it("odmowa POSWIADCZENIA zdejmuje pozycje z kolejki, awaria sieci ja odklada", () => {
    const queue = [item({ id: "i1" })];
    expect(withFailure(queue, "i1", "device_revoked: gone", "2026-09-01T08:00:00Z")).toHaveLength(
      0,
    );
    const retried = withFailure(queue, "i1", "TypeError: Failed to fetch", "2026-09-01T08:00:00Z");
    expect(retried[0].attempts).toBe(1);
    expect(retried[0].nextAttemptAt).toBe("2026-09-01T08:00:04.000Z");
    expect(isPermanentFailure("invalid_payload: code is required")).toBe(true);
    expect(errorHead("checkpoint_not_found: nope")).toBe("checkpoint_not_found");
  });

  it("pozycja po limicie prob przestaje byc ponawiana i idzie do „wymaga uwagi”", () => {
    const stuck = item({ id: "i1", attempts: OUTBOX_MAX_ATTEMPTS });
    const fresh = item({ id: "i2" });
    expect(dueItems([stuck, fresh], "2026-09-01T09:00:00Z").map((row) => row.id)).toEqual(["i2"]);
    expect(stuckItems([stuck, fresh])).toHaveLength(1);
    expect(outboxCounts([stuck, fresh])).toEqual({ pending: 1, stuck: 1 });
  });

  it("wysyla w kolejnosci SKANOWANIA, nie dokladania do kolejki", () => {
    const later = item({ id: "later", deviceScannedAt: "2026-09-01T08:10:00Z" });
    const earlier = item({ id: "earlier", deviceScannedAt: "2026-09-01T08:00:00Z" });
    expect(dueItems([later, earlier], "2026-09-01T09:00:00Z").map((row) => row.id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("nie ponawia przed terminem wycofania", () => {
    const waiting = item({ id: "i1", attempts: 2, nextAttemptAt: "2026-09-01T09:00:00Z" });
    expect(dueItems([waiting], "2026-09-01T08:59:00Z")).toHaveLength(0);
    expect(dueItems([waiting], "2026-09-01T09:00:01Z")).toHaveLength(1);
    expect(withoutItem([waiting], "i1")).toHaveLength(0);
  });
});

describe("scannerErrors - co uniewaznia sesje urzadzenia", () => {
  it("uniewaznienie i termin wyrzucaja do parowania, blokada czasowa nie", () => {
    expect(invalidatesSession(new Error("device_revoked: gone"))).toBe(true);
    expect(invalidatesSession(new Error("device_expired: gone"))).toBe(true);
    expect(invalidatesSession(new Error("device_locked: wait"))).toBe(false);
    expect(invalidatesSession(new Error("TypeError: Failed to fetch"))).toBe(false);
  });

  it("wyciaga tekst z kazdej postaci bledu", () => {
    expect(scannerErrorText("plain")).toBe("plain");
    expect(scannerErrorText(new Error("boom"))).toBe("boom");
    expect(scannerErrorText({ message: "z obiektu" })).toBe("z obiektu");
    expect(scannerErrorText(null)).toBe("");
  });
});

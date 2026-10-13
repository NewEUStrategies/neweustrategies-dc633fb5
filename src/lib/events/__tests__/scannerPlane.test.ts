// Plaszczyzna urzadzenia skanujacego: sesja, zakresy i kolejka offline.
//
// TE REGULY DECYDUJA O TYM, CZY LUDZIE WEJDA NA KONGRES. Kolejka bez
// idempotencji zdublowalaby odprawy, kolejka bez wycofania dobijalaby sie do
// bazy do konca baterii, a zakresy bez sprawdzenia otworzylyby wolontariuszowi
// z bramki liste leadow partnera. Kazda z tych rzeczy ma tu wlasny przypadek.
import { describe, expect, it } from "vitest";
import { freezeClock } from "@/test/time";

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
  sessionToRecord,
  clockOffsetMs,
  isClockSkewed,
  CLOCK_SKEW_WARNING_MS,
  withReentryPolicies,
} from "@/lib/events/scannerSession";
import {
  backoffBaseMs,
  backoffDelayMs,
  dueItems,
  enqueueScan,
  enqueueScanWithOverflow,
  errorHead,
  isPermanentFailure,
  outboxCounts,
  outboxDisposition,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_CAPACITY,
  resetBackoff,
  retryingItems,
  stopsFlushRun,
  stuckItems,
  toRejectedItem,
  withFailure,
  withoutItem,
  withoutItems,
  appendRejected,
  isRejectedItem,
  markRejected,
  parseOutboxItem,
  parseRejectedItem,
  reconcileRejected,
  rejectAll,
  REJECTED_CAPACITY,
  type OutboxItem,
} from "@/lib/events/scannerOutbox";
import {
  invalidatesSession,
  scanOutcomeKey,
  scannerErrorKey,
  scannerErrorMessage,
  scannerErrorText,
  isRetryableScanError,
  scannerErrorHead,
} from "@/lib/events/scannerErrors";
import { isCheckinDirection, isCheckinResult, isOfflineOutcome } from "@/lib/events/onsiteEnums";

freezeClock();

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

  it("przepełnienie ODDAJE wypchniętą pozycję zamiast gubić ją po cichu", () => {
    const full = Array.from({ length: OUTBOX_CAPACITY }, (_, index) =>
      item({ id: `i${index}`, code: `C${index}` }),
    );
    const fresh = item({ id: "nowa", code: "NOWY" });
    const result = enqueueScanWithOverflow(full, fresh);
    expect(result.queue).toHaveLength(OUTBOX_CAPACITY);
    expect(result.queue.at(-1)).toBe(fresh);
    expect(result.overflow).toEqual([full[0]]);
    // Bez przepełnienia i przy sklejeniu leadu nic nie wypada.
    expect(enqueueScanWithOverflow([], fresh).overflow).toEqual([]);
    const lead = item({ id: "l1", kind: "lead", code: "X" });
    expect(enqueueScanWithOverflow([lead], { ...lead, id: "l2" }).overflow).toEqual([]);
  });

  it("sklejony lead bierze chwilę NOWSZEGO skanu razem z jego znacznikiem kolejki (OPS-12)", () => {
    // Baza sprawdza je RAZEM: skan najwyżej kwadrans przed wydaniem znacznika
    // i najwyżej dobę po nim - stary znacznik z nową chwilą mógłby nie przejść.
    const merged = enqueueScan(
      enqueueScan(
        [],
        item({
          id: "l1",
          kind: "lead",
          code: "X",
          deviceScannedAt: "2026-09-01T08:00:00Z",
          queueMarker: "m-stary",
        }),
      ),
      item({
        id: "l2",
        kind: "lead",
        code: "X",
        deviceScannedAt: "2026-09-02T09:00:00Z",
        queueMarker: "m-nowy",
      }),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deviceScannedAt: "2026-09-02T09:00:00Z",
      queueMarker: "m-nowy",
    });
    // Nowszy skan bez znacznika nie kasuje starszego.
    const kept = enqueueScan(merged, item({ id: "l3", kind: "lead", code: "X" }));
    expect(kept[0].queueMarker).toBe("m-nowy");
  });

  it("leady sklejają się tylko w obrębie JEDNEGO urządzenia", () => {
    const first = item({ id: "l1", kind: "lead", code: "X", deviceId: "dev-a" });
    const other = enqueueScan([first], { ...first, id: "l2", deviceId: "dev-b" });
    expect(other.map((row) => row.id)).toEqual(["l1", "l2"]);
    const same = enqueueScan([first], { ...first, id: "l3", note: "druga" });
    expect(same).toHaveLength(1);
    expect(same[0].note).toBe("druga");
  });

  it("lista odrzuconych mieści całą kolejkę naraz - z zapasem", () => {
    expect(REJECTED_CAPACITY).toBeGreaterThan(OUTBOX_CAPACITY * 2);
  });

  it("wycofanie rosnie wykladniczo i ma sufit MINUTY (OPS-05, wczesniej 5 minut)", () => {
    expect(backoffBaseMs(0)).toBe(2_000);
    expect(backoffBaseMs(3)).toBe(16_000);
    expect(backoffBaseMs(30)).toBe(OUTBOX_BACKOFF_CAP_MS);
    expect(OUTBOX_BACKOFF_CAP_MS).toBe(60_000);
    // Rozrzut: od polowy do calosci podstawy - nigdy powyzej sufitu.
    expect(backoffDelayMs(3, () => 0)).toBe(8_000);
    expect(backoffDelayMs(3, () => 1)).toBe(16_000);
    expect(backoffDelayMs(30, () => 1)).toBe(60_000);
    expect(backoffDelayMs(30, () => 7)).toBe(60_000);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      expect(backoffDelayMs(attempt)).toBeLessThanOrEqual(OUTBOX_BACKOFF_CAP_MS);
    }
  });

  it("odmowa POSWIADCZENIA zamraza pozycje w kolejce i oddaje ja jako odrzucona, awaria sieci ja odklada", () => {
    const queue = [item({ id: "i1" })];
    const revoked = withFailure(queue, "i1", "device_revoked: gone", "2026-09-01T08:00:00Z");
    // Pozycja ZOSTAJE w kolejce, zamrozona - znika z niej dopiero po trwalym
    // zapisie listy odrzuconych (to druga baza IndexedDB, patrz naglowek).
    expect(revoked.queue).toHaveLength(1);
    expect(isRejectedItem(revoked.queue[0])).toBe(true);
    expect(revoked.queue[0].lastError).toBe("device_revoked: gone");
    expect(dueItems(revoked.queue, "2026-09-01T09:00:00Z")).toHaveLength(0);
    // Oddana jako odrzucona - z bledem, chwila i pozycja w stanie sprzed odmowy,
    // ale BEZ jawnego kodu (OPS-06): zostaje prefiks.
    expect(revoked.rejected).toEqual({
      item: toRejectedItem(queue[0]),
      error: "device_revoked: gone",
      rejectedAt: "2026-09-01T08:00:00Z",
    });
    expect(revoked.rejected?.item).not.toHaveProperty("code");
    expect(revoked.rejected?.item.codePrefix).toBe("AAA");
    const retried = withFailure(
      queue,
      "i1",
      "TypeError: Failed to fetch",
      "2026-09-01T08:00:00Z",
      () => 1,
    );
    expect(retried.rejected).toBeNull();
    expect(retried.queue[0].attempts).toBe(1);
    expect(retried.queue[0].nextAttemptAt).toBe("2026-09-01T08:00:04.000Z");
    expect(isPermanentFailure("invalid_payload: code is required")).toBe(true);
    expect(errorHead("checkpoint_not_found: nope")).toBe("checkpoint_not_found");
  });

  it("OPS-05: po DOWOLNEJ liczbie porazek przejsciowych pozycja nadal jest ponawiana, nie „wymaga uwagi”", () => {
    // Wczesniej po osmiu probach (~8,5 min) pozycja wypadala z wysylki na
    // zawsze. Teraz licznik prob to tylko wykladnik wycofania - bez sufitu.
    const veteran = item({ id: "i1", attempts: 500, lastError: "Scanner request timed out" });
    const fresh = item({ id: "i2" });
    expect(dueItems([veteran, fresh], "2026-09-01T09:00:00Z").map((row) => row.id)).toEqual([
      "i1",
      "i2",
    ]);
    expect(stuckItems([veteran, fresh])).toEqual([]);
    expect(outboxCounts([veteran, fresh])).toEqual({ pending: 2, stuck: 0 });
    expect(retryingItems([veteran, fresh]).map((row) => row.id)).toEqual(["i1"]);
  });

  it("OPS-05: zerowanie wycofania oddaje te sama tablice, gdy nie ma czego zerowac", () => {
    const now = "2026-09-01T09:00:00.000Z";
    const waiting = item({ id: "w", attempts: 6, nextAttemptAt: "2026-09-01T09:01:00.000Z" });
    const ready = item({ id: "r" });
    const frozen = item({ id: "f", attempts: 3, rejectedAt: now, lastError: "invalid_payload: x" });

    const all = resetBackoff([waiting, ready, frozen], now);
    expect(all.map((row) => [row.id, row.attempts, row.nextAttemptAt])).toEqual([
      ["w", 0, now],
      ["r", 0, ready.nextAttemptAt],
      // Zamrozona (odrzucona) nie wraca do wysylki.
      ["f", 3, frozen.nextAttemptAt],
    ]);
    const queue = [ready];
    expect(resetBackoff(queue, now)).toBe(queue);
    // Tylko wskazane pozycje (przycisk „Ponów” przy jednej pozycji).
    const one = resetBackoff([waiting, item({ id: "x", attempts: 2 })], now, ["x"]);
    expect(one.map((row) => row.attempts)).toEqual([6, 0]);
  });

  it("OPS-05: tabela dyspozycji - przejsciowe ponawiamy, trwale odrzucamy", () => {
    expect(outboxDisposition(new Error("Scanner request timed out"))).toBe("retry");
    expect(outboxDisposition(new TypeError("Failed to fetch"))).toBe("retry");
    expect(outboxDisposition(new Error("<html>502 Bad Gateway</html>"))).toBe("retry");
    expect(outboxDisposition(new Error("device_locked: 30 min"))).toBe("retry");
    expect(outboxDisposition(new Error("rate_limited: slow down"))).toBe("retry");
    expect(outboxDisposition(new Error("device_inactive: paused"))).toBe("hold");
    expect(outboxDisposition(new Error("device_revoked: gone"))).toBe("reject_all");
    expect(outboxDisposition(new Error("device_expired: past"))).toBe("reject_expired");
    expect(outboxDisposition(new Error("invalid_payload: x"))).toBe("reject");
    // Blokada i dlawik dotycza CALEGO urzadzenia - przebieg staje.
    expect(stopsFlushRun(new Error("device_locked: wait"))).toBe(true);
    expect(stopsFlushRun(new Error("Failed to fetch"))).toBe(false);
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

  it("wstrzymanie w panelu jest odwracalne: ani koniec sesji, ani trwała odmowa pozycji", () => {
    expect(invalidatesSession(new Error("device_inactive: paused"))).toBe(false);
    expect(isPermanentFailure("device_inactive: paused")).toBe(false);
    expect(isPermanentFailure("device_mismatch: queued under another credential")).toBe(true);
  });

  it("wyciaga tekst z kazdej postaci bledu", () => {
    expect(scannerErrorText("plain")).toBe("plain");
    expect(scannerErrorText(new Error("boom"))).toBe("boom");
    expect(scannerErrorText({ message: "z obiektu" })).toBe("z obiektu");
    expect(scannerErrorText(null)).toBe("");
  });
});

/* --------------------------- brzegi parsera sesji i kolejki --- */

// PO CO TA SEKCJA. Odpowiedz bazy bywa niepelna nie dlatego, ze baza klamie,
// tylko dlatego, ze telefon przy bramce dziala na tej wersji aplikacji, ktora
// zostala na nim z zeszlego kongresu. Parser, ktory na takim wejsciu rzuca
// albo oddaje `undefined`, gasi ekran w chwili, w ktorej stoi przy nim kolejka.
describe("scannerSession - odpowiedz niepelna nie gasi ekranu", () => {
  it("PUNKT BEZ IDENTYFIKATORA wypada z listy - nie da sie pod niego zapisac skanu", () => {
    const sesja = parseScannerSession({
      ...BOOTSTRAP,
      checkpoints: [{ name_pl: "Duch" }, { id: "c9", name_pl: "Prawdziwy" }],
    });

    expect(sesja?.checkpoints.map((punkt) => punkt.id)).toEqual(["c9"]);
  });

  it("PUNKT BEZ RODZAJU I TRYBU dostaje wartosci domyslne bazy, a nie `undefined`", () => {
    // `event_entry` / `in_only` / `control` to te same wartosci domyslne, ktore
    // ma kolumna w migracji - ekran ma zachowac sie tak jak baza.
    const sesja = parseScannerSession({ ...BOOTSTRAP, checkpoints: [{ id: "c9" }] });
    const punkt = sesja?.checkpoints[0];

    expect(punkt?.kind).toBe("event_entry");
    expect(punkt?.directionMode).toBe("in_only");
    expect(punkt?.accessMode).toBe("control");
    expect(punkt?.capacity).toBeNull();
    expect(punkt?.dedupeWindowSeconds).toBe(0);
    // Bez `sort_order` liczy sie kolejnosc z bazy, a nie przypadkowa.
    expect(punkt?.sortOrder).toBe(0);
  });

  it("OKNO IDEMPOTENCJI spoza liczb spada do zera, a nie do `NaN` na ekranie", () => {
    const sesja = parseScannerSession({
      ...BOOTSTRAP,
      checkpoints: [{ id: "c9", dedupe_window_seconds: "szescdziesiat", capacity: "sto" }],
    });

    expect(sesja?.checkpoints[0].dedupeWindowSeconds).toBe(0);
    expect(sesja?.checkpoints[0].capacity).toBeNull();
  });

  it("LISTA PUNKTOW, KTORA NIE JEST TABLICA, to pusta lista - ekran mowi „brak punktow”", () => {
    const sesja = parseScannerSession({ ...BOOTSTRAP, checkpoints: "brak" });

    expect(sesja?.checkpoints).toEqual([]);
    // Bez punktow i bez przypiecia ekran nie ma czego wybrac.
    expect(sesja === null ? null : defaultCheckpointId(sesja)).toBeNull();
  });

  it("ZAKRESY, KTORE NIE SA TABLICA, to brak zakresow - zaden tryb sie nie otwiera", () => {
    const sesja = parseScannerSession({ ...BOOTSTRAP, scopes: "checkin" });

    expect(sesja?.scopes).toEqual([]);
    expect(sesja === null ? [] : availableModes(sesja)).toEqual([]);
  });

  it("POSWIADCZENIE BEZ NAZWY dostaje pusty napis, a nie `null` w naglowku ekranu", () => {
    const sesja = parseScannerSession({ ...BOOTSTRAP, label: null });

    expect(sesja?.label).toBe("");
  });

  it("punkt SPOZA sesji nie zostaje odnaleziony, a brak wyboru nie jest punktem", () => {
    const sesja = parseScannerSession(BOOTSTRAP);
    if (sesja === null) throw new Error("test: sesja nie powstala");

    expect(findCheckpoint(sesja, "nie-ma-takiego")).toBeNull();
    expect(findCheckpoint(sesja, null)).toBeNull();
    // Bez punktu jedyny sensowny kierunek to wejscie.
    expect(checkpointDirections(null)).toEqual(["in"]);
  });

  it("punkt TYLKO WYJSCIOWY oferuje wylacznie wyjscie", () => {
    const sesja = parseScannerSession({
      ...BOOTSTRAP,
      checkpoints: [{ id: "c9", direction_mode: "out_only" }],
    });
    const punkt = sesja === null ? null : findCheckpoint(sesja, "c9");

    expect(checkpointDirections(punkt)).toEqual(["out"]);
  });

  it("NIECZYTELNA data terminu nie wyrzuca operatora do parowania", () => {
    // Ekran, ktory na zepsutej dacie uzna poswiadczenie za wygasle, zatrzymuje
    // bramke bez zadnego powodu po stronie bazy.
    const sesja = parseScannerSession({ ...BOOTSTRAP, expires_at: "kiedys" });
    if (sesja === null) throw new Error("test: sesja nie powstala");

    expect(isSessionExpired(sesja, "2026-09-01T08:00:00Z")).toBe(false);
    expect(hoursUntilExpiry(sesja, "2026-09-01T08:00:00Z")).toBeNull();
  });

  it("NIECZYTELNA chwila „teraz” tez nie uniewaznia poswiadczenia", () => {
    const sesja = parseScannerSession(BOOTSTRAP);
    if (sesja === null) throw new Error("test: sesja nie powstala");

    expect(isSessionExpired(sesja, "nie-data")).toBe(false);
    expect(hoursUntilExpiry(sesja, "nie-data")).toBeNull();
  });
});

describe("scannerOutbox - brzegi kolejki", () => {
  it("komunikat BEZ dwukropka jest w calosci glowa bledu - i nie jest odmowa bazy", () => {
    // `TypeError: Failed to fetch` ma dwukropek, ale `Failed to fetch` (Safari)
    // juz nie - i to nadal jest awaria sieci, czyli pozycja do ponowienia.
    expect(errorHead("Failed to fetch")).toBe("Failed to fetch");
    expect(isPermanentFailure("Failed to fetch")).toBe(false);
    // Baza ZAWSZE odpowiada `kod: szczegoly`. Goly kod bez dwukropka byl dla
    // kolejki odmowa trwala, a dla toru na zywo - awaria sieci (do kolejki).
    // Jedna regula: bez dwukropka to nie jest odmowa bazy.
    expect(isPermanentFailure("invalid_payload")).toBe(false);
    expect(isRetryableScanError(new Error("invalid_payload"))).toBe(true);
  });

  it("NIECZYTELNA chwila „teraz” nie psuje terminu ponowienia", () => {
    // Zegar urzadzenia bywa przestawiony; termin i tak ma byc data, a nie
    // `Invalid Date`, bo inaczej pozycja nie wyszlaby z kolejki nigdy.
    const [po] = withFailure([item({ id: "i1" })], "i1", "Failed to fetch", "nie-data").queue;

    expect(Number.isNaN(Date.parse(po.nextAttemptAt))).toBe(false);
    expect(po.attempts).toBe(1);
  });

  it("NIECZYTELNA chwila „teraz” przy wyborze zaleglosci nie chowa kolejki", () => {
    const czekajaca = item({ id: "i1", nextAttemptAt: "2020-01-01T00:00:00Z" });

    expect(dueItems([czekajaca], "nie-data")).toHaveLength(1);
  });

  it("nieudana proba dotyka WYLACZNIE swojej pozycji", () => {
    const kolejka = [item({ id: "i1" }), item({ id: "i2", code: "BBB" })];

    const po = withFailure(kolejka, "i1", "Failed to fetch", "2026-09-01T08:00:00Z").queue;

    expect(po[0].attempts).toBe(1);
    expect(po[1].attempts).toBe(0);
    expect(po[1].lastError).toBeNull();
  });
});

describe("scannerErrors - klucz odmowy i klucz wyniku", () => {
  it("glowa komunikatu bazy staje sie kluczem slownika bramki", () => {
    expect(scannerErrorKey(new Error("device_revoked: gone"))).toBe(
      "eventScanner.errors.deviceRevoked",
    );
    // `camel()` zamienia WSZYSTKIE podkreslenia, nie pierwsze.
    expect(scannerErrorKey(new Error("device_checkpoint_mismatch: pinned"))).toBe(
      "eventScanner.errors.deviceCheckpointMismatch",
    );
  });

  it("komunikat, ktory NIE JEST kluczem bazy, spada na zdanie awaryjne", () => {
    // Tekst Postgresa niesie nazwy tabel i ograniczen - pokazanie go przy
    // bramce to wyciek schematu i zdanie bez nastepnego kroku dla operatora.
    for (const blad of [
      new Error("TypeError: Failed to fetch"),
      new Error('relation "event_checkins" does not exist'),
      new Error(""),
      new Error("Nieznana odmowa"),
    ]) {
      expect(scannerErrorKey(blad)).toBe("eventScanner.errors.unknown");
    }
  });

  it("klucz o poprawnym KSZTALCIE, ale bez tlumaczenia, tez spada na zdanie awaryjne", () => {
    expect(scannerErrorKey(new Error("cos_czego_nie_ma: tresc"))).toBe(
      "eventScanner.errors.unknown",
    );
    // Zdanie zawsze istnieje - operator nie zobaczy samego klucza.
    expect(scannerErrorMessage(new Error("cos_czego_nie_ma: tresc"))).not.toBe("");
  });

  it("WYNIK SKANU ma wlasny slownik, a nieznany wynik ma wlasne zdanie awaryjne", () => {
    expect(scanOutcomeKey("unknown_code")).toBe("eventScanner.outcomes.unknownCode");
    expect(scanOutcomeKey("wrong_event")).toBe("eventScanner.outcomes.wrongEvent");
    expect(scanOutcomeKey("cos-czego-nie-ma")).toBe("eventScanner.outcomes.unknown");
  });
});

describe("onsiteEnums - slownik wynikow odprawy", () => {
  it("rozpoznaje WYLACZNIE wyniki ze slownika bazy", () => {
    // Straznik chroni dziennik przed wynikiem, ktorego CHECK bazy nie przyjmie.
    expect(isCheckinResult("granted")).toBe(true);
    expect(isCheckinResult("denied_registration_status")).toBe(true);
    expect(isCheckinResult("wpuszczony")).toBe(false);
    expect(isCheckinResult("")).toBe(false);
  });
});

/* ------------------------------------------------------ tryb offline --- */
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW (tryb offline, 20260926150000):
//   * sesja z pamięci urządzenia (zimny start bez sieci) nie wraca przez ten
//     sam parser co odpowiedź serwera - albo wraca bez zgody na listę offline;
//   * przesunięcie zegara liczone od chwili WYSŁANIA zamiast od środka
//     odcinka żądania (błąd o połowę czasu odpowiedzi na słabym łączu);
//   * pozycja kolejki sprzed zmiany (bez pól offline) nie wczytuje się albo
//     wczytuje się z `undefined` w polach, które flush wysyła do bazy;
//   * trwała odmowa kasuje pozycję zamiast oddać ją jako odrzuconą.

describe("scannerSession - polityka ponownego wejścia (OPS-08)", () => {
  it("punkt niesie politykę z bazy; brak albo wartość obca to `allow` (domyślna kolumny)", () => {
    const session = parseScannerSession({
      ...BOOTSTRAP,
      checkpoints: [
        { id: "c1", reentry_policy: "deny" },
        { id: "c2", reentry_policy: "zakaz" },
        { id: "c3" },
      ],
    });
    expect(session?.checkpoints.map((cp) => cp.reentryPolicy)).toEqual(["deny", "allow", "allow"]);
  });

  it("polityka przeżywa zapis sesji na urządzeniu (zimny start bez sieci)", () => {
    const session = parseScannerSession({
      ...BOOTSTRAP,
      checkpoints: [{ id: "c1", reentry_policy: "deny" }],
    });
    if (session === null) throw new Error("test: sesja nieczytelna");
    expect(parseScannerSession(sessionToRecord(session))?.checkpoints[0].reentryPolicy).toBe(
      "deny",
    );
  });

  it("zmiana z listy offline podmienia politykę; bez zmiany oddaje TĘ SAMĄ sesję", () => {
    const session = parseScannerSession({
      ...BOOTSTRAP,
      checkpoints: [{ id: "c1" }, { id: "c2", reentry_policy: "deny" }],
    });
    if (session === null) throw new Error("test: sesja nieczytelna");
    const next = withReentryPolicies(session, [
      { id: "c1", reentryPolicy: "deny" },
      { id: "obcy", reentryPolicy: "deny" },
    ]);
    expect(next).not.toBe(session);
    expect(next.checkpoints.map((cp) => cp.reentryPolicy)).toEqual(["deny", "deny"]);
    expect(withReentryPolicies(next, [{ id: "c1", reentryPolicy: "deny" }])).toBe(next);
    expect(withReentryPolicies(next, [])).toBe(next);
  });
});

describe("scannerSession - pola trybu offline", () => {
  it("bootstrap niesie zgodę na listę offline, jej pobranie i zegar serwera", () => {
    const session = parseScannerSession({
      ...BOOTSTRAP,
      offline_roster: true,
      roster_downloaded_at: "2026-09-01T07:30:00Z",
      server_now: "2026-09-01T08:00:00.123Z",
    });
    expect(session).toMatchObject({
      offlineRoster: true,
      rosterDownloadedAt: "2026-09-01T07:30:00Z",
      serverNow: "2026-09-01T08:00:00.123Z",
    });
  });

  it("starszy backend bez tych pól to BRAK zgody na listę, a nie zgoda", () => {
    expect(parseScannerSession(BOOTSTRAP)).toMatchObject({
      offlineRoster: false,
      rosterDownloadedAt: null,
      serverNow: null,
    });
    expect(parseScannerSession({ ...BOOTSTRAP, offline_roster: "true" })?.offlineRoster).toBe(
      false,
    );
  });

  it("sesja zapisana w kształcie bazy wraca przez parser BEZ strat", () => {
    const session = parseScannerSession({ ...BOOTSTRAP, offline_roster: true, server_now: "x" });
    if (session === null) throw new Error("test: sesja nieczytelna");
    expect(parseScannerSession(sessionToRecord(session))).toEqual(session);
    expect(JSON.stringify(sessionToRecord(session))).not.toContain("token");
  });

  it("przesunięcie zegara liczy się względem ŚRODKA odcinka żądania", () => {
    const sent = Date.parse("2026-09-01T08:00:00.000Z");
    // Serwer o 08:02:01, żądanie trwało 2 s -> środek 08:00:01 -> +120 s.
    expect(clockOffsetMs("2026-09-01T08:02:01.000Z", sent, sent + 2000)).toBe(120_000);
    expect(clockOffsetMs(null, sent, sent)).toBe(0);
    expect(clockOffsetMs("nie-data", sent, sent)).toBe(0);
  });

  it("ostrzeżenie o zegarze od 90 s odchyłki w obie strony", () => {
    expect(isClockSkewed(CLOCK_SKEW_WARNING_MS)).toBe(false);
    expect(isClockSkewed(CLOCK_SKEW_WARNING_MS + 1)).toBe(true);
    expect(isClockSkewed(-CLOCK_SKEW_WARNING_MS - 1)).toBe(true);
  });
});

describe("scannerOutbox - odrzucone i pozycje z pamięci", () => {
  it("trwała odmowa pozycji, której już nie ma (operator ją zdjął), nie wymyśla odrzuconej", () => {
    const result = withFailure([item({ id: "i2" })], "i1", "device_revoked: x", "t");
    expect(result.queue).toHaveLength(1);
    expect(result.rejected).toBeNull();
  });

  it("skan sprzed tygodnia to trwała odmowa, nie awaria sieci", () => {
    expect(isPermanentFailure("device_time_out_of_range: too old")).toBe(true);
  });

  it("odmowa poświadczenia zamienia CAŁĄ kolejkę w odrzucone z tym samym powodem", () => {
    const queue = [item({ id: "a" }), item({ id: "b" })];
    expect(rejectAll(queue, "device_revoked: x", "t")).toEqual([
      { item: toRejectedItem(queue[0]), error: "device_revoked: x", rejectedAt: "t" },
      { item: toRejectedItem(queue[1]), error: "device_revoked: x", rejectedAt: "t" },
    ]);
  });

  it("OPS-06: wpis odrzuconej NIE niesie jawnego kodu, bloku sejfu ani znacznika kolejki", () => {
    const queued = item({
      id: "s1",
      code: "  QR-SEKRETNY-KOD-0000000000000001 ",
      codeHash: "f".repeat(64),
      queueMarker: "marker",
      sealed: { iv: "0".repeat(24), data: "ab" },
    });
    const rejected = toRejectedItem(queued);
    expect(rejected).not.toHaveProperty("code");
    expect(rejected).not.toHaveProperty("sealed");
    expect(rejected).not.toHaveProperty("queueMarker");
    // Prefiks z kodu bez spacji z czytnika (jak `btrim` w bazie).
    expect(rejected).toMatchObject({ codeHash: "f".repeat(64), codePrefix: "QR-SEK" });
    // Wpis sprzed tej zmiany (z jawnym kodem) wraca z dysku bez kodu.
    const legacy = parseRejectedItem(JSON.parse(JSON.stringify(item({ code: "TICKET-XYZ-1" }))));
    expect(legacy).not.toHaveProperty("code");
    expect(legacy?.codePrefix).toBe("TICKET");
  });

  it("lista odrzuconych dopisuje na koniec, a przepełnienie zjada najstarsze", () => {
    const one = (id: string) => ({ item: item({ id }), error: "e", rejectedAt: "t" });
    const full = Array.from({ length: REJECTED_CAPACITY }, (_, i) => one(`r${i}`));
    const next = appendRejected(full, [one("nowa")]);
    expect(next).toHaveLength(REJECTED_CAPACITY);
    expect(next[0].item.id).toBe("r1");
    expect(next.at(-1)?.item.id).toBe("nowa");
    expect(appendRejected([], [one("x")])).toHaveLength(1);
  });

  it("pozycja sprzed trybu offline wczytuje się z pustymi polami decyzji", () => {
    const legacy = {
      id: "i1",
      kind: "checkin",
      code: "AAA",
      checkpointId: "c1",
      direction: "in",
      note: null,
      interestRating: null,
      deviceScannedAt: "2026-09-01T08:00:00Z",
      attempts: 2,
      nextAttemptAt: "2026-09-01T08:01:00Z",
      lastError: "Failed to fetch",
    };
    expect(parseOutboxItem(legacy)).toEqual({
      ...legacy,
      offlineAdmitted: null,
      offlineOutcome: null,
      rosterGeneratedAt: null,
      deviceId: null,
    });
  });

  it("pozycja z urządzeniem zachowuje je; urządzenie nie-napis wypada", () => {
    expect(parseOutboxItem({ ...item({}), deviceId: "dev-1" })?.deviceId).toBe("dev-1");
    expect(parseOutboxItem({ ...item({}), deviceId: 7 })?.deviceId).toBeNull();
  });

  it("pozycja z decyzją offline zachowuje ją; nieznany wynik offline wypada", () => {
    const withDecision = parseOutboxItem({
      ...item({}),
      kind: "lead",
      direction: "bok",
      interestRating: 4,
      offlineAdmitted: true,
      offlineOutcome: "granted",
      rosterGeneratedAt: "v1",
    });
    expect(withDecision).toMatchObject({
      kind: "lead",
      direction: null,
      interestRating: 4,
      offlineAdmitted: true,
      offlineOutcome: "granted",
      rosterGeneratedAt: "v1",
    });
    expect(
      parseOutboxItem({ ...item({}), offlineOutcome: "denied_capacity" })?.offlineOutcome,
    ).toBeNull();
  });

  it("brakujące liczniki i terminy dostają wartości bezpieczne", () => {
    expect(
      parseOutboxItem({
        id: "i1",
        code: "A",
        kind: "checkin",
        direction: "out",
        interestRating: "5",
      }),
    ).toMatchObject({
      direction: "out",
      interestRating: null,
      deviceScannedAt: "",
      attempts: 0,
      nextAttemptAt: "",
      checkpointId: null,
    });
  });

  it("rekord bez identyfikatora, kodu albo znanego rodzaju wypada", () => {
    expect(parseOutboxItem(null)).toBeNull();
    expect(parseOutboxItem([])).toBeNull();
    expect(parseOutboxItem({ code: "A", kind: "checkin" })).toBeNull();
    expect(parseOutboxItem({ id: "i1", kind: "checkin" })).toBeNull();
    expect(parseOutboxItem({ id: "i1", code: "A", kind: "badge" })).toBeNull();
  });
});

describe("scannerErrors - ponowienie i głowa odmowy", () => {
  it("ponawiamy to, czego baza nie nazwała: sieć i przekroczenie terminu", () => {
    expect(isRetryableScanError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableScanError(new Error("Scanner request timed out"))).toBe(true);
    expect(isRetryableScanError(new Error("TypeError: NetworkError when attempting"))).toBe(true);
    expect(isRetryableScanError(new Error("roster_throttled: wait"))).toBe(false);
  });

  it("głowa odmowy to kod przed dwukropkiem albo cały komunikat", () => {
    expect(scannerErrorHead(new Error("roster_disabled: off"))).toBe("roster_disabled");
    expect(scannerErrorHead("device_expired")).toBe("device_expired");
  });

  it("nowe odmowy trybu offline mają własne zdania, nie zdanie awaryjne", () => {
    for (const head of [
      "roster_disabled",
      "roster_throttled",
      "roster_resync_required",
      "device_time_out_of_range",
      "outbox_overflow",
      "device_mismatch",
    ]) {
      expect(scannerErrorKey(new Error(`${head}: x`))).not.toBe("eventScanner.errors.unknown");
    }
  });

  it("wynik `replay` (ten sam skan wysłany ponownie) ma własny nagłówek", () => {
    expect(scanOutcomeKey("replay")).toBe("eventScanner.outcomes.replay");
  });
});

describe("onsiteEnums - słowniki trybu offline", () => {
  it("rozpoznaje wyniki offline i kierunki wyłącznie ze słownika bazy", () => {
    expect(isOfflineOutcome("unknown_code")).toBe(true);
    expect(isOfflineOutcome("denied_capacity")).toBe(false);
    expect(isCheckinDirection("out")).toBe(true);
    expect(isCheckinDirection("sideways")).toBe(false);
  });
});

describe("scannerOutbox - odrzucona pozycja schodzi z kolejki dopiero po trwalym zapisie", () => {
  const NOW = item({}).deviceScannedAt;

  it("NIEZNANY kod odmowy z bazy jest trwaly - nie osiem ponowien do „wymaga uwagi”", () => {
    // Regresja klasyfikacji: kolejka znala reczna liste kodow, a tor na zywo
    // kazdy kod `kod:`. Kod dolozony w bazie po tej liscie trafial przy bramce
    // do operatora, a w kolejce byl ponawiany do wyczerpania prob.
    const failure = withFailure([item({ id: "i1" })], "i1", "event_closed: closed", NOW);
    expect(failure.rejected?.error).toBe("event_closed: closed");
    expect(failure.queue[0].attempts).toBe(0);
  });

  it("pozycja zamrozona jest „wymaga uwagi”, dopoki lista jej nie przechowa", () => {
    const frozen = withFailure([item({ id: "i1" })], "i1", "invalid_payload: x", NOW).queue;
    expect(stuckItems(frozen).map((row) => row.id)).toEqual(["i1"]);
    expect(outboxCounts(frozen)).toEqual({ pending: 0, stuck: 1 });
  });

  it("nieznana pozycja nie tworzy odrzuconej z niczego", () => {
    const failure = withFailure([item({ id: "i1" })], "brak", "invalid_payload: x", NOW);
    expect(failure.rejected).toBeNull();
    expect(failure.queue).toEqual([item({ id: "i1" })]);
  });

  it("rejectAll pomija pozycje juz zamrozone - zadnego duplikatu w eksporcie", () => {
    const queue = [
      item({ id: "a", rejectedAt: NOW, lastError: "invalid_payload: x" }),
      item({ id: "b" }),
    ];
    expect(rejectAll(queue, "device_revoked: gone", NOW).map((row) => row.item.id)).toEqual(["b"]);
  });

  it("markRejected zamraza wskazane pozycje z powodem i chwila, reszty nie dotyka", () => {
    const queue = [item({ id: "a" }), item({ id: "b" })];
    const entries = rejectAll([queue[0]], "device_revoked: gone", NOW);
    const next = markRejected(queue, entries);
    expect(next[0]).toMatchObject({ rejectedAt: NOW, lastError: "device_revoked: gone" });
    expect(isRejectedItem(next[1])).toBe(false);
    // Juz zamrozona nie dostaje nowego powodu - pierwszy powod jest prawdziwy.
    expect(markRejected(next, rejectAll(next, "inny: x", NOW))[0].lastError).toBe(
      "device_revoked: gone",
    );
  });

  it("withoutItems zdejmuje dokladnie wskazane pozycje", () => {
    const queue = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];
    expect(withoutItems(queue, ["a", "c"]).map((row) => row.id)).toEqual(["b"]);
    expect(withoutItems(queue, [])).toEqual(queue);
  });

  it("start po zamknieciu karty: sierota wraca na liste, przechowana schodzi z kolejki", () => {
    const orphan = item({ id: "sierota", rejectedAt: NOW, lastError: "invalid_payload: x" });
    const kept = item({ id: "znana", rejectedAt: NOW, lastError: "invalid_payload: y" });
    const live = item({ id: "zywa" });
    const result = reconcileRejected(
      [orphan, kept, live],
      [{ item: item({ id: "znana" }), error: "invalid_payload: y", rejectedAt: NOW }],
    );
    expect(result.settled).toEqual(["znana"]);
    expect(result.orphans).toEqual([
      {
        item: toRejectedItem(item({ id: "sierota", lastError: "invalid_payload: x" })),
        error: "invalid_payload: x",
        rejectedAt: NOW,
      },
    ]);
    // Pozycja zywa nie jest ani sierota, ani przechowana.
    expect(result.orphans.some((row) => row.item.id === "zywa")).toBe(false);
  });

  it("parseOutboxItem: znacznik odmowy przezywa zapis, a pozycja zywa nie dostaje pola", () => {
    const frozen = parseOutboxItem(JSON.parse(JSON.stringify(item({ rejectedAt: NOW }))));
    expect(frozen?.rejectedAt).toBe(NOW);
    const live = parseOutboxItem(JSON.parse(JSON.stringify(item({}))));
    expect(live !== null && "rejectedAt" in live).toBe(false);
  });
});

// Srodowisko uruchomieniowe skanera przy bramce: poswiadczenie, siec, kolejka.
//
// PO CO TEN PLIK ISTNIEJE. `useScannerRuntime` jest jedynym miejscem, w ktorym
// spotykaja sie trzy rzeczy decydujace o tym, czy czlowiek wejdzie na kongres:
// czy urzadzenie ma wazne poswiadczenie, czy skan poleci teraz czy do kolejki
// i czy kolejka sama sie oprozni, gdy zasieg wroci. Kazda z tych rzeczy psuje
// sie cicho - operator widzi ten sam ekran i to samo pikniecie.
//
// CO PSUJE SIE BEZ TEGO PLIKU:
//   1. kod o zlym ksztalcie (pusty, sam z bialych znakow, za krotki) leci do
//      bazy i podbija licznik nieudanych rozpoznan urzadzenia - po serii takich
//      prob baza blokuje bramke, ktora dziala poprawnie;
//   2. skan z bilet-em CUDZEGO wydarzenia albo kod JUZ UZYTY lada w kolejce
//      jak awaria sieci i wraca do bazy dwadziescia razy;
//   3. utrata zasiegu w polowie odprawy gubi skan zamiast go zapisac;
//   4. powrot sieci nie oprozia kolejki, bo wolontariusz nie ma jak zauwazyc,
//      ze zasieg wrocil - a przycisk „wyslij” jest tylko awaryjny.
//
// SIEC, PAMIEC URZADZENIA I ZEGAR SA ZASLEPIONE - test nie wychodzi do sieci
// i nie dotyka IndexedDB. Zaslepiamy `scannerApi` (trzy RPC bramki) oraz
// `scannerStorage` (localStorage + IndexedDB), a `navigator.onLine`
// podmieniamy tak samo, jak robi to E2E w `e2e/scanner.spec.ts`.
//
// RODO: zadnych prawdziwych danych. Osoby sa wymyslone, adresy wylacznie
// `example.org`. Ten modul nie hashuje adresow IP, wiec nie ma tu czego
// sprawdzac pod tym katem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import type {
  CheckinScanInput,
  CheckinScanResult,
  LeadScanInput,
  LeadScanResult,
} from "@/lib/events/scannerApi";
import type { OutboxItem } from "@/lib/events/scannerOutbox";
import type { ScannerSession } from "@/lib/events/scannerSession";
import type {
  QueuedScanOutcome,
  SentCheckinOutcome,
  SentLeadOutcome,
} from "@/lib/events/useScanner";

/* --------------------------------------------------------------- atrapy --- */

const api = vi.hoisted(() => ({
  bootstrapScanner: vi.fn<(token: string) => Promise<ScannerSession>>(),
  recordCheckinScan: vi.fn<(input: CheckinScanInput) => Promise<CheckinScanResult>>(),
  recordLeadScan: vi.fn<(input: LeadScanInput) => Promise<LeadScanResult>>(),
}));

vi.mock("@/lib/events/scannerApi", () => api);

/** Pamiec urzadzenia w RAM - bez localStorage i bez IndexedDB. */
const device = vi.hoisted(() => ({
  token: null as string | null,
  queue: [] as OutboxItem[],
  persistent: true,
}));

vi.mock("@/lib/events/scannerStorage", () => ({
  readStoredToken: () => device.token,
  writeStoredToken: (token: string) => {
    device.token = token;
  },
  clearStoredToken: () => {
    device.token = null;
  },
  isOutboxPersistent: () => device.persistent,
  loadOutbox: () => Promise.resolve([...device.queue]),
  saveOutbox: (queue: readonly OutboxItem[]) => {
    device.queue = [...queue];
    return Promise.resolve();
  },
}));

const { useScannerRuntime } = await import("@/lib/events/useScanner");

/* ------------------------------------------------------------ fixture'y --- */

/** Ksztalt wymuszany przez `_event_scanner_device_auth`: 16-128 znakow. */
const TOKEN = "SCN-abcdefghijklmnopqrstuvwxyz01";
const OTHER_TOKEN = "SCN-zyxwvutsrqponmlkjihgfedcba99";
const CHECKPOINT_ID = "11111111-1111-4111-8111-111111111111";

const SESSION: ScannerSession = {
  deviceId: "22222222-2222-4222-8222-222222222222",
  label: "Recepcja A",
  scopes: ["checkin", "lead"],
  expiresAt: null,
  pinnedCheckpointId: CHECKPOINT_ID,
  sponsorId: null,
  event: {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "kongres",
    titlePl: "Kongres testowy",
    titleEn: "Test congress",
    startsAt: null,
    endsAt: null,
    timezone: "Europe/Warsaw",
  },
  checkpoints: [
    {
      id: CHECKPOINT_ID,
      namePl: "Wejscie glowne",
      nameEn: "Main entrance",
      kind: "event_entry",
      directionMode: "in_only",
      accessMode: "control",
      capacity: null,
      dedupeWindowSeconds: 0,
      sortOrder: 0,
    },
  ],
};

function scanResult(over: Partial<CheckinScanResult> = {}): CheckinScanResult {
  return {
    outcome: "granted",
    admit: true,
    result: "granted",
    checkinId: "44444444-4444-4444-8444-444444444444",
    direction: "in",
    occurredAt: "2026-09-01T08:00:00.000Z",
    repeatCount: 0,
    previousCheckinAt: null,
    deviceLocked: false,
    checkpoint: {
      id: CHECKPOINT_ID,
      namePl: "Wejscie glowne",
      nameEn: "Main entrance",
      kind: "event_entry",
      directionMode: "in_only",
      accessMode: "control",
      capacity: null,
      occupancy: 12,
    },
    person: null,
    otherEventTitlePl: null,
    otherEventTitleEn: null,
    ...over,
  };
}

function leadResult(over: Partial<LeadScanResult> = {}): LeadScanResult {
  return {
    outcome: "saved",
    leadId: "55555555-5555-4555-8555-555555555555",
    scanCount: 1,
    consent: true,
    deviceLocked: false,
    person: {
      firstName: "Anna",
      lastName: "Testowa",
      company: "Acme Energy",
      jobTitle: "CTO",
      email: "anna@example.org",
      phone: "+48 600 100 200",
    },
    ...over,
  };
}

/**
 * Pozycja kolejki z poprzedniej zmiany - taka wraca z pamieci urzadzenia.
 *
 * Znaczniki czasu MUSZA lezec w przeszlosci: `dueItems` wysyla tylko to,
 * czego termin ponowienia juz minal. Pozycja z data w przyszlosci wygladalaby
 * na „jeszcze nie teraz” i test milczaco nie sprawdzalby niczego.
 */
function queuedItem(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "queued-1",
    kind: "checkin",
    code: "QR-Z-POPRZEDNIEJ-ZMIANY",
    checkpointId: CHECKPOINT_ID,
    direction: "in",
    note: null,
    interestRating: null,
    deviceScannedAt: "2026-08-01T07:00:00.000Z",
    attempts: 0,
    nextAttemptAt: "2026-08-01T07:00:00.000Z",
    lastError: null,
    ...over,
  };
}

/* ------------------------------------------------------------ narzedzia --- */

let offline = false;

/** Brak zasiegu udajemy PRZEGLADARCE, tak samo jak E2E - to jest ten sygnal,
 *  na ktorym opiera sie skaner (`navigator.onLine`). */
function goOffline(): void {
  offline = true;
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
}

function goOnline(): void {
  offline = false;
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}

function render(initialToken: string | null = null) {
  return renderHookWithQueryClient(() => useScannerRuntime(initialToken));
}

/**
 * Render BEZ parowania, z odczekaniem na wczytanie kolejki z pamieci
 * urzadzenia. Bez tego pierwsza asercja wypada przed `loadOutbox`, a React
 * zglasza aktualizacje stanu poza `act(...)`.
 */
async function renderIdle(initialToken: string | null = null) {
  const view = render(initialToken);
  await act(async () => {});
  return view;
}

/** Parowanie urzadzenia i odczekanie, az sesja bedzie gotowa. */
async function connected(initialToken: string | null = TOKEN) {
  api.bootstrapScanner.mockResolvedValue(SESSION);
  const view = render(initialToken);
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  device.token = null;
  device.queue = [];
  device.persistent = true;
  offline = false;
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => !offline,
  });
});

/* ------------------------------------------------------- poswiadczenie --- */

describe("useScannerRuntime - poswiadczenie urzadzenia", () => {
  it("kod NIEWAZNY nie dotyka bazy: pusty, sam z bialych znakow i za krotki", async () => {
    // Kazde takie wywolanie podbiloby licznik nieudanych rozpoznan urzadzenia
    // (`_event_scanner_device_note_failure`), a po serii baza blokuje bramke.
    // Ksztalt tokenu znamy z gory, wiec odsiewamy go PRZED wyjsciem do sieci.
    const { result } = await renderIdle();

    for (const bad of ["", "   ", "za-krotki", "ma spacje w srodku 123456", "\t\n"]) {
      act(() => {
        result.current.connect(bad);
      });
      expect(result.current.connectError).toBe("invalid_device_token: malformed");
      expect(result.current.status).toBe("idle");
    }
    expect(api.bootstrapScanner).not.toHaveBeenCalled();
    expect(result.current.session).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("poswiadczenie z ADRESU wygrywa z tym z pamieci urzadzenia", async () => {
    // Operator, ktory wlasnie zeskanowal nowy kod z panelu, chce podlaczyc TO
    // urzadzenie. Bez pierwszenstwa dwa wywolania `bootstrap` scigalyby sie
    // o stan sesji, a wygrywaloby to, ktore wrocilo pozniej.
    device.token = OTHER_TOKEN;
    const { result } = await connected(TOKEN);

    expect(api.bootstrapScanner).toHaveBeenCalledTimes(1);
    expect(api.bootstrapScanner).toHaveBeenCalledWith(TOKEN);
    expect(result.current.token).toBe(TOKEN);
    expect(device.token).toBe(TOKEN);
  });

  it("bez tokenu z adresu bierzemy ten z pamieci - wolontariusz nie wpisuje go co wygaszenie ekranu", async () => {
    device.token = TOKEN;
    const { result } = await connected(null);

    expect(api.bootstrapScanner).toHaveBeenCalledWith(TOKEN);
    expect(result.current.session).toEqual(SESSION);
  });

  it("poswiadczenie PO TERMINIE konczy sie stanem `expired`, a nie `ready`", async () => {
    // Ekran ma powiedziec o tym ZANIM ktos zeskanuje bilet - inaczej pierwsza
    // wiadomoscia o wygasnieciu jest odmowa nad glowa uczestnika.
    api.bootstrapScanner.mockResolvedValue({
      ...SESSION,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const { result } = render(TOKEN);

    await waitFor(() => expect(result.current.status).toBe("expired"));
    expect(result.current.session).not.toBeNull();
  });

  it("odmowa UNIEWAZNIAJACA sesje kasuje token z urzadzenia, chwilowa blokada - nie", async () => {
    api.bootstrapScanner.mockRejectedValueOnce(new Error("device_revoked: unieważnione w panelu"));
    device.token = TOKEN;
    const first = render(TOKEN);
    await waitFor(() => expect(first.result.current.connectError).not.toBeNull());
    expect(first.result.current.status).toBe("idle");
    // Token odrzucony przez baze nie ma po co zostawac - kolejne otwarcie
    // ekranu probowaloby go znowu i znowu.
    expect(device.token).toBeNull();
    first.unmount();

    device.token = TOKEN;
    api.bootstrapScanner.mockRejectedValueOnce(new Error("device_locked: cooling down"));
    const second = render(TOKEN);
    await waitFor(() => expect(second.result.current.connectError).not.toBeNull());
    // Blokada czasowa mija sama, wiec poswiadczenie zostaje na urzadzeniu.
    expect(device.token).toBe(TOKEN);
  });

  it("odlaczenie kasuje poswiadczenie i wraca do ekranu parowania", async () => {
    const { result } = await connected();
    expect(device.token).toBe(TOKEN);

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.session).toBeNull();
    expect(result.current.token).toBeNull();
    expect(result.current.connectError).toBeNull();
    expect(device.token).toBeNull();
  });
});

/* -------------------------------------------------------- skan przy bramce --- */

describe("useScannerRuntime - skan przy bramce", () => {
  it("skan BEZ sesji nie leci do bazy", async () => {
    const { result } = await renderIdle();
    await expect(
      result.current.submitCheckin({ code: "QR-1", checkpointId: null, direction: "in" }),
    ).rejects.toThrow("invalid_device_token");
    expect(api.recordCheckinScan).not.toHaveBeenCalled();
  });

  it("skan online niesie klucz idempotencji i chwile SKANU, a kolejka zostaje pusta", async () => {
    api.recordCheckinScan.mockResolvedValue(scanResult());
    const { result } = await connected();

    let outcome: QueuedScanOutcome | SentCheckinOutcome | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: "QR-ONLINE-1",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
    });

    expect(outcome).toEqual({ queued: false, result: scanResult() });
    const sent = api.recordCheckinScan.mock.calls[0][0];
    expect(sent.deviceToken).toBe(TOKEN);
    expect(sent.code).toBe("QR-ONLINE-1");
    expect(sent.checkpointId).toBe(CHECKPOINT_ID);
    expect(sent.direction).toBe("in");
    // Bez klucza idempotencji ponowienie z kolejki zalozyloby druga odprawe.
    expect(sent.clientScanUid).toEqual(expect.any(String));
    expect(sent.clientScanUid).not.toBe("");
    // Dziennik ma pokazac, KIEDY ktos stanal w bramce, nie kiedy wyszlo zadanie.
    expect(sent.deviceScannedAt).toEqual(expect.any(String));
    expect(result.current.outbox).toEqual([]);
    expect(result.current.outboxCounts).toEqual({ pending: 0, stuck: 0 });
  });

  it("kod CUDZEGO wydarzenia to POPRAWNA odpowiedz bazy, nie awaria - nic nie ladu w kolejce", async () => {
    // `wrong_event` wraca jako wynik RPC, a nie jako wyjatek. Gdyby warstwa
    // danych potraktowala to jak blad sieci, bilet z sasiedniego kongresu
    // wracalby do bazy z kolejki az do konca baterii.
    api.recordCheckinScan.mockResolvedValue(
      scanResult({
        outcome: "wrong_event",
        admit: false,
        result: null,
        checkinId: null,
        otherEventTitlePl: "Forum Energetyczne",
        otherEventTitleEn: "Energy Forum",
      }),
    );
    const { result } = await connected();

    let outcome: QueuedScanOutcome | SentCheckinOutcome | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: "QR-CUDZE-WYDARZENIE",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
    });

    expect(outcome).toMatchObject({ queued: false });
    if (outcome === undefined || outcome.queued) throw new Error("test: skan nie doszedl do bazy");
    expect(outcome.result.outcome).toBe("wrong_event");
    expect(outcome.result.admit).toBe(false);
    expect(outcome.result.otherEventTitlePl).toBe("Forum Energetyczne");
    expect(result.current.outbox).toEqual([]);
    expect(api.recordCheckinScan).toHaveBeenCalledTimes(1);
  });

  it("kod JUZ UZYTY: dwa pikniecia to DWA zdarzenia z roznymi kluczami idempotencji", async () => {
    // Powtorzenie rozstrzyga BAZA (okno powtorzen + ograniczenie EXCLUDE), nie
    // ekran. Gdybysmy wyslali ten sam `client_scan_uid`, drugie pikniecie
    // zniknelo by z dziennika - a organizator ma widziec, ze ktos podszedl
    // do bramki dwa razy.
    api.recordCheckinScan.mockResolvedValueOnce(scanResult()).mockResolvedValueOnce(
      scanResult({
        outcome: "repeat",
        repeatCount: 1,
        previousCheckinAt: "2026-09-01T08:00:00.000Z",
      }),
    );
    const { result } = await connected();

    let second: QueuedScanOutcome | SentCheckinOutcome | undefined;
    await act(async () => {
      await result.current.submitCheckin({
        code: "QR-POWTORKA",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
      second = await result.current.submitCheckin({
        code: "QR-POWTORKA",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
    });

    expect(api.recordCheckinScan).toHaveBeenCalledTimes(2);
    const [first, repeat] = api.recordCheckinScan.mock.calls.map((call) => call[0]);
    expect(first.code).toBe(repeat.code);
    expect(first.clientScanUid).not.toBe(repeat.clientScanUid);
    if (second === undefined || second.queued) throw new Error("test: skan nie doszedl do bazy");
    expect(second.result.repeatCount).toBe(1);
    expect(second.result.previousCheckinAt).toBe("2026-09-01T08:00:00.000Z");
    expect(result.current.outbox).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // REGRESJA NA MIGRACJE 20260828206000 I 20260830090000.
  //
  // Przed tamta naprawa `event_register` w ogole nie sprawdzalo ceny
  // wejsciowki: platny bilet wychodzil za darmo, RAZEM Z DZIALAJACYM KODEM QR.
  // Po naprawie zgloszenie z `payment_status = 'unpaid'` NIE DOSTAJE kodu QR -
  // `qr_token_hash` zostaje puste, a `approved` jest dla takiego zgloszenia
  // zabronione.
  //
  // Dla bramki znaczy to jedno: takiego kodu NIE MA jak zeskanowac. Baza
  // szuka po haszu (`r.qr_token_hash = encode(digest(code,'sha256'),'hex')`),
  // nic nie znajduje i oddaje `unknown_code` z `admit => false`. Warstwa
  // danych ma to PRZENIESC BEZ ZMIAN i - to jest druga polowa regresji - NIE
  // WOLNO jej wziac tego za awarie sieci i wsadzic skanu do kolejki, bo po
  // powrocie zasiegu probowalaby wpuscic te osobe jeszcze raz.
  // -------------------------------------------------------------------------
  it("REGRESJA (20260828206000 + 20260830090000): kod zgloszenia `unpaid` NIE ISTNIEJE, bramka oddaje `unknown_code` i NIE wpuszcza", async () => {
    api.recordCheckinScan.mockResolvedValue(
      scanResult({
        outcome: "unknown_code",
        admit: false,
        result: null,
        checkinId: null,
        direction: null,
        occurredAt: null,
        // Seria nieznanych kodow blokuje urzadzenie - ekran musi to podac.
        deviceLocked: false,
        person: null,
      }),
    );
    const { result } = await connected();

    let outcome: QueuedScanOutcome | SentCheckinOutcome | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: "QR-NIEOPLACONE-ZGLOSZENIE",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
    });

    if (outcome === undefined || outcome.queued) {
      throw new Error("test: kod nieoplaconego zgloszenia trafil do kolejki zamiast do bazy");
    }
    expect(outcome.result.outcome).toBe("unknown_code");
    expect(outcome.result.admit).toBe(false);
    expect(outcome.result.checkinId).toBeNull();
    // Nie ma czego ponawiac: kodu nie ma w bazie i nie pojawi sie tam sam.
    expect(result.current.outbox).toEqual([]);
    expect(api.recordCheckinScan).toHaveBeenCalledTimes(1);
    // Nigdzie w wyniku nie ma sladu kodu QR - po naprawie nie ma go czym wydac.
    expect(JSON.stringify(outcome)).not.toContain("qr_token");
  });

  it("seria nieznanych kodow blokuje urzadzenie, ale NIE zrywa sesji", async () => {
    api.recordCheckinScan.mockResolvedValue(
      scanResult({ outcome: "unknown_code", admit: false, result: null, deviceLocked: true }),
    );
    const { result } = await connected();

    await act(async () => {
      await result.current.submitCheckin({
        code: "QR-NIEZNANY",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
    });

    // Blokada mija sama - wyrzucenie operatora do parowania kosztowaloby go
    // ponowne wpisywanie tokenu w srodku kolejki.
    expect(result.current.status).toBe("ready");
    expect(device.token).toBe(TOKEN);
  });
});

/* ------------------------------------------------- utrata sieci i powrot --- */

describe("useScannerRuntime - utrata polaczenia i powrot sieci", () => {
  it("BEZ SIECI skan trafia do kolejki, a nie do bazy", async () => {
    const { result } = await connected();
    goOffline();
    await waitFor(() => expect(result.current.online).toBe(false));

    let outcome: QueuedScanOutcome | SentCheckinOutcome | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: "QR-OFFLINE-1",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
    });

    expect(outcome).toEqual({ queued: true });
    expect(api.recordCheckinScan).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    expect(result.current.outbox[0]).toMatchObject({
      kind: "checkin",
      code: "QR-OFFLINE-1",
      checkpointId: CHECKPOINT_ID,
      direction: "in",
      attempts: 0,
      lastError: null,
    });
    // Kolejka jest ZAPISANA na urzadzeniu, nie tylko w pamieci komponentu -
    // inaczej wygaszenie ekranu kasowaloby odprawy.
    expect(device.queue).toHaveLength(1);
    expect(result.current.outboxCounts).toEqual({ pending: 1, stuck: 0 });
  });

  it("AWARIA SIECI bez nazwy od bazy tez trafia do kolejki", async () => {
    // `fetch` rzuca `TypeError: Failed to fetch` - komunikat bez rozpoznawalnego
    // prefiksu. To jedyny rodzaj bledu, ktory ma sens ponawiac.
    api.recordCheckinScan.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = await connected();

    let outcome: QueuedScanOutcome | SentCheckinOutcome | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: "QR-ZERWANE-LACZE",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
    });

    expect(outcome).toEqual({ queued: true });
    await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    expect(result.current.outbox[0].code).toBe("QR-ZERWANE-LACZE");
  });

  it("odmowa NAZWANA przez baze nie idzie do kolejki - odczekanie jej nie naprawi", async () => {
    api.recordCheckinScan.mockRejectedValue(
      new Error("invalid_payload: checkpoint_id is required"),
    );
    const { result } = await connected();

    await expect(
      result.current.submitCheckin({ code: "QR-ZLY-LADUNEK", checkpointId: null, direction: "in" }),
    ).rejects.toThrow("invalid_payload");
    expect(result.current.outbox).toEqual([]);
  });

  it("odmowa POSWIADCZENIA leci do wolajacego, a nie do kolejki", async () => {
    api.recordCheckinScan.mockRejectedValue(new Error("device_revoked: unieważnione w panelu"));
    const { result } = await connected();

    await expect(
      result.current.submitCheckin({
        code: "QR-PO-UNIEWAZNIENIU",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      }),
    ).rejects.toThrow("device_revoked");
    expect(result.current.outbox).toEqual([]);
  });

  it("POWROT SIECI oprozia kolejke bez udzialu czlowieka", async () => {
    // To jest cala obietnica kolejki. Wolontariusz przy bramce nie ma jak
    // zauwazyc, ze zasieg wrocil - przycisk „wyslij” jest tylko awaryjny.
    api.recordCheckinScan.mockResolvedValue(scanResult());
    const { result } = await connected();

    goOffline();
    await waitFor(() => expect(result.current.online).toBe(false));
    await act(async () => {
      await result.current.submitCheckin({
        code: "QR-W-KOLEJCE",
        checkpointId: CHECKPOINT_ID,
        direction: "in",
      });
    });
    await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    expect(api.recordCheckinScan).not.toHaveBeenCalled();
    const queued = result.current.outbox[0];

    goOnline();

    await waitFor(() => expect(api.recordCheckinScan).toHaveBeenCalledTimes(1));
    const sent = api.recordCheckinScan.mock.calls[0][0];
    expect(sent.code).toBe("QR-W-KOLEJCE");
    // Klucz idempotencji ponowienia to identyfikator pozycji kolejki - to on
    // sprawia, ze wyslany dwa razy skan nie tworzy dwoch odpraw.
    expect(sent.clientScanUid).toBe(queued.id);
    // Do dziennika idzie chwila SKANU sprzed utraty sieci, a nie chwila,
    // w ktorej zasieg wrocil - inaczej godzina wejscia bylaby zmyslona.
    expect(sent.deviceScannedAt).toBe(queued.deviceScannedAt);
    await waitFor(() => expect(result.current.outbox).toEqual([]));
    expect(device.queue).toEqual([]);
  });

  it("wysylka zaleglosci jest SZEREGOWA i chronologiczna", async () => {
    // Dwadziescia rownoleglych zadan z telefonu na slabym laczu konczy sie
    // dwudziestoma przekroczeniami czasu; jedno po drugim przechodzi.
    // Kolejnosc jest chronologiczna, bo dziennik ma sie zgadzac z tym, co
    // dzialo sie przy bramce - kolejka na dysku jest nieuporzadkowana.
    let inFlight = 0;
    let maxInFlight = 0;
    const sentOrder: string[] = [];
    api.recordCheckinScan.mockImplementation(async (input: CheckinScanInput) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      sentOrder.push(input.code);
      inFlight -= 1;
      return scanResult();
    });

    device.queue = [
      queuedItem({ id: "b", code: "QR-DRUGI", deviceScannedAt: "2026-08-01T07:05:00.000Z" }),
      queuedItem({ id: "a", code: "QR-PIERWSZY", deviceScannedAt: "2026-08-01T07:00:00.000Z" }),
      queuedItem({ id: "c", code: "QR-TRZECI", deviceScannedAt: "2026-08-01T07:10:00.000Z" }),
    ];
    // Sparowanie urzadzenia jest samo w sobie sygnalem „mozna wysylac”:
    // zaleglosci z poprzedniej zmiany wychodza bez klikania czegokolwiek.
    const { result } = await connected();

    await waitFor(() => expect(sentOrder).toHaveLength(3));
    expect(sentOrder).toEqual(["QR-PIERWSZY", "QR-DRUGI", "QR-TRZECI"]);
    expect(maxInFlight).toBe(1);
    await waitFor(() => expect(result.current.outbox).toEqual([]));
  });

  it("odmowa poswiadczenia PRZERYWA przebieg kolejki zamiast dobijac sie nia dwadziescia razy", async () => {
    api.recordCheckinScan.mockRejectedValue(new Error("device_expired: token po terminie"));
    device.queue = [
      queuedItem({ id: "a", code: "QR-A", deviceScannedAt: "2026-08-01T07:00:00.000Z" }),
      queuedItem({ id: "b", code: "QR-B", deviceScannedAt: "2026-08-01T07:01:00.000Z" }),
      queuedItem({ id: "c", code: "QR-C", deviceScannedAt: "2026-08-01T07:02:00.000Z" }),
    ];
    const { result } = await connected();

    // Pozycja z odmowa trwala znika z kolejki (nie ma czego ponawiac),
    // a przebieg sie urywa - reszta czeka na nowe poswiadczenie.
    await waitFor(() => expect(result.current.outbox).toHaveLength(2));
    expect(result.current.outbox.map((item) => item.code)).toEqual(["QR-B", "QR-C"]);
    expect(api.recordCheckinScan).toHaveBeenCalledTimes(1);
  });

  it("kolejka z poprzedniej zmiany wraca z pamieci urzadzenia, zanim ktokolwiek zeskanuje", async () => {
    device.queue = [queuedItem()];
    // Bez poswiadczenia nic sie nie wysyla - kolejka ma tylko wrocic na ekran.
    const { result } = render();

    await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    expect(result.current.outbox[0].code).toBe("QR-Z-POPRZEDNIEJ-ZMIANY");
    expect(api.recordCheckinScan).not.toHaveBeenCalled();
  });

  it("brak trwalosci kolejki jest STANEM widocznym dla operatora, a nie cicha awaria", async () => {
    // Prywatne okno Safari potrafi odmowic IndexedDB. Skaner ma dzialac dalej,
    // ale ekran musi powiedziec, ze kolejka nie przezyje zamkniecia karty.
    device.persistent = false;
    const { result } = render();

    await waitFor(() => expect(result.current.outboxPersistent).toBe(false));
  });

  it("operator moze ZDJAC pozycje z kolejki, ktorej nie da sie wyslac", async () => {
    device.queue = [queuedItem({ id: "do-zdjecia", attempts: 8, lastError: "Failed to fetch" })];
    const { result } = render();
    await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    // Pozycja po ostatniej probie nie jest juz ponawiana - liczy sie jako
    // „wymaga uwagi”, nie jako czekajaca.
    expect(result.current.outboxCounts).toEqual({ pending: 0, stuck: 1 });

    act(() => {
      result.current.discard("do-zdjecia");
    });

    await waitFor(() => expect(result.current.outbox).toEqual([]));
    expect(device.queue).toEqual([]);
  });

  it("reczne `flush` bez poswiadczenia nie dotyka bazy", async () => {
    device.queue = [queuedItem()];
    const { result } = render();
    await waitFor(() => expect(result.current.outbox).toHaveLength(1));

    act(() => {
      result.current.flush();
    });

    expect(api.recordCheckinScan).not.toHaveBeenCalled();
    expect(result.current.flushing).toBe(false);
  });
});

/* --------------------------------------------------------------- leady --- */

describe("useScannerRuntime - skan leadu", () => {
  it("lead bez sesji nie leci do bazy", async () => {
    const { result } = await renderIdle();
    await expect(
      result.current.submitLead({ code: "QR-L", note: null, interestRating: null }),
    ).rejects.toThrow("invalid_device_token");
  });

  it("lead online oddaje wynik bazy, a notatka i ocena jada razem z kodem", async () => {
    api.recordLeadScan.mockResolvedValue(leadResult());
    const { result } = await connected();

    let outcome: QueuedScanOutcome | SentLeadOutcome | undefined;
    await act(async () => {
      outcome = await result.current.submitLead({
        code: "QR-LEAD-1",
        note: "chce oferte na Q1",
        interestRating: 4,
      });
    });

    expect(api.recordLeadScan).toHaveBeenCalledWith({
      deviceToken: TOKEN,
      code: "QR-LEAD-1",
      note: "chce oferte na Q1",
      interestRating: 4,
    });
    if (outcome === undefined || outcome.queued) throw new Error("test: lead nie doszedl do bazy");
    expect(outcome.result.consent).toBe(true);
    expect(outcome.result.person?.email).toBe("anna@example.org");
  });

  it("BEZ SIECI leady tego samego gosca SKLEJAJA sie w jedna pozycje kolejki", async () => {
    // Ten sam gosc podchodzi do stoiska trzy razy w ciagu minuty. Trzy pozycje
    // dalyby `scan_count` = 3 za jedno spotkanie.
    const { result } = await connected();
    goOffline();
    await waitFor(() => expect(result.current.online).toBe(false));

    await act(async () => {
      await result.current.submitLead({ code: "QR-LEAD-2", note: null, interestRating: null });
      await result.current.submitLead({
        code: "QR-LEAD-2",
        note: "rozmowa o Q1",
        interestRating: 5,
      });
    });

    await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    expect(result.current.outbox[0]).toMatchObject({
      kind: "lead",
      code: "QR-LEAD-2",
      note: "rozmowa o Q1",
      interestRating: 5,
    });
    expect(api.recordLeadScan).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------- defekty --- */

// -----------------------------------------------------------------------------
// DEFEKT: chwilowa blokada urzadzenia GUBI SKAN zamiast wsadzic go do kolejki.
//
// `useScanner.isRetryable` uznaje za trwaly KAZDY komunikat z rozpoznawalnym
// prefiksem bazy (`^[a-z][a-z0-9_]*:`). Trafia w to takze `device_locked:`,
// a to jest blokada CZASOWA: `scannerErrors.invalidatesSession` wyklucza ja
// wprost („mija sama i poswiadczenie nadal jest wazne”), a
// `scannerOutbox.PERMANENT_HEADS` - jedyna lista odmow, ktorych nie warto
// ponawiac - rowniez jej NIE zawiera. Dwa moduly tej samej warstwy mowia wiec
// „to minie”, a trzeci wyrzuca skan.
//
// Koszt przy bramce: urzadzenie zablokowane po serii nieznanych kodow (np. gdy
// kolejka niesie bilety nieoplaconych zgloszen, ktore po migracjach
// 20260828206000 / 20260830090000 nie maja kodu QR) odrzuca kazdy NASTEPNY
// skan bezpowrotnie - wlacznie z waznymi. Operator dostaje wyjatek, kolejka
// zostaje pusta i po ustaniu blokady nie ma czego wyslac; te odprawy nie
// istnieja w dzienniku.
//
// Naprawa nalezy do produkcji: `isRetryable` powinno pytac
// `scannerOutbox.isPermanentFailure`, zamiast trzymac wlasna, szersza regule.
// -----------------------------------------------------------------------------
describe("useScannerRuntime - znane defekty", () => {
  it.fails(
    "skan odrzucony CHWILOWA blokada urzadzenia (`device_locked`) powinien trafic do kolejki, a jest gubiony - `isRetryable` uznaje go za odmowe trwala, wbrew `scannerOutbox.PERMANENT_HEADS`",
    async () => {
      api.recordCheckinScan.mockRejectedValue(new Error("device_locked: cooling down"));
      const { result } = await connected();

      let outcome: QueuedScanOutcome | SentCheckinOutcome | undefined;
      await act(async () => {
        outcome = await result.current.submitCheckin({
          code: "QR-PO-BLOKADZIE",
          checkpointId: CHECKPOINT_ID,
          direction: "in",
        });
      });

      expect(outcome).toEqual({ queued: true });
      await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    },
  );
});

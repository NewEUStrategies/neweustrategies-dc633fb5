// JEDNA klasyfikacja odmów płaszczyzny urządzenia - tor na żywo i kolejka.
//
// CO TEN PLIK DOWODZI. Wcześniej odmowę klasyfikowały dwie reguły:
// `isRetryableScanError` (tor na żywo) i `isPermanentFailure` z ręczną listą
// kodów (kolejka). Rozjeżdżały się na każdym kodzie spoza listy i na komunikacie
// bez dwukropka. Tabela poniżej przypina klasę KAŻDEGO kodu płaszczyzny
// urządzenia (RAISE EXCEPTION w `event_checkin_record`, `event_lead_scan_record`,
// `_event_scanner_device_auth[_sync]`, `_event_checkin_write`), awarii
// transportu i kodów lokalnych, a test spójności - że obie strony odpowiadają
// tak samo dla każdego z nich.
import { describe, expect, it } from "vitest";

import {
  invalidatesSession,
  isPermanentScanError,
  isRetryableScanError,
  scanErrorKind,
  scannerErrorHead,
  scannerErrorText,
  type ScanErrorKind,
} from "@/lib/events/scannerErrorKind";
import { isPermanentFailure } from "@/lib/events/scannerOutbox";

const CASES: ReadonlyArray<readonly [string, ScanErrorKind]> = [
  // Transport: brak głowy `kod:`.
  ["TypeError: Failed to fetch", "transport"],
  ["Failed to fetch", "transport"],
  ["Scanner request timed out", "transport"],
  ["NetworkError when attempting to fetch resource.", "transport"],
  [
    "upstream connect error or disconnect/reset before headers. reset reason: connection termination",
    "transport",
  ],
  ["invalid_payload", "transport"],
  ["", "transport"],
  // Odwracalne.
  ["device_locked: too many unknown codes", "locked"],
  ["device_inactive: paused by organizer", "paused"],
  // Koniec sesji.
  ["invalid_device_token: unknown token", "session"],
  ["device_revoked: revoked in panel", "session"],
  ["device_expired: credential expired", "session"],
  // Odmowa TEJ pozycji - kody bazy i kody lokalne.
  ["device_scope_missing: no checkin scope", "refused"],
  ["device_checkpoint_mismatch: pinned elsewhere", "refused"],
  ["checkpoint_not_found: nope", "refused"],
  ["invalid_payload: code is required", "refused"],
  ["invalid_direction: out at in_only", "refused"],
  ["device_time_out_of_range: scan older than 7 days", "refused"],
  ["device_mismatch: queued under another credential", "refused"],
  ["outbox_overflow: device queue full", "refused"],
  // Kod, którego jeszcze nie ma - nowa odmowa bazy jest odmową, nie siecią.
  ["event_closed: check-in closed by organizer", "refused"],
];

describe("scanErrorKind - jedna tabela klas", () => {
  it.each(CASES)("%j -> %s", (message, kind) => {
    expect(scanErrorKind(new Error(message))).toBe(kind);
    // Ta sama odpowiedź dla napisu i dla obiektu z `message` (PostgrestError).
    expect(scanErrorKind(message)).toBe(kind);
    expect(scanErrorKind({ message })).toBe(kind);
  });

  it("odmowa bez obiektu błędu (null, liczba) to transport, nie odmowa bazy", () => {
    expect(scanErrorKind(null)).toBe("transport");
    expect(scanErrorKind(42)).toBe("transport");
    expect(scannerErrorText(undefined)).toBe("");
  });

  it("głowa to tekst przed PIERWSZYM dwukropkiem, bez odstępów", () => {
    expect(scannerErrorHead(new Error(" device_locked : a: b"))).toBe("device_locked");
    expect(scannerErrorHead("bez dwukropka")).toBe("bez dwukropka");
  });
});

describe("spójność toru na żywo i kolejki", () => {
  it.each(CASES)("%j: obie strony odpowiadają tą samą regułą", (message, kind) => {
    const retryable = isRetryableScanError(new Error(message));
    const permanent = isPermanentFailure(message);
    // Nigdy obie naraz: albo czekamy na sieć, albo odrzucamy.
    expect(retryable && permanent).toBe(false);
    // Poza wstrzymaniem (ani ponawiane w pętli, ani odrzucane) zawsze jedna z dwóch.
    if (kind !== "paused") expect(retryable || permanent).toBe(true);
    expect(permanent).toBe(isPermanentScanError(message));
    expect(invalidatesSession(new Error(message))).toBe(kind === "session");
  });
});

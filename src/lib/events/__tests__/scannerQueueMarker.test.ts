// Znacznik kolejki urządzenia (OPS-12) - reguła czysta i sejf.
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. SPÓŹNIONA ODPOWIEDŹ (starsze żądanie) podmienia nowszy znacznik na
//      starszy - pozycje kolejkowane później dostają znacznik, który baza po
//      terminie odrzuci (skan > wydanie + 24 h).
//   2. ODPOWIEDŹ BEZ ZNACZNIKA (poświadczenie po terminie dostaje `{}`) kasuje
//      ostatni znacznik - kolejne pozycje jadą bez niego.
//   3. ZNACZNIK CUDZEGO URZĄDZENIA stempluje pozycję innego poświadczenia.
//   4. ZAPIS NA DYSK przy każdej odpowiedzi - szyfrowanie i IndexedDB przy
//      każdym skanie - albo przeciwnie: nigdy nowszy.
//   5. BLOK SEJFU otwiera się pod innym urządzeniem albo innym kluczem.
import { describe, expect, it } from "vitest";

import {
  QUEUE_MARKER_PERSIST_STEP_MS,
  SCANNER_CLIENT_CAPS,
  newerQueueMarker,
  openQueueMarker,
  parseQueueMarker,
  queueMarkerFor,
  sealQueueMarker,
  shouldPersistQueueMarker,
  type QueueMarker,
} from "@/lib/events/scannerQueueMarker";
import { deriveVaultKey } from "@/lib/events/scannerVault";

/** Kształt znacznika z bazy: 54 znaki base64url. */
const VALUE_A = "AAAAAGkAAAA" + "a".repeat(43);
const VALUE_B = "AAAAAGkAAAB" + "b".repeat(43);

function marker(value: string, validUntil: string | null): QueueMarker {
  return { value, validUntil };
}

async function key(token: string): Promise<CryptoKey> {
  const derived = await deriveVaultKey(token);
  if (derived === null) throw new Error("test: brak WebCrypto w środowisku testowym");
  return derived;
}

describe("odczyt znacznika z odpowiedzi bazy", () => {
  it("bierze `queue_marker` i `queue_marker_valid_until` bez interpretacji napisu", () => {
    expect(
      parseQueueMarker({
        outcome: "granted",
        queue_marker: VALUE_A,
        queue_marker_valid_until: "2026-10-13T08:00:00+00:00",
      }),
    ).toEqual({ value: VALUE_A, validUntil: "2026-10-13T08:00:00+00:00" });
  });

  it("odpowiedź po terminie (`{}`), pusty albo obcy napis to BRAK znacznika", () => {
    expect(parseQueueMarker({})).toBeNull();
    expect(parseQueueMarker({ queue_marker: "" })).toBeNull();
    expect(parseQueueMarker({ queue_marker: "ma spacje i znaki: /+=" })).toBeNull();
    expect(parseQueueMarker({ queue_marker: 42 })).toBeNull();
    expect(parseQueueMarker(null)).toBeNull();
    expect(parseQueueMarker([VALUE_A])).toBeNull();
  });

  it("nieczytelny termin to termin nieznany, a znacznik zostaje", () => {
    expect(parseQueueMarker({ queue_marker: VALUE_A, queue_marker_valid_until: "kiedyś" })).toEqual(
      { value: VALUE_A, validUntil: null },
    );
  });

  it("klient deklaruje bazie DOKŁADNIE jedną zdolność: stemplowanie kolejki", () => {
    expect(SCANNER_CLIENT_CAPS).toEqual(["queue_marker"]);
  });
});

describe("który znacznik trzymać", () => {
  const older = marker(VALUE_A, "2026-10-13T08:00:00.000Z");
  const newer = marker(VALUE_B, "2026-10-13T09:00:00.000Z");

  it("nowszy wypiera starszy, a SPÓŹNIONA odpowiedź ze starszym nie cofa stanu", () => {
    expect(newerQueueMarker(older, newer)).toBe(newer);
    expect(newerQueueMarker(newer, older)).toBe(newer);
  });

  it("odpowiedź bez znacznika niczego nie kasuje", () => {
    expect(newerQueueMarker(newer, null)).toBe(newer);
    expect(newerQueueMarker(null, null)).toBeNull();
    expect(newerQueueMarker(null, older)).toBe(older);
  });

  it("ten sam termin (przycięty do terminu poświadczenia) - wygrywa świeżo odebrany", () => {
    const capped = marker(VALUE_B, older.validUntil);
    expect(newerQueueMarker(older, capped)).toBe(capped);
  });

  it("stempel tylko dla pozycji TEGO urządzenia", () => {
    const held = { deviceId: "dev-1", marker: newer };
    expect(queueMarkerFor(held, "dev-1")).toBe(VALUE_B);
    expect(queueMarkerFor(held, "dev-2")).toBeNull();
    expect(queueMarkerFor(held, null)).toBeNull();
    expect(queueMarkerFor(null, "dev-1")).toBeNull();
  });
});

describe("kiedy zapisać znacznik na dysk", () => {
  const at = (minutes: number) =>
    new Date(Date.parse("2026-10-13T08:00:00.000Z") + minutes * 60_000).toISOString();
  const persisted = { deviceId: "dev-1", marker: marker(VALUE_A, at(0)) };

  it("pierwszy znacznik i znacznik innego urządzenia - zawsze", () => {
    expect(shouldPersistQueueMarker(null, persisted)).toBe(true);
    expect(
      shouldPersistQueueMarker(persisted, { deviceId: "dev-2", marker: marker(VALUE_B, at(1)) }),
    ).toBe(true);
  });

  it("nowszy o mniej niż krok - nie (bez zapisu przy każdym skanie); o krok i więcej - tak", () => {
    const step = QUEUE_MARKER_PERSIST_STEP_MS / 60_000;
    expect(
      shouldPersistQueueMarker(persisted, { deviceId: "dev-1", marker: marker(VALUE_B, at(1)) }),
    ).toBe(false);
    expect(
      shouldPersistQueueMarker(persisted, {
        deviceId: "dev-1",
        marker: marker(VALUE_B, at(step)),
      }),
    ).toBe(true);
  });

  it("ten sam napis - nie; nieznany termin - tak (bezpieczniej zapisać)", () => {
    expect(shouldPersistQueueMarker(persisted, persisted)).toBe(false);
    expect(
      shouldPersistQueueMarker(persisted, { deviceId: "dev-1", marker: marker(VALUE_B, null) }),
    ).toBe(true);
  });
});

describe("sejf znacznika", () => {
  it("blok otwiera się tylko kluczem tego poświadczenia i pod tym urządzeniem", async () => {
    const mine = await key("token-urzadzenia-0123456789");
    const other = await key("inny-token-urzadzenia-98765");
    const value = marker(VALUE_A, "2026-10-13T08:00:00.000Z");

    const blob = await sealQueueMarker(mine, "dev-1", value);
    expect(blob.data).not.toContain(VALUE_A);

    await expect(openQueueMarker(mine, "dev-1", blob)).resolves.toEqual(value);
    await expect(openQueueMarker(mine, "dev-2", blob)).resolves.toBeNull();
    await expect(openQueueMarker(other, "dev-1", blob)).resolves.toBeNull();
  });
});

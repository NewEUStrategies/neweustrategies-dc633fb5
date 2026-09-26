// Skrót SHA-256 kodu z biletu - klucz listy offline.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. SKRÓT INNY NIŻ W BAZIE. `event_registrations.qr_token_hash` to
//      `encode(digest(token, 'sha256'), 'hex')` - 64 znaki szesnastkowe,
//      małymi literami, z UTF-8. Wielkie litery, base64 albo inne kodowanie
//      znaków i KAŻDY bilet offline byłby „nieznanym kodem".
//   2. ZAPASOWA ŚCIEŻKA MILCZY. Stare WebView i strona po http nie mają
//      `crypto.subtle` - bez zapasu skaner offline nie rozpozna żadnego biletu.
import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/lib/events/scannerHash";

/** Wektor testowy NIST (FIPS 180-2): sha256("abc"). */
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sha256Hex", () => {
  it("WebCrypto daje skrót zgodny z `digest(..., 'sha256')` bazy", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(ABC);
  });

  it("znaki spoza ASCII są liczone z UTF-8, tak jak w Postgresie", async () => {
    // sha256 UTF-8 bajtów "zażółć" - policzone niezależnie od implementacji.
    const viaNode = (await import("node:crypto")).createHash("sha256").update("zażółć", "utf8").digest("hex");
    await expect(sha256Hex("zażółć")).resolves.toBe(viaNode);
  });

  it("BEZ `crypto.subtle` liczy ten sam skrót biblioteką zapasową", async () => {
    vi.stubGlobal("crypto", { getRandomValues: () => undefined });
    await expect(sha256Hex("abc")).resolves.toBe(ABC);
  });

  it("BEZ `crypto` w ogóle też liczy ten sam skrót", async () => {
    vi.stubGlobal("crypto", undefined);
    await expect(sha256Hex("abc")).resolves.toBe(ABC);
  });
});

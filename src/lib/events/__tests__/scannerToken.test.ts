// Kształt poświadczenia urządzenia skanującego, wydzielony z `scannerSession`
// po to, żeby trasa `/scanner` nie ciągnęła parsera sesji do chunku
// wejściowego.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// (1) trasa i aplikacja skanera sprawdzają token DWOMA różnymi wzorcami (link
//     z panelu przechodzi przez adres, a pada na parowaniu - albo odwrotnie);
// (2) token z białym znakiem na brzegu (wklejony z komunikatora) jest
//     odrzucany, choć baza przyjęłaby go po obcięciu;
// (3) wzorzec rozluźnia się poza granice `_event_scanner_device_auth`
//     (16-128 znaków base64url).
import { describe, expect, it } from "vitest";

import { SCANNER_TOKEN_PATTERN, isScannerToken } from "@/lib/events/scannerToken";
import * as session from "@/lib/events/scannerSession";

describe("scannerToken", () => {
  it("`scannerSession` re-eksportuje TE SAME symbole", () => {
    expect(session.isScannerToken).toBe(isScannerToken);
    expect(session.SCANNER_TOKEN_PATTERN).toBe(SCANNER_TOKEN_PATTERN);
  });

  it("granice długości i alfabet base64url", () => {
    expect(isScannerToken("a".repeat(16))).toBe(true);
    expect(isScannerToken("A-_9".repeat(32))).toBe(true);
    expect(isScannerToken("a".repeat(15))).toBe(false);
    expect(isScannerToken("a".repeat(129))).toBe(false);
    expect(isScannerToken(`${"a".repeat(20)}=`)).toBe(false);
  });

  it("biały znak na brzegu jest obcinany, w środku - nie", () => {
    expect(isScannerToken(`  ${"a".repeat(20)}\n`)).toBe(true);
    expect(isScannerToken(`${"a".repeat(10)} ${"a".repeat(10)}`)).toBe(false);
  });
});

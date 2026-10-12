// Adres skanera: token we FRAGMENCIE (OPS-07) i osobny origin (OPS-13).
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Link parowania z tokenem w ZAPYTANIU - pierwsze żądanie HTML niesie
//      poświadczenie do logów Cloudflare/Workers.
//   2. Stary link `?t=` paruje urządzenie tokenem, który już wyciekł.
//   3. Literówka w `VITE_SCANNER_ORIGIN` wysyła tokeny urządzeń pod obcy host
//      albo origin ze ścieżką.
//   4. Skaner otwarty pod originem portalu nie wie, dokąd się przenieść - albo
//      przenosi się w kółko pod tym samym originem.
import { describe, expect, it } from "vitest";

import {
  parseScannerOrigin,
  readScannerEntry,
  scannerEntryNeedsCleanup,
  scannerOriginFor,
  scannerPairingUrl,
  scannerRelocationTarget,
  scannerUrl,
} from "@/lib/events/scannerLink";

const TOKEN = "nes-scanner-token-0123456789";

describe("link parowania", () => {
  it("token jedzie we FRAGMENCIE, zakodowany - nigdy w zapytaniu", () => {
    const url = scannerPairingUrl("https://example.eu", "tok_abc+def/123");
    expect(url).toBe("https://example.eu/scanner#t=tok_abc%2Bdef%2F123");
    expect(new URL(url).search).toBe("");
  });

  it("origin skanera z konfiguracji wygrywa z originem panelu; bez niego - origin panelu", () => {
    expect(scannerOriginFor("https://panel.example.eu", "https://scan.example.eu")).toBe(
      "https://scan.example.eu",
    );
    expect(scannerOriginFor("https://panel.example.eu", null)).toBe("https://panel.example.eu");
  });

  it("adres przeniesienia niesie token i komunikat we fragmencie, bez ukośnika na końcu originu", () => {
    expect(scannerUrl("https://scan.example.eu/", { token: TOKEN, notice: "legacy_link" })).toBe(
      `https://scan.example.eu/scanner#t=${TOKEN}&e=legacy_link`,
    );
    expect(scannerUrl("https://scan.example.eu")).toBe("https://scan.example.eu/scanner");
    expect(scannerUrl("https://scan.example.eu", { token: null })).toBe(
      "https://scan.example.eu/scanner",
    );
  });
});

describe("wejście z adresu", () => {
  it("token z fragmentu paruje - przycięty, tylko w kształcie poświadczenia", () => {
    expect(readScannerEntry(`#t=${TOKEN}`, "")).toEqual({ token: TOKEN, notice: null });
    expect(readScannerEntry(`#t=%20${TOKEN}%20`, "")).toEqual({ token: TOKEN, notice: null });
    expect(readScannerEntry("#t=za-krotki", "")).toEqual({ token: null, notice: null });
    expect(readScannerEntry("", "")).toEqual({ token: null, notice: null });
  });

  it("STARY link `?t=` NIE paruje - token z zapytania już wyciekł; zostaje komunikat", () => {
    expect(readScannerEntry("", `?t=${TOKEN}`)).toEqual({ token: null, notice: "legacy_link" });
    // Nawet z fragmentem obok: zapytanie zawsze daje komunikat, fragment paruje.
    expect(readScannerEntry(`#t=${TOKEN}`, "?t=cokolwiek")).toEqual({
      token: TOKEN,
      notice: "legacy_link",
    });
    // Komunikat przeniesiony pod origin skanera we fragmencie.
    expect(readScannerEntry("#e=legacy_link", "")).toEqual({ token: null, notice: "legacy_link" });
  });

  it("sprzątanie adresu: wszystko poza czystą ścieżką", () => {
    expect(scannerEntryNeedsCleanup(`#t=${TOKEN}`, "")).toBe(true);
    expect(scannerEntryNeedsCleanup("", "?t=x")).toBe(true);
    expect(scannerEntryNeedsCleanup("", "")).toBe(false);
    expect(scannerEntryNeedsCleanup("#", "?")).toBe(false);
  });
});

describe("osobny origin skanera (VITE_SCANNER_ORIGIN)", () => {
  it("przyjmuje wyłącznie czysty origin https (http tylko dla localhost)", () => {
    expect(parseScannerOrigin("https://scan.example.eu")).toBe("https://scan.example.eu");
    expect(parseScannerOrigin(" https://scan.example.eu/ ")).toBe("https://scan.example.eu");
    expect(parseScannerOrigin("http://localhost:8080")).toBe("http://localhost:8080");
    for (const bad of [
      "http://scan.example.eu",
      "https://scan.example.eu/scanner",
      "https://scan.example.eu?x=1",
      "https://user:pass@scan.example.eu",
      "javascript:alert(1)",
      "scan.example.eu",
      "",
      undefined,
      42,
    ]) {
      expect(parseScannerOrigin(bad)).toBeNull();
    }
  });

  it("przenosi tylko spod INNEGO originu; bez konfiguracji - nigdy", () => {
    expect(scannerRelocationTarget("https://example.eu", "https://scan.example.eu")).toBe(
      "https://scan.example.eu",
    );
    expect(
      scannerRelocationTarget("https://scan.example.eu", "https://scan.example.eu"),
    ).toBeNull();
    expect(scannerRelocationTarget("https://example.eu", null)).toBeNull();
  });
});

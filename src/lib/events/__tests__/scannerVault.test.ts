// Sejf kolejki skanera (OPS-06): HKDF-SHA-256 z tokenu urządzenia, AES-GCM,
// losowy IV na blok, identyfikator pozycji jako AAD.
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Klucz EKSPORTOWALNY - skrypt strony wyciąga go bajtami i odszyfrowuje
//      kolejkę poza przeglądarką.
//   2. Stały IV - dwa bloki tego samego kodu wyglądają tak samo, a GCM z
//      powtórzonym IV traci poufność.
//   3. Blok przeniesiony do innej pozycji (podmiana w IndexedDB) otwiera się
//      i wysyła cudzy kod pod cudzym kluczem idempotencji.
//   4. Skrót kodu liczony inaczej niż w bazie (`btrim`) - eksport ze skrótem
//      nie prowadzi organizatora do zgłoszenia.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODE_PREFIX_LENGTH,
  codePrefixOf,
  deriveVaultKey,
  isSealedBlob,
  openSecret,
  scanCodeHash,
  sealSecret,
} from "@/lib/events/scannerVault";

const TOKEN = "nes-dev-token-0123456789";
const SECRET = { code: "QR-0123456789abcdefghijklmnopqr", note: "notatka", queueMarker: "m-1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

async function key(token = TOKEN): Promise<CryptoKey> {
  const derived = await deriveVaultKey(token);
  if (derived === null) throw new Error("test: brak WebCrypto w środowisku testowym");
  return derived;
}

describe("klucz sejfu", () => {
  it("jest NIEEKSPORTOWALNYM kluczem AES-GCM-256 tylko do szyfrowania i odszyfrowania", async () => {
    const derived = await key();
    expect(derived.extractable).toBe(false);
    expect(derived.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect([...derived.usages].sort()).toEqual(["decrypt", "encrypt"]);
    await expect(crypto.subtle.exportKey("raw", derived)).rejects.toThrow();
  });

  it("ten sam token daje klucz, który otwiera blok - inny token nie", async () => {
    const blob = await sealSecret(await key(), "scan-1", SECRET);
    await expect(openSecret(await key(), "scan-1", blob)).resolves.toEqual(SECRET);
    await expect(
      openSecret(await key("inny-token-0123456789"), "scan-1", blob),
    ).resolves.toBeNull();
  });

  it("bez WebCrypto (http, stare WebView) nie ma klucza - zamknięte, nie jawne", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    await expect(deriveVaultKey(TOKEN)).resolves.toBeNull();
    await expect(deriveVaultKey("   ")).resolves.toBeNull();
  });
});

describe("blok pozycji", () => {
  it("ma losowy 96-bitowy IV - dwa bloki tego samego kodu się różnią", async () => {
    const derived = await key();
    const first = await sealSecret(derived, "scan-1", SECRET);
    const second = await sealSecret(derived, "scan-1", SECRET);
    expect(first.iv).toMatch(/^[0-9a-f]{24}$/);
    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
    expect(isSealedBlob(first)).toBe(true);
    expect(JSON.stringify(first)).not.toContain(SECRET.code);
  });

  it("jest związany z pozycją (AAD) - przeniesiony do innej pozycji się nie otwiera", async () => {
    const derived = await key();
    const blob = await sealSecret(derived, "scan-1", SECRET);
    await expect(openSecret(derived, "scan-2", blob)).resolves.toBeNull();
  });

  it("uszkodzony albo podmieniony blok to `null`, nie wyjątek", async () => {
    const derived = await key();
    const blob = await sealSecret(derived, "scan-1", SECRET);
    const flipped = `${blob.data.slice(0, -2)}${blob.data.endsWith("00") ? "01" : "00"}`;
    await expect(openSecret(derived, "scan-1", { ...blob, data: flipped })).resolves.toBeNull();
    await expect(openSecret(derived, "scan-1", { iv: "zz", data: "00" })).resolves.toBeNull();
    expect(isSealedBlob({ iv: "00", data: "" })).toBe(false);
    expect(isSealedBlob(null)).toBe(false);
  });
});

describe("skrót i prefiks kodu", () => {
  it("skrót jest TYM SAMYM skrótem co w bazie: sha256(btrim(kod)) - btrim tnie tylko spacje", async () => {
    const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
    await expect(scanCodeHash("  QR-1 ")).resolves.toBe(sha("QR-1"));
    await expect(scanCodeHash("\tQR-1")).resolves.toBe(sha("\tQR-1"));
  });

  it("prefiks to kilka pierwszych znaków - nigdy cały kod", () => {
    expect(CODE_PREFIX_LENGTH).toBe(6);
    expect(codePrefixOf("  Qr1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT")).toBe("Qr1aB2");
    expect(codePrefixOf("abc")).toBe("abc");
  });
});

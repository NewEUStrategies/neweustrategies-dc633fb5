// @vitest-environment node
// Koder i czytnik DER pod podpis przepustki Apple Wallet.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Jeden bajt długości w złej formie,
// zbiór atrybutów w złym porządku albo OID z błędnie złożonym pierwszym łukiem
// i Wallet odrzuca przepustkę bez komunikatu - uczestnik widzi „nie można
// dodać", a my nie mamy logu. Wektory niżej są z X.690 i z wyjścia
// `openssl asn1parse`, nie z tego samego kodu, który testujemy.
import { describe, expect, it } from "vitest";

import {
  compareBytes,
  concatBytes,
  derChildren,
  derContext,
  derLength,
  derNull,
  derOctetString,
  derOid,
  derSequence,
  derSet,
  derSlice,
  derSmallInteger,
  derSortedSetContent,
  derTime,
  derTlv,
  readDer,
} from "../der";
import { toHex } from "../rsa";

const hex = (bytes: Uint8Array) => toHex(bytes);

describe("derLength", () => {
  it("koduje formę krótką i długą (1-4 bajty) zgodnie z X.690", () => {
    expect(hex(derLength(0))).toBe("00");
    expect(hex(derLength(127))).toBe("7f");
    expect(hex(derLength(128))).toBe("8180");
    expect(hex(derLength(255))).toBe("81ff");
    expect(hex(derLength(256))).toBe("820100");
    expect(hex(derLength(0x10000))).toBe("83010000");
    expect(hex(derLength(0xffffffff))).toBe("84ffffffff");
  });

  it("odrzuca długość ujemną, ułamkową i ponad 32 bity", () => {
    expect(() => derLength(-1)).toThrow(RangeError);
    expect(() => derLength(1.5)).toThrow(RangeError);
    expect(() => derLength(0x100000000)).toThrow(RangeError);
  });
});

describe("typy proste", () => {
  it("INTEGER: zero, małe liczby i wiodące zero przy ustawionym najstarszym bicie", () => {
    expect(hex(derSmallInteger(0))).toBe("020100");
    expect(hex(derSmallInteger(1))).toBe("020101");
    expect(hex(derSmallInteger(127))).toBe("02017f");
    expect(hex(derSmallInteger(128))).toBe("02020080");
    expect(hex(derSmallInteger(256))).toBe("02020100");
    expect(() => derSmallInteger(-1)).toThrow(RangeError);
    expect(() => derSmallInteger(0x80000000)).toThrow(RangeError);
  });

  it("NULL, OCTET STRING i TLV", () => {
    expect(hex(derNull())).toBe("0500");
    expect(hex(derOctetString(Uint8Array.of(1, 2, 3)))).toBe("0403010203");
    expect(hex(derTlv(0x0c, new TextEncoder().encode("ok")))).toBe("0c026f6b");
    expect(hex(concatBytes())).toBe("");
  });

  it("OID: wektory sha256, signedData i łuk ponad 127", () => {
    expect(hex(derOid("2.16.840.1.101.3.4.2.1"))).toBe("0609608648016503040201");
    expect(hex(derOid("1.2.840.113549.1.7.2"))).toBe("06092a864886f70d010702");
    // Pierwszy bajt 2*40+999 = 1079 = 0x88 0x37 (łuki łączone w base-128).
    expect(hex(derOid("2.999.3"))).toBe("0603883703");
  });

  it("OID: odrzuca zapis, który nie jest identyfikatorem", () => {
    expect(() => derOid("1")).toThrow(RangeError);
    expect(() => derOid("1.x.3")).toThrow(RangeError);
    expect(() => derOid("3.1")).toThrow(RangeError);
    expect(() => derOid("1.40")).toThrow(RangeError);
  });

  it("czas: UTCTime w latach 1950-2049, GeneralizedTime poza nimi", () => {
    expect(new TextDecoder().decode(derTime(new Date("2026-09-26T08:05:09Z")).slice(2))).toBe(
      "260926080509Z",
    );
    expect(derTime(new Date("2026-09-26T08:05:09Z"))[0]).toBe(0x17);
    expect(derTime(new Date("1950-01-01T00:00:00Z"))[0]).toBe(0x17);
    const late = derTime(new Date("2099-06-15T12:00:00.750Z"));
    expect(late[0]).toBe(0x18);
    expect(new TextDecoder().decode(late.slice(2))).toBe("20990615120000Z");
    expect(derTime(new Date("1949-12-31T23:59:59Z"))[0]).toBe(0x18);
  });
});

describe("zbiory i sekwencje", () => {
  it("SET OF układa elementy rosnąco wg kodowania, krótszy prefiks pierwszy", () => {
    const a = Uint8Array.of(0x04, 0x01, 0x02);
    const b = Uint8Array.of(0x04, 0x01);
    const c = Uint8Array.of(0x02, 0x01, 0x00);
    expect(hex(derSet([a, b, c]))).toBe("310802010004010401" + "02");
    expect(hex(derSortedSetContent([a, c]))).toBe("020100040102");
    expect(compareBytes(b, a)).toBeLessThan(0);
    expect(compareBytes(a, b)).toBeGreaterThan(0);
    expect(compareBytes(a, Uint8Array.from(a))).toBe(0);
  });

  it("SEQUENCE i znacznik kontekstowy [n]", () => {
    expect(hex(derSequence(derNull(), derNull()))).toBe("300405000500");
    expect(hex(derContext(0, derNull()))).toBe("a0020500");
    expect(hex(derContext(3, new Uint8Array()))).toBe("a300");
  });
});

describe("readDer / derChildren / derSlice", () => {
  it("czyta formę krótką i długą oraz dzieci elementu konstruowanego", () => {
    const long = derOctetString(new Uint8Array(200));
    const tree = derSequence(derSmallInteger(5), long);
    const root = readDer(tree);
    expect(root).toMatchObject({ tag: 0x30, start: 0, contentStart: 3, end: tree.length });
    const [first, second] = derChildren(tree, root);
    expect(hex(derSlice(tree, first))).toBe("020105");
    expect(second).toMatchObject({ tag: 0x04, contentStart: first.end + 3 });
    expect(derSlice(tree, second)).toEqual(long);
  });

  it("odrzuca ucięty nagłówek, długość i treść", () => {
    expect(() => readDer(Uint8Array.of(0x30))).toThrow("truncated header");
    expect(() => readDer(Uint8Array.of(0x04, 0x82, 0x01))).toThrow("truncated length");
    expect(() => readDer(Uint8Array.of(0x04, 0x03, 0x01))).toThrow("truncated content");
  });

  it("odrzuca znaczniki wielobajtowe i nieobsługiwane formy długości", () => {
    expect(() => readDer(Uint8Array.of(0x1f, 0x01, 0x00))).toThrow("multi-byte");
    expect(() => readDer(Uint8Array.of(0x04, 0x80, 0x00))).toThrow("length form");
    expect(() => readDer(Uint8Array.of(0x04, 0x85, 0, 0, 0, 0, 1))).toThrow("length form");
  });

  it("odrzuca dziecko wystające poza rodzica", () => {
    // SEQUENCE deklaruje 2 bajty treści, ale jej dziecko ma 3 (reszta bufora istnieje).
    const bytes = Uint8Array.of(0x30, 0x02, 0x04, 0x01, 0xaa, 0x00);
    expect(() => derChildren(bytes, readDer(bytes))).toThrow("overflows parent");
  });
});

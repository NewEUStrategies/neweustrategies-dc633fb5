// Skróty kluczy cache ścieżek (S8): stabilny JSON i szybki skrót.
//
// CO TEN PLIK DOWODZI. Klucz szacunku i symulacji zmienia się WYŁĄCZNIE przy
// realnej zmianie treści: kolejność pól (jsonb, nowy obiekt po renderze) nie
// ma znaczenia, a kolejność elementów tablic - ma (warunki, krawędzie).
import { describe, expect, it } from "vitest";

import { conditionHash, draftChecksum, fastHash, stableStringify } from "../hash";
import { emptyJourneyGraph } from "@/lib/journeys/graph";

describe("stableStringify", () => {
  it("sortuje klucze obiektów na każdym poziomie i zachowuje kolejność tablic", () => {
    expect(stableStringify({ b: 1, a: { d: [3, 1], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,1]},"b":1}',
    );
    expect(stableStringify({ a: { c: "x", d: [3, 1] }, b: 1 })).toBe(
      stableStringify({ b: 1, a: { d: [3, 1], c: "x" } }),
    );
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("zasady JSON.stringify: undefined znika w obiekcie, w tablicy to null; NaN to null", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
    expect(stableStringify([undefined, () => 1])).toBe("[null,null]");
    expect(stableStringify({ n: Number.NaN, i: Infinity })).toBe('{"i":null,"n":null}');
    expect(stableStringify(new Date("2026-10-20T00:00:00.000Z"))).toBe('"2026-10-20T00:00:00.000Z"');
    expect(stableStringify("ż\"")).toBe(JSON.stringify("ż\""));
    expect(stableStringify(undefined)).toBe("null");
  });

  it("dla obiektu bez wielu kluczy daje to samo co JSON.stringify", () => {
    const value = { a: [1, { b: true, c: null }], d: "e" };
    expect(stableStringify(value)).toBe(JSON.stringify(value));
  });

  it("cykl w danych to błąd, a nie zawieszenie", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(/cykl/);
    // Ten sam obiekt dwa razy (bez cyklu) jest poprawny.
    const shared = { x: 1 };
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});

describe("fastHash", () => {
  it("jest deterministyczny, ma stałą długość 14 znaków szesnastkowych", () => {
    expect(fastHash("abc")).toBe(fastHash("abc"));
    for (const input of ["", "a", "ścieżka", "x".repeat(10_000)]) {
      expect(fastHash(input)).toMatch(/^[0-9a-f]{14}$/);
    }
  });

  it("rozróżnia bliskie napisy i reaguje na ziarno", () => {
    const hashes = new Set(Array.from({ length: 500 }, (_, i) => fastHash(`klucz-${i}`)));
    expect(hashes.size).toBe(500);
    expect(fastHash("abc", 1)).not.toBe(fastHash("abc", 0));
  });
});

describe("conditionHash i draftChecksum", () => {
  it("brak warunku i warunek pusty to ten sam szacunek", () => {
    expect(conditionHash({})).toBe(conditionHash(undefined));
    expect(conditionHash(null)).toBe(conditionHash({}));
  });

  it("kolejność pól warunku nie zmienia skrótu, wartość - zmienia", () => {
    expect(conditionHash({ kind: "subscription", has_coupon: true })).toBe(
      conditionHash({ has_coupon: true, kind: "subscription" }),
    );
    expect(conditionHash({ kind: "subscription" })).not.toBe(conditionHash({ kind: "one_time" }));
  });

  it("suma szkicu zmienia się z treścią, nie z kolejnością pól", () => {
    const draft = { graph: emptyJourneyGraph(), settings: { triggerEventType: "account.registered.v1" } };
    const reordered = { settings: { triggerEventType: "account.registered.v1" }, graph: emptyJourneyGraph() };
    expect(draftChecksum(draft)).toBe(draftChecksum(reordered));
    expect(
      draftChecksum({ ...draft, settings: { triggerEventType: "paywall.hit.v1" } }),
    ).not.toBe(draftChecksum(draft));
    expect(draftChecksum(null)).toBe(draftChecksum(undefined));
  });
});

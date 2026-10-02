// Klucz idempotencji odprawy: generator i „jedna próba = jeden klucz".
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCheckinAttemptKeys, newClientScanUid } from "@/lib/events/clientScanUid";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newClientScanUid", () => {
  it("bierze UUID z `crypto.randomUUID`, gdy jest", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });
    expect(newClientScanUid()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("bez `crypto.randomUUID` nadal daje niepusty, niepowtarzalny klucz", () => {
    vi.stubGlobal("crypto", {});
    const keys = new Set(Array.from({ length: 50 }, () => newClientScanUid()));
    expect(keys.size).toBe(50);
    expect([...keys].every((key) => key.length > 0)).toBe(true);
  });
});

describe("createCheckinAttemptKeys", () => {
  function sequence(): () => string {
    let n = 0;
    return () => `klucz-${(n += 1)}`;
  }

  it("ta sama próba dostaje ten sam klucz, dopóki nie zostanie zamknięta", () => {
    const keys = createCheckinAttemptKeys(sequence());
    expect(keys.keyFor("bramka:osoba:in")).toBe("klucz-1");
    expect(keys.keyFor("bramka:osoba:in")).toBe("klucz-1");
  });

  it("zamknięcie próby daje następnej nowy klucz", () => {
    const keys = createCheckinAttemptKeys(sequence());
    const first = keys.keyFor("p");
    keys.settle("p", first);
    expect(keys.keyFor("p")).toBe("klucz-2");
  });

  it("różne próby mają różne klucze", () => {
    const keys = createCheckinAttemptKeys(sequence());
    expect(keys.keyFor("a")).not.toBe(keys.keyFor("b"));
  });

  it("spóźniona odpowiedź STAREJ próby nie zamyka nowszej", () => {
    const keys = createCheckinAttemptKeys(sequence());
    const old = keys.keyFor("p");
    keys.settle("p", old);
    const fresh = keys.keyFor("p");
    keys.settle("p", old);
    expect(keys.keyFor("p")).toBe(fresh);
  });
});

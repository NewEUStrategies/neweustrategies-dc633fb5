// getVisitorId: pseudonimowy klucz przeglądarki dla meteringu anonimów i
// budżetu kliknięć linku prezentowego. Hooki wołają go W RENDERZE, więc musi:
//  * nigdy nie rzucać - ani w SSR (brak `window`), ani przy zablokowanym
//    storage (tryb prywatny: SecurityError już przy odczycie właściwości),
//  * być stabilny - ten sam uuid przy każdym wywołaniu tej przeglądarki, a przy
//    niedziałającym zapisie null (nie świeży uuid co render, który paliłby
//    kolejne sloty licznika),
//  * działać bez `crypto.randomUUID` (kontekst niezabezpieczony, Safari < 15.4).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVisitorId } from "@/lib/access/visitor";

const STORAGE_KEY = "nes:metering:visitor";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.crypto, "randomUUID");
});

describe("getVisitorId - stabilność", () => {
  it("pierwsze wywołanie zapisuje uuid v4, kolejne zwracają ten sam", () => {
    const first = getVisitorId();
    expect(first).toMatch(UUID_V4);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(first);
    expect(getVisitorId()).toBe(first);
  });

  it("zachowuje istniejący klucz gościa (np. sprzed aktualizacji aplikacji)", () => {
    const stored = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
    window.localStorage.setItem(STORAGE_KEY, stored);
    expect(getVisitorId()).toBe(stored);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
  });

  it("uszkodzona wartość w storage jest zastępowana świeżym uuid", () => {
    window.localStorage.setItem(STORAGE_KEY, "nie-uuid");
    const id = getVisitorId();
    expect(id).toMatch(UUID_V4);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(id);
  });
});

describe("getVisitorId - degradacja", () => {
  it("bez crypto.randomUUID buduje uuid v4 z getRandomValues", () => {
    // Własność instancji przesłania metodę prototypu - tak wygląda `crypto`
    // w kontekście niezabezpieczonym (HTTP) i w Safari sprzed 15.4.
    Object.defineProperty(window.crypto, "randomUUID", { value: undefined, configurable: true });
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i * 0x11);
    vi.spyOn(window.crypto, "getRandomValues").mockImplementation((array) => {
      if (array instanceof Uint8Array) array.set(bytes);
      return array;
    });

    const id = getVisitorId();
    // Bajt 6 dostaje wersję 4, bajt 8 wariant RFC 4122 - reszta to losowość.
    expect(id).toBe("00112233-4455-4677-8899-aabbccddeeff");
    expect(id).toMatch(UUID_V4);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(id);
  });

  it("zablokowany localStorage (SecurityError przy odczycie właściwości): null bez wyjątku", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(() => getVisitorId()).not.toThrow();
    expect(getVisitorId()).toBeNull();
  });

  it("nieudany zapis (quota / stary tryb prywatny Safari): stabilny null zamiast uuid co wywołanie", () => {
    const real = window.localStorage;
    const readOnly: Storage = {
      get length() {
        return real.length;
      },
      clear: () => real.clear(),
      getItem: (key) => real.getItem(key),
      key: (index) => real.key(index),
      removeItem: (key) => real.removeItem(key),
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    vi.spyOn(window, "localStorage", "get").mockReturnValue(readOnly);
    expect(getVisitorId()).toBeNull();
    expect(getVisitorId()).toBeNull();
  });

  it("SSR (brak window): null, bez ReferenceError", () => {
    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");
    expect(getVisitorId()).toBeNull();
  });
});

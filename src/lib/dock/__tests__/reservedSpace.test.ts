// REZERWACJA DOLNEJ KRAWĘDZI - logika czysta i skrypt sprzed malowania.
//
// PO CO TEN PLIK. Rezerwacja jest jedynym mechanizmem, który stoi między
// czytelnikiem a paskiem zasłaniającym stopkę, a jej najważniejsza część
// (skrypt w `<head>`) wykonuje się PRZED Reactem, więc żaden test
// komponentowy jej nie dotknie. Tu jest i przeczytana, i WYKONANA - dokładnie
// jak `THEME_INIT_SCRIPT`, którego docstring wyjaśnia, dlaczego literał
// w `__root.tsx` był nietestowalny.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearReservedSpace,
  DOCK_RESERVE_INIT_SCRIPT,
  DOCK_RESERVE_KEY,
  DOCK_RESERVE_MAX_PX,
  isDockSuppressedPath,
  normalizeReservedSpace,
  readReservedSpace,
  writeReservedSpace,
} from "../reservedSpace";

/** Magazyn na Mapie - test nie zależy od `localStorage` środowiska. */
function memoryStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    get size() {
      return map.size;
    },
  };
}

/** Magazyn, który RZUCA - tryb prywatny przeglądarki. */
const hostileStorage = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
  removeItem() {
    throw new Error("SecurityError");
  },
};

describe("normalizeReservedSpace - bezpiecznik wysokości", () => {
  it("przyjmuje sensowną wysokość paska i zaokrągla ją do piksela", () => {
    expect(normalizeReservedSpace(38)).toBe(38);
    expect(normalizeReservedSpace(37.6)).toBe(38);
    expect(normalizeReservedSpace("33")).toBe(33);
  });

  it("ODRZUCA zero i wartości ujemne - to jest ta poprawka, która zdejmuje 35 px pustego pasa", () => {
    // Pomiar zerowy zdarza się realnie: węzeł pod `display: none`, pomiar
    // wykonany poza układem. Poprzednia wersja włączała wtedy znacznik
    // rezerwacji BEZ wysokości, a CSS spadał na zapas 72 px przy pasku
    // ~33-38 px. `null` znaczy „nie publikuj niczego".
    expect(normalizeReservedSpace(0)).toBeNull();
    expect(normalizeReservedSpace(-12)).toBeNull();
  });

  it("odrzuca śmieci i wartości absurdalne", () => {
    expect(normalizeReservedSpace(null)).toBeNull();
    expect(normalizeReservedSpace(undefined)).toBeNull();
    expect(normalizeReservedSpace("nie liczba")).toBeNull();
    expect(normalizeReservedSpace(Number.NaN)).toBeNull();
    expect(normalizeReservedSpace(Number.POSITIVE_INFINITY)).toBeNull();
    // Podmieniona wartość w magazynie nie zepchnie treści na środek ekranu.
    expect(normalizeReservedSpace(DOCK_RESERVE_MAX_PX + 1)).toBeNull();
    expect(normalizeReservedSpace(DOCK_RESERVE_MAX_PX)).toBe(DOCK_RESERVE_MAX_PX);
  });
});

describe("odczyt i zapis zapamiętanej wysokości", () => {
  it("zapisuje, czyta i USUWA pod `null`", () => {
    const storage = memoryStorage();
    writeReservedSpace(storage, 38);
    expect(storage.getItem(DOCK_RESERVE_KEY)).toBe("38");
    expect(readReservedSpace(storage)).toBe(38);

    // `null` to ścieżka wylogowania - klucz musi ZNIKNĄĆ, nie wyzerować się.
    writeReservedSpace(storage, null);
    expect(storage.getItem(DOCK_RESERVE_KEY)).toBeNull();
    expect(readReservedSpace(storage)).toBeNull();
  });

  it("nie zapisuje wartości, której odczyt i tak by odrzucił", () => {
    const storage = memoryStorage();
    writeReservedSpace(storage, 0);
    writeReservedSpace(storage, 5000);
    expect(storage.size).toBe(0);
  });

  it("przeżywa magazyn, który rzuca (tryb prywatny) i brak magazynu", () => {
    expect(() => writeReservedSpace(hostileStorage, 38)).not.toThrow();
    expect(readReservedSpace(hostileStorage)).toBeNull();
    expect(readReservedSpace(null)).toBeNull();
    expect(() => writeReservedSpace(null, 38)).not.toThrow();
  });

  it("uszkodzony wpis czyta się jako brak, a nie jako zero", () => {
    expect(readReservedSpace(memoryStorage({ [DOCK_RESERVE_KEY]: "abc" }))).toBeNull();
    expect(readReservedSpace(memoryStorage({ [DOCK_RESERVE_KEY]: "-1" }))).toBeNull();
    expect(readReservedSpace(memoryStorage({ [DOCK_RESERVE_KEY]: "" }))).toBeNull();
  });
});

describe("isDockSuppressedPath - te same bramki co powłoka", () => {
  it("wycisza panel i logowanie razem z podtrasami", () => {
    for (const path of ["/admin", "/admin/", "/admin/settings", "/login", "/login/reset"]) {
      expect(isDockSuppressedPath(path), path).toBe(true);
    }
  });

  it("nie wycisza tras publicznych ani takich, które tylko zaczynają się podobnie", () => {
    for (const path of ["/", "/en", "/analizy", "/administracja", "/logins", "/klub/admin"]) {
      expect(isDockSuppressedPath(path), path).toBe(false);
    }
  });
});

// ── SKRYPT SPRZED PIERWSZEGO MALOWANIA ────────────────────────────────────
// Wykonujemy go tak, jak przeglądarka: jako kod w kontekście dokumentu.
// `new Function` zamiast `eval`, żeby nie wciągać zasięgu tego pliku.
function runInitScript(): void {
  new Function(DOCK_RESERVE_INIT_SCRIPT)();
}

describe("DOCK_RESERVE_INIT_SCRIPT - rezerwacja przed pierwszym malowaniem", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.mbb;
    document.documentElement.style.removeProperty("--mbb-space");
    window.history.replaceState(null, "", "/analizy");
  });

  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.mbb;
    document.documentElement.style.removeProperty("--mbb-space");
  });

  it("odtwarza rezerwację z zapamiętanej wysokości", () => {
    window.localStorage.setItem(DOCK_RESERVE_KEY, "38");
    runInitScript();
    expect(document.documentElement.dataset.mbb).toBe("on");
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("38px");
  });

  it("BEZ zapamiętanej wysokości nie rezerwuje nic - gość nie dostaje pustego pasa", () => {
    runInitScript();
    expect(document.documentElement.dataset.mbb).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("");
  });

  it("nie rezerwuje w /admin ani /login, bo tam paska nie ma", () => {
    window.localStorage.setItem(DOCK_RESERVE_KEY, "38");
    for (const path of ["/admin", "/admin/settings", "/login"]) {
      delete document.documentElement.dataset.mbb;
      window.history.replaceState(null, "", path);
      runInitScript();
      expect(document.documentElement.dataset.mbb, path).toBeUndefined();
    }
  });

  it("odrzuca wartość uszkodzoną i absurdalną", () => {
    for (const value of ["abc", "0", "-5", String(DOCK_RESERVE_MAX_PX + 1)]) {
      delete document.documentElement.dataset.mbb;
      window.localStorage.setItem(DOCK_RESERVE_KEY, value);
      runInitScript();
      expect(document.documentElement.dataset.mbb, value).toBeUndefined();
    }
  });

  it("jest jedną linią i nie rzuca, gdy magazyn jest niedostępny", () => {
    // Każdy znak jedzie na krytycznej ścieżce dokumentu, więc nowych linii
    // w tym literale być nie może (ta sama zasada co `THEME_INIT_SCRIPT`).
    expect(DOCK_RESERVE_INIT_SCRIPT).not.toContain("\n");
    // Cały korpus stoi w `try`, więc odebrany `localStorage` nie wywala
    // dokumentu - to jest jedyny powód, dla którego ten `catch` istnieje.
    expect(DOCK_RESERVE_INIT_SCRIPT).toContain("try{");
    expect(DOCK_RESERVE_INIT_SCRIPT).toContain("catch(e){}");
  });

  it("skrypt i moduł czytają TEN SAM klucz i ten sam limit", () => {
    // Bez tej asercji da się zmienić stałą w module i zostawić w skrypcie
    // starą wartość - a wtedy rezerwacja sprzed malowania cicho przestaje
    // działać i defekt wraca bez ani jednego czerwonego testu.
    expect(DOCK_RESERVE_INIT_SCRIPT).toContain(DOCK_RESERVE_KEY);
    expect(DOCK_RESERVE_INIT_SCRIPT).toContain(String(DOCK_RESERVE_MAX_PX));
  });
});

describe("clearReservedSpace - ścieżka wylogowania", () => {
  it("zdejmuje znacznik, właściwość i zapamiętaną wysokość", () => {
    window.localStorage.setItem(DOCK_RESERVE_KEY, "38");
    document.documentElement.dataset.mbb = "on";
    document.documentElement.style.setProperty("--mbb-space", "38px");

    clearReservedSpace();

    expect(document.documentElement.dataset.mbb).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("");
    expect(window.localStorage.getItem(DOCK_RESERVE_KEY)).toBeNull();
  });

  it("jest idempotentne - drugie wywołanie nie rzuca", () => {
    clearReservedSpace();
    expect(() => clearReservedSpace()).not.toThrow();
  });
});

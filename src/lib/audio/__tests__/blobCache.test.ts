// Cache blobów narracji: eksmisja i zwalnianie URL-i. Defekt tutaj nie daje
// widocznej awarii od razu - daje WYCIEK PAMIĘCI w długiej sesji czytania
// (każdy niezwolniony blob trzyma całe MP3, kilka MB) albo, w drugą stronę,
// zwolnienie blobu, który jest WŁAŚNIE ODTWARZANY, czyli audio urwane w połowie
// artykułu.
//
// `URL.revokeObjectURL` nie zostawia obserwowalnego śladu, więc funkcja
// zwalniająca jest wstrzykiwana - inaczej testy mogłyby sprawdzić tylko rozmiar
// mapy, a to najmniej istotna połowa reguły.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MAX_CACHED_BLOBS,
  cacheKey,
  cachedBlobCount,
  getCachedBlob,
  resetBlobCache,
  sanitizeFilename,
  setBlobRevoker,
  setCachedBlob,
} from "@/lib/audio/blobCache";

let revoked: string[] = [];
let restoreRevoker: (url: string) => void;

beforeEach(() => {
  resetBlobCache();
  revoked = [];
  restoreRevoker = setBlobRevoker((url) => revoked.push(url));
});

afterEach(() => {
  setBlobRevoker(restoreRevoker);
  resetBlobCache();
});

describe("cacheKey - tożsamość nagrania", () => {
  it("klucz niesie wpis I język", () => {
    expect(cacheKey("post-1", "pl")).toBe("post-1:pl");
    expect(cacheKey("post-1", "en")).toBe("post-1:en");
  });

  it("DWA JĘZYKI tego samego wpisu to DWA nagrania (różne klucze)", () => {
    expect(cacheKey("post-1", "pl")).not.toBe(cacheKey("post-1", "en"));
    expect(cacheKey("post-1", "en")).toContain("en");
  });
});

describe("setCachedBlob - zapis i nadpisanie", () => {
  it("zapisuje blob pod kluczem i pozwala go odczytać", () => {
    setCachedBlob("k1", "blob:a");
    expect(getCachedBlob("k1")).toBe("blob:a");
    expect(cachedBlobCount()).toBe(1);
  });

  it("NADPISANIE tego samego klucza ZWALNIA poprzedni URL (inaczej wyciek)", () => {
    setCachedBlob("k1", "blob:stary");
    setCachedBlob("k1", "blob:nowy");
    expect(revoked).toEqual(["blob:stary"]);
    expect(getCachedBlob("k1")).toBe("blob:nowy");
  });

  it("zapis TEGO SAMEGO URL-a pod tym samym kluczem NIE zwalnia go", () => {
    setCachedBlob("k1", "blob:a");
    setCachedBlob("k1", "blob:a");
    expect(revoked).toEqual([]);
    expect(getCachedBlob("k1")).toBe("blob:a");
  });

  it("nieznany klucz daje `undefined`, nie wyjątek", () => {
    expect(getCachedBlob("nie-ma")).toBeUndefined();
    expect(cachedBlobCount()).toBe(0);
  });
});

describe("setCachedBlob - eksmisja po przekroczeniu limitu", () => {
  function fill(count: number, prefix = "blob") {
    for (let i = 0; i < count; i += 1) setCachedBlob(`k${i}`, `${prefix}:${i}`);
  }

  it("do limitu włącznie NIC nie jest eksmitowane", () => {
    fill(MAX_CACHED_BLOBS);
    expect(cachedBlobCount()).toBe(MAX_CACHED_BLOBS);
    expect(revoked).toEqual([]);
  });

  it("wpis ponad limit eksmituje NAJSTARSZY i zwalnia jego URL", () => {
    fill(MAX_CACHED_BLOBS + 1);
    expect(cachedBlobCount()).toBe(MAX_CACHED_BLOBS);
    expect(revoked).toEqual(["blob:0"]);
  });

  it("eksmisja idzie w kolejności wstawiania (FIFO), nie losowo", () => {
    fill(MAX_CACHED_BLOBS + 3);
    expect(revoked).toEqual(["blob:0", "blob:1", "blob:2"]);
    expect(getCachedBlob("k0")).toBeUndefined();
  });

  it("cache NIGDY nie rośnie ponad limit, nawet przy 100 wpisach", () => {
    fill(100);
    expect(cachedBlobCount()).toBe(MAX_CACHED_BLOBS);
    expect(revoked).toHaveLength(100 - MAX_CACHED_BLOBS);
  });

  it("`keepUrl` CHRONI aktualnie odtwarzany blob przed zwolnieniem", () => {
    fill(MAX_CACHED_BLOBS);
    // "blob:0" jest właśnie odtwarzany - eksmisja może wyjąć go z mapy,
    // ale NIE MOŻE zwolnić URL-a, bo audio urwałoby się w połowie.
    setCachedBlob("nowy", "blob:nowy", "blob:0");
    expect(revoked).toEqual([]);
    expect(getCachedBlob("k0")).toBeUndefined();
  });

  it("`keepUrl` chroni WYŁĄCZNIE wskazany URL, pozostałe nadal są zwalniane", () => {
    fill(MAX_CACHED_BLOBS + 1);
    revoked = [];
    setCachedBlob("kolejny", "blob:kolejny", "blob:1");
    expect(revoked).toEqual([]);

    setCachedBlob("jeszcze", "blob:jeszcze", "blob:1");
    expect(revoked).toEqual(["blob:2"]);
  });

  it("nowo wstawiany URL nie jest zwalniany przez własną eksmisję", () => {
    // Ten sam URL pod dwoma kluczami: eksmisja starszego nie może zabrać
    // blobu, który właśnie został zapisany pod nowym kluczem.
    for (let i = 0; i < MAX_CACHED_BLOBS; i += 1) setCachedBlob(`k${i}`, "blob:wspolny");
    revoked = [];
    setCachedBlob("nowy", "blob:wspolny");
    expect(revoked).toEqual([]);
    expect(getCachedBlob("nowy")).toBe("blob:wspolny");
  });

  it("nadpisanie klucza, gdy cache jest pełny, nie eksmituje samego siebie", () => {
    fill(MAX_CACHED_BLOBS);
    revoked = [];
    setCachedBlob("k0", "blob:k0-nowy");
    expect(revoked).toEqual(["blob:0"]);
    expect(getCachedBlob("k0")).toBe("blob:k0-nowy");
  });
});

describe("domyślna funkcja zwalniająca", () => {
  it("woła `URL.revokeObjectURL` przeglądarki (bez podmiany w teście)", () => {
    // Reszta pliku wstrzykuje własny licznik zwolnień; ten przypadek sprawdza
    // ŚCIEŻKĘ PRODUKCYJNĄ - bez niej nikt nie dowodzi, że blob w ogóle jest
    // zwalniany w przeglądarce, a to jest cała funkcja tego modułu.
    setBlobRevoker(restoreRevoker);
    const calls: string[] = [];
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => calls.push(url) && undefined;
    try {
      setCachedBlob("k1", "blob:stary");
      setCachedBlob("k1", "blob:nowy");
    } finally {
      URL.revokeObjectURL = original;
    }
    expect(calls).toEqual(["blob:stary"]);
    expect(getCachedBlob("k1")).toBe("blob:nowy");
  });

  it("brak `URL.revokeObjectURL` w środowisku nie wywala zapisu do cache", () => {
    setBlobRevoker(restoreRevoker);
    const original = URL.revokeObjectURL;
    // @ts-expect-error - odgrywamy środowisko bez tego API (starsze WebView).
    URL.revokeObjectURL = undefined;
    try {
      setCachedBlob("k1", "blob:stary");
      expect(() => setCachedBlob("k1", "blob:nowy")).not.toThrow();
    } finally {
      URL.revokeObjectURL = original;
    }
    expect(getCachedBlob("k1")).toBe("blob:nowy");
  });
});

describe("sanitizeFilename - nazwa pobieranego MP3", () => {
  it("transliteruje diakrytyki i zamienia spacje na łączniki", () => {
    expect(sanitizeFilename("Rola Unii Europejskiej")).toBe("Rola-Unii-Europejskiej");
    expect(sanitizeFilename("Zażółć gęślą")).toBe("Zazolc-gesla");
  });

  it("REGRESJA: litery bez rozkładu kanonicznego są transliterowane, nie gubione", () => {
    // DEFEKT ZNALEZIONY TYM TESTEM (naprawiony osobnym commitem):
    // `normalize("NFKD")` NIE rozkłada U+0142 (ł) na `l` + znak łączący - to
    // odrębny punkt kodowy, nie litera z diakrytykiem - więc krok wycinający
    // znaki poza [a-z0-9-_ ] zjadał ją razem z nimi. „Małe firmy" pobierało się
    // jako `Mae-firmy`, „Łódź" jako `odz`.
    expect(sanitizeFilename("Małe firmy")).toBe("Male-firmy");
    expect(sanitizeFilename("Łódź")).toBe("Lodz");
  });

  it("transliteruje też pozostałe litery atomowe (nordyckie, germańskie)", () => {
    expect(sanitizeFilename("Straße")).toBe("Strasse");
    expect(sanitizeFilename("Malmø")).toBe("Malmo");
  });

  it("wycina znaki niebezpieczne dla systemu plików", () => {
    expect(sanitizeFilename("raport/2026: wersja*ostateczna?")).toBe("raport2026-wersjaostateczna");
    expect(sanitizeFilename("../../etc/passwd")).toBe("etcpasswd");
  });

  it("PUSTE wejście degraduje do `artykul`, nie do pliku o nazwie `.mp3`", () => {
    expect(sanitizeFilename("")).toBe("artykul");
    expect(sanitizeFilename("   ")).toBe("artykul");
  });

  it("wejście SAMYCH znaków niedozwolonych też degraduje do `artykul`", () => {
    expect(sanitizeFilename("///???")).toBe("artykul");
    expect(sanitizeFilename("。、！")).toBe("artykul");
  });

  it("przycina do 80 znaków (limity nazw plików)", () => {
    const long = "a".repeat(200);
    expect(sanitizeFilename(long)).toHaveLength(80);
    expect(sanitizeFilename(long)).toBe("a".repeat(80));
  });

  it("zachowuje cyfry, łączniki i podkreślenia", () => {
    expect(sanitizeFilename("raport_2026-08 v2")).toBe("raport_2026-08-v2");
    expect(sanitizeFilename("UE-27")).toBe("UE-27");
  });

  it("zwija wielokrotne spacje do JEDNEGO łącznika", () => {
    expect(sanitizeFilename("Rola    Unii")).toBe("Rola-Unii");
    expect(sanitizeFilename("  Rola  Unii  ")).toBe("Rola-Unii");
  });
});

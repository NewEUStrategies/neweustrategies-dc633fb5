import { describe, it, expect } from "vitest";
import {
  cacheControlHeader,
  CHROME_DEGRADED_S_MAXAGE,
  CHROME_DEGRADED_SWR,
  chromeDegradedCacheControl,
  contentCacheControl,
  narrowestCacheControl,
  PUBLIC_CONTENT_MAX_AGE,
  PUBLIC_CONTENT_S_MAXAGE,
  PUBLIC_CONTENT_SWR,
  staticFallbackCacheControl,
} from "./cachePolicy";
import { documentStorePolicy } from "./documentCache";

describe("cacheControlHeader", () => {
  it("returns private/no-store for non-cacheable responses", () => {
    expect(cacheControlHeader({ cacheable: false })).toBe("private, no-store");
    // browser/shared values are ignored when not cacheable
    expect(cacheControlHeader({ cacheable: false, sharedMaxAge: 999 })).toBe("private, no-store");
  });

  it("emits a full public directive set", () => {
    expect(
      cacheControlHeader({
        cacheable: true,
        browserMaxAge: 60,
        sharedMaxAge: 300,
        staleWhileRevalidate: 86400,
      }),
    ).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
  });

  it("defaults browser max-age to 0 and omits unset shared directives", () => {
    expect(cacheControlHeader({ cacheable: true })).toBe("public, max-age=0");
    expect(cacheControlHeader({ cacheable: true, sharedMaxAge: 120 })).toBe(
      "public, max-age=0, s-maxage=120",
    );
  });

  it("clamps negatives to 0 and floors fractional seconds", () => {
    expect(
      cacheControlHeader({
        cacheable: true,
        browserMaxAge: -5,
        sharedMaxAge: 30.9,
        staleWhileRevalidate: -1,
      }),
    ).toBe("public, max-age=0, s-maxage=30, stale-while-revalidate=0");
  });
});

describe("contentCacheControl", () => {
  it("share-caches anonymous public content by default", () => {
    expect(contentCacheControl()).toBe(
      `public, max-age=${PUBLIC_CONTENT_MAX_AGE}, s-maxage=${PUBLIC_CONTENT_S_MAXAGE}, stale-while-revalidate=${PUBLIC_CONTENT_SWR}`,
    );
  });

  it("never shares a personalized or preview render", () => {
    expect(contentCacheControl({ personalized: true })).toBe("private, no-store");
    expect(contentCacheControl({ preview: true })).toBe("private, no-store");
    expect(contentCacheControl({ personalized: false, preview: false })).toContain("public");
  });
});

describe("chromeDegradedCacheControl", () => {
  it("degradacja samego chrome'u to KRÓTKA świeżość wspólna, nie no-store", () => {
    expect(chromeDegradedCacheControl()).toBe(
      `public, max-age=0, s-maxage=${CHROME_DEGRADED_S_MAXAGE}, stale-while-revalidate=${CHROME_DEGRADED_SWR}`,
    );
    // Sens tej polityki to „współdziel, ale krótko" - dłużej niż treść czysta
    // byłoby zaprzeczeniem jej racji bytu.
    expect(CHROME_DEGRADED_S_MAXAGE).toBeLessThan(PUBLIC_CONTENT_S_MAXAGE);
    expect(CHROME_DEGRADED_SWR).toBeLessThan(PUBLIC_CONTENT_SWR);
  });
});

describe("staticFallbackCacheControl", () => {
  it("czysty render zostaje przy polityce treści", () => {
    expect(staticFallbackCacheControl(false)).toBe(contentCacheControl());
  });

  it("pozwala trasie podać WŁASNĄ politykę czystego renderu", () => {
    const own = "public, max-age=0, s-maxage=30";
    expect(staticFallbackCacheControl(false, own)).toBe(own);
    // Polityka czystego renderu nie dotyczy gałęzi zdegradowanej.
    expect(staticFallbackCacheControl(true, own)).toBe(chromeDegradedCacheControl());
  });

  it("degradacja warstwy opcjonalnej to KRÓTKA świeżość, a NIE `no-store`", () => {
    // Fallback tej klasy tras to pełna treść z kodu, więc dokument jest
    // poprawny dla czytelnika - różnica wobec `resilientCacheControl`, gdzie
    // fallbackiem jest komunikat degradacji albo pusta powłoka.
    expect(staticFallbackCacheControl(true)).toBe(chromeDegradedCacheControl());
    expect(staticFallbackCacheControl(true)).not.toContain("no-store");
  });

  it("zdegradowany dokument JEST zapisywalny przez NES Edge Cache", () => {
    // To jest cały sens tej polityki: `documentStorePolicy` odrzuca `no-store`,
    // więc poprzednia wersja zamieniała każde żądanie strony prawnej przy
    // padającej bazie w pełny render (regresja testu rozruchowego /cookies).
    const policy = documentStorePolicy(200, "text/html", staticFallbackCacheControl(true));
    expect(policy.store).toBe(true);
    expect(policy.freshMs).toBeGreaterThan(0);
    expect(policy.swrMs).toBeGreaterThan(0);
    expect(documentStorePolicy(200, "text/html", cacheControlHeader({ cacheable: false })).store).toBe(
      false,
    );
  });

  it("scalone z polityką korzenia nie zawęża dokumentu do `no-store`", () => {
    // Trasa i bramka chrome ustawiają politykę tego samego żądania; wynik
    // scalenia musi zostać zapisywalny, niezależnie od kolejności loaderów.
    const merged = narrowestCacheControl(chromeDegradedCacheControl(), staticFallbackCacheControl(true));
    expect(documentStorePolicy(200, "text/html", merged).store).toBe(true);
    expect(
      documentStorePolicy(
        200,
        "text/html",
        narrowestCacheControl(staticFallbackCacheControl(true), contentCacheControl()),
      ).store,
    ).toBe(true);
  });
});

describe("narrowestCacheControl", () => {
  const clean = contentCacheControl();
  const chrome = chromeDegradedCacheControl();

  it("bez poprzednika przyjmuje nową wartość", () => {
    expect(narrowestCacheControl(null, clean)).toBe(clean);
    expect(narrowestCacheControl(undefined, "private, no-store")).toBe("private, no-store");
  });

  it("opt-out (`private`/`no-store`/`no-cache`) nie da się cofnąć w żadnej kolejności", () => {
    expect(narrowestCacheControl("private, no-store", clean)).toBe("private, no-store");
    expect(narrowestCacheControl(clean, "private, no-store")).toBe("private, no-store");
    expect(narrowestCacheControl("no-cache", chrome)).toBe("no-cache");
    expect(narrowestCacheControl(chrome, "no-cache")).toBe("no-cache");
  });

  it("między dwiema politykami public wygrywa MNIEJSZE s-maxage, niezależnie od kolejności", () => {
    expect(narrowestCacheControl(chrome, clean)).toBe(chrome);
    expect(narrowestCacheControl(clean, chrome)).toBe(chrome);
  });

  it("przy równym s-maxage wygrywa mniejsze okno stale; brak s-maxage liczy się jak 0", () => {
    const shortSwr = "public, max-age=0, s-maxage=30, stale-while-revalidate=10";
    expect(narrowestCacheControl(chrome, shortSwr)).toBe(shortSwr);
    expect(narrowestCacheControl(shortSwr, chrome)).toBe(shortSwr);
    expect(narrowestCacheControl("public, max-age=60", clean)).toBe("public, max-age=60");
    expect(narrowestCacheControl(clean, "public, max-age=60")).toBe("public, max-age=60");
  });

  it("przy pełnym remisie zostaje wartość późniejsza (równoważne dla magazynu)", () => {
    expect(narrowestCacheControl(clean, clean)).toBe(clean);
  });
});

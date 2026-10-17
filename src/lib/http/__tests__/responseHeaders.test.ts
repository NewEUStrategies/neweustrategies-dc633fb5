// @vitest-environment node
// Kanały per `Request` z `responseHeaders.ts` - kontrakt każdego pomocnika osobno.
//
// Pozostałe suity (`documentLogTelemetry`, `platformPreloads`, `crawlerUnavailable`, trasy)
// przechodzą przez te kanały tylko ścieżką szczęśliwą całego potoku dokumentu. Tu przypinamy
// gałęzie, których potok nie trafia: wywołanie poza zasięgiem żądania (prerender, kod tła),
// sufit i deduplikację etykiet degradacji, predykat kompletności bez etykiet i predykat, który
// rzuca, oraz odrzucenie wartości `Link` spoza ByteString, zanim zatruje złączony nagłówek.
//
// Bez kompilatora Start `createIsomorphicFn` zawsze wybiera implementację `.server()`, więc
// atrapą jest wyłącznie `getRequest()`: zwraca bieżące żądanie albo rzuca jak poza zasięgiem.
import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ request: null as Request | null }));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!scope.request) throw new Error("poza zasięgiem żądania");
    return scope.request;
  },
}));

const {
  appendLinkHeader,
  markCrawlerUnavailable,
  noteDocumentDegradation,
  readCrawlerUnavailable,
  readDocumentCompleteness,
  readDocumentDegradations,
  readLinkHeader,
  readRouteCacheDirective,
  registerDocumentCompletenessCheck,
  setCacheControlHeader,
} = await import("../responseHeaders");

function newRequest(): Request {
  return new Request("https://tenant-a.eu/artykul");
}

beforeEach(() => {
  scope.request = newRequest();
});

describe("setCacheControlHeader / readRouteCacheDirective", () => {
  it("poza zasięgiem żądania nic nie zapisuje i nie rzuca", () => {
    scope.request = null;
    expect(() => setCacheControlHeader("public, s-maxage=900")).not.toThrow();
    expect(readRouteCacheDirective()).toBeNull();
  });

  it("równoległe loadery: wygrywa ostrzejsza intencja, a opt-out się nie cofa", () => {
    const request = scope.request!;
    setCacheControlHeader("public, s-maxage=900, stale-while-revalidate=86400");
    setCacheControlHeader("public, s-maxage=30");
    expect(readRouteCacheDirective()).toBe("public, s-maxage=30");

    setCacheControlHeader("private, no-store");
    setCacheControlHeader("public, s-maxage=900");
    // Granica odpowiedzi czyta wpis tym samym kluczem, który zapisał loader.
    scope.request = null;
    expect(readRouteCacheDirective(request)).toBe("private, no-store");
  });

  it("intencja jednego żądania nie przecieka do drugiego", () => {
    setCacheControlHeader("private, no-store");
    const other = newRequest();
    expect(readRouteCacheDirective(other)).toBeNull();
  });
});

describe("registerDocumentCompletenessCheck / readDocumentCompleteness", () => {
  it("brak predykatu = kompletny; poza zasięgiem rejestracja jest no-opem", () => {
    expect(readDocumentCompleteness()).toEqual({ complete: true, reasons: [] });

    scope.request = null;
    const check = vi.fn(() => ({ complete: false, reasons: ["x"] }));
    registerDocumentCompletenessCheck(check);
    expect(readDocumentCompleteness()).toEqual({ complete: true, reasons: [] });
    expect(check).not.toHaveBeenCalled();
  });

  it("predykaty składają się koniunkcją, a werdykt liczy się dopiero przy odczycie", () => {
    let streamed = false;
    registerDocumentCompletenessCheck(() => ({ complete: true, reasons: [] }));
    registerDocumentCompletenessCheck(() =>
      streamed ? { complete: true, reasons: [] } : { complete: false, reasons: ["dropped:a"] },
    );

    expect(readDocumentCompleteness()).toEqual({ complete: false, reasons: ["dropped:a"] });
    streamed = true;
    expect(readDocumentCompleteness()).toEqual({ complete: true, reasons: [] });
  });

  it("odstępstwo bez etykiet dostaje `incomplete`, a predykat rzucający - `check-failed`", () => {
    const request = scope.request!;
    registerDocumentCompletenessCheck(() => ({ complete: false, reasons: [] }));
    registerDocumentCompletenessCheck(() => {
      throw new Error("predykat padł");
    });
    registerDocumentCompletenessCheck(() => ({ complete: false, reasons: ["b", "c"] }));

    // Magazyn w `applyDeferredDocumentStore` czyta spoza zasięgu, z `Request` podanym wprost.
    scope.request = null;
    expect(readDocumentCompleteness(request)).toEqual({
      complete: false,
      reasons: ["incomplete", "check-failed", "b", "c"],
    });
  });

  it("predykat podany z jawnym żądaniem trafia do tego żądania, nie do bieżącego", () => {
    const other = newRequest();
    registerDocumentCompletenessCheck(() => ({ complete: false, reasons: ["other"] }), other);

    expect(readDocumentCompleteness()).toEqual({ complete: true, reasons: [] });
    expect(readDocumentCompleteness(other)).toEqual({ complete: false, reasons: ["other"] });
  });
});

describe("noteDocumentDegradation / readDocumentDegradations", () => {
  it("bez etykiet: pusta lista; pusta etykieta i brak zasięgu są ignorowane", () => {
    expect(readDocumentDegradations()).toEqual([]);
    noteDocumentDegradation("");
    expect(readDocumentDegradations()).toEqual([]);

    scope.request = null;
    noteDocumentDegradation("chrome");
    expect(readDocumentDegradations()).toEqual([]);
  });

  it("kolejność pierwszego zgłoszenia, bez duplikatów", () => {
    noteDocumentDegradation("chrome");
    noteDocumentDegradation("dropped:builder-post-list");
    noteDocumentDegradation("chrome");

    expect(readDocumentDegradations()).toEqual(["chrome", "dropped:builder-post-list"]);
  });

  it("sufit 16 etykiet: pętla zgłoszeń nie rozdmuchuje linii logu", () => {
    for (let i = 0; i < 40; i += 1) noteDocumentDegradation(`label-${i}`);

    const labels = readDocumentDegradations();
    expect(labels).toHaveLength(16);
    expect(labels[0]).toBe("label-0");
    expect(labels[15]).toBe("label-15");
  });
});

describe("markCrawlerUnavailable / readCrawlerUnavailable", () => {
  it("znak żyje w żądaniu, które loader oznaczył", () => {
    const request = scope.request!;
    expect(readCrawlerUnavailable()).toBe(false);
    markCrawlerUnavailable();

    expect(readCrawlerUnavailable()).toBe(true);
    expect(readCrawlerUnavailable(request)).toBe(true);
    expect(readCrawlerUnavailable(newRequest())).toBe(false);
  });

  it("poza zasięgiem: oznaczenie jest no-opem, odczyt daje `false`", () => {
    scope.request = null;
    expect(() => markCrawlerUnavailable()).not.toThrow();
    expect(readCrawlerUnavailable()).toBe(false);
  });
});

describe("appendLinkHeader / readLinkHeader", () => {
  const css = "</assets/styles.css>; rel=preload; as=style";
  const font = "</fonts/inter.woff2>; rel=preload; as=font; crossorigin";

  it("bez wpisów: `null`; pusta wartość i brak zasięgu są ignorowane", () => {
    expect(readLinkHeader()).toBeNull();
    appendLinkHeader("");
    expect(readLinkHeader()).toBeNull();

    scope.request = null;
    expect(() => appendLinkHeader(css)).not.toThrow();
    expect(readLinkHeader()).toBeNull();
  });

  it("złącza w kolejności pierwszego dołożenia i deduplikuje rewalidację loadera", () => {
    const request = scope.request!;
    appendLinkHeader(css);
    appendLinkHeader(font);
    appendLinkHeader(css);

    scope.request = null;
    expect(readLinkHeader(request)).toBe(`${css}, ${font}`);
  });

  it("wartość spoza ByteString albo z CRLF nie wchodzi do zbioru i nie zatruwa reszty", () => {
    appendLinkHeader(css);
    appendLinkHeader('</a.css>; rel=preload; title="€"');
    appendLinkHeader("</b.css>; rel=preload\r\nset-cookie: x=1");
    appendLinkHeader(font);

    const joined = readLinkHeader();
    expect(joined).toBe(`${css}, ${font}`);
    // Złączona wartość musi dać się nadać - dokładnie to chroni walidacja przy dołożeniu.
    expect(() => new Headers({ link: joined! })).not.toThrow();
  });
});

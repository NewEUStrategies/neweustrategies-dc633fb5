// CO DOWODZI TEN PLIK
//
// Jeden kontrakt nagłówków cache kanałów: `feedCacheControl` rozdziela kanał
// PEŁNY od PUSTEGO. Bez tego rozdzielenia odpowiedź zdegradowana - pusta, bo
// czytnik treści padł i `resilient` oddał `[]`, albo bo katalog domen był
// nieosiągalny - lądowała na brzegu CDN z `s-maxage=1800` i
// `stale-while-revalidate=86400`, czyli awaria trwająca sekundy utrwalała się
// na dobę.
//
// Ten plik jest tanią bramką na SAM KONTRAKT (czysta funkcja); dowody o tym,
// że trasy go faktycznie używają, siedzą w
// `routes/__tests__/feedRoutesDegradation.test.ts` i w testach modułów feedu.
import { describe, expect, it } from "vitest";
import {
  FEED_CACHE_CONTROL_EMPTY,
  FEED_CACHE_CONTROL_FULL,
  LIVE_FEED_CACHE_CONTROL_FULL,
  feedCacheControl,
  rssResponseHeaders,
} from "@/lib/seo/feedCache";

describe("feedCacheControl - kanał pełny kontra pusty", () => {
  it.each([1, 2, 30, 200])("kanał z %i pozycjami dostaje DŁUGI TTL", (count) => {
    expect(feedCacheControl(count)).toBe(FEED_CACHE_CONTROL_FULL);
  });

  it("kanał PUSTY dostaje TTL odpowiedzi zdegradowanej", () => {
    expect(feedCacheControl(0)).toBe(FEED_CACHE_CONTROL_EMPTY);
  });

  it("liczba ujemna (nigdy nie powinna wystąpić) też jest traktowana jako pustka", () => {
    // Kontrakt jest „ma pozycje / nie ma pozycji", nie „liczba jest dodatnia" -
    // gdyby wołający policzył długość źle, bezpieczniejsza jest odpowiedź
    // krótkotrwała niż długi TTL na dokumencie, o którym nic nie wiemy.
    expect(feedCacheControl(-1)).toBe(FEED_CACHE_CONTROL_EMPTY);
  });

  it("TTL kanału pustego NIE zawiera stale-while-revalidate", () => {
    // To jest właściwa treść defektu: `stale-while-revalidate=86400` pozwalał
    // brzegowi podawać ZAPAMIĘTANĄ PUSTKĘ przez dobę po powrocie bazy.
    expect(FEED_CACHE_CONTROL_EMPTY).not.toContain("stale-while-revalidate");
  });

  it("TTL kanału pustego wymusza rewalidację u klienta", () => {
    expect(FEED_CACHE_CONTROL_EMPTY).toContain("max-age=0");
    expect(FEED_CACHE_CONTROL_EMPTY).toContain("must-revalidate");
  });

  it("brzeg trzyma pustkę najwyżej minutę", () => {
    expect(FEED_CACHE_CONTROL_EMPTY).toContain("s-maxage=60");
  });

  it("kontrola dodatnia: TTL kanału pełnego jest DOKŁADNIE tym, co było przed wydzieleniem", () => {
    // Wydzielenie stałej nie jest zmianą zachowania kanału pełnego - gdyby
    // literał się tu przesunął, wszystkie testy nagłówków kanałów w repo
    // padłyby naraz i nikt by nie wiedział, że to była ta jedna linia.
    expect(FEED_CACHE_CONTROL_FULL).toBe(
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    );
  });
});

describe("feedCacheControl - wyjątek relacji na żywo", () => {
  it("relacja na żywo z pozycjami dostaje SWÓJ, krótszy TTL pełny", () => {
    expect(feedCacheControl(3, LIVE_FEED_CACHE_CONTROL_FULL)).toBe(LIVE_FEED_CACHE_CONTROL_FULL);
  });

  it("relacja na żywo PUSTA spada na ten sam TTL zdegradowany co pozostałe kanały", () => {
    expect(feedCacheControl(0, LIVE_FEED_CACHE_CONTROL_FULL)).toBe(FEED_CACHE_CONTROL_EMPTY);
  });

  it("TTL relacji jest KRÓTSZY od standardowego - inaczej wyjątek nie miałby sensu", () => {
    const sMaxAge = (cc: string): number => Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? "0");
    expect(sMaxAge(LIVE_FEED_CACHE_CONTROL_FULL)).toBeLessThan(sMaxAge(FEED_CACHE_CONTROL_FULL));
  });

  it("kontrola dodatnia: TTL relacji jest DOKŁADNIE tym, co było w trasie", () => {
    expect(LIVE_FEED_CACHE_CONTROL_FULL).toBe(
      "public, max-age=60, s-maxage=120, stale-while-revalidate=600",
    );
  });
});

describe("rssResponseHeaders", () => {
  it("dokłada typ treści kanału RSS", () => {
    expect(rssResponseHeaders(5)["Content-Type"]).toBe("application/rss+xml; charset=utf-8");
  });

  it("przenosi rozdzielenie pełny/pusty na nagłówek Cache-Control", () => {
    expect(rssResponseHeaders(5)["Cache-Control"]).toBe(FEED_CACHE_CONTROL_FULL);
    expect(rssResponseHeaders(0)["Cache-Control"]).toBe(FEED_CACHE_CONTROL_EMPTY);
  });

  it("przepuszcza wyjątek TTL pełnego do nagłówka", () => {
    expect(rssResponseHeaders(5, LIVE_FEED_CACHE_CONTROL_FULL)["Cache-Control"]).toBe(
      LIVE_FEED_CACHE_CONTROL_FULL,
    );
  });

  it("oddaje DOKŁADNIE dwa nagłówki - nic więcej trasa nie dokłada", () => {
    expect(Object.keys(rssResponseHeaders(1)).sort()).toEqual(["Cache-Control", "Content-Type"]);
  });
});

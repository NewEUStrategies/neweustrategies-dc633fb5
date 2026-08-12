// Regresja RODO: identyfikator widza ma skończone życie.
//
// `viewer_hash` był mintowany raz i trzymany w localStorage bez znacznika czasu,
// więc jedno urządzenie nosiło ten sam identyfikator odsłon bezterminowo. Test
// przybija rotację po TTL, jednorazowe zdjęcie starego (bezterminowego) tokenu
// oraz kasowanie na żądanie (wycofana zgoda).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearViewerHash, getViewerHash } from "../viewerHash";

const STORAGE_KEY = "viewer_hash:v2";
const LEGACY_KEY = "__viewer_hash";
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getViewerHash", () => {
  it("mintuje token ze znacznikiem czasu i zwraca go ponownie w oknie TTL", () => {
    const first = getViewerHash();
    expect(first.length).toBeGreaterThanOrEqual(16);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as {
      hash: string;
      mintedAt: number;
    };
    expect(stored.hash).toBe(first);
    expect(stored.mintedAt).toBe(Date.now());

    vi.setSystemTime(new Date(Date.now() + 29 * DAY_MS));
    expect(getViewerHash()).toBe(first);
  });

  it("rotuje token po upływie TTL", () => {
    const first = getViewerHash();

    vi.setSystemTime(new Date(Date.now() + 31 * DAY_MS));
    const second = getViewerHash();

    expect(second).not.toBe(first);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as {
      hash: string;
      mintedAt: number;
    };
    expect(stored.hash).toBe(second);
    expect(stored.mintedAt).toBe(Date.now());
  });

  it("zdejmuje bezterminowy token sprzed rotacji i mintuje nowy", () => {
    window.localStorage.setItem(LEGACY_KEY, "legacyhash0123456789");

    const minted = getViewerHash();

    expect(minted).not.toBe("legacyhash0123456789");
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("rotuje token ze znacznikiem czasu w przyszłości (skok zegara nie daje wieczności)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hash: "futurehash0123456789", mintedAt: Date.now() + 10 * DAY_MS }),
    );

    expect(getViewerHash()).not.toBe("futurehash0123456789");
  });

  it("odrzuca uszkodzony wpis zamiast go zwracać", () => {
    window.localStorage.setItem(STORAGE_KEY, "{nie-json");
    expect(getViewerHash().length).toBeGreaterThanOrEqual(16);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hash: "krotki" }));
    expect(getViewerHash().length).toBeGreaterThanOrEqual(16);
  });
});

describe("clearViewerHash", () => {
  it("usuwa token bieżący i bezterminowy", () => {
    getViewerHash();
    window.localStorage.setItem(LEGACY_KEY, "legacyhash0123456789");

    clearViewerHash();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

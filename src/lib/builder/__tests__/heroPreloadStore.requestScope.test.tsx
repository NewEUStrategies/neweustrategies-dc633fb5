// MAGAZYN PRELOADÓW OBRAZU LCP NA CZAS ŻĄDANIA (`heroPreloadStore`).
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// Loader trasy liczy na serwerze preloady obrazów kandydatów LCP i zamiast
// wozić je w danych loadera (`$tsr` w KAŻDYM dokumencie) zapisuje je w magazynie
// kluczowanym `QueryClient`em, który na serwerze żyje jedno żądanie. Kontrakt:
// * zapis i odczyt dotyczą TEGO SAMEGO żądania - dwa równoległe renderery SSR
//   (dwa `QueryClient`y) nigdy nie widzą swoich preloadów nawzajem (inaczej
//   strona A wysyłałaby nagłówek preloadu obrazu strony B),
// * brak zapisu to `undefined` (loader nic nie policzył), a nie pusta lista,
// * hak komponentu zwraca listę WYŁĄCZNIE w renderze serwerowym - na kliencie
//   zawsze `undefined`, bo render czysto kliencki nie ma kandydata ani preloadu.
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// Jedyna atrapa to flaga środowiska `@tanstack/router-core/isServer` (pod
// vitest ma wartość `undefined`, a `isSsrRequest()` widzi `document` z
// happy-dom). Przełączamy ją getterem, żeby w jednym pliku zmierzyć OBA ramiona
// warunku z `useHeroPreloads`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { LcpImagePreload } from "@/lib/builder/aboveFold";
import { heroPreloadsFor, rememberHeroPreloads, useHeroPreloads } from "../heroPreloadStore";

const env = vi.hoisted(() => ({ server: false as boolean | undefined }));

vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return env.server;
  },
}));

afterEach(() => {
  cleanup();
  env.server = false;
});

const preload = (href: string): LcpImagePreload => ({ href });

function hakDla(queryClient: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useHeroPreloads(), { wrapper }).result.current;
}

describe("heroPreloadStore - zakres żądania", () => {
  it("odczyt bez zapisu to undefined, nie pusta lista", () => {
    expect(heroPreloadsFor(new QueryClient())).toBeUndefined();
  });

  it("zapis i odczyt dotyczą tego samego żądania, a równoległe żądania się nie mieszają", () => {
    const zadanieA = new QueryClient();
    const zadanieB = new QueryClient();
    const listaA = [preload("/a.avif")];
    rememberHeroPreloads(zadanieA, listaA);
    rememberHeroPreloads(zadanieB, []);
    expect(heroPreloadsFor(zadanieA)).toBe(listaA);
    // Pusta lista to WYNIK loadera („brak kandydata"), nie brak zapisu.
    expect(heroPreloadsFor(zadanieB)).toEqual([]);
  });

  it("ponowny zapis w tym samym żądaniu zastępuje listę (nawigacja loadera)", () => {
    const zadanie = new QueryClient();
    rememberHeroPreloads(zadanie, [preload("/stary.avif")]);
    const nowa = [preload("/nowy.avif")];
    rememberHeroPreloads(zadanie, nowa);
    expect(heroPreloadsFor(zadanie)).toBe(nowa);
  });
});

describe("useHeroPreloads - tylko render serwerowy", () => {
  it("serwer: komponent dostaje listę zapisaną przez loader tego żądania", () => {
    env.server = true;
    const zadanie = new QueryClient();
    const lista = [preload("/hero.avif")];
    rememberHeroPreloads(zadanie, lista);
    expect(hakDla(zadanie)).toBe(lista);
    expect(hakDla(new QueryClient())).toBeUndefined();
  });

  it("klient: zawsze undefined, nawet gdy magazyn ma wpis", () => {
    env.server = false;
    const zadanie = new QueryClient();
    rememberHeroPreloads(zadanie, [preload("/hero.avif")]);
    expect(hakDla(zadanie)).toBeUndefined();
  });

  it("flaga routera nieustalona (undefined): decyduje obecność `document`, czyli klient", () => {
    env.server = undefined;
    const zadanie = new QueryClient();
    rememberHeroPreloads(zadanie, [preload("/hero.avif")]);
    expect(hakDla(zadanie)).toBeUndefined();
  });
});

// Klasa urządzenia widoku (`desktop | tablet | mobile`) dla treści wysp
// hydratacji - magazyn i hak `useViewportDevice()`.
//
// PO CO. Treść wyspy (P2.2: sekcje >= 1 i stopka, P2.3: widgety nagłówka)
// renderuje się zależnie od urządzenia, ale do chwili otwarcia bramki
// (`hydrationIsland.tsx`) jest ODWODNIONĄ granicą Suspense z HTML-em serwera.
// Każda aktualizacja w torze Sync/Default, która do takiej granicy dotrze
// (nowe propsy, zmiana kontekstu nad nią, `useSyncExternalStore`), każe
// Reactowi porzucić HTML serwera i wyrenderować granicę po stronie klienta:
// utrata treści, fallback, CLS (klasa 0,421 z boot-js §1.3). Dlatego
// urządzenie NIE przechodzi przez kontekst nad wyspą ani przez jej propsy -
// każdy komponent w środku czyta je sam, z tego modułu.
//
// LUSTRO `useState` + `startTransition`, NIE `useSyncExternalStore`.
// `useSyncExternalStore` z `getServerSnapshot` innym niż migawka klienta
// (serwer: `desktop`, telefon: `mobile`) po hydratacji wymusza re-render w
// SyncLane (`forceStoreRerender`), który dociera do jeszcze odwodnionych,
// zagnieżdżonych granic (leniwy widget bez chunku) i renderuje je od nowa po
// stronie klienta - bez ostrzeżenia, bez `onRecoverableError`
// (`react-dom-client` 19.2, `updateDehydratedSuspenseComponent`). Lustro
// zaczyna od `useState(serverDevice)` - pierwszy render klienta jest więc
// bajt w bajt taki jak HTML serwera - a po montażu (efekt pasywny) i przy
// każdej zmianie magazynu woła `startTransition(() => setDevice(next))`.
// Przejście, które trafi na odwodnioną granicę, zawiesza się (React czeka na
// jej hydratację) zamiast ją niszczyć (werdykt H6: dzisiejsze przełączenie w
// `BuilderRenderer.tsx` jest przejściem, czyli bezpieczne).
//
// ŹRÓDŁO. Domyślnie magazyn mierzy widok przez `matchMedia` na progach
// `BuilderRenderer.tsx` (`MOBILE_BREAKPOINT` 768, `TABLET_BREAKPOINT` 1024;
// test pilnuje zgodności). `matchMedia` zamiast `window.innerWidth`, bo
// odczyt `innerWidth` należy do odczytów wymuszających układ. Pomiar rusza
// leniwie, przy pierwszym odczycie albo subskrypcji - nigdy w czasie importu
// i nigdy na serwerze. Renderer, który mierzy własny kontener (dziś
// `ResizeObserver` w `BuilderRenderer.tsx`), może ogłaszać wynik przez
// `publishViewportDevice()` - wtedy wyspy dostają DOKŁADNIE to urządzenie, co
// reszta renderera (kontener bez paska przewijania bywa węższy od widoku o
// ~15 px, czyli inną klasą w pasie 1024-1039 px). Ostatni zapis wygrywa;
// słuchacze `matchMedia` odzywają się tylko przy przekroczeniu progu.
//
// SSR: `getViewportDevice()` zwraca `null`, subskrypcja i ogłoszenie to no-op,
// a hak zwraca `serverDevice` (efekty nie biegną na serwerze).

import { startTransition, useEffect, useState } from "react";
import type { Device } from "@/lib/builder/types";

/** Szerokość (px), od której widok przestaje być `mobile` - jak `BuilderRenderer.tsx`. */
export const VIEWPORT_TABLET_MIN_WIDTH = 768;
/** Szerokość (px), od której widok jest `desktop` - jak `BuilderRenderer.tsx`. */
export const VIEWPORT_DESKTOP_MIN_WIDTH = 1024;

/** Urządzenie, które renderuje serwer (i pierwszy render klienta), gdy wołający nie poda innego. */
export const SERVER_VIEWPORT_DEVICE: Device = "desktop";

export type ViewportDeviceListener = (device: Device) => void;

const TABLET_QUERY = `(min-width: ${VIEWPORT_TABLET_MIN_WIDTH}px)`;
const DESKTOP_QUERY = `(min-width: ${VIEWPORT_DESKTOP_MIN_WIDTH}px)`;

const listeners = new Set<ViewportDeviceListener>();
let current: Device | null = null;
let queries: { readonly tablet: MediaQueryList; readonly desktop: MediaQueryList } | null = null;

const noop = (): void => {};

function canMeasure(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function measured(): Device | null {
  if (!queries) return null;
  if (queries.desktop.matches) return "desktop";
  return queries.tablet.matches ? "tablet" : "mobile";
}

function set(next: Device): void {
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener(next);
}

function onBreakpoint(): void {
  const next = measured();
  if (next !== null) set(next);
}

/** Zakłada zapytania `matchMedia` (raz na dokument) i bierze z nich pierwszy pomiar. */
function ensureMeasuring(): void {
  if (queries || !canMeasure()) return;
  queries = {
    tablet: window.matchMedia(TABLET_QUERY),
    desktop: window.matchMedia(DESKTOP_QUERY),
  };
  queries.tablet.addEventListener("change", onBreakpoint);
  queries.desktop.addEventListener("change", onBreakpoint);
  if (current === null) current = measured();
}

/**
 * Bieżące urządzenie widoku albo `null` (serwer, brak `matchMedia` przed
 * pierwszym ogłoszeniem). Pierwszy odczyt zakłada pomiar.
 */
export function getViewportDevice(): Device | null {
  if (typeof window === "undefined") return null;
  ensureMeasuring();
  return current;
}

/**
 * Subskrybuje zmiany urządzenia (słuchacz dostaje tylko RÓŻNĄ wartość).
 * Zwraca odpięcie. Na serwerze no-op.
 */
export function subscribeViewportDevice(listener: ViewportDeviceListener): () => void {
  if (typeof window === "undefined") return noop;
  ensureMeasuring();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ogłasza urządzenie zmierzone przez renderer (np. `ResizeObserver` na jego
 * korzeniu), żeby wyspy widziały tę samą klasę co reszta renderera. Na
 * serwerze no-op.
 */
export function publishViewportDevice(device: Device): void {
  if (typeof window === "undefined") return;
  ensureMeasuring();
  set(device);
}

/**
 * Urządzenie dla treści wyspy: lustro `useState(serverDevice)` aktualizowane
 * WYŁĄCZNIE w `startTransition` - po montażu (bieżąca wartość magazynu) i przy
 * każdej jego zmianie. Pierwszy render zwraca `serverDevice` (parytet z HTML
 * serwera także przy hydratacji na telefonie). `serverDevice` czytane tylko
 * przy montażu; musi być tym, co wyrenderował serwer (`BuilderRenderer`:
 * `desktop`).
 */
export function useViewportDevice(serverDevice: Device = SERVER_VIEWPORT_DEVICE): Device {
  const [device, setDevice] = useState<Device>(serverDevice);
  useEffect(() => {
    const follow = (next: Device) => {
      startTransition(() => setDevice(next));
    };
    const now = getViewportDevice();
    if (now !== null) follow(now);
    return subscribeViewportDevice(follow);
  }, []);
  return device;
}

/** Tylko testy: zdejmuje zapytania i słuchaczy, zeruje bieżące urządzenie. */
export function __resetViewportDeviceForTests(): void {
  if (queries) {
    queries.tablet.removeEventListener("change", onBreakpoint);
    queries.desktop.removeEventListener("change", onBreakpoint);
  }
  queries = null;
  current = null;
  listeners.clear();
}

// Wspólny zatrzask dokumentu: „pierwsza interakcja ALBO punkt ciszy" (P3.5).
//
// PO CO. Kilka rzeczy na stronie ma ruszyć dopiero wtedy, gdy czytelnik
// czegoś dotknie, a bez dotknięcia - gdy strona się uspokoi: autoplay
// sliderów, tickery i rotatory (bramka ruchu, `motionGate.ts`), a dalej
// zapytania nakładek (P3.8). Każdy z własną parą „kolejka + punkt ciszy"
// (wzorzec `useDecorativeMotion` paska „Na czasie" sprzed P3.5) rozjeżdżał się
// o klatki i kosztował osobny wpis w kolejce. Tutaj zatrzask jest JEDEN na
// dokument, a konsumenci tylko się w nim zapisują.
//
// KONTRAKT.
//  - Otwiera się RAZ: przy pierwszej interakcji odwiedzającego (kolejka P0.3
//    `enqueue(open, {priority: "overlays"})` - po końcu gestu i po klatce,
//    jedno zadanie na klatkę) albo w punkcie ciszy (`onQuiescent`, ta sama
//    klasa), cokolwiek przyjdzie pierwsze. Potem zostaje otwarty do końca życia
//    dokumentu (także po nawigacji SPA).
//  - Uzbraja się leniwie, przy pierwszym subskrybencie, i nigdy się nie
//    rozbraja: remount ani podwójny efekt StrictMode nie zaczynają czekania od
//    nowa (tak samo jak detektor ciszy). Strona bez konsumentów nie płaci za
//    nic.
//  - Nigdy w prerenderze (Speculation Rules): uzbrojenie czeka na aktywację
//    (`afterPrerendering`), a otwarcie zgłoszone w dokumencie wciąż
//    prerenderowanym jest ignorowane.
//  - Serwer: zamknięty, wszystko no-op. Hook daje `false` na serwerze i w
//    renderze hydratacji (`getServerSnapshot`), więc nic, co od niego zależy,
//    nie trafia do HTML-a ani nie rozjeżdża hydratacji. Komponent zamontowany
//    PO otwarciu (nawigacja SPA, późna wyspa poza hydratacją) dostaje `true`
//    od razu - zatrzask jest faktem dokumentu, nie komponentu.
//  - Callbacki przy otwarciu biegną synchronicznie, w kolejności zapisu, w
//    jednym zadaniu kolejki; wyjątek jednego idzie do `reportError` i nie
//    zatrzymuje pozostałych. Spóźniony subskrybent (zatrzask już otwarty)
//    dostaje callback w mikrozadaniu - już po zwróceniu funkcji odwołującej.
//
// Przewinięcie ELEMENTU (programowe `scrollTo` karuzeli) nie jest interakcją
// (`firstInteraction.ts`), więc autoplay nie otwiera zatrzasku sam sobie.

import { useSyncExternalStore } from "react";
import { afterPrerendering, isPrerendering } from "@/lib/prerender";
import { enqueue } from "./postInteractionQueue";
import { onQuiescent } from "./whenQuiescent";

/** Callback wołany raz, przy otwarciu zatrzasku. */
export type InteractionOrQuietCallback = () => void;
/** Odwołuje subskrypcję (bezpieczne do wielokrotnego wołania). */
export type CancelInteractionOrQuiet = () => void;

interface Subscriber {
  readonly callback: InteractionOrQuietCallback;
}

const subscribers = new Set<Subscriber>();
let open = false;
/** Zdejmuje uzbrojenie (wyłącznie reset testów); `null` = jeszcze nieuzbrojony. */
let disarm: (() => void) | null = null;

const noop = (): void => {};

function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

function invoke(callback: InteractionOrQuietCallback): void {
  try {
    callback();
  } catch (error) {
    report(error);
  }
}

function openLatch(): void {
  if (open || isPrerendering()) return;
  open = true;
  const waiting = [...subscribers];
  subscribers.clear();
  for (const { callback } of waiting) invoke(callback);
}

/** Jedyne uzbrojenie na dokument: wpis w kolejce interakcji + zapis w punkcie ciszy. */
function arm(): void {
  if (disarm) return;
  let cancelInteraction: () => void = noop;
  let cancelQuiet: () => void = noop;
  const cancelActivation = afterPrerendering(() => {
    // Cokolwiek przyjdzie pierwsze, otwiera; drugi tor jest wtedy zbędny.
    const fire = () => {
      cancelInteraction();
      cancelQuiet();
      openLatch();
    };
    cancelInteraction = enqueue(fire, { priority: "overlays" });
    cancelQuiet = onQuiescent(fire, { priority: "overlays" });
  });
  disarm = () => {
    cancelActivation();
    cancelInteraction();
    cancelQuiet();
  };
}

/**
 * Woła `callback` raz, przy otwarciu zatrzasku (pierwsza interakcja albo punkt
 * ciszy). Gdy zatrzask jest już otwarty - w mikrozadaniu. Pierwszy zapis
 * uzbraja zatrzask dokumentu. Zwraca funkcję odwołującą (cleanup efektu). Na
 * serwerze no-op.
 */
export function onInteractionOrQuiet(
  callback: InteractionOrQuietCallback,
): CancelInteractionOrQuiet {
  if (typeof window === "undefined" || typeof document === "undefined") return noop;
  if (open) {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) invoke(callback);
    });
    return () => {
      cancelled = true;
    };
  }
  const subscriber: Subscriber = { callback };
  subscribers.add(subscriber);
  arm();
  return () => {
    subscribers.delete(subscriber);
  };
}

/** Czy zatrzask jest otwarty (`false` na serwerze, w prerenderze i przed uzbrojeniem). */
export function isInteractionOrQuietOpen(): boolean {
  return open;
}

function subscribeLatch(onChange: () => void): () => void {
  return onInteractionOrQuiet(onChange);
}

function subscribeNever(): () => void {
  return noop;
}

function readOpen(): boolean {
  return open;
}

function readClosed(): boolean {
  return false;
}

/**
 * Stan zatrzasku dla Reacta: `false` na serwerze i w renderze hydratacji,
 * `true` od otwarcia (re-render subskrybentów w zadaniu otwarcia). Przy
 * `enabled === false` niczego nie uzbraja i zawsze daje `false` - dla
 * komponentu, który w danej konfiguracji nie ma na co czekać.
 */
export function useInteractionOrQuiet(enabled = true): boolean {
  return useSyncExternalStore(
    enabled ? subscribeLatch : subscribeNever,
    enabled ? readOpen : readClosed,
    readClosed,
  );
}

/**
 * Tylko testy: otwiera zatrzask tą samą ścieżką co interakcja albo cisza
 * (callbacki subskrybentów synchronicznie). Testy konsumentów sprawdzają nim
 * zachowanie „od chwili otwarcia" bez odtwarzania kolejki i detektora ciszy.
 */
export function __openInteractionOrQuietForTests(): void {
  openLatch();
}

/** Tylko testy: zdejmuje uzbrojenie, subskrybentów i zamyka zatrzask. */
export function __resetInteractionOrQuietForTests(): void {
  disarm?.();
  disarm = null;
  subscribers.clear();
  open = false;
}

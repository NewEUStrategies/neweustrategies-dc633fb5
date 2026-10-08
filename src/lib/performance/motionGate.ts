// Bramka ruchu strony (P3.5): autoplay, tickery, rotatory i nieskończone
// animacje treści ruszają dopiero po pierwszej interakcji albo w punkcie ciszy.
//
// PO CO. Speed Index liczy postęp wizualny wobec OSTATNIEJ klatki śladu. Hero
// strony głównej przeskakiwał na drugi slajd ~4,5 s po montażu (na produkcji
// ~8 s po nawigacji), więc filmstrip trzymał postęp na ~85% od pierwszej
// sekundy aż do przeskoku: ok. +0,8 s obserwowanego SI, ~+1,1 s SI mobile
// (`faza3/diagnoza/ruch-inwentarz.md`). Tak samo działa każda porcja tickera i
// każda nieskończona animacja treści widoczna w kadrze. Ruch, który zaczyna się
// po interakcji albo po ≥ 5 s ciszy, wypada poza ślad Lighthouse'a, a dla
// czytelnika zmienia tylko tyle, że karuzela nie rusza, zanim on sam czegoś
// nie dotknie albo strona się nie uspokoi.
//
// DWIE POŁOWY NA JEDNYM ZATRZASKU (`interactionOrQuiet.ts`).
//  1. JS: `useMotionGate()` daje `false` do otwarcia. Timery (slidery,
//     karuzele, porcje tickerów, rotatory, sekundnik odliczania) zakładają się
//     dopiero na `true`, więc pierwsza zmiana = otwarcie + PEŁNY interwał.
//  2. CSS: przy otwarciu bramka ustawia `data-motion="on"` na `<html>` - poza
//     Reactem (atrybutu nie ma w HTML-u z serwera ani w drzewie Reacta, więc
//     hydratacja go nie porównuje i żaden render go nie zdejmie). Element z
//     nieskończoną animacją treści obecną już w HTML-u z SSR nosi atrybut
//     `data-motion-loop`; reguła w `src/styles.css` trzyma go w
//     `animation-play-state: paused`, dopóki `<html>` nie ma
//     `data-motion="on"`. Arkusz jest blokujący, więc pauza obowiązuje od
//     pierwszego malowania, jeszcze przed hydratacją.
// Pauza (a nie brak animacji) znaczy, że samo otwarcie bramki nie zmienia
// klatki: ruch rusza od klatki, która już stoi na ekranie.
//
// UZBROJENIE. Każdy komponent, który ma `data-motion-loop` albo timer ruchu,
// woła `useMotionGate()` (subskrypcja w fazie commit) - to uzbraja zatrzask i
// zapis atrybutu także na stronie, na której nie ma innych konsumentów.
// `useMotionGate(false)` niczego nie uzbraja (widget bez autoplay).
//
// WIDEO Z AUTOPLAY: `useGatedVideoAutoplay` (wyciszone `play()` po otwarciu,
// wariant tła tylko przy viewporcie) i `firstFrameVideoSrc` (pierwsza klatka
// zamiast pustego prostokąta na iOS do otwarcia) - jedno wykonanie dla wideo
// widgetu, hero wideo i wideo tła sekcji.
//
// REDUCED MOTION: niezależne. Bramka tylko opóźnia ruch; reguły
// `prefers-reduced-motion` i odczyty `prefersReducedMotion()` w konsumentach
// zostają, jak były.

import { useEffect, useSyncExternalStore, type RefObject } from "react";
import {
  __openInteractionOrQuietForTests,
  __resetInteractionOrQuietForTests,
  isInteractionOrQuietOpen,
  onInteractionOrQuiet,
} from "./interactionOrQuiet";

/** Atrybut `<html>` ustawiany przy otwarciu bramki. */
const MOTION_ATTRIBUTE = "data-motion";
/** Wartość atrybutu otwartej bramki (selektor `[data-motion="on"]` w `styles.css`). */
const MOTION_ON = "on";
/**
 * Takt odliczań przed otwarciem bramki: raz na minutę, więc cyfra sekund stoi
 * (po pełnych 60 s ma tę samą wartość), a minuty nadal są prawdziwe.
 */
export const MOTION_IDLE_TICK_MS = 60_000;

let attributeArmed = false;

const noop = (): void => {};

function setMotionAttribute(): void {
  document.documentElement.setAttribute(MOTION_ATTRIBUTE, MOTION_ON);
}

/**
 * Subskrypcja hooka (faza commit, nigdy render): raz na dokument zapis
 * atrybutu przy otwarciu, potem callback Reacta. Atrybut i re-render
 * konsumentów przychodzą z tego samego zadania otwarcia (React przerenderowuje
 * subskrybentów dopiero po nim), więc CSS i JS ruszają w tej samej klatce.
 */
function subscribeMotion(onChange: () => void): () => void {
  if (!attributeArmed) {
    attributeArmed = true;
    onInteractionOrQuiet(setMotionAttribute);
  }
  return onInteractionOrQuiet(onChange);
}

function subscribeNever(): () => void {
  return noop;
}

function readClosed(): boolean {
  return false;
}

/**
 * Bramka ruchu dla Reacta: `false` na serwerze, w renderze hydratacji i do
 * otwarcia zatrzasku, potem `true` (komponent zamontowany po otwarciu dostaje
 * `true` od razu). Subskrypcja uzbraja zatrzask i zapis `data-motion="on"` na
 * `<html>`. Przy `enabled === false` niczego nie uzbraja i daje `false`.
 */
export function useMotionGate(enabled = true): boolean {
  return useSyncExternalStore(
    enabled ? subscribeMotion : subscribeNever,
    enabled ? isInteractionOrQuietOpen : readClosed,
    readClosed,
  );
}

/**
 * Autoplay wideo za bramką - jedno wykonanie dla wideo widgetu, hero wideo i
 * wideo tła sekcji. HTML nie ma atrybutu `autoplay` (przeglądarka nie rusza
 * wideo przy pierwszym malowaniu, w środku śladu Lighthouse'a), a wyciszone
 * `play()` przychodzi po otwarciu bramki (ponownie przy zmianie `src`).
 * `inViewOnly`: gra tylko przy viewporcie (`IntersectionObserver`, margines
 * 200 px) i pauzuje poza nim - wideo tła na długich stronach paliło pasmo,
 * dekodowanie i baterię. Przy `enabled === false` niczego nie uzbraja.
 */
export function useGatedVideoAutoplay(
  ref: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  src: string,
  inViewOnly = false,
): void {
  const motion = useMotionGate(enabled);
  useEffect(() => {
    const el = ref.current;
    if (!motion || !el) return;
    // Polityka autoplay przeglądarki wpuszcza bez gestu wyłącznie wyciszone wideo.
    el.muted = true;
    const play = () => void el.play().catch(noop);
    if (!inViewOnly || typeof IntersectionObserver === "undefined") {
      play();
      return inViewOnly ? () => el.pause() : undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) play();
          else el.pause();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [motion, src, inViewOnly, ref]);
}

/**
 * Adres wideo, które stoi do otwarcia bramki. Bez atrybutu `autoplay`, przy
 * `preload="metadata"` i bez plakatu Safari na iOS nie dekoduje pierwszej
 * klatki - prostokąt wideo (tło sekcji, hero) zostaje pusty aż do `play()`.
 * Fragment mediów `#t=0.001` (start 1 ms) wymusza zdekodowanie i namalowanie
 * pierwszej klatki; fragment nie idzie do serwera, więc cache i transfer bez
 * zmian. Plakat z CMS-u wygrywa (początkowe przewinięcie do `t` zdjęłoby
 * plakat), a adres z własnym fragmentem zostaje nietknięty.
 */
export function firstFrameVideoSrc(src: string, poster?: string): string {
  return poster || src.includes("#") ? src : `${src}#t=0.001`;
}

/**
 * Tylko testy konsumentów: otwiera bramkę tą samą ścieżką co interakcja albo
 * punkt ciszy (subskrybenci synchronicznie). Zwykle przed renderem albo w
 * `act()`.
 */
export function __openMotionGateForTests(): void {
  __openInteractionOrQuietForTests();
}

/** Tylko testy: zamyka zatrzask, zdejmuje atrybut z `<html>` i uzbrojenie zapisu. */
export function __resetMotionGateForTests(): void {
  __resetInteractionOrQuietForTests();
  attributeArmed = false;
  if (typeof document !== "undefined") {
    document.documentElement.removeAttribute(MOTION_ATTRIBUTE);
  }
}

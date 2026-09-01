// EFEKT LAYOUTOWY BEZPIECZNY DLA RENDERU SERWEROWEGO - jedna definicja dla
// całego repozytorium.
//
// CO ROBI. Na kliencie to DOKŁADNIE `useLayoutEffect`: pomiar musi zostać
// w gałęzi layoutowej, bo leci synchronicznie PRZED malowaniem, więc czytelnik
// nie widzi stanu sprzed korekty. Na serwerze (brak `window`) to `useEffect` -
// i tam żaden z nich nie wykonuje ciała, bo React nie uruchamia efektów podczas
// `renderToString`.
//
// CO TA ZMIANA KUPUJE, A CZEGO NIE - UCZCIWIE:
//  * NIE zmienia ani jednego bajtu HTML-a. Oba haki zajmują ten sam slot
//    w kolejności haków, a ciało i tak nie biegnie na serwerze. To NIE jest
//    naprawa rozjazdu hydratacji ani defekt poprawności.
//  * NIE wycisza ostrzeżenia „useLayoutEffect does nothing on the server".
//    ZMIERZONE na zainstalowanym `react-dom` 19.2.5: tego napisu nie ma
//    w żadnym pliku paczki, a `renderToString` komponentu z gołym
//    `useLayoutEffect` nie wypisuje NIC (sprawdzone w tym samym przebiegu,
//    w którym ostrzeżenie o brakującym `key` się pojawia, czyli w budowie
//    deweloperskiej). React 18 ostrzegał, React 19 przestał.
//  * DAJE natomiast dwie rzeczy: (1) intencja jest napisana W KODZIE, a nie
//    oparta na wiedzy o wnętrzu Reacta - dziś ciało z `window.requestAnimationFrame`
//    (`MobileBottomBarView`) jest bezpieczne WYŁĄCZNIE dlatego, że React nie
//    odpala efektów na serwerze, czyli bezpieczne PRZEZ PRZYPADEK; (2) jedna
//    definicja zamiast pięciu kopii tej samej decyzji.
//
// SKĄD SIĘ WZIĘŁA. Regułę i jej uzasadnienie napisano najpierw lokalnie
// w `src/components/builder/organisms/BuilderRenderer.tsx` (przy korekcie
// „desktop-first"). Ten moduł jest tym samym wyrażeniem wyciągniętym do liścia,
// żeby kolejne powierzchnie SSR-owe nie kopiowały go po raz piąty.
import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` na kliencie, `useEffect` w renderze serwerowym.
 *
 * Wybór następuje RAZ, przy wczytaniu modułu - a nie przy każdym renderze -
 * bo `typeof window` nie zmienia się w trakcie życia procesu, a hak wybierany
 * warunkowo per render łamałby kolejność haków.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

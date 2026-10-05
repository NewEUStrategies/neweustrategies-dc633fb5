import { clsx, type ClassValue } from "clsx";
import { useRef } from "react";
import { twMerge } from "tailwind-merge";

// `cn()` Z OGRANICZONĄ PAMIĘCIĄ (Wydajność PSI 85/95, fala 2, P2.4 -
// hydration:H10 d). W commicie hydratacji `cn` + `tailwind-merge` to 7-10 ms
// (profile księgi P0.5, K12): ten sam zestaw klas przechodzi przez scalanie
// przy pierwszym renderze i ponownie w synchronicznym re-renderze po efektach
// pasywnych. Własna pamięć tailwind-merge ma 500 wpisów w dwóch pokoleniach,
// a strona buildera produkuje więcej różnych napisów, więc drugi przebieg
// trafiał w wypchnięte wpisy. Tu: mapa napis -> wynik z twardym limitem
// (najstarszy wpis wylatuje pierwszy, O(1)), więc pamięć nie rośnie bez końca
// na długo żyjącym kliencie ani w izolacie serwera (czysta funkcja - wspólna
// pamięć między żądaniami nie przenosi żadnych danych poza nazwami klas).
// Pojedyncza klasa (bez spacji) nie ma z czym się scalić i wraca od razu.
const CN_CACHE_LIMIT = 2048;
const cnCache = new Map<string, string>();

export function cn(...inputs: ClassValue[]) {
  const joined = clsx(inputs);
  if (!/\s/.test(joined)) return joined;
  const cached = cnCache.get(joined);
  if (cached !== undefined) return cached;
  const merged = twMerge(joined);
  if (cnCache.size >= CN_CACHE_LIMIT) {
    const oldest = cnCache.keys().next().value;
    if (oldest !== undefined) cnCache.delete(oldest);
  }
  cnCache.set(joined, merged);
  return merged;
}

// Powrót ogniska po zamknięciu okna modalnego (Dialog, Sheet, AlertDialog).
//
// Radix po zamknięciu oddaje ognisko WYŁĄCZNIE swojemu `Trigger`. Większość
// okien w tym repozytorium jest sterowana propem `open` (przycisk w panelu,
// skrót klawiszowy, host globalnych okien) i żadnego `Trigger` nie ma - wtedy
// ognisko lądowało na <body>, a użytkownik klawiatury i czytnika ekranu wracał
// na początek strony (WCAG 2.4.3). Ten hook zapamiętuje element, który miał
// ognisko w chwili otwarcia, i oddaje mu je przy zamknięciu.
//
// Pierwszeństwo ma wywołujący: jego `onCloseAutoFocus` biegnie pierwszy i jeśli
// zrobi `preventDefault()`, hook niczego nie rusza. Nie są celem: element
// odpięty od DOM (np. pozycja menu, które się zamknęło) ani <body> - klik
// myszą w Safari nie ogniskuje przycisku, więc „otwierającym" bywa <body>,
// a wtedy właściwym celem jest `Trigger` Radiksa. W obu przypadkach zostaje
// domyślne zachowanie biblioteki.
//
// DLACZEGO TUTAJ, A NIE W OSOBNYM MODULE ANI W `dialog.tsx` (2026-10-03):
// - nowy moduł, choćby 0,6 KB, staje się małym chunkiem, który Rollup
//   (`experimentalMinChunkSize`) dokleja według rozmiarów innych chunków;
//   to przestawiało kolejne scalenia i do domknięcia startowego KAŻDEJ strony
//   wchodziły obce chunki (pomocnicy date-fns albo całe `vendor-lucide`,
//   +5 do +18 KB gz, zmierzone `check:bundle`). Ten plik jest już w chunku
//   wejściowym i importują go wszystkie trzy prymitywy, więc graf modułów
//   zostaje taki jak bez hooka, a jedyny przyrost ląduje w chunku, którego
//   rozmiar nie wpływa na decyzje scalania;
// - eksport z `dialog.tsx` wywracał 66 plików testowych, które zastępują
//   `@/components/ui/dialog` atrapą (`Sheet` i `AlertDialog` importowały hook
//   z atrapy); tego modułu nie atrapuje żaden test.

type FocusHandler = (event: Event) => void;

export function useReturnFocus(
  onOpenAutoFocus: FocusHandler | undefined,
  onCloseAutoFocus: FocusHandler | undefined,
): { onOpenAutoFocus: FocusHandler; onCloseAutoFocus: FocusHandler } {
  const openerRef = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      // Zdarzenie montowania przychodzi, zanim Radix przeniesie ognisko do okna.
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      const opener = openerRef.current;
      openerRef.current = null;
      if (event.defaultPrevented || !opener?.isConnected) return;
      event.preventDefault();
      opener.focus();
    },
  };
}

// Odroczony generator CSS bloku `<style>` korzenia - patrz nagłówek
// `lib/theme/styleSnapshot.ts` (po co i dlaczego skrót danych).
//
// KONTRAKT HYDRATACJI (reguła: SSR i pierwszy render klienta bajt w bajt):
//   * serwer ma generator synchronicznie (`serverGenerate`) i liczy CSS w
//     inicjalizatorze `useState`;
//   * przeglądarka dostaje `serverGenerate === null` (gałąź `.server()` jest
//     wycinana przez kompilator Start) i w inicjalizatorze CZYTA blok z DOM-u -
//     ten sam napis i ten sam skrót, które wyrenderował serwer;
//   * wszystko, co może się różnić, dzieje się w `useEffect`, czyli po
//     hydratacji: porównanie skrótów, `import()` generatora, `setState`.
//
// Bez bloku w DOM-ie (render bez SSR, np. test montujący komponent na czysto)
// pierwszy render emituje PUSTY blok, a efekt dociąga generator - w produkcji
// ten przypadek nie zachodzi, bo korzeń renderuje te bloki na każdym dokumencie.
//
// W testach jednostkowych kompilator Start nie działa, a runtime
// `createIsomorphicFn` zwraca gałąź serwerową - komponenty liczą więc CSS
// synchronicznie jak dotąd, a ścieżkę kliencką testy wybierają podmianą
// `createIsomorphicFn` (wzorzec: widget-view/__tests__/serverWidgetShell).
import { useEffect, useMemo, useState } from "react";
import { hashStyleInput, readStyleSnapshot, type StyleSnapshot } from "@/lib/theme/styleSnapshot";

export type StyleGenerator<TInput> = (input: TInput) => string;

export interface DeferredStyleOptions<TInput> {
  /** Atrybut znacznika bloku, np. `data-theme-design`. */
  marker: string;
  /**
   * Dane wejściowe generatora. Muszą mieć stabilną tożsamość między renderami
   * (dane zapytań albo `useMemo` nad nimi) - skrót liczymy przy zmianie.
   */
  input: TInput;
  /** Generator dostępny synchronicznie (serwer); `null` w przeglądarce. */
  serverGenerate: StyleGenerator<TInput> | null;
  /** Leniwy import generatora - jedyna droga do niego w przeglądarce. */
  loadGenerate: () => Promise<StyleGenerator<TInput>>;
}

export function useDeferredStyleCss<TInput>({
  marker,
  input,
  serverGenerate,
  loadGenerate,
}: DeferredStyleOptions<TInput>): StyleSnapshot {
  const hash = useMemo(() => hashStyleInput(input), [input]);
  const [snapshot, setSnapshot] = useState<StyleSnapshot>(() => {
    if (serverGenerate) return { css: serverGenerate(input), hash };
    return readStyleSnapshot(marker) ?? { css: "", hash: "" };
  });

  useEffect(() => {
    if (snapshot.hash === hash) return;
    if (serverGenerate) {
      setSnapshot({ css: serverGenerate(input), hash });
      return;
    }
    let cancelled = false;
    loadGenerate().then(
      (generate) => {
        if (!cancelled) setSnapshot({ css: generate(input), hash });
      },
      () => {
        // Chunk nie dojechał (sieć, stary deploy): zostaje CSS z SSR - lepszy
        // niż pusty blok; kolejna zmiana danych ponowi import.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hash, input, snapshot.hash, serverGenerate, loadGenerate]);

  return snapshot;
}

// Zastępca `mammoth/lib/promises.js` w bundlu przeglądarki: TE SAME eksporty i
// TE SAME zachowania co moduł mammoth, napisane wprost na natywnym `Promise`.
// Przekierowanie robi `scripts/lib/officeParserTrim.ts`; tam jest pełne
// uzasadnienie i bramka, która pilnuje założeń przy aktualizacji pakietu.
//
// DLACZEGO DALEJ, SKORO MAMMOTH 1.13.0 NIE MA JUŻ BLUEBIRDA. Do 1.12.3 ten moduł
// był przykrywką dla bluebirda (~21 KB gzip w chunku podglądu .docx). Od 1.13.0
// mammoth sam stoi na natywnych obietnicach, więc zastępca nie wycina już
// biblioteki - zostaje, bo:
//   1. pilnuje grafu: każdy plik mammoth wołający `promises` ma parę
//      przekierowania, a test porównuje eksporty z oryginałem, więc aktualizacja
//      pakietu, która sięgnie po nową funkcję, zapali test zamiast milczeć;
//   2. zdejmuje z bundla przeglądarki ścieżki, których w niej nie ma:
//      wykrywanie Node i `process.stderr`/`process.exit` z metody `done`;
//   3. daje parytet mierzalny testami (niżej) zamiast zaufania do znajomości
//      cudzego kodu.
//
// KOMPLET EKSPORTÓW (jak `exports.*` w `mammoth/lib/promises.js` 1.13.0):
// `defer`, `Promise`, `resolve`, `reject`, `forEachSeries`, `props`, `try`,
// `toExternalPromise`.
//
// TA SAMA SEMANTYKA, nie podobna:
// - `resolve`/`reject`/`Promise` to natywny `Promise` - `resolve` na obietnicy
//   oddaje TĘ SAMĄ obietnicę, na thenable oddaje nową, a na wartości
//   obietnicę resolved;
// - `props` czeka na WSZYSTKIE wartości i składa NOWY obiekt w kolejności
//   kluczy (`Object.keys` = własne, wyliczalne);
// - `also` (tylko na łańcuchu `props`) dokłada pola zwrócone przez `func`,
//   kopiuje je jak `_.extend` z underscore (własne i dziedziczone wyliczalne,
//   pętlą `for...in`) i czeka na ich wartości - czyli robi to samo co oryginał;
// - `forEachSeries` idzie PO KOLEI: nie woła następnego elementu, dopóki
//   iterator nie skończy, a pierwszy błąd przerywa serię i odrzuca wynik;
// - `try` woła funkcję synchronicznie, a rzucony wyjątek zamienia w odrzucenie;
// - `toExternalPromise` oddaje NOWĄ obietnicę z metodą `done`, tak jak
//   `ExternalPromise.resolve` w oryginale (stara obietnica NIE dostaje `done`).
//
// ZNANA RÓŻNICA: `done` przy nieobsłużonym odrzuceniu. Oryginał w Node pisze
// „Fatal …" na `process.stderr` i kończy proces `process.exit(2)`, a w
// przeglądarce rzuca asynchronicznie. Ten moduł trafia WYŁĄCZNIE do bundla
// przeglądarki (wtyczka działa tylko w `vite build` i tylko dla środowiska
// `client`), więc zostaje ścieżka przeglądarkowa: `setTimeout(() => { throw … })`.
// Serwer, proces arkuszy i dev dostają oryginał mammoth.
//
// i18n: brak treści dla użytkownika - kod biblioteki.

/** `_.extend` z underscore: klucze własne i dziedziczone (`for...in`). */
function extendIn(
  target: Record<string, unknown>,
  ...sources: unknown[]
): Record<string, unknown> {
  for (const source of sources) {
    if (source !== null && (typeof source === "object" || typeof source === "function")) {
      for (const key in source) target[key] = (source as Record<string, unknown>)[key];
    }
  }
  return target;
}

/**
 * Obietnica z metodą `also` - dokładanie pól do wyniku `props`, tak jak
 * `addAlsoToPromise` w oryginale. Dostają ją WYŁĄCZNIE obietnice z łańcucha
 * `props`/`also`; `resolve`, `reject`, `try`, `defer` i `forEachSeries` oddają
 * natywny `Promise` bez tej metody.
 */
export class PropsPromise<T> extends Promise<T> {
  also(func: (value: T) => Record<string, unknown>): PropsPromise<Record<string, unknown>> {
    return this.then((value) => props(extendIn({}, value, func(value)))) as PropsPromise<
      Record<string, unknown>
    >;
  }
}

/**
 * Obietnica zwracana przez `toExternalPromise` - czyli to, co mammoth oddaje
 * fuori (`convertToHtml`, `extractRawText`, `readEmbeddedStyleMap`,
 * `embedStyleMap`). `done` jest tu dla zgodności z dokumentacją sprzed 1.13.0;
 * nieobsłużone odrzucenie rzuca asynchronicznie (patrz „ZNANA RÓŻNICA" wyżej).
 */
export class ExternalPromise<T> extends Promise<T> {
  done(
    onFulfilled?: (value: T) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ): Promise<unknown> {
    return this.then(onFulfilled, onRejected).catch((error: unknown) => {
      setTimeout(() => {
        throw error;
      }, 0);
    });
  }
}

/** `exports.Promise` - natywna funkcja `Promise` (test porównuje ją z globalną). */
export const PromiseConstructor = globalThis.Promise;
export { PromiseConstructor as Promise };

/** `exports.resolve` - natywny `Promise.resolve`. */
export function resolve<T>(value: T | PromiseLike<T>): Promise<T> {
  return Promise.resolve(value);
}

/** `exports.reject` - natywny `Promise.reject`. */
export function reject(error: unknown): Promise<never> {
  return Promise.reject(error);
}

/** `exports.defer` - uchwyt `resolve`/`reject` na obietnicę. */
export function defer<T>() {
  let resolveFn!: (value: T | PromiseLike<T>) => void;
  let rejectFn!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolveFn = ok;
    rejectFn = fail;
  });
  return { resolve: resolveFn, reject: rejectFn, promise };
}

/**
 * `exports.props` - czeka na wartości WSZYSTKICH pól i składa NOWY obiekt
 * w kolejności `Object.keys`. Oryginał opiera się na tym, że `keys()` i
 * `values()` zwracają właściwości w tej samej kolejności.
 */
export function props(source: Record<string, unknown>): PropsPromise<Record<string, unknown>> {
  return new PropsPromise((resolveFn, rejectFn) => {
    const keys = Object.keys(source);
    Promise.all(Object.values(source)).then(
      (values) => {
        const result: Record<string, unknown> = {};
        keys.forEach((key, index) => {
          result[key] = values[index];
        });
        resolveFn(result);
      },
      (error: unknown) => {
        rejectFn(error);
      },
    );
  });
}

/**
 * `exports.forEachSeries` - seria po kolei: iterator następnego elementu nie
 * startuje, dopóki poprzedni nie skończy. Pierwsze odrzucenie przerywa serię
 * i odrzuca wynik; synchroniczne rzucenie w iteratorze zachowuje się jak
 * w oryginale (wychodzi z `forEachSeries`).
 */
export function forEachSeries<T>(
  items: readonly T[],
  func: (item: T) => PromiseLike<unknown>,
): Promise<void> {
  let arrayIndex = 0;
  const deferred = defer<void>();

  const next = (): void => {
    if (arrayIndex < items.length) {
      const element = items[arrayIndex];
      arrayIndex++;
      func(element).then(next, deferred.reject);
    } else {
      deferred.resolve();
    }
  };

  next();

  return deferred.promise;
}

/** `exports.try` - woła funkcję synchronicznie, wyjątek zamienia w odrzucenie. */
export function tryFunction<T>(func: () => T | PromiseLike<T>): Promise<T> {
  try {
    return Promise.resolve(func());
  } catch (error) {
    return Promise.reject(error);
  }
}
export { tryFunction as try };

/**
 * `exports.toExternalPromise` - NOWA obietnica z metodą `done`; oryginał robi to
 * samo (`ExternalPromise.resolve`), więc starej obietnicy `done` nie przybywa.
 */
export function toExternalPromise<T>(promise: T | PromiseLike<T>): ExternalPromise<T> {
  return new ExternalPromise<T>((ok, fail) => {
    resolve(promise).then(ok, fail);
  });
}

// Zastępca `mammoth/lib/promises.js` w bundlu przeglądarki: ten sam zestaw
// funkcji na natywnym `Promise` zamiast bluebirda. Przekierowanie robi
// `scripts/lib/officeParserTrim.ts`; tam jest pełne uzasadnienie i bramka,
// która pilnuje założeń przy aktualizacji pakietu.
//
// DLACZEGO. `promises.js` bierze z bluebirda (38 modułów, ~21 KB gzip w chunku
// podglądu .docx) tylko kilka funkcji: `resolve`/`when`, `reject`, `all`,
// `props`, `mapSeries`, `attempt`, `promisify`, oraz metody łańcucha `caught`,
// `tap` i dopisane przez mammoth `fail`/`also`. Reszta bluebirda (anulowanie,
// `using`, generatory, długie ślady stosu, `timeout`...) nie wykonuje się nigdy.
//
// TA SAMA SEMANTYKA, nie podobna:
// - `MammothPromise` dziedziczy po `Promise`, więc `then` zwraca znowu
//   `MammothPromise` (species) i `.caught`/`.tap`/`.also` działają w dalszej
//   części łańcucha, jak w bluebirdzie;
// - `resolve(p)` oddaje `p` bez opakowania, gdy to już nasza obietnica;
// - `props` bierze `Object.keys` (własne, wyliczalne) i składa NOWY obiekt;
// - `mapSeries` czeka na element i na wynik iteratora po kolei, a iterator
//   dostaje `(wartość, indeks, długość)`;
// - `attempt` woła funkcję synchronicznie, a rzucony wyjątek zamienia
//   w odrzucenie;
// - `also` kopiuje klucze jak `_.extend` z underscore (własne i dziedziczone
//   wyliczalne, pętlą `for...in`).
// Wszystkie eksporty to zwykłe funkcje modułu, nie metody statyczne zależne
// od `this` - `promises.js` też eksportuje je odpięte od bluebirda.
//
// i18n: brak treści dla użytkownika - kod biblioteki.

type Callback = (error: unknown, value?: unknown) => void;
type NodeStyle = (...args: [...unknown[], Callback]) => void;

/** `_.extend` z underscore: klucze własne i dziedziczone (`for...in`). */
function extendIn(target: Record<string, unknown>, ...sources: unknown[]): Record<string, unknown> {
  for (const source of sources) {
    if (source !== null && (typeof source === "object" || typeof source === "function")) {
      for (const key in source) target[key] = (source as Record<string, unknown>)[key];
    }
  }
  return target;
}

export class MammothPromise<T> extends Promise<T> {
  caught<R = never>(onRejected: (reason: unknown) => R | PromiseLike<R>): MammothPromise<T | R> {
    return this.then(undefined, onRejected) as MammothPromise<T | R>;
  }

  /** Jak `caught` - alias dopisywany przez `mammoth/lib/promises.js`. */
  fail<R = never>(onRejected: (reason: unknown) => R | PromiseLike<R>): MammothPromise<T | R> {
    return this.caught(onRejected);
  }

  /** Wywołuje `handler` dla efektu ubocznego i przepuszcza oryginalną wartość. */
  tap(handler: (value: T) => unknown): MammothPromise<T> {
    return this.then((value) => resolve(handler(value)).then(() => value)) as MammothPromise<T>;
  }

  /** Dokłada do wyniku pola zwrócone przez `func` i czeka na ich wartości. */
  also(func: (value: T) => object): MammothPromise<Record<string, unknown>> {
    return this.then((value) => props(extendIn({}, value, func(value)))) as MammothPromise<
      Record<string, unknown>
    >;
  }
}

export function resolve<T>(value?: T | PromiseLike<T>): MammothPromise<T> {
  return value instanceof MammothPromise
    ? (value as MammothPromise<T>)
    : new MammothPromise<T>((ok) => ok(value as T | PromiseLike<T>));
}

export const when = resolve;

export function reject(error: unknown): MammothPromise<never> {
  return new MammothPromise<never>((_ok, fail) => fail(error));
}

export function all<T>(values: Iterable<T | PromiseLike<T>> | PromiseLike<Iterable<T>>) {
  return resolve(values).then((list) => MammothPromise.all(list as Iterable<T>));
}

export function props(object: unknown): MammothPromise<Record<string, unknown>> {
  return resolve(object).then((source) => {
    const record = source as Record<string, unknown>;
    const keys = Object.keys(record);
    return MammothPromise.all(keys.map((key) => record[key])).then((values) => {
      const out: Record<string, unknown> = {};
      keys.forEach((key, index) => {
        out[key] = values[index];
      });
      return out;
    });
  }) as MammothPromise<Record<string, unknown>>;
}

export function mapSeries<T, R>(
  values: readonly (T | PromiseLike<T>)[] | PromiseLike<readonly (T | PromiseLike<T>)[]>,
  iterator: (value: T, index: number, length: number) => R | PromiseLike<R>,
): MammothPromise<R[]> {
  return resolve(values).then((list) => {
    const results: R[] = [];
    let chain: PromiseLike<unknown> = resolve();
    list.forEach((item, index) => {
      chain = chain
        .then(() => item)
        .then((value) => iterator(value, index, list.length))
        .then((mapped) => {
          results.push(mapped);
        });
    });
    return chain.then(() => results);
  }) as MammothPromise<R[]>;
}

export function attempt<T>(func: () => T | PromiseLike<T>): MammothPromise<T> {
  return new MammothPromise<T>((ok) => ok(func()));
}

export function promisify(func: NodeStyle) {
  return function (this: unknown, ...args: unknown[]): MammothPromise<unknown> {
    return new MammothPromise((ok, fail) =>
      func.call(this, ...args, (error: unknown, value?: unknown) =>
        error ? fail(error) : ok(value),
      ),
    );
  };
}

export function nfcall(func: NodeStyle, ...args: unknown[]): MammothPromise<unknown> {
  return promisify(func)(...args);
}

export function defer<T>() {
  let resolveFn!: (value: T | PromiseLike<T>) => void;
  let rejectFn!: (reason?: unknown) => void;
  const promise = new MammothPromise<T>((ok, fail) => {
    resolveFn = ok;
    rejectFn = fail;
  });
  return { resolve: resolveFn, reject: rejectFn, promise };
}

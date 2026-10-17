// Zastępca `underscore` dla plików mammoth i lop (parser map stylów) w bundlu
// przeglądarki. Przekierowanie robi `scripts/lib/officeParserTrim.ts`; tam jest
// pełne uzasadnienie i bramka, która pilnuje założeń przy aktualizacji pakietu.
//
// DLACZEGO. underscore 1.13 to jeden moduł UMD (~74 kB źródła, ~7,5 KB gzip
// w chunku podglądu .docx) - bundler nie wytnie z niego nieużywanych funkcji.
// mammoth i lop wołają 20 z nich, zawsze jako `_.nazwa(kolekcja, funkcja)`
// albo `_.nazwa(kolekcja, "pole")` (test czyta źródła obu pakietów i pada przy
// nowej nazwie albo nowym pliku).
//
// TA SAMA SEMANTYKA, nie podobna - każda funkcja to port 1.13.8 dla argumentów,
// jakie dostaje z mammoth/lop (test porównuje wyniki z prawdziwym underscore):
// - kolekcja „tablicopodobna" (`length` liczbowe 0..2^53-1: tablica, NodeList,
//   NamedNodeMap, napis) idzie po indeksach z długością odczytaną RAZ; każda
//   inna po `Object.keys` (własne, wyliczalne); prymityw bez `length` to
//   kolekcja pusta;
// - iterator to funkcja wołana z `(wartość, klucz/indeks, kolekcja)`, napis
//   albo tablica-ścieżka (`_.property`), albo brak (tożsamość); obiekt-wzorzec
//   (`_.matcher`) i argument `context` nie występują w mammoth/lop, więc ich
//   nie ma - wzorzec rzuca, zamiast po cichu dopasować inaczej;
// - `extend`/`clone` kopiują klucze własne I dziedziczone (`for...in`), nie
//   `Object.assign`;
// - `flatten(x, true)` spłaszcza jeden poziom, bez drugiego argumentu -
//   wszystkie; `arguments` liczy się jak tablica;
// - `isEqual` to iteracyjne porównanie głębokie underscore (klasa
//   `[[Class]]`, opakowania prymitywów, `NaN`, `0`/`-0`, konstruktory, cykle).
//   mammoth porównuje nim wyłącznie obiekty atrybutów HTML (napisy), więc
//   gałęzie binarne (ArrayBuffer, DataView, tablice typowane) rzucają zamiast
//   istnieć.
//
// i18n: brak treści dla użytkownika - kod biblioteki.

type Collection = { readonly [key: string]: unknown } | ArrayLike<unknown> | null | undefined;
type Iteratee = ((value: never, key: never, collection: never) => unknown) | string | number;
type Callback = (value: unknown, key: string | number, collection: unknown) => unknown;
type AnyRecord = Record<PropertyKey, unknown>;

const MAX_ARRAY_INDEX = 2 ** 53 - 1;
const tag = (value: unknown): string => Object.prototype.toString.call(value);

function isObject(value: unknown): value is AnyRecord {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}

/** `length` przez `_.property`: brak dla `null`/`undefined`. */
function lengthOf(value: unknown): unknown {
  return value == null ? undefined : (value as { length?: unknown }).length;
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  const length = lengthOf(value);
  return typeof length === "number" && length >= 0 && length <= MAX_ARRAY_INDEX;
}

function keysOf(value: unknown): string[] {
  return isObject(value) ? Object.keys(value) : [];
}

/** `_.property` dla napisu, liczby albo ścieżki (tablicy kluczy). */
function property(path: string | number | readonly (string | number)[]) {
  const steps = Array.isArray(path) ? path : [path];
  return (value: unknown): unknown => {
    let current = value;
    for (const step of steps) {
      if (current == null) return undefined;
      current = (current as AnyRecord)[step as PropertyKey];
    }
    return steps.length ? current : undefined;
  };
}

/** `cb` underscore bez `context` i bez obiektu-wzorca. */
function callback(iteratee: Iteratee | null | undefined): Callback {
  if (iteratee == null) return (value) => value;
  if (typeof iteratee === "function") return iteratee as unknown as Callback;
  if (isObject(iteratee) && !Array.isArray(iteratee)) {
    throw new Error("mammothUnderscore: iterator-wzorzec (_.matcher) nie jest obsługiwany");
  }
  const get = property(iteratee);
  return (value) => get(value);
}

/** Wspólna pętla: indeksy kolekcji tablicopodobnej albo `Object.keys`. */
function entries(collection: unknown): { keys: readonly string[] | null; length: number } {
  if (isArrayLike(collection)) return { keys: null, length: collection.length };
  const keys = keysOf(collection);
  return { keys, length: keys.length };
}

export function extend<T>(target: T, ...sources: unknown[]): T {
  if (target == null) return target;
  for (const source of sources) {
    if (!isObject(source)) continue;
    // Najpierw lista kluczy (`_.allKeys`), potem kopiowanie - jak underscore.
    const keys: string[] = [];
    for (const key in source) keys.push(key);
    for (const key of keys) (target as AnyRecord)[key] = source[key];
  }
  return target;
}

export function clone<T>(value: T): T {
  if (!isObject(value)) return value;
  return (Array.isArray(value) ? value.slice() : extend({}, value)) as T;
}

export function forEach<C extends Collection>(collection: C, iteratee: Callback): C {
  const { keys, length } = entries(collection);
  const source = collection as unknown as AnyRecord;
  for (let i = 0; i < length; i++) {
    const key = keys ? keys[i] : i;
    iteratee(source[key], key, collection);
  }
  return collection;
}

export const each = forEach;

export function map(collection: Collection, iteratee?: Iteratee | null): unknown[] {
  const fn = callback(iteratee);
  const { keys, length } = entries(collection);
  const source = collection as unknown as AnyRecord;
  const results = new Array<unknown>(length);
  for (let i = 0; i < length; i++) {
    const key = keys ? keys[i] : i;
    results[i] = fn(source[key], key, collection);
  }
  return results;
}

export function some(collection: Collection, predicate?: Iteratee | null): boolean {
  const fn = callback(predicate);
  const { keys, length } = entries(collection);
  const source = collection as unknown as AnyRecord;
  for (let i = 0; i < length; i++) {
    const key = keys ? keys[i] : i;
    if (fn(source[key], key, collection)) return true;
  }
  return false;
}

export const any = some;

export function filter(collection: Collection, predicate?: Iteratee | null): unknown[] {
  const fn = callback(predicate);
  const results: unknown[] = [];
  forEach(collection, (value, key, list) => {
    if (fn(value, key, list)) results.push(value);
  });
  return results;
}

export function findIndex(array: Collection, predicate?: Iteratee | null): number {
  const fn = callback(predicate);
  const length = lengthOf(array) as number;
  const source = array as unknown as AnyRecord;
  for (let index = 0; index >= 0 && index < length; index++) {
    if (fn(source[index], index, array)) return index;
  }
  return -1;
}

export function find(collection: Collection, predicate?: Iteratee | null): unknown {
  const source = collection as unknown as AnyRecord;
  if (isArrayLike(collection)) {
    const index = findIndex(collection, predicate);
    return index !== -1 ? source[index] : undefined;
  }
  const fn = callback(predicate);
  for (const key of keysOf(collection)) {
    if (fn(source[key], key, collection)) return source[key];
  }
  return undefined;
}

export function foldl(
  collection: Collection,
  iteratee: (memo: never, value: never, key: never, collection: never) => unknown,
  ...memo: [unknown?]
): unknown {
  const fn = iteratee as unknown as (
    memo: unknown,
    value: unknown,
    key: string | number,
    collection: unknown,
  ) => unknown;
  const { keys, length } = entries(collection);
  const source = collection as unknown as AnyRecord;
  let index = 0;
  let accumulator = memo[0];
  if (memo.length === 0) {
    accumulator = source[keys ? keys[index] : index];
    index++;
  }
  for (; index < length; index++) {
    const key = keys ? keys[index] : index;
    accumulator = fn(accumulator, source[key], key, collection);
  }
  return accumulator;
}

export const reduce = foldl;

export function pluck(collection: Collection, key: string | number): unknown[] {
  return map(collection, key);
}

export function indexBy(collection: Collection, iteratee?: Iteratee | null): AnyRecord {
  const fn = callback(iteratee);
  const result: AnyRecord = {};
  forEach(collection, (value, index) => {
    result[fn(value, index, collection) as PropertyKey] = value;
  });
  return result;
}

export function values(collection: unknown): unknown[] {
  const source = collection as AnyRecord;
  return keysOf(collection).map((key) => source[key]);
}

export function invert(collection: unknown): Record<string, string> {
  const source = collection as AnyRecord;
  const result: Record<string, string> = {};
  for (const key of keysOf(collection)) result[source[key] as string] = key;
  return result;
}

export function last<T>(array: ArrayLike<T> | null | undefined): T | undefined {
  return array == null || array.length < 1 ? undefined : array[array.length - 1];
}

const isArguments = (value: unknown): boolean => tag(value) === "[object Arguments]";

export function flatten(input: Collection, depth?: number | boolean): unknown[] {
  const limit = !depth && depth !== 0 ? Infinity : Number(depth);
  const output: unknown[] = [];
  const stack: { i: number; v: AnyRecord }[] = [];
  let list = input as unknown as AnyRecord;
  let length = (lengthOf(list) as number) || 0;
  let i = 0;
  for (;;) {
    if (i >= length) {
      const frame = stack.pop();
      if (frame === undefined) break;
      i = frame.i;
      list = frame.v;
      length = lengthOf(list) as number;
      continue;
    }
    const value = list[i++];
    if (stack.length >= limit) {
      output.push(value);
    } else if (isArrayLike(value) && (Array.isArray(value) || isArguments(value))) {
      stack.push({ i, v: list });
      i = 0;
      list = value as unknown as AnyRecord;
      length = lengthOf(list) as number;
    } else {
      output.push(value);
    }
  }
  return output;
}

export const isArray = Array.isArray;

export function isString(value: unknown): value is string {
  return tag(value) === "[object String]";
}

export function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

const BINARY = /^\[object (ArrayBuffer|DataView|\w+Array)\]$/;

export function isEqual(left: unknown, right: unknown): boolean {
  type Frame = { a: unknown; b: unknown } | true;
  const todo: Frame[] = [{ a: left, b: right }];
  const aStack: unknown[] = [];
  const bStack: unknown[] = [];
  while (todo.length) {
    const frame = todo.pop() as Frame;
    if (frame === true) {
      aStack.pop();
      bStack.pop();
      continue;
    }
    const { a, b } = frame;
    if (a === b) {
      if (a !== 0 || 1 / a === 1 / (b as number)) continue;
      return false;
    }
    if (a == null || b == null) return false;
    if (a !== a) {
      if (b !== b) continue;
      return false;
    }
    if (typeof a !== "function" && typeof a !== "object" && typeof b !== "object") return false;
    const className = tag(a);
    if (className !== tag(b)) return false;
    switch (className) {
      case "[object RegExp]":
      case "[object String]":
        if (String(a) === String(b)) continue;
        return false;
      case "[object Number]":
        todo.push({ a: Number(a), b: Number(b) });
        continue;
      case "[object Date]":
      case "[object Boolean]":
        if (Number(a) === Number(b)) continue;
        return false;
      case "[object Symbol]":
        if (Symbol.prototype.valueOf.call(a) === Symbol.prototype.valueOf.call(b)) continue;
        return false;
    }
    if (BINARY.test(className) && className !== "[object Array]") {
      throw new Error(`mammothUnderscore: isEqual nie porównuje danych binarnych (${className})`);
    }
    const areArrays = className === "[object Array]";
    if (!areArrays) {
      if (typeof a !== "object" || typeof b !== "object") return false;
      const aCtor = (a as AnyRecord).constructor;
      const bCtor = (b as AnyRecord).constructor;
      if (
        aCtor !== bCtor &&
        !(
          typeof aCtor === "function" &&
          aCtor instanceof aCtor &&
          typeof bCtor === "function" &&
          bCtor instanceof bCtor
        ) &&
        "constructor" in a &&
        "constructor" in b
      ) {
        return false;
      }
    }
    let length = aStack.length;
    while (length--) {
      if (aStack[length] === a) {
        if (bStack[length] === b) break;
        return false;
      }
    }
    if (length >= 0) continue;
    aStack.push(a);
    bStack.push(b);
    todo.push(true);
    if (areArrays) {
      const aList = a as unknown[];
      const bList = b as unknown[];
      length = aList.length;
      if (length !== bList.length) return false;
      while (length--) todo.push({ a: aList[length], b: bList[length] });
    } else {
      const keys = Object.keys(a);
      length = keys.length;
      if (Object.keys(b).length !== length) return false;
      while (length--) {
        const key = keys[length];
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        todo.push({ a: (a as AnyRecord)[key], b: (b as AnyRecord)[key] });
      }
    }
  }
  return true;
}

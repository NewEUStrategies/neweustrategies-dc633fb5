// Atrapy warstwy REACTOWEJ - wspólne dla wszystkich powierzchni testowych.
//
// Mieszkały w `src/test/profile/fixtures.ts`, bo profil pierwszy potrzebował
// ich w tym kształcie (PR #252). Nie ma w nich jednak niczego profilowego:
// to echo klucza i18n, atrapa `useTranslation`, kształt wyniku `useQuery`
// i natywny `<select>` w miejsce Radixowego. Monetyzacja potrzebuje ich
// DOKŁADNIE tak samo - `SubscriptionCard` i `ChangePlanCard` wybierają plan
// docelowy przez Radix Select, a każda karta rozliczeniowa czyta `useQuery`.
//
// Zostały więc dwa wyjścia: skopiować je do piątego pliku fixture'ów albo
// zaimportować w rozliczeniach z katalogu `test/profile`. Pierwsze daje kolejną
// atrapę rozjeżdżającą się przy następnej zmianie kontraktu, drugie -
// zależność, która nic nie znaczy. Dlatego atrapy stoją tu, a
// `test/profile/fixtures.ts` re-eksportuje je dalej: żaden istniejący test
// profilu nie zmienia importu.
//
// UWAGA na `test/chat/fixtures.ts` i `test/network/fixtures.ts`: mają WŁASNE,
// starsze kopie `translateKey`/`reactI18nextStub` (bez filtra `defaultValue`)
// i świadomie ich tu nie scalamy - to 42 zielone pliki testowe poza modułem
// monetyzacji, a scalenie zmieniłoby wartość zwracaną przez ich `t()`.
// Scalenie należy zrobić osobną pracą, z przejściem po ich asercjach.
import { vi, type Mock } from "vitest";

// --- i18n -------------------------------------------------------------------

/**
 * Echo klucza i18n: `t("a.b")` -> `"a.b"`, a z opcjami -> `a.b {"count":3}`.
 * Testy asertują KLUCZ, nie polski tekst, więc zmiana copy nie psuje testów,
 * a rozjazd klucza owszem (za parytet PL/EN odpowiadają bramki słownikowe).
 */
export function translateKey(key: string, options?: Record<string, unknown>): string {
  if (options === undefined) return key;
  const entries = Object.entries(options).filter(([k]) => k !== "defaultValue");
  return entries.length === 0 ? key : `${key} ${JSON.stringify(Object.fromEntries(entries))}`;
}

/** Ten sam stub `react-i18next` dla wszystkich powierzchni testowych. */
export function reactI18nextStub(getLanguage: () => string = () => "pl"): {
  useTranslation: () => {
    t: typeof translateKey;
    i18n: { language: string; t: typeof translateKey };
  };
  initReactI18next: { type: string; init: () => void };
  Trans: (props: { children?: unknown }) => unknown;
} {
  // `i18n` jest JEDNYM STABILNYM obiektem (getter na `language`, nie nowy
  // literał na każde wywołanie) - dokładnie jak realna instancja i18next.
  // Kod produkcyjny (np. `AuthorProfileEditor`) opiera się na tej stabilności
  // wprost: woła `i18n.t(...)` zamiast `t` z `useTranslation()` i wpina `i18n`
  // do tablicy zależności efektu ładującego, żeby przełączenie języka NIE
  // przeładowywało formularza w trakcie edycji. Nowy obiekt `i18n` przy każdym
  // renderze zmieniałby tę tablicę na każdy render - efekt odpalałby w kółko
  // i formularz nigdy nie ustabilizowałby stanu (`exists`, wczytane pola).
  const i18n = {
    get language() {
      return getLanguage();
    },
    t: translateKey,
  };
  return {
    useTranslation: () => ({ t: translateKey, i18n }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
}

// --- atrapy hooków ----------------------------------------------------------

/** Kształt, jakiego molekuły oczekują od `useQuery`. */
export interface QueryStub<T> {
  data: T | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  refetch: Mock;
}

export function queryStub<T>(data: T, overrides: Partial<QueryStub<T>> = {}): QueryStub<T> {
  return {
    data,
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

export function pendingQueryStub<T>(): QueryStub<T> {
  return {
    data: undefined,
    isLoading: true,
    isSuccess: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

// --- atrapa Radix Select ----------------------------------------------------

/**
 * Natywny `<select>` w miejsce Radixowego. Radix nie otwiera listy w happy-dom
 * (potrzebuje realnego wskaźnika i pomiarów układu), więc test nie miałby jak
 * wybrać opcji - a wybór opcji jest tu całą treścią zachowania: KTÓRE pole
 * dostaje nową wartość.
 *
 * Atrapa jest wierna w tym, na czym stoją asercje: `SelectItem` staje się
 * `<option>` (więc widać PEŁNĄ listę dostępnych opcji), a `aria-label`/`id`
 * z `SelectTrigger` ląduje na `<select>` (więc pole da się znaleźć etykietą,
 * dokładnie jak w produkcji). Nie odwzorowuje warstwy rozwijanej, bo żadna
 * asercja jej nie dotyczy.
 *
 * Bez JSX (jak cały ten moduł) - wołane z wnętrza fabryki `vi.mock`.
 */
export function radixSelectStub(react: typeof import("react")): Record<string, unknown> {
  interface TriggerProps {
    "aria-label"?: string;
    id?: string;
  }
  const isTrigger = (node: { props?: TriggerProps }): boolean =>
    !!node.props && ("aria-label" in node.props || "id" in node.props);

  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string;
      onValueChange?: (next: string) => void;
      disabled?: boolean;
      children?: unknown;
    }) => {
      const parts = react.Children.toArray(children as never) as Array<{ props?: TriggerProps }>;
      const trigger = parts.find(isTrigger);
      const content = parts.filter((part) => part !== trigger);
      return react.createElement(
        "select",
        {
          "aria-label": trigger?.props?.["aria-label"],
          id: trigger?.props?.id,
          value,
          disabled,
          onChange: (event: { target: { value: string } }) => onValueChange?.(event.target.value),
        },
        content as never,
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: unknown }) =>
      react.createElement(react.Fragment, null, children as never),
    SelectItem: ({ value, children }: { value: string; children?: unknown }) =>
      react.createElement("option", { value }, children as never),
  };
}

// --- atrapa Radix Switch ----------------------------------------------------

/**
 * Natywny `<input type="checkbox" role="switch">` w miejsce Radixowego.
 * Radix Switch nie przełącza się pod happy-dom od samego `fireEvent.click`
 * (potrzebuje zdarzeń wskaźnika), więc test nie miałby jak wejść w tryb
 * zależny od przełącznika - a od tego zależą całe sekcje formularzy
 * rozliczeniowych i paneli redakcyjnych (pole NIP pojawia się dopiero
 * w trybie firmy).
 *
 * Atrapa jest wierna w tym, na czym stoją asercje: zachowuje `id`
 * (więc `<Label htmlFor>` dalej wiąże etykietę), rolę `switch`,
 * `aria-checked` i wywołanie `onCheckedChange` z nową wartością.
 *
 * Bez JSX (jak cały ten moduł) - wołane z wnętrza fabryki `vi.mock`.
 */
export function radixSwitchStub(react: typeof import("react")): Record<string, unknown> {
  return {
    Switch: ({
      checked,
      onCheckedChange,
      disabled,
      id,
      ...rest
    }: {
      checked?: boolean;
      onCheckedChange?: (next: boolean) => void;
      disabled?: boolean;
      id?: string;
      [key: string]: unknown;
    }) =>
      react.createElement("input", {
        ...rest,
        type: "checkbox",
        role: "switch",
        id,
        checked: !!checked,
        disabled,
        "aria-checked": checked ? "true" : "false",
        onChange: (event: { target: { checked: boolean } }) =>
          onCheckedChange?.(event.target.checked),
      }),
  };
}

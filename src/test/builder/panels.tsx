// Wspólne narzędzia testów PANELI WŁAŚCIWOŚCI buildera (sekcja, kolumna,
// widget). Trzy rzeczy powtarzają się w każdym z tych testów i tylko dlatego
// stoją tutaj, a nie w plikach testowych:
//
//  1. Kontrolki wyboru w panelach to Radixowy `<Select>` BEZ etykiety - nazwę
//     dla czytnika ekranu daje im dopiero `Row`/`PropField` obok. Po podmianie
//     Radiksa na natywny `<select>` (patrz `radixSelectStub` w
//     `src/test/reactStubs.ts`) taką listę można rozpoznać wyłącznie po
//     ZBIORZE OPCJI - stąd `selectWithOption`.
//  2. Panele nie przyjmują nowej wartości, a MUTACJĘ obiektu stylu
//     (`onChange: (mut) => void`). Test, który tylko podgląda wywołania, nie
//     zobaczy więc wyniku - a wynik jest tu całą treścią zachowania (np. czy
//     zapis jednej strony odstępu zachował pozostałe). `MutableHost` trzyma
//     stan tak, jak robi to kanwa: świeży, płaski klon i mutacja na nim.
//  3. Panele dopisują wartości per breakpoint - `deviceValue` skraca odczyt.
import { useState, type ReactElement } from "react";

/**
 * Lista wyboru rozpoznana po tym, że MA opcję o danej wartości. Panele mają na
 * jednym ekranie po kilka list (typ ramki, tryb mieszania, wyrównanie), więc
 * indeks byłby kruchy - zbiór opcji jest stabilny i czytelny w asercji.
 */
export function selectWithOption(value: string): HTMLSelectElement {
  const found = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((select) =>
    select.querySelector(`option[value="${value}"]`),
  );
  if (!found) throw new Error(`test: brak listy z opcją "${value}"`);
  return found;
}

/** Wszystkie wartości opcji listy - do asercji na PEŁNEJ ofercie wyboru. */
export function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.querySelectorAll("option")).map((o) => o.value);
}

/**
 * Natywne zakładki w miejsce Radixowych.
 *
 * Radix `Tabs` NIE przełącza się od samego `fireEvent.click` w happy-dom
 * (potrzebuje zdarzeń wskaźnika i pomiarów), a panel właściwości widgetu ma
 * całą treść rozłożoną na trzech zakładkach - bez przełączania dwie trzecie
 * panelu nie istnieje w DOM. Atrapa jest wierna w tym, na czym stoją asercje:
 * `TabsTrigger` ma rolę `tab` i `data-state`, a `TabsContent` montuje treść
 * WYŁĄCZNIE dla aktywnej zakładki (tak jak Radix) - więc test dalej wykrywa
 * przypadkowe renderowanie wszystkich zakładek naraz.
 *
 * Bez JSX - wołane z wnętrza fabryki `vi.mock`.
 */
export function radixTabsStub(react: typeof import("react")): Record<string, unknown> {
  const Ctx = react.createContext<{ value: string; setValue: (v: string) => void }>({
    value: "",
    setValue: () => {},
  });
  return {
    Tabs: ({
      value,
      defaultValue,
      onValueChange,
      children,
    }: {
      value?: string;
      defaultValue?: string;
      onValueChange?: (v: string) => void;
      children?: unknown;
    }) => {
      const [local, setLocal] = react.useState(value ?? defaultValue ?? "");
      const current = value ?? local;
      const setValue = (next: string): void => {
        setLocal(next);
        onValueChange?.(next);
      };
      return react.createElement(
        Ctx.Provider,
        { value: { value: current, setValue } },
        children as never,
      );
    },
    TabsList: ({ children }: { children?: unknown }) =>
      react.createElement("div", { role: "tablist" }, children as never),
    TabsTrigger: ({ value, children }: { value: string; children?: unknown }) => {
      const ctx = react.useContext(Ctx);
      return react.createElement(
        "button",
        {
          type: "button",
          role: "tab",
          "data-state": ctx.value === value ? "active" : "inactive",
          "aria-selected": ctx.value === value,
          onClick: () => ctx.setValue(value),
        },
        children as never,
      );
    },
    TabsContent: ({ value, children }: { value: string; children?: unknown }) => {
      const ctx = react.useContext(Ctx);
      if (ctx.value !== value) return null;
      return react.createElement("div", { role: "tabpanel" }, children as never);
    },
  };
}

interface MutableHostProps<T extends object> {
  initial: T;
  /** Dostaje aktualną wartość i funkcję zapisu w kształcie panelu. */
  children: (value: T, apply: (mut: (draft: T) => void) => void) => ReactElement;
  /** Wywoływane po każdej mutacji - do asercji na CIĄGU zapisów. */
  onApplied?: (next: T) => void;
}

/**
 * Gospodarz stanu w kształcie, w jakim panel dostaje go z kanwy: płaski klon
 * poprzedniej wartości i mutacja wykonana NA KLONIE. Dzięki temu test widzi
 * dokładnie to, co zapisze dokument - w tym przypadki, w których panel czyta
 * wartość, którą sam dopiero co ustawił.
 */
export function MutableHost<T extends object>({
  initial,
  children,
  onApplied,
}: MutableHostProps<T>) {
  const [value, setValue] = useState<T>(initial);
  const apply = (mut: (draft: T) => void): void => {
    setValue((prev) => {
      const next = { ...prev };
      mut(next);
      onApplied?.(next);
      return next;
    });
  };
  return children(value, apply);
}

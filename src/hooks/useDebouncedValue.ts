// Opóźniona (trailing-edge) kopia wartości: zmiany "uspokajają się" po
// delayMs bez przepisań. Użycie: autosuggest wyszukiwarki - zapytanie RPC
// strzela raz po pauzie w pisaniu, nie na każdy znak.
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

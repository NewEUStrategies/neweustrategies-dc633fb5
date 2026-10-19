// Atom: pole liczbowe z zakresem, które NIE walczy z użytkownikiem podczas
// pisania. Klasyczny błąd (`value={n}` + clamp w onChange) sprawia, że po
// wyczyszczeniu pola natychmiast wskakuje wartość domyślna i nie da się wpisać
// np. "12" - tutaj trzymamy lokalny draft (string), a clamp/commit dzieje się
// dopiero gdy wartość jest kompletna: blur, Enter lub poprawna liczba w zakresie.
//
// Zakres podaje WYWOŁUJĄCY i ma to być zakres renderera (panel pokazujący 5000,
// gdy kanwa rysuje 900, to ten sam defekt w drugą stronę). Renderer domykający
// wartość tylko od dołu = brak `max`.
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ClampedNumberInputProps {
  /** Wartość zatwierdzona (źródło prawdy z dokumentu buildera). */
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  min: number;
  /** Górny kraniec; brak = bez górnej granicy (renderer domyka tylko od dołu). */
  max?: number;
  step?: number;
  /**
   * Liczba miejsc po przecinku. Brak = pole przyjmuje wyłącznie liczby całkowite
   * (zachowanie wszystkich wywołań sprzed trybu ułamkowego). Wartość > 0
   * wpuszcza ułamek (kropka lub przecinek, najwyżej tyle cyfr po separatorze),
   * a zatwierdzenie i krok strzałki zaokrągla do tej precyzji - 1.1 + 0.05 to
   * w arytmetyce binarnej 1.1500000000000001, a nie 1.15.
   */
  precision?: number;
  /** Gdy true, puste pole zatwierdza `undefined` (np. min-height = auto). */
  allowEmpty?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const parse = (raw: string) => Number(raw.replace(",", "."));

export function ClampedNumberInput({
  value,
  onCommit,
  min,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  precision,
  allowEmpty = false,
  placeholder,
  ariaLabel,
  className,
}: ClampedNumberInputProps) {
  const [draft, setDraft] = useState<string>(value === undefined ? "" : String(value));
  const editing = useRef(false);
  const fractional = precision !== undefined && precision > 0;
  // Wzorzec liczony z precyzji: separator i co najwyżej `precision` cyfr po nim.
  const accepts = fractional ? new RegExp(`^-?\\d*([.,]\\d{0,${precision}})?$`) : /^-?\d*$/;
  // Bez precyzji wynik zostaje dosłowny (dotychczasowa semantyka atomu).
  const round = (n: number) => (precision === undefined ? n : Number(n.toFixed(precision)));

  // Synchronizacja tylko gdy pole nie jest edytowane - inaczej kasowalibyśmy
  // to, co użytkownik właśnie wpisuje.
  useEffect(() => {
    if (!editing.current) setDraft(value === undefined ? "" : String(value));
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (allowEmpty) {
        onCommit(undefined);
        setDraft("");
      } else {
        setDraft(value === undefined ? "" : String(value));
      }
      return;
    }
    const parsed = parse(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(value === undefined ? "" : String(value));
      return;
    }
    const next = clamp(round(parsed), min, max);
    setDraft(String(next));
    onCommit(next);
  };

  const bump = (delta: number) => {
    const base = parse(draft);
    // `Number("")` to ZERO, nie NaN - pusty draft musi jawnie wrócić do
    // wartości dokumentu, inaczej strzałka liczyła od zera.
    const start = draft.trim() !== "" && Number.isFinite(base) ? base : (value ?? min);
    const next = clamp(round(start + delta), min, max);
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <Input
      type="text"
      inputMode={fractional ? "decimal" : "numeric"}
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        // Wpuszczamy tylko cyfry (i minus, gdy zakres na to pozwala; w trybie
        // ułamkowym - jeden separator) - reszta znaków jest ignorowana, więc nie
        // trzeba "naprawiać" wartości później.
        if (!accepts.test(raw)) return;
        setDraft(raw);
        // Commit w locie tylko dla wartości już poprawnych w zakresie, żeby
        // podgląd reagował od razu bez blokowania dalszego pisania. Stany
        // pośrednie ("-", ".", "1.") albo nie są liczbą, albo są tą samą
        // liczbą co bez separatora - draft trzyma je dalej do dopisania cyfr.
        if (raw !== "" && raw !== "-") {
          const parsed = parse(raw);
          if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onCommit(parsed);
        }
      }}
      onBlur={(e) => {
        editing.current = false;
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit((e.target as HTMLInputElement).value);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          bump(e.shiftKey ? step * 10 : step);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          bump(e.shiftKey ? -step * 10 : -step);
        }
      }}
      className={cn("h-8 text-xs", className)}
    />
  );
}

// Atom: pole liczbowe z zakresem, które NIE walczy z użytkownikiem podczas
// pisania. Klasyczny błąd (`value={n}` + clamp w onChange) sprawia, że po
// wyczyszczeniu pola natychmiast wskakuje wartość domyślna i nie da się wpisać
// np. "12" - tutaj trzymamy lokalny draft (string), a clamp/commit dzieje się
// dopiero gdy wartość jest kompletna: blur, Enter lub poprawna liczba w zakresie.
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ClampedNumberInputProps {
  /** Wartość zatwierdzona (źródło prawdy z dokumentu buildera). */
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
  /** Gdy true, puste pole zatwierdza `undefined` (np. min-height = auto). */
  allowEmpty?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function ClampedNumberInput({
  value,
  onCommit,
  min,
  max,
  step = 1,
  allowEmpty = false,
  placeholder,
  ariaLabel,
  className,
}: ClampedNumberInputProps) {
  const [draft, setDraft] = useState<string>(value === undefined ? "" : String(value));
  const editing = useRef(false);

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
    const parsed = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraft(value === undefined ? "" : String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    onCommit(next);
  };

  const bump = (delta: number) => {
    const base = Number(draft.replace(",", "."));
    const start = Number.isFinite(base) ? base : (value ?? min);
    const next = clamp(start + delta, min, max);
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        // Wpuszczamy tylko cyfry (i minus, gdy zakres na to pozwala) - reszta
        // znaków jest ignorowana, więc nie trzeba "naprawiać" wartości później.
        if (!/^-?\d*$/.test(raw)) return;
        setDraft(raw);
        // Commit w locie tylko dla wartości już poprawnych w zakresie, żeby
        // podgląd reagował od razu bez blokowania dalszego pisania.
        if (raw !== "" && raw !== "-") {
          const parsed = Number(raw);
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

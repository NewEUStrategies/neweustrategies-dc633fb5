// Combobox: kraje z autouzupełnianiem, filtrowaniem po wpisywaniu.
// - Lista krajów z i18n-iso-countries (PL + EN).
// - Użytkownik może wybrać z listy albo wpisać własną nazwę (free text zapisywany 1:1).
// - Dostępny z klawiatury (↑ ↓ Enter Esc), aria zgodne z combobox pattern.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import plLocale from "i18n-iso-countries/langs/pl.json";
import { cn } from "@/lib/utils";

countries.registerLocale(enLocale);
countries.registerLocale(plLocale);

interface CountryComboboxProps {
  value: string;
  onChange: (v: string) => void;
  lang: "pl" | "en";
  placeholder?: string;
  required?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  maxLength?: number;
  name?: string;
}

function useCountryList(lang: "pl" | "en"): string[] {
  return useMemo(() => {
    const map = countries.getNames(lang, { select: "official" });
    return Object.values(map).sort((a, b) => a.localeCompare(b, lang));
  }, [lang]);
}

function normalize(s: string): string {
  return s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function CountryCombobox({
  value,
  onChange,
  lang,
  placeholder,
  required,
  className,
  style,
  ariaLabel,
  maxLength = 100,
  name,
}: CountryComboboxProps) {
  const list = useCountryList(lang);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = normalize(value.trim());
    if (!q) return list.slice(0, 200);
    return list.filter((n) => normalize(n).includes(q)).slice(0, 200);
  }, [value, list]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [value, open]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        e.preventDefault();
        commit(filtered[highlight]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const activeId = open && filtered[highlight] ? `${listId}-opt-${highlight}` : undefined;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        name={name}
        autoComplete="country-name"
        value={value}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-10 px-3 rounded border border-input bg-background font-sans leading-none w-full"
        style={style}
        data-edit-target="placeholderSize"
      />
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md text-sm"
        >
          {filtered.map((name, i) => {
            const active = i === highlight;
            return (
              <li
                key={name}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(name);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "px-3 py-1.5 cursor-pointer",
                  active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                {name}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

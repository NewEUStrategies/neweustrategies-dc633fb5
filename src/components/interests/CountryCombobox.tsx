// Combobox: kraje z autouzupełnianiem, filtrowaniem po wpisywaniu.
// - Lista krajów z i18n-iso-countries (PL + EN).
// - Użytkownik może wybrać z listy albo wpisać własną nazwę (free text zapisywany 1:1).
// - Dostępny z klawiatury (↑ ↓ Enter Esc), aria zgodne z combobox pattern.
// - Dropdown renderowany przez portal (fixed) - nie jest przycinany przez overflow-hidden.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
// `/index.js` and NOT the bare package: the package's Node entry (`main:
// entry-node`) registers every locale through a dynamic `require("./langs/" +
// lang + ".json")` that Rollup cannot bundle, so the SSR Worker chunk throws at
// module init and every request 500s. The browser field points at index.js;
// importing it directly gives both builds the same lazily-registered library.
import countries from "i18n-iso-countries/index.js";
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
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = normalize(value.trim());
    if (!q) return list.slice(0, 200);
    return list.filter((n) => normalize(n).includes(q)).slice(0, 200);
  }, [value, list]);

  const updatePosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const desired = 240;
    const openUp = spaceBelow < desired && spaceAbove > spaceBelow;
    const maxH = Math.max(160, Math.min(desired, openUp ? spaceAbove - 8 : spaceBelow - 8));
    setPopupStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? vh - rect.top + 4 : undefined,
      maxHeight: maxH,
      zIndex: 1000,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updatePosition, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (popupRef.current?.contains(t)) return;
      setOpen(false);
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

  const inputBase = "h-10 px-3 rounded border border-input bg-background font-sans leading-none w-full";

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
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-form-type="other"
        data-lpignore="true"
        data-1p-ignore="true"
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
        className={inputBase}
        style={style}
        data-edit-target="placeholderSize"
      />
      {open && filtered.length > 0 && typeof document !== "undefined" &&
        createPortal(
          <ul
            ref={popupRef}
            id={listId}
            role="listbox"
            style={popupStyle}
            className="overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-2xl text-sm"
          >
            {filtered.map((countryName, i) => {
              const active = i === highlight;
              return (
                <li
                  key={countryName}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(countryName);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "px-3 py-1.5 cursor-pointer",
                    active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )}
                >
                  {countryName}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}

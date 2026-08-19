// Combobox: kraje z autouzupełnianiem, filtrowaniem po wpisywaniu.
// - Lista krajów z i18n-iso-countries (PL + EN).
// - Użytkownik może wybrać z listy albo wpisać własną nazwę (free text zapisywany 1:1).
// - Dostępny z klawiatury (↑ ↓ Enter Esc), aria zgodne z combobox pattern.
// - Dropdown renderowany przez portal (fixed) - nie jest przycinany przez overflow-hidden.
//
// Geometria pola jest TA SAMA co w atomie <FloatingInput/> (`.input-group` +
// `.input` + `.user-label`), więc "Kraj" wygląda i zachowuje się identycznie
// jak Imię / Nazwisko / Telefon / Firma w formularzu "Dołącz do nas", a
// rozmiary z buildera (`placeholderSize` / `labelSize`) działają na nim tak
// samo jak na pozostałych polach.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
// `i18n-iso-countries/index.js` is CommonJS and uses `require()`, which is
// undefined in the browser. We use a tiny ESM-only wrapper that imports the
// static locale JSON files directly.
import { getAlpha2Code, getNames } from "@/lib/countries";
import { cn } from "@/lib/utils";

interface CountryComboboxProps {
  value: string;
  onChange: (v: string) => void;
  lang: "pl" | "en";
  /** Etykieta pola (floating label), np. "Kraj" / "Country". */
  label: string;
  required?: boolean;
  className?: string;
  style?: CSSProperties;
  maxLength?: number;
  name?: string;
  /** Klucz rozmiaru dla floating labelki (builder: "Etykiety pól"). */
  labelEditTarget?: string;
}

/**
 * Slot flagi wewnątrz pola. Wszystko w `em`, żeby proporcje trzymały się przy
 * dowolnym `placeholderSize` z buildera:
 *   [ 0.9rem wcięcia ][ flaga 1.5em ][ 0.5em ][ kreska 1px ][ 0.5em ][ tekst ]
 * `paddingLeft` idzie STYLEM INLINE, a nie klasą `pl-*`, bo wartość zależy od
 * rozmiaru czcionki pola (`em`) - żadne utility tego nie wyrazi. Klasa i tak
 * by tu zadziałała: baseline pól siedzi w `@layer components` (patrz
 * `src/lib/ci/cssLayers.ts`), więc utility go nadpisują.
 */
const FLAG_GUTTER = "0.9rem";
const FLAG_WIDTH = "1.5em";
const FLAG_HEIGHT = "1.125em";
const TEXT_PADDING_WITH_FLAG = `calc(${FLAG_GUTTER} + 2.5em + 1px)`;

export function useCountryList(lang: "pl" | "en"): string[] {
  return useMemo(() => {
    const map = getNames(lang);
    return Object.values(map).sort((a, b) => a.localeCompare(b, lang));
  }, [lang]);
}

export function normalizeCountrySearch(s: string): string {
  return s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l");
}

export function CountryCombobox({
  value,
  onChange,
  lang,
  label,
  required,
  className,
  style,
  maxLength = 100,
  name,
  labelEditTarget,
}: CountryComboboxProps) {
  const list = useCountryList(lang);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const inputId = useId();

  const filtered = useMemo(() => {
    const q = normalizeCountrySearch(value.trim());
    if (!q) return list.slice(0, 200);
    return list.filter((n) => normalizeCountrySearch(n).includes(q)).slice(0, 200);
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

  const codeFor = (name: string): string | undefined => {
    const c = getAlpha2Code(name, lang) || getAlpha2Code(name, "en");
    return c ? c.toLowerCase() : undefined;
  };
  const selectedCode = codeFor(value.trim());

  const flagStyle: CSSProperties = { width: FLAG_WIDTH, height: FLAG_HEIGHT };
  // Slot flagi liczy swoje `em` od kontenera, a padding tekstu - od inputa.
  // Zrównujemy obie bazy, inaczej przy zmianie "Pola / placeholder" flaga i
  // wcięcie tekstu rozjeżdżałyby się i znów wchodziłyby na nazwę kraju.
  const emBase = style?.fontSize ?? "0.95rem";

  return (
    <div
      ref={rootRef}
      className={cn("input-group", className)}
      style={{ fontSize: emBase } as CSSProperties}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={activeId}
        name={name}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-form-type="other"
        data-lpignore="true"
        data-1p-ignore="true"
        value={value}
        /* Spacja (nie pusty string) - `:placeholder-shown` steruje floating labelką. */
        placeholder=" "
        required={required}
        aria-required={required || undefined}
        maxLength={maxLength}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="input"
        style={selectedCode ? { ...style, paddingLeft: TEXT_PADDING_WITH_FLAG } : style}
        data-edit-target="placeholderSize"
      />
      <label htmlFor={inputId} className="user-label" data-edit-target={labelEditTarget}>
        {label}
      </label>
      {/* Flaga + pionowa kreska: wybrany kraj jest wyraźnie ODDZIELONY od
          wpisanej nazwy, nigdy jej nie przykrywa. Renderowana po labelce, żeby
          w stanie spoczynku (pole puste = brak flagi) nie było kolizji. */}
      {selectedCode ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center gap-[0.5em]"
          style={{ paddingLeft: FLAG_GUTTER }}
        >
          <img
            src={`https://flagcdn.com/w40/${selectedCode}.png`}
            srcSet={`https://flagcdn.com/w80/${selectedCode}.png 2x`}
            alt=""
            className="shrink-0 rounded-[6px] border border-border/60 object-cover"
            style={flagStyle}
            loading="lazy"
            decoding="async"
          />
          <span className="h-[1.3em] w-px shrink-0 bg-border" />
        </span>
      ) : null}
      {open &&
        filtered.length > 0 &&
        typeof document !== "undefined" &&
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
              const code = codeFor(countryName);
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
                    "px-3 py-1.5 cursor-pointer flex items-center gap-2",
                    active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )}
                >
                  {code ? (
                    <img
                      src={`https://flagcdn.com/w40/${code}.png`}
                      srcSet={`https://flagcdn.com/w80/${code}.png 2x`}
                      alt=""
                      aria-hidden
                      className="shrink-0 rounded-[6px] border border-border/60 object-cover"
                      style={flagStyle}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span
                      className="shrink-0 rounded-[6px] bg-muted"
                      style={flagStyle}
                      aria-hidden
                    />
                  )}
                  <span className="w-px self-stretch shrink-0 bg-border/70" aria-hidden />
                  <span className="truncate">{countryName}</span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}

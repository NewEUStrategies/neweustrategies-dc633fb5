// Font dropdown z wizualnym podglądem stylu w polu wyboru i na liście.
// Wartością jest pełen stos font-family (string), zgodny z `var(--brand-font-*)`.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface FontOption {
  label: string;
  /** Pełny font-family stack (zapisywany do bazy). */
  stack: string;
  /** Nazwa rodziny do podpięcia z Google Fonts (jeśli ma być załadowana). */
  googleFamily?: string;
  /** Krótki opis charakteru fontu. */
  hint?: string;
}

/** Sample dla nagłówków + treści — pokrywa popularne kierunki. */
export const DEFAULT_FONT_STACK = '"Red Hat Display", system-ui, -apple-system, Segoe UI, sans-serif';

export const FONT_OPTIONS: FontOption[] = [
  { label: "Red Hat Display", stack: DEFAULT_FONT_STACK, googleFamily: "Red+Hat+Display:wght@400;500;600;700;800", hint: "Domyślny / System UI" },
  { label: "Inter", stack: "Inter, system-ui, sans-serif", googleFamily: "Inter:wght@400;500;600;700", hint: "Neutralny, czytelny" },
  { label: "Manrope", stack: "Manrope, system-ui, sans-serif", googleFamily: "Manrope:wght@400;500;600;700", hint: "Geometryczny sans" },
  { label: "DM Sans", stack: "'DM Sans', system-ui, sans-serif", googleFamily: "DM+Sans:wght@400;500;700", hint: "Krągły, przyjazny" },
  { label: "Space Grotesk", stack: "'Space Grotesk', system-ui, sans-serif", googleFamily: "Space+Grotesk:wght@400;500;700", hint: "Tech / startup" },
  { label: "Outfit", stack: "Outfit, system-ui, sans-serif", googleFamily: "Outfit:wght@400;500;700", hint: "Lekki display" },
  { label: "Sora", stack: "Sora, system-ui, sans-serif", googleFamily: "Sora:wght@400;500;700", hint: "Nowoczesny sans" },
  { label: "Plus Jakarta Sans", stack: "'Plus Jakarta Sans', system-ui, sans-serif", googleFamily: "Plus+Jakarta+Sans:wght@400;500;700", hint: "Łagodny, biznesowy" },
  { label: "Work Sans", stack: "'Work Sans', system-ui, sans-serif", googleFamily: "Work+Sans:wght@400;500;700", hint: "Klasyczny grotesk" },
  { label: "Playfair Display", stack: "'Playfair Display', Georgia, serif", googleFamily: "Playfair+Display:wght@400;600;800", hint: "Elegancki serif" },
  { label: "Instrument Serif", stack: "'Instrument Serif', Georgia, serif", googleFamily: "Instrument+Serif", hint: "Magazynowy serif" },
  { label: "Lora", stack: "Lora, Georgia, serif", googleFamily: "Lora:wght@400;500;600;700", hint: "Czytelny serif" },
  { label: "Cormorant Garamond", stack: "'Cormorant Garamond', Georgia, serif", googleFamily: "Cormorant+Garamond:wght@400;500;700", hint: "Luksusowy serif" },
  { label: "Bebas Neue", stack: "'Bebas Neue', Impact, sans-serif", googleFamily: "Bebas+Neue", hint: "Display, plakat" },
  { label: "Archivo Black", stack: "'Archivo Black', Impact, sans-serif", googleFamily: "Archivo+Black", hint: "Pogrubiony display" },
  { label: "JetBrains Mono", stack: "'JetBrains Mono', ui-monospace, monospace", googleFamily: "JetBrains+Mono:wght@400;500;700", hint: "Monospace" },
];

/** Załaduj wszystkie Google Fonts z listy raz (do podglądu w dropdownie). */
function useLoadGoogleFonts() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("__brand-font-picker-fonts")) return;
    const families = FONT_OPTIONS
      .filter((f) => f.googleFamily)
      .map((f) => `family=${f.googleFamily}`)
      .join("&");
    const link = document.createElement("link");
    link.id = "__brand-font-picker-fonts";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }, []);
}

function findOption(stack: string | undefined): FontOption | undefined {
  if (!stack) return undefined;
  return FONT_OPTIONS.find((o) => o.stack === stack);
}

interface Props {
  value: string | undefined;
  onChange: (stack: string | undefined) => void;
  sampleText?: string;
}

export function FontPicker({ value, onChange, sampleText = "Aa — The quick brown fox" }: Props) {
  useLoadGoogleFonts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => findOption(value), [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 bg-background border border-border rounded-md px-3 py-2 text-sm hover:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand"
      >
        <span className="flex flex-col items-start min-w-0">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {selected?.label ?? "Domyślny"}
          </span>
          <span
            className="truncate text-base"
            style={{ fontFamily: value || "inherit" }}
          >
            {sampleText}
          </span>
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-80 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          <button
            type="button"
            onClick={() => { onChange(undefined); setOpen(false); }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50"
          >
            <span className="text-muted-foreground italic">Red Hat Display (domyślny)</span>
            {!value && <Check className="w-4 h-4 text-brand" />}
          </button>
          <div className="border-t border-border" />
          {FONT_OPTIONS.map((opt) => {
            const active = opt.stack === value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => { onChange(opt.stack); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 ${active ? "bg-muted/40" : ""}`}
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {opt.label}{opt.hint ? ` · ${opt.hint}` : ""}
                  </span>
                  <span
                    className="truncate text-base"
                    style={{ fontFamily: opt.stack }}
                  >
                    {sampleText}
                  </span>
                </span>
                {active && <Check className="w-4 h-4 text-brand shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

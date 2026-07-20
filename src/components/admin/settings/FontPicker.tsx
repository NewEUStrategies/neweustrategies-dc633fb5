// Font dropdown z wizualnym podglądem stylu w polu wyboru i na liście.
// Wartością jest pełen stos font-family (string), zgodny z `var(--brand-font-*)`.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CustomFont } from "@/lib/theme/customFonts";
import "@/lib/i18n-admin-panes-misc";

export interface FontOption {
  label: string;
  /** Pełny font-family stack (zapisywany do bazy). */
  stack: string;
  /** Nazwa rodziny do podpięcia z Google Fonts (jeśli ma być załadowana). */
  googleFamily?: string;
  /** Krótki opis charakteru fontu. */
  hint?: string;
}

/** Sample dla nagłówków + treści - pokrywa popularne kierunki. */
const DEFAULT_FONT_STACK =
  '"Red Hat Display", "Red Hat Display Fallback", system-ui, -apple-system, Segoe UI, sans-serif';

// `hint` holds an i18n key path (resolved with t() at render), not literal text.
const FONT_OPTIONS: FontOption[] = [
  {
    label: "Red Hat Display",
    stack: DEFAULT_FONT_STACK,
    googleFamily: "Red+Hat+Display:wght@400;500;600;700;800",
    hint: "adminPanesMisc.fontPicker.hints.redhat",
  },
  {
    label: "Inter",
    stack: "Inter, system-ui, sans-serif",
    googleFamily: "Inter:wght@400;500;600;700",
    hint: "adminPanesMisc.fontPicker.hints.inter",
  },
  {
    label: "Manrope",
    stack: "Manrope, system-ui, sans-serif",
    googleFamily: "Manrope:wght@400;500;600;700",
    hint: "adminPanesMisc.fontPicker.hints.manrope",
  },
  {
    label: "DM Sans",
    stack: "'DM Sans', system-ui, sans-serif",
    googleFamily: "DM+Sans:wght@400;500;700",
    hint: "adminPanesMisc.fontPicker.hints.dmsans",
  },
  {
    label: "Space Grotesk",
    stack: "'Space Grotesk', system-ui, sans-serif",
    googleFamily: "Space+Grotesk:wght@400;500;700",
    hint: "adminPanesMisc.fontPicker.hints.spaceGrotesk",
  },
  {
    label: "Outfit",
    stack: "Outfit, system-ui, sans-serif",
    googleFamily: "Outfit:wght@400;500;700",
    hint: "adminPanesMisc.fontPicker.hints.outfit",
  },
  {
    label: "Sora",
    stack: "Sora, system-ui, sans-serif",
    googleFamily: "Sora:wght@400;500;700",
    hint: "adminPanesMisc.fontPicker.hints.sora",
  },
  {
    label: "Plus Jakarta Sans",
    stack: "'Plus Jakarta Sans', system-ui, sans-serif",
    googleFamily: "Plus+Jakarta+Sans:wght@400;500;700",
    hint: "adminPanesMisc.fontPicker.hints.jakarta",
  },
  {
    label: "Work Sans",
    stack: "'Work Sans', system-ui, sans-serif",
    googleFamily: "Work+Sans:wght@400;500;700",
    hint: "adminPanesMisc.fontPicker.hints.workSans",
  },
  {
    label: "Playfair Display",
    stack: "'Playfair Display', Georgia, serif",
    googleFamily: "Playfair+Display:wght@400;600;800",
    hint: "adminPanesMisc.fontPicker.hints.playfair",
  },
  {
    label: "Instrument Serif",
    stack: "'Instrument Serif', Georgia, serif",
    googleFamily: "Instrument+Serif",
    hint: "adminPanesMisc.fontPicker.hints.instrument",
  },
  {
    label: "Lora",
    stack: "Lora, Georgia, serif",
    googleFamily: "Lora:wght@400;500;600;700",
    hint: "adminPanesMisc.fontPicker.hints.lora",
  },
  {
    label: "Cormorant Garamond",
    stack: "'Cormorant Garamond', Georgia, serif",
    googleFamily: "Cormorant+Garamond:wght@400;500;700",
    hint: "adminPanesMisc.fontPicker.hints.cormorant",
  },
  {
    label: "Bebas Neue",
    stack: "'Bebas Neue', Impact, sans-serif",
    googleFamily: "Bebas+Neue",
    hint: "adminPanesMisc.fontPicker.hints.bebas",
  },
  {
    label: "Archivo Black",
    stack: "'Archivo Black', Impact, sans-serif",
    googleFamily: "Archivo+Black",
    hint: "adminPanesMisc.fontPicker.hints.archivo",
  },
  {
    label: "JetBrains Mono",
    stack: "'JetBrains Mono', ui-monospace, monospace",
    googleFamily: "JetBrains+Mono:wght@400;500;700",
    hint: "adminPanesMisc.fontPicker.hints.jetbrains",
  },
];

/** Załaduj wszystkie Google Fonts z listy raz (do podglądu w dropdownie). */
function useLoadGoogleFonts() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("__brand-font-picker-fonts")) return;
    const families = FONT_OPTIONS.filter((f) => f.googleFamily)
      .map((f) => `family=${f.googleFamily}`)
      .join("&");
    const link = document.createElement("link");
    link.id = "__brand-font-picker-fonts";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }, []);
}

interface Props {
  value: string | undefined;
  onChange: (stack: string | undefined) => void;
  sampleText?: string;
  /** Tenant-uploaded custom fonts (rendered as extra options at the top). */
  customFonts?: CustomFont[];
}

export function FontPicker({
  value,
  onChange,
  sampleText = "Aa - The quick brown fox",
  customFonts = [],
}: Props) {
  const { t } = useTranslation();
  useLoadGoogleFonts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const customOptions = useMemo<FontOption[]>(
    () =>
      customFonts.map((f) => ({
        label: `${f.label} ${t("adminPanesMisc.fontPicker.customSuffix")}`,
        stack: `"${f.id}", system-ui, sans-serif`,
        hint: "adminPanesMisc.fontPicker.customHint",
      })),
    [customFonts, t],
  );
  const allOptions = useMemo(() => [...customOptions, ...FONT_OPTIONS], [customOptions]);
  const selected = useMemo(() => allOptions.find((o) => o.stack === value), [allOptions, value]);

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
            {selected?.label ?? t("adminPanesMisc.fontPicker.defaultLabel")}
          </span>
          <span className="truncate text-base" style={{ fontFamily: value || DEFAULT_FONT_STACK }}>
            {sampleText}
          </span>
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-80 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50"
          >
            <span className="text-muted-foreground italic">
              {t("adminPanesMisc.fontPicker.defaultLabel")}
            </span>
            {!value && <Check className="w-4 h-4 text-brand" />}
          </button>
          <div className="border-t border-border" />
          {allOptions.map((opt) => {
            const active = opt.stack === value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => {
                  onChange(opt.stack);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 ${active ? "bg-muted/40" : ""}`}
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {opt.label}
                    {opt.hint ? ` · ${t(opt.hint)}` : ""}
                  </span>
                  <span className="truncate text-base" style={{ fontFamily: opt.stack }}>
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

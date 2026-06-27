// Small site-chrome widgets (header/footer), extracted from SimpleWidgets.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as LucideIcons from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";

export function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n } = useTranslation();
  const current: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const options: { code: "pl" | "en"; flag: string; label: string }[] = [
    { code: "pl", flag: "🇵🇱", label: "PL" },
    { code: "en", flag: "🇬🇧", label: "EN" },
  ];
  const cur = options.find((o) => o.code === current)!;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-border bg-background hover:bg-muted transition text-xs font-medium"
      >
        <span className="text-base leading-none">{cur.flag}</span>
        <span>{cur.label}</span>
        <LucideIcons.ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full mt-1 z-50 min-w-[7rem] rounded-md border border-border bg-popover shadow-md py-1"
        >
          {options.map((o) => {
            const active = o.code === current;
            return (
              <li key={o.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    i18n.changeLanguage(o.code);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-muted transition ${active ? "font-semibold" : ""}`}
                >
                  <span className="text-base leading-none">{o.flag}</span>
                  <span className="flex-1">{o.label}</span>
                  {active && <LucideIcons.Check className="w-3.5 h-3.5 opacity-70" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ThemeToggleWidget() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Przełącz na tryb jasny" : "Przełącz na tryb ciemny"}
      title={isDark ? "Tryb ciemny (kliknij, aby zmienić)" : "Tryb jasny (kliknij, aby zmienić)"}
      className="inline-flex items-center justify-center rounded-[2px] hover:opacity-80 transition-opacity"
      style={{ width: 14, height: 14 }}
    >
      {isDark ? (
        <LucideIcons.Sun className="w-3.5 h-3.5" style={{ color: "#FA9346" }} />
      ) : (
        <LucideIcons.Moon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

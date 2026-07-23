// Wspólne atomy prezentacyjne dla wszystkich powierzchni wyszukiwania:
// - <SuggestGroupHeader> (nagłówek grupy: brand-tinted tile + label + count)
// - <SuggestRow> (wiersz: tile ikony / avatar + label + prawy meta + wskaźnik)
// - <SuggestListShell> (kaftan popovera: tokeny, radius 10px, backdrop)
//
// Trzej konsumenci (SearchButtonWidget, SearchAutosuggest, SearchOverlay)
// używają dokładnie tego samego wyglądu wierszy - typografia Red Hat Display,
// tokeny (--popover, --border, --brand, --brand-ink, --muted), 6px rounding.
// Wzorowane na wzorcu Preline combobox (grouping + right-meta + hover state).
import type { ComponentType, ReactNode } from "react";
import { ArrowRight } from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export interface SuggestGroupHeaderProps {
  icon: IconType;
  label: string;
  count?: number;
}

export function SuggestGroupHeader({ icon: Icon, label, count }: SuggestGroupHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
      <span
        className="flex h-4 w-4 items-center justify-center rounded-[4px]"
        style={{ backgroundColor: "color-mix(in oklab, var(--brand) 12%, transparent)" }}
      >
        <Icon className="h-2.5 w-2.5" aria-hidden />
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {typeof count === "number" && (
        <span className="ml-auto rounded bg-muted/60 px-1.5 py-0.5 text-[8px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  );
}

export interface SuggestRowProps {
  id?: string;
  href: string;
  label: string;
  meta?: string;
  icon?: IconType;
  avatarUrl?: string | null;
  active: boolean;
  onSelect?: () => void;
  onHover?: () => void;
  /** Intercepcja mousedown - używana gdy rodzic sam obsługuje nawigację
   *  (np. autosuggest na /search, gdzie pickSuggestion robi router.navigate). */
  onMouseDown?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Wiersz podpowiedzi. Rola `option` siedzi na linku (tabIndex=-1) - fokus
 * zostaje w combobox, a wybór ogłasza aria-activedescendant. `li` obudowy
 * zostaje po stronie konsumenta jako `role="presentation"` (unikamy
 * nested-interactive w axe).
 */
export function SuggestRow({
  id,
  href,
  label,
  meta,
  icon: Icon,
  avatarUrl,
  active,
  onSelect,
  onHover,
  onMouseDown,
}: SuggestRowProps) {
  return (
    <AppLink
      href={href}
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseDown={onMouseDown}
      className={`group relative mx-1.5 flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] leading-[1.4] transition-all ${
        active
          ? "bg-[color-mix(in_oklab,var(--brand)_8%,transparent)] text-foreground"
          : "text-foreground hover:bg-muted/60"
      }`}
      style={{ overflow: "visible" }}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
        style={{ backgroundColor: "var(--brand)" }}
      />
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          aria-hidden
          className="h-7 w-7 shrink-0 rounded-md border border-border/60 object-cover"
        />
      ) : Icon ? (
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-all ${
            active ? "border-transparent" : "border-border/60 bg-background/60 group-hover:border-border"
          }`}
          style={
            active
              ? { backgroundColor: "color-mix(in oklab, var(--brand) 14%, transparent)" }
              : undefined
          }
        >
          <Icon
            className="h-3.5 w-3.5"
            aria-hidden
          />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && (
        <span
          data-typography-exempt
          className={`hidden shrink-0 rounded-[6px] px-1 py-px !text-[9px] !leading-[12px] font-semibold uppercase !tracking-[0.02em] sm:inline-flex ${
            active ? "text-[var(--brand-ink)]" : "text-muted-foreground"
          }`}
          style={{
            backgroundColor: active
              ? "color-mix(in oklab, var(--brand) 14%, transparent)"
              : "color-mix(in oklab, var(--muted-foreground) 10%, transparent)",
          }}
        >
          {meta}
        </span>
      )}
      <ArrowRight
        className={`h-3.5 w-3.5 shrink-0 transition-all ${
          active
            ? "translate-x-0 opacity-100"
            : "-translate-x-0.5 opacity-0 group-hover:translate-x-0 group-hover:opacity-70"
        }`}
        aria-hidden
        style={{ color: "var(--brand)" }}
      />
    </AppLink>
  );
}

export interface SuggestListShellProps {
  children: ReactNode;
  className?: string;
  minWidth?: string;
}

/**
 * Kaftan popovera podpowiedzi - identyczny dla widgetu, autosuggesta i overlay.
 * Radius 10px, tokeny popover/border, backdrop-blur, cień „premium".
 */
export function SuggestListShell({ children, className = "", minWidth }: SuggestListShellProps) {
  return (
    <div
      className={`overflow-hidden rounded-[10px] border border-border/70 bg-popover text-popover-foreground shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35),0_8px_24px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.04] backdrop-blur-xl ${className}`}
      style={{
        fontFamily:
          '"Red Hat Display", "Red Hat Display Fallback", system-ui, -apple-system, "Segoe UI", sans-serif',
        ...(minWidth ? { minWidth } : {}),
      }}
    >
      {children}
    </div>
  );
}

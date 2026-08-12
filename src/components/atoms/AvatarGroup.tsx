// Grupa nakładających się awatarów z kartą tożsamości po najechaniu.
//
// Atom bez wiedzy o domenie: dostaje gotowe pozycje i tylko je układa. Dzięki
// temu tej samej molekuły używa klub (kto zareagował), a w przyszłości np.
// lista uczestników wydarzenia - bez duplikowania logiki nakładania i tooltipa.
//
// Świadomie BEZ framer-motion: projekt nie ma tej zależności, a wejście karty
// da się zrobić czystym CSS (opacity + translate + scale) w tym samym rytmie,
// co reszta interakcji w klubach.
import { useId, useState } from "react";
import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
import { cn } from "@/lib/utils";

export interface AvatarGroupItem {
  /** Stabilny klucz - id użytkownika albo syntetyczny dla osób anonimowych. */
  id: string;
  name: string;
  /** Druga linia karty: stanowisko, rola, typ reakcji. */
  designation?: string | null;
  image?: string | null;
  /** Gdy podany, awatar staje się linkiem do profilu. */
  href?: string | null;
  /** Tożsamość ukryta (tryb poufny) - neutralny znacznik, bez inicjałów. */
  anonymous?: boolean;
}

export type AvatarGroupSize = "xs" | "sm" | "md" | "lg";

const SIZES: Record<AvatarGroupSize, { cls: string; px: number }> = {
  xs: { cls: "h-6 w-6 text-[9px]", px: 24 },
  sm: { cls: "h-8 w-8 text-[10px]", px: 32 },
  md: { cls: "h-10 w-10 text-xs", px: 40 },
  lg: { cls: "h-12 w-12 text-sm", px: 48 },
};

export function avatarInitials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

interface AvatarGroupProps {
  items: readonly AvatarGroupItem[];
  className?: string;
  maxVisible?: number;
  size?: AvatarGroupSize;
  /** Etykieta całej grupy dla czytnika ekranu, np. "Zareagowali". */
  label: string;
  /** Tekst karty licznika "+N", np. "i 4 inne osoby". */
  overflowLabel?: (count: number) => string;
}

export function AvatarGroup({
  items,
  className,
  maxVisible = 5,
  size = "sm",
  label,
  overflowLabel,
}: AvatarGroupProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const listId = useId();
  const spec = SIZES[size];
  const visible = items.slice(0, Math.max(1, maxVisible));
  const remaining = items.length - visible.length;

  if (items.length === 0) return null;

  return (
    <ul
      className={cn("flex items-center", className)}
      aria-label={label}
      // Nakładanie robimy ujemnym marginesem elementów, nie space-x, żeby
      // ostatni element nie ciągnął pustego marginesu w prawo.
      data-avatar-group={listId}
    >
      {visible.map((item, index) => {
        const open = hovered === item.id;
        const src = item.image ? buildAvatarSrc(item.image, spec.px) : "";
        const srcSet = item.image ? buildAvatarSrcSet(item.image, spec.px) : "";
        const inner = (
          <>
            <span
              role="tooltip"
              aria-hidden={!open}
              className={cn(
                "pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[16rem]",
                "-translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-1.5",
                "text-left shadow-md transition-all duration-150",
                open ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-95 opacity-0",
              )}
            >
              <span className="block text-xs font-semibold leading-tight text-popover-foreground">
                {item.name}
              </span>
              {item.designation ? (
                <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                  {item.designation}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                spec.cls,
                "relative flex items-center justify-center overflow-hidden rounded-full",
                "border border-background bg-muted font-semibold uppercase text-muted-foreground",
                "transition-transform duration-150 group-hover/avatar:-translate-y-0.5",
                item.anonymous ? "text-muted-foreground/70" : "",
              )}
            >
              {src ? (
                <img
                  src={src}
                  srcSet={srcSet || undefined}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span aria-hidden="true">
                  {item.anonymous ? "\u00b7\u00b7\u00b7" : avatarInitials(item.name)}
                </span>
              )}
            </span>
          </>
        );

        return (
          <li
            key={item.id}
            className={cn("group/avatar relative", index > 0 ? "-ml-2" : "")}
            style={{ zIndex: visible.length - index }}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered((prev) => (prev === item.id ? null : prev))}
          >
            {item.href ? (
              <a
                href={item.href}
                className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={item.designation ? `${item.name} - ${item.designation}` : item.name}
                onFocus={() => setHovered(item.id)}
                onBlur={() => setHovered((prev) => (prev === item.id ? null : prev))}
              >
                {inner}
              </a>
            ) : (
              <span
                tabIndex={0}
                role="img"
                className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={item.designation ? `${item.name} - ${item.designation}` : item.name}
                onFocus={() => setHovered(item.id)}
                onBlur={() => setHovered((prev) => (prev === item.id ? null : prev))}
              >
                {inner}
              </span>
            )}
          </li>
        );
      })}

      {remaining > 0 ? (
        <li className="-ml-2" style={{ zIndex: 0 }}>
          <span
            className={cn(
              spec.cls,
              "flex items-center justify-center rounded-full border border-background",
              "bg-muted font-semibold text-muted-foreground",
            )}
            aria-label={overflowLabel ? overflowLabel(remaining) : `+${remaining}`}
            title={overflowLabel ? overflowLabel(remaining) : undefined}
          >
            +{remaining}
          </span>
        </li>
      ) : null}
    </ul>
  );
}

export default AvatarGroup;

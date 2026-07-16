// Registry mapping layout_variant (1..6) to component + label + SVG preview.
import type { FC } from "react";
import type { ArchiveLayoutProps } from "./types";
import {
  LayoutMinimal,
  LayoutClassic,
  LayoutMagazine,
  LayoutHero,
  LayoutDark,
  LayoutBento,
} from "./variants";

export type LayoutVariant = 1 | 2 | 3 | 4 | 5 | 6;

export interface LayoutRegistryEntry {
  id: LayoutVariant;
  Component: FC<ArchiveLayoutProps>;
  preview: FC<{ className?: string }>;
}

function P1({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect width="120" height="80" fill="hsl(var(--muted))" opacity="0.3" />
      <rect x="10" y="12" width="35" height="6" fill="hsl(var(--foreground))" opacity="0.7" />
      <line x1="10" y1="26" x2="110" y2="26" stroke="hsl(var(--border))" />
      <g fill="hsl(var(--foreground))" opacity="0.25">
        <rect x="10" y="34" width="30" height="20" rx="2" />
        <rect x="45" y="34" width="30" height="20" rx="2" />
        <rect x="80" y="34" width="30" height="20" rx="2" />
        <rect x="10" y="58" width="30" height="16" rx="2" />
        <rect x="45" y="58" width="30" height="16" rx="2" />
        <rect x="80" y="58" width="30" height="16" rx="2" />
      </g>
    </svg>
  );
}
function P2({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect width="120" height="80" fill="hsl(var(--muted))" opacity="0.3" />
      <rect x="10" y="8" width="100" height="16" fill="hsl(var(--brand))" opacity="0.2" />
      <rect x="14" y="12" width="30" height="4" fill="hsl(var(--foreground))" opacity="0.7" />
      <g fill="hsl(var(--foreground))" opacity="0.25">
        <rect x="10" y="30" width="65" height="20" rx="2" />
        <rect x="10" y="52" width="65" height="20" rx="2" />
        <rect x="80" y="30" width="30" height="42" rx="2" fill="hsl(var(--brand))" opacity="0.3" />
      </g>
    </svg>
  );
}
function P3({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <defs>
        <linearGradient id="g3" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="hsl(var(--brand))" stopOpacity="0.3" />
          <stop offset="1" stopColor="hsl(var(--brand))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="120" height="80" fill="hsl(var(--muted))" opacity="0.3" />
      <rect x="0" y="0" width="120" height="24" fill="url(#g3)" />
      <rect x="10" y="8" width="40" height="6" fill="hsl(var(--foreground))" opacity="0.7" />
      <g fill="hsl(var(--foreground))" opacity="0.25">
        <rect x="10" y="30" width="55" height="42" rx="3" />
        <rect x="70" y="30" width="18" height="20" rx="2" />
        <rect x="92" y="30" width="18" height="20" rx="2" />
        <rect x="70" y="52" width="18" height="20" rx="2" />
        <rect x="92" y="52" width="18" height="20" rx="2" />
      </g>
    </svg>
  );
}
function P4({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <defs>
        <radialGradient id="g4" cx="0.2" cy="0.3" r="0.6">
          <stop offset="0" stopColor="hsl(var(--brand))" stopOpacity="0.5" />
          <stop offset="1" stopColor="hsl(var(--brand))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="80" fill="hsl(var(--muted))" opacity="0.3" />
      <rect x="0" y="0" width="120" height="34" fill="url(#g4)" />
      <rect x="10" y="12" width="50" height="8" fill="hsl(var(--foreground))" opacity="0.7" />
      <g fill="hsl(var(--foreground))" opacity="0.25">
        <rect x="10" y="42" width="30" height="30" rx="2" />
        <rect x="45" y="42" width="30" height="30" rx="2" />
        <rect x="80" y="42" width="30" height="30" rx="2" />
      </g>
    </svg>
  );
}
function P5({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect width="120" height="80" fill="hsl(var(--muted))" opacity="0.3" />
      <rect x="0" y="0" width="120" height="30" fill="#0a0a0a" />
      <g stroke="#ffffff" strokeOpacity="0.15">
        <line x1="0" y1="10" x2="120" y2="10" />
        <line x1="0" y1="20" x2="120" y2="20" />
        <line x1="30" y1="0" x2="30" y2="30" />
        <line x1="60" y1="0" x2="60" y2="30" />
        <line x1="90" y1="0" x2="90" y2="30" />
      </g>
      <rect x="10" y="10" width="40" height="6" fill="#ffffff" opacity="0.9" />
      <g fill="hsl(var(--foreground))" opacity="0.25">
        <rect x="10" y="38" width="30" height="30" rx="2" />
        <rect x="45" y="38" width="30" height="30" rx="2" />
        <rect x="80" y="38" width="30" height="30" rx="2" />
      </g>
    </svg>
  );
}
function P6({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden>
      <rect width="120" height="80" fill="hsl(var(--muted))" opacity="0.3" />
      <rect x="8" y="10" width="30" height="60" rx="3" fill="hsl(var(--brand))" opacity="0.15" />
      <rect x="12" y="14" width="22" height="5" fill="hsl(var(--foreground))" opacity="0.7" />
      <g fill="hsl(var(--foreground))" opacity="0.25">
        <rect x="44" y="10" width="30" height="30" rx="2" />
        <rect x="78" y="10" width="34" height="20" rx="2" />
        <rect x="78" y="34" width="18" height="18" rx="2" />
        <rect x="100" y="34" width="12" height="18" rx="2" />
        <rect x="44" y="44" width="20" height="26" rx="2" />
        <rect x="68" y="44" width="20" height="26" rx="2" />
        <rect x="92" y="56" width="20" height="14" rx="2" />
      </g>
    </svg>
  );
}

export const LAYOUT_REGISTRY: Record<LayoutVariant, LayoutRegistryEntry> = {
  1: { id: 1, Component: LayoutMinimal, preview: P1 },
  2: { id: 2, Component: LayoutClassic, preview: P2 },
  3: { id: 3, Component: LayoutMagazine, preview: P3 },
  4: { id: 4, Component: LayoutHero, preview: P4 },
  5: { id: 5, Component: LayoutDark, preview: P5 },
  6: { id: 6, Component: LayoutBento, preview: P6 },
};

export function getLayoutComponent(variant: number): FC<ArchiveLayoutProps> {
  const v = (variant >= 1 && variant <= 6 ? variant : 2) as LayoutVariant;
  return LAYOUT_REGISTRY[v].Component;
}
